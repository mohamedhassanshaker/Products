import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { loadDbEnv } from "./config.js";
import { withPlatform } from "./platform-context.js";
import { TENANT_SCOPED_TABLES, PLATFORM_SHARED_TENANT_TABLES } from "./tenant-scoped-tables.js";

/**
 * Generic CI gate (LLD §3.2 rule 1): "A migration adding a tenant-scoped table
 * without these three statements fails CI (`pnpm test:isolation` asserts policy
 * coverage over `information_schema`)." Runs against `information_schema`/`pg_class`/
 * `pg_policies` directly so it holds regardless of *how* a table got its RLS
 * (generated migration, hand-authored SQL, or a future drizzle-kit feature).
 */
describe("RLS coverage manifest (LLD §3.2 rule 1)", () => {
  it.each(TENANT_SCOPED_TABLES)("table '%s' has RLS enabled, forced, and a tenant_isolation policy", async (table) => {
    const result = await withPlatform((db) =>
      db.execute(sql`
        SELECT relrowsecurity AS rls_enabled, relforcerowsecurity AS rls_forced
        FROM pg_class
        WHERE relname = ${table} AND relkind = 'r'
      `),
    );
    const row = result.rows[0] as { rls_enabled: boolean; rls_forced: boolean } | undefined;
    expect(row, `table '${table}' does not exist`).toBeDefined();
    expect(row?.rls_enabled, `table '${table}' must ENABLE ROW LEVEL SECURITY`).toBe(true);
    expect(row?.rls_forced, `table '${table}' must FORCE ROW LEVEL SECURITY`).toBe(true);

    const policies = await withPlatform((db) =>
      db.execute(sql`SELECT policyname FROM pg_policies WHERE tablename = ${table}`),
    );
    expect(
      policies.rows.length,
      `table '${table}' must have at least one RLS policy (expected 'tenant_isolation')`,
    ).toBeGreaterThan(0);
  });
});

/**
 * Target Architecture Blueprint Phase 1 (BL-32, LLD §14.8.7) — the generic
 * RLS/FORCE/policy-presence check above applies equally to the platform-shared
 * tables (they DO have RLS enabled, forced, and a policy — just a different-shaped
 * one). `platform-shared-write-denied.isolation.test.ts` asserts the shape itself
 * (the two-clause USING/WITH CHECK split); this block only asserts presence, exactly
 * like the generic manifest above.
 */
describe("RLS coverage manifest — platform-shared tables (LLD §14.8.7)", () => {
  it.each(PLATFORM_SHARED_TENANT_TABLES)("table '%s' has RLS enabled, forced, and a tenant_isolation policy", async (table) => {
    const result = await withPlatform((db) =>
      db.execute(sql`
        SELECT relrowsecurity AS rls_enabled, relforcerowsecurity AS rls_forced
        FROM pg_class
        WHERE relname = ${table} AND relkind = 'r'
      `),
    );
    const row = result.rows[0] as { rls_enabled: boolean; rls_forced: boolean } | undefined;
    expect(row, `table '${table}' does not exist`).toBeDefined();
    expect(row?.rls_enabled, `table '${table}' must ENABLE ROW LEVEL SECURITY`).toBe(true);
    expect(row?.rls_forced, `table '${table}' must FORCE ROW LEVEL SECURITY`).toBe(true);

    const policies = await withPlatform((db) =>
      db.execute(sql`SELECT policyname FROM pg_policies WHERE tablename = ${table}`),
    );
    expect(
      policies.rows.length,
      `table '${table}' must have at least one RLS policy (expected 'tenant_isolation')`,
    ).toBeGreaterThan(0);
  });
});

/**
 * Standing CI gate for QA Defect 1: table-level RLS/policy presence (above) is
 * necessary but not sufficient — ADR-0001's isolation model is defeated just as
 * completely if the "app" role itself holds BYPASSRLS, since that attribute lets a
 * role skip row security checks entirely regardless of how many policies exist.
 * This asserts the *role*-level attribute directly against `pg_roles`, following the
 * same "regression cannot silently occur" philosophy as the table-level gate above.
 */
describe("Role BYPASSRLS attribute gate (QA Defect 1 / ADR-0001 / NFR-4)", () => {
  it("the app role does not have BYPASSRLS", async () => {
    const env = loadDbEnv();
    const appRoleName = decodeURIComponent(new URL(env.NEXTBOT_DB_APP_URL).username);
    const result = await withPlatform((db) =>
      db.execute(sql`SELECT rolbypassrls FROM pg_roles WHERE rolname = ${appRoleName}`),
    );
    const row = result.rows[0] as { rolbypassrls: boolean } | undefined;
    expect(row, `role '${appRoleName}' does not exist`).toBeDefined();
    expect(
      row?.rolbypassrls,
      `role '${appRoleName}' ("app") must never have BYPASSRLS — this is load-bearing for tenant isolation (ADR-0001)`,
    ).toBe(false);
  });

  it("the platform role has BYPASSRLS", async () => {
    const env = loadDbEnv();
    const platformRoleName = decodeURIComponent(new URL(env.NEXTBOT_DB_PLATFORM_URL).username);
    const result = await withPlatform((db) =>
      db.execute(sql`SELECT rolbypassrls FROM pg_roles WHERE rolname = ${platformRoleName}`),
    );
    const row = result.rows[0] as { rolbypassrls: boolean } | undefined;
    expect(row, `role '${platformRoleName}' does not exist`).toBeDefined();
    expect(
      row?.rolbypassrls,
      `role '${platformRoleName}' ("platform") must have BYPASSRLS for withPlatform() to function`,
    ).toBe(true);
  });
});
