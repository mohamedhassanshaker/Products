import { describe, expect, it } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadDbEnv } from "../config.js";
import { getOwnerPool } from "../pool.js";
import { ensureRoles } from "./ensure-roles.js";
import { runSqlMigrations } from "./run-sql-migrations.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("bootstrap (migrations + role provisioning) — idempotency", () => {
  it("runSqlMigrations is a no-op once every migration has already been applied", async () => {
    const ownerPool = getOwnerPool();
    const applied = await runSqlMigrations(ownerPool, path.join(__dirname, "..", "..", "migrations"));
    expect(applied).toEqual([]);
  });

  it("ensureRoles can be run twice without error (idempotent CREATE ROLE + grants)", async () => {
    const env = loadDbEnv();
    const ownerPool = getOwnerPool();
    // Always pass gatewayUrl here — this test calls ensureRoles() directly (bypassing
    // migrate.ts), so it must supply the same real argument set migrate.ts always
    // does. See the "credential grant regression" test below for exactly what goes
    // wrong if a caller omits it once `credential` already exists.
    await expect(
      ensureRoles(ownerPool, {
        appUrl: env.NEXTBOT_DB_APP_URL,
        platformUrl: env.NEXTBOT_DB_PLATFORM_URL,
        gatewayUrl: env.NEXTBOT_DB_GATEWAY_URL,
      }),
    ).resolves.toBeUndefined();
  });

  /**
   * Regression test for QA Defect 1: reproduces QA's exact repro verbatim —
   * an operator (or a compromised process) flips the "app" role's BYPASSRLS
   * attribute directly, outside of `ensureRoles()`. Before the fix, re-running
   * `ensureRoles()` (the same call `migrate`/`migrate:test` makes) performed
   * grants only and left the drifted attribute untouched, silently defeating
   * ADR-0001's isolation model (NFR-4). After the fix, `ensureRoles()` must
   * reconcile the attribute back on every run, unconditionally.
   */
  it("ensureRoles repairs BYPASSRLS drift on the app role (QA Defect 1 regression)", async () => {
    const env = loadDbEnv();
    const ownerPool = getOwnerPool();
    const appRoleName = decodeURIComponent(new URL(env.NEXTBOT_DB_APP_URL).username);

    // Simulate the drift QA reproduced: directly grant BYPASSRLS to the app role,
    // bypassing ensureRoles entirely (e.g. a manual ALTER ROLE in production).
    await ownerPool.query(`ALTER ROLE "${appRoleName}" BYPASSRLS`);

    const rolbypassrlsBefore = await ownerPool.query<{ rolbypassrls: boolean }>(
      "SELECT rolbypassrls FROM pg_roles WHERE rolname = $1",
      [appRoleName],
    );
    expect(rolbypassrlsBefore.rows[0]?.rolbypassrls, "drift setup did not take effect").toBe(true);

    // Re-run the same bootstrap entry point `migrate`/`migrate:test` calls.
    await ensureRoles(ownerPool, {
      appUrl: env.NEXTBOT_DB_APP_URL,
      platformUrl: env.NEXTBOT_DB_PLATFORM_URL,
      gatewayUrl: env.NEXTBOT_DB_GATEWAY_URL,
    });

    const rolbypassrlsAfter = await ownerPool.query<{ rolbypassrls: boolean }>(
      "SELECT rolbypassrls FROM pg_roles WHERE rolname = $1",
      [appRoleName],
    );
    expect(
      rolbypassrlsAfter.rows[0]?.rolbypassrls,
      "ensureRoles must repair BYPASSRLS drift on the app role unconditionally, not only at first CREATE ROLE",
    ).toBe(false);
  });

  /**
   * Regression test discovered while adding Phase 4's credential-column-grant
   * security control: calling `ensureRoles()` **without** `gatewayUrl` re-grants
   * table-wide `SELECT` on `credential` to the "app" role via the generic per-role
   * blanket grant (`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES`), and — since
   * the credential-column-restriction step is itself gated on `gateway` being
   * supplied — does NOT reconcile it back afterward. A caller that omits
   * `gatewayUrl` after `credential` already exists silently reintroduces exactly the
   * vulnerability that column restriction exists to prevent. Proves both the break
   * and the self-heal once `gatewayUrl` is supplied again (the same "reconcile on
   * every call" pattern as the BYPASSRLS drift fix above).
   */
  it("omitting gatewayUrl reintroduces blanket SELECT on credential; supplying it again repairs it", async () => {
    const env = loadDbEnv();
    const ownerPool = getOwnerPool();
    const appRoleName = decodeURIComponent(new URL(env.NEXTBOT_DB_APP_URL).username);

    const hasTableWideSelect = async (): Promise<boolean> => {
      // has_table_privilege() alone can't distinguish "table-wide SELECT" from
      // "column-level SELECT grants happen to cover every column" — inspect
      // pg_class.relacl directly (via aclexplode in a LATERAL join, since Postgres
      // disallows set-returning functions directly in a WHERE clause) for a
      // table-wide (no column qualifier) 'SELECT' grant to this role specifically.
      const acl = await ownerPool.query<{ privilege_type: string }>(
        `SELECT acl.privilege_type
         FROM pg_class c, LATERAL aclexplode(c.relacl) AS acl
         WHERE c.relname = 'credential' AND acl.grantee = $1::regrole::oid AND acl.privilege_type = 'SELECT'`,
        [appRoleName],
      );
      return acl.rows.length > 0;
    };

    // Ensure a known-good (restricted) starting state.
    await ensureRoles(ownerPool, {
      appUrl: env.NEXTBOT_DB_APP_URL,
      platformUrl: env.NEXTBOT_DB_PLATFORM_URL,
      gatewayUrl: env.NEXTBOT_DB_GATEWAY_URL,
    });
    expect(await hasTableWideSelect(), "expected the restricted (no table-wide SELECT) starting state").toBe(false);

    // The regression: call without gatewayUrl.
    await ensureRoles(ownerPool, { appUrl: env.NEXTBOT_DB_APP_URL, platformUrl: env.NEXTBOT_DB_PLATFORM_URL });
    expect(await hasTableWideSelect(), "omitting gatewayUrl must not silently leave a broad grant in place forever").toBe(true);

    // The repair: call with gatewayUrl again.
    await ensureRoles(ownerPool, {
      appUrl: env.NEXTBOT_DB_APP_URL,
      platformUrl: env.NEXTBOT_DB_PLATFORM_URL,
      gatewayUrl: env.NEXTBOT_DB_GATEWAY_URL,
    });
    expect(await hasTableWideSelect()).toBe(false);
  });
});
