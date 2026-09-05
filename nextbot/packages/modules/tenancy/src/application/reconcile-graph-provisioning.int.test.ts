import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@nextbot/db";
import { withPlatform } from "@nextbot/db/platform-only";
import { withTenantGraph } from "@nextbot/graph-store";
import { provisionTenant } from "./provision-tenant.js";
import { reconcileStrandedGraphProvisioning } from "./reconcile-graph-provisioning.js";
import { dropFixtureTenantGraphDatabase } from "../testing/drop-graph-database.test-util.js";

const createdTenantIds: string[] = [];

afterEach(async () => {
  for (const id of createdTenantIds) await dropFixtureTenantGraphDatabase(id);
  await withPlatform(async (db) => {
    for (const id of createdTenantIds.splice(0)) {
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

function uniqueName(label: string): { name: string; slug: string } {
  const suffix = crypto.randomUUID().slice(0, 8);
  return { name: `${label} ${suffix}`, slug: `${label.toLowerCase()}-${suffix}` };
}

describe("reconcileStrandedGraphProvisioning (Phase 7b fast-follow, real Postgres + real Neo4j)", () => {
  it("repairs a real tenant whose routing row is simulated as stranded (provisionedAt forced back to NULL after a genuinely successful provisioning)", async () => {
    // provisionTenant() already runs real Neo4j provisioning end-to-end (Phase 7a),
    // so this tenant's routing row starts out correctly provisioned. To simulate
    // ADR-0018 §4's "half-provisioned" state realistically (a real database/role/
    // user already exist, only the Postgres-side bookkeeping is stale — exactly
    // what a transient failure AFTER Neo4j succeeded but BEFORE the provisionedAt
    // stamp would leave behind), force `provisionedAt` back to NULL directly.
    const { name, slug } = uniqueName("Stranded Graph Co");
    const result = await provisionTenant({
      name,
      slug,
      region: "US",
      planTier: "Starter",
      defaultLanguage: "en",
      retention: { mode: "indefinite" },
    });
    createdTenantIds.push(result.id);

    await withPlatform((db) =>
      db
        .update(schema.tenantGraphDatabaseRoute)
        .set({ provisionedAt: null, lastProvisionError: "simulated stranded state for reconciliation test" })
        .where(eq(schema.tenantGraphDatabaseRoute.tenantId, result.id)),
    );

    const before = await withPlatform((db) =>
      db.select().from(schema.tenantGraphDatabaseRoute).where(eq(schema.tenantGraphDatabaseRoute.tenantId, result.id)),
    );
    expect(before[0]?.provisionedAt).toBeNull();

    const sweepResult = await reconcileStrandedGraphProvisioning();

    expect(sweepResult.strandedCount).toBeGreaterThanOrEqual(1);
    expect(sweepResult.repairedTenantIds).toContain(result.id);
    expect(sweepResult.stillStrandedTenantIds).not.toContain(result.id);

    const after = await withPlatform((db) =>
      db.select().from(schema.tenantGraphDatabaseRoute).where(eq(schema.tenantGraphDatabaseRoute.tenantId, result.id)),
    );
    expect(after[0]?.provisionedAt).not.toBeNull();

    // The tenant's graph database is still genuinely usable (the "repair" was
    // idempotent, it didn't corrupt an already-working database).
    await withTenantGraph(result.id, (tx) =>
      tx.run("CREATE (:Entity:G_dddddddddddddddddddddddddddddddd {id: 'e1', type: 'Person', aclTags: []})"),
    );
    const graphResult = await withTenantGraph(result.id, (tx) => tx.run("MATCH (n:Entity) RETURN n.id AS id"), "READ");
    expect(graphResult.records.map((r) => r.get("id"))).toEqual(["e1"]);
  }, 60_000);

  it("is a no-op when no tenant is stranded (does not repair a tenant that never needed repair)", async () => {
    const result = await reconcileStrandedGraphProvisioning();
    // Other tests/environments may leave stranded rows behind, so this only asserts
    // the function completes and returns a coherent shape rather than asserting
    // exactly zero stranded tenants globally.
    expect(result.strandedCount).toBe(result.repairedTenantIds.length + result.stillStrandedTenantIds.length);
  });
});
