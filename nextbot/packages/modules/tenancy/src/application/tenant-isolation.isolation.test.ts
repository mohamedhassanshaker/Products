import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { withTenant, schema } from "@nextbot/db";
import { withPlatform } from "@nextbot/db/platform-only";
import { provisionTenant } from "./provision-tenant.js";
import { dropFixtureTenantGraphDatabase } from "../testing/drop-graph-database.test-util.js";

/**
 * ADR-0001 §6 verification suite: proves the RLS isolation model actually holds for
 * every tenant-scoped table this phase introduces (`tenant_data_policy`,
 * `tenant_runtime_quota`, `tenant_database_route`), not merely that the pattern was
 * "applied" in the migration.
 */
describe("tenant isolation (ADR-0001 §6 / LLD §3.2)", () => {
  const createdTenantIds: string[] = [];

  afterAll(async () => {
    // Phase 7a (ADR-0018) — drop the real Neo4j database `provisionTenant()` now
    // also provisions per tenant.
    for (const id of createdTenantIds) await dropFixtureTenantGraphDatabase(id);
    await withPlatform(async (db) => {
      for (const id of createdTenantIds) {
        await db.delete(schema.tenantGraphDatabaseRoute).where(eq(schema.tenantGraphDatabaseRoute.tenantId, id));
        await db.delete(schema.tenantDatabaseRoute).where(eq(schema.tenantDatabaseRoute.tenantId, id));
        await db.delete(schema.tenantRuntimeQuota).where(eq(schema.tenantRuntimeQuota.tenantId, id));
        await db.delete(schema.tenantDataPolicy).where(eq(schema.tenantDataPolicy.tenantId, id));
        // Target Architecture Blueprint Phase 19 (BL-50, FR-OC-08) — the new tenant-opt-in row provisionTenant() now also inserts.
        await db.delete(schema.tenantIdentityResolutionPolicy).where(eq(schema.tenantIdentityResolutionPolicy.tenantId, id));
        await db.delete(schema.tenant).where(eq(schema.tenant.id, id));
      }
    });
  });

  async function makeTenant(label: string) {
    const suffix = crypto.randomUUID().slice(0, 8);
    const result = await provisionTenant({
      name: `${label} ${suffix}`,
      slug: `${label.toLowerCase()}-${suffix}`,
      region: "US",
      planTier: "Growth",
      defaultLanguage: "en",
      retention: { mode: "indefinite" },
    });
    createdTenantIds.push(result.id);
    return result;
  }

  it("a tenant scoped to A reads zero rows of B's tenant_data_policy", async () => {
    const a = await makeTenant("Iso A");
    const b = await makeTenant("Iso B");

    const rowsSeenByA = await withTenant(
      { tenantId: a.id, region: "US", environment: "Sandbox" },
      (db) => db.select().from(schema.tenantDataPolicy).where(eq(schema.tenantDataPolicy.tenantId, b.id)),
    );
    expect(rowsSeenByA).toHaveLength(0);

    const rowsSeenByAOwn = await withTenant(
      { tenantId: a.id, region: "US", environment: "Sandbox" },
      (db) => db.select().from(schema.tenantDataPolicy).where(eq(schema.tenantDataPolicy.tenantId, a.id)),
    );
    expect(rowsSeenByAOwn).toHaveLength(1);
  });

  it("a tenant scoped to A reads zero rows of B's tenant_runtime_quota", async () => {
    const a = await makeTenant("Iso Quota A");
    const b = await makeTenant("Iso Quota B");

    const rows = await withTenant({ tenantId: a.id, region: "US", environment: "Sandbox" }, (db) =>
      db.select().from(schema.tenantRuntimeQuota).where(eq(schema.tenantRuntimeQuota.tenantId, b.id)),
    );
    expect(rows).toHaveLength(0);
  });

  it("a tenant scoped to A reads zero rows of B's tenant_database_route", async () => {
    const a = await makeTenant("Iso Route A");
    const b = await makeTenant("Iso Route B");

    const rows = await withTenant({ tenantId: a.id, region: "US", environment: "Sandbox" }, (db) =>
      db.select().from(schema.tenantDatabaseRoute).where(eq(schema.tenantDatabaseRoute.tenantId, b.id)),
    );
    expect(rows).toHaveLength(0);
  });

  it("an INSERT under A's context with B's tenant_id is rejected by WITH CHECK", async () => {
    const a = await makeTenant("Iso Insert A");
    const b = await makeTenant("Iso Insert B");

    await expect(
      withTenant({ tenantId: a.id, region: "US", environment: "Sandbox" }, (db) =>
        db.insert(schema.tenantRuntimeQuota).values({ tenantId: b.id }),
      ),
    ).rejects.toThrow();
  });
});
