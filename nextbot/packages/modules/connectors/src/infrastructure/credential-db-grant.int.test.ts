import { afterEach, describe, expect, it } from "vitest";
import pg from "pg";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import { loadDbEnv } from "@nextbot/db";
import { createConnector } from "../application/create-connector.js";

const createdTenantIds: string[] = [];
afterEach(async () => {
  for (const id of createdTenantIds.splice(0)) await deleteFixtureTenant(id);
});

/**
 * Security-review-required DB-level proof (Phase 4 exit gate): `credential.ciphertext`
 * / `credential.dek_ref` are column-grant-restricted to the "gateway" role only (LLD
 * §3.5) — the "app" role (used by `apps/web`'s admin API, via `withTenant`) and the
 * "platform" role (BYPASSRLS, used by `withPlatform`) must both be denied at the
 * database privilege level, not merely "not asked to" at the application layer.
 * Connects directly with `pg` (bypassing Drizzle/withTenant) so this test proves the
 * actual grant, independent of any application-code discipline.
 *
 * QA Defect B1 regression: the "platform" role previously kept the blanket
 * `GRANT SELECT ON ALL TABLES` from `ensureRoles()`'s per-role loop — since
 * "platform" also holds BYPASSRLS, that let it read `ciphertext`/`dek_ref` for any
 * tenant's credentials with no tenant scoping applied at all. Covers all three
 * non-owner roles ("app", "platform", "gateway") rather than only app-vs-gateway.
 */
describe("credential.ciphertext/dek_ref column grants (FR-SEC-02 / ADR-0007 security review)", () => {
  it("the app role cannot SELECT ciphertext or dek_ref; the gateway role can", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const connector = await createConnector(ctx, {
      name: "Grant Test Connector",
      backendType: "Billing",
      transport: "StreamableHTTP",
      endpointUrl: "https://billing.example.com/mcp",
      authMethod: "APIKey",
      credentialPlaintext: "should-never-be-app-readable",
      environment: "Sandbox",
    });

    const env = loadDbEnv();

    const appClient = new pg.Client({ connectionString: env.NEXTBOT_DB_APP_URL });
    await appClient.connect();
    try {
      // A failed query aborts the current Postgres transaction (every later
      // statement in it errors with "current transaction is aborted" rather than
      // actually running) — each denied-column assertion below therefore gets its
      // own BEGIN/ROLLBACK rather than sharing one transaction across both checks.
      await appClient.query("BEGIN");
      await appClient.query("SELECT set_config('app.current_tenant', $1, true)", [ctx.tenantId]);
      await expect(
        appClient.query(`SELECT ciphertext FROM credential WHERE id = $1`, [connector.credentialId]),
      ).rejects.toThrow(/permission denied/i);
      await appClient.query("ROLLBACK");

      await appClient.query("BEGIN");
      await appClient.query("SELECT set_config('app.current_tenant', $1, true)", [ctx.tenantId]);
      await expect(
        appClient.query(`SELECT dek_ref FROM credential WHERE id = $1`, [connector.credentialId]),
      ).rejects.toThrow(/permission denied/i);
      await appClient.query("ROLLBACK");
    } finally {
      await appClient.end();
    }

    const gatewayClient = new pg.Client({ connectionString: env.NEXTBOT_DB_GATEWAY_URL });
    await gatewayClient.connect();
    try {
      await gatewayClient.query("BEGIN");
      await gatewayClient.query("SELECT set_config('app.current_tenant', $1, true)", [ctx.tenantId]);
      const result = await gatewayClient.query(
        `SELECT ciphertext, dek_ref FROM credential WHERE id = $1`,
        [connector.credentialId],
      );
      expect(result.rows).toHaveLength(1);
      await gatewayClient.query("ROLLBACK");
    } finally {
      await gatewayClient.end();
    }
  });

  it("the platform (BYPASSRLS) role cannot SELECT ciphertext or dek_ref at all (QA Defect B1 regression)", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const connector = await createConnector(ctx, {
      name: "Grant Test Connector (platform)",
      backendType: "Billing",
      transport: "StreamableHTTP",
      endpointUrl: "https://billing.example.com/mcp",
      authMethod: "APIKey",
      credentialPlaintext: "should-never-be-platform-readable",
      environment: "Sandbox",
    });

    const env = loadDbEnv();

    const platformClient = new pg.Client({ connectionString: env.NEXTBOT_DB_PLATFORM_URL });
    await platformClient.connect();
    try {
      // Deliberately do NOT set app.current_tenant — platform is BYPASSRLS, so this
      // proves the column grant itself is the control, not tenant scoping (which
      // BYPASSRLS ignores entirely regardless). Each assertion gets its own
      // BEGIN/ROLLBACK — see the app-role test above for why.
      await platformClient.query("BEGIN");
      await expect(
        platformClient.query(`SELECT ciphertext FROM credential WHERE id = $1`, [connector.credentialId]),
      ).rejects.toThrow(/permission denied/i);
      await platformClient.query("ROLLBACK");

      await platformClient.query("BEGIN");
      await expect(
        platformClient.query(`SELECT dek_ref FROM credential WHERE id = $1`, [connector.credentialId]),
      ).rejects.toThrow(/permission denied/i);
      await platformClient.query("ROLLBACK");

      // A bare `SELECT *` must also be denied (it expands to every column,
      // including the two restricted ones) even though platform *does* hold
      // column-level SELECT on the non-secret columns (needed for legitimate
      // administrative row-management — see ensure-roles.ts's doc comment).
      await platformClient.query("BEGIN");
      await expect(
        platformClient.query(`SELECT * FROM credential WHERE id = $1`, [connector.credentialId]),
      ).rejects.toThrow(/permission denied/i);
      await platformClient.query("ROLLBACK");

      // But platform CAN read non-secret columns (needed by tenant deprovisioning's
      // `DELETE ... WHERE tenant_id = $1`, which requires SELECT on any column
      // referenced in a WHERE clause, not just the DELETE privilege).
      await platformClient.query("BEGIN");
      const nonSecret = await platformClient.query(
        `SELECT id, tenant_id, label FROM credential WHERE id = $1`,
        [connector.credentialId],
      );
      expect(nonSecret.rows).toHaveLength(1);
      await platformClient.query("ROLLBACK");
    } finally {
      await platformClient.end();
    }
  });
});
