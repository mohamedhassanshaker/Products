import { afterEach, describe, expect, it } from "vitest";
import pg from "pg";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import { loadDbEnv } from "@nextbot/db";
import { recordAuditEntry } from "../application/record-audit.js";

const createdTenantIds: string[] = [];
afterEach(async () => {
  for (const id of createdTenantIds.splice(0)) await deleteFixtureTenant(id);
});

/**
 * Security-review-required DB-level proof (Phase 17 exit gate, FR-ADM-03/NFR-5):
 * `audit_log_entry` must be genuinely append-only — `UPDATE`/`DELETE` denied at the
 * database privilege level for both the "app" and "platform" roles (`ensure-roles.ts`),
 * not merely "not called" at the application layer. Connects directly with `pg`
 * (bypassing Drizzle/withTenant) so this proves the actual grant.
 */
describe("audit_log_entry append-only grants (FR-ADM-03/NFR-5 security review)", () => {
  it("the app role can INSERT/SELECT but not UPDATE/DELETE", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const entryId = await recordAuditEntry(ctx, {
      actorLabel: "test-actor",
      actionType: "test.action",
      outcome: "Success",
      details: { note: "grant test" },
    });

    const env = loadDbEnv();
    const appClient = new pg.Client({ connectionString: env.NEXTBOT_DB_APP_URL });
    await appClient.connect();
    try {
      await appClient.query("BEGIN");
      await appClient.query("SELECT set_config('app.current_tenant', $1, true)", [ctx.tenantId]);
      const selectResult = await appClient.query(`SELECT id FROM audit_log_entry WHERE id = $1`, [entryId]);
      expect(selectResult.rows).toHaveLength(1);
      await appClient.query("ROLLBACK");

      await appClient.query("BEGIN");
      await appClient.query("SELECT set_config('app.current_tenant', $1, true)", [ctx.tenantId]);
      await expect(
        appClient.query(`UPDATE audit_log_entry SET actor_label = 'tampered' WHERE id = $1`, [entryId]),
      ).rejects.toThrow(/permission denied/i);
      await appClient.query("ROLLBACK");

      await appClient.query("BEGIN");
      await appClient.query("SELECT set_config('app.current_tenant', $1, true)", [ctx.tenantId]);
      await expect(appClient.query(`DELETE FROM audit_log_entry WHERE id = $1`, [entryId])).rejects.toThrow(/permission denied/i);
      await appClient.query("ROLLBACK");
    } finally {
      await appClient.end();
    }
  });

  it("the platform (BYPASSRLS) role also cannot UPDATE/DELETE", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const entryId = await recordAuditEntry(ctx, {
      actorLabel: "test-actor",
      actionType: "test.action",
      outcome: "Success",
      details: {},
    });

    const env = loadDbEnv();
    const platformClient = new pg.Client({ connectionString: env.NEXTBOT_DB_PLATFORM_URL });
    await platformClient.connect();
    try {
      await platformClient.query("BEGIN");
      await expect(
        platformClient.query(`UPDATE audit_log_entry SET actor_label = 'tampered' WHERE id = $1`, [entryId]),
      ).rejects.toThrow(/permission denied/i);
      await platformClient.query("ROLLBACK");
    } finally {
      await platformClient.end();
    }
  });
});
