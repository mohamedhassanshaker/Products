import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema, getOwnerPool } from "@nextbot/db";
import { withPlatform } from "@nextbot/db/platform-only";
import { provisionTenant } from "./provision-tenant.js";
import { updateTenantPlanTier } from "./update-tenant-plan-tier.js";
import { reseedTenantQuotaFromTier } from "./reseed-tenant-quota.js";
import { updatePlanTierDefinition } from "./plan-tier-definitions.js";
import { dropFixtureTenantGraphDatabase } from "../testing/drop-graph-database.test-util.js";

const createdTenantIds: string[] = [];

afterEach(async () => {
  for (const id of createdTenantIds) {
    await getOwnerPool().query(`DELETE FROM platform_audit_log_entry WHERE target_tenant_id = $1`, [id]);
    // Phase 7a (ADR-0018) — drop the real Neo4j database `provisionTenant()` now
    // also provisions per tenant.
    await dropFixtureTenantGraphDatabase(id);
  }
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
  // Restore the Growth tier definition to its migration-seeded values in case a
  // test mutated it, so other tests/suites relying on the seeded defaults are
  // unaffected.
  await withPlatform(async (db) => {
    await db
      .update(schema.planTierDefinition)
      .set({ maxToolCallsPerSecond: 5, maxConcurrentConversations: 500, maxMcpConnectors: 15 })
      .where(eq(schema.planTierDefinition.tier, "Growth"));
  });
});

function uniqueName(label: string): { name: string; slug: string } {
  const suffix = crypto.randomUUID().slice(0, 8);
  return { name: `${label} ${suffix}`, slug: `${label.toLowerCase()}-${suffix}` };
}

async function makeTenant(label: string, planTier: "Starter" | "Growth" | "Enterprise" = "Starter") {
  const { name, slug } = uniqueName(label);
  const result = await provisionTenant({
    name,
    slug,
    region: "US",
    planTier,
    defaultLanguage: "en",
    retention: { mode: "indefinite" },
  });
  createdTenantIds.push(result.id);
  return result;
}

describe("reseedTenantQuotaFromTier (Platform Manager console Phase 2, NFR-11)", () => {
  it("overwrites a hand-tuned quota with the tenant's current tier's defaults", async () => {
    const tenant = await makeTenant("Reseed Co", "Starter");

    // Simulate an operator hand-tuning the quota away from the Starter defaults.
    await withPlatform(async (db) =>
      db
        .update(schema.tenantRuntimeQuota)
        .set({ maxToolCallsPerSecond: 999, maxConcurrentConversations: 999, maxMcpConnectors: 999 })
        .where(eq(schema.tenantRuntimeQuota.tenantId, tenant.id)),
    );

    const result = await reseedTenantQuotaFromTier(tenant.id, "operator-token-holder");
    expect(result).toEqual({
      tenantId: tenant.id,
      maxToolCallsPerSecond: 1,
      maxConcurrentConversations: 50,
      maxMcpConnectors: 3,
    });

    const [quotaRow] = await withPlatform(async (db) =>
      db.select().from(schema.tenantRuntimeQuota).where(eq(schema.tenantRuntimeQuota.tenantId, tenant.id)),
    );
    expect(quotaRow?.maxToolCallsPerSecond).toBe(1);
    expect(quotaRow?.maxConcurrentConversations).toBe(50);
    expect(quotaRow?.maxMcpConnectors).toBe(3);

    const auditRows = await withPlatform(async (db) =>
      db.select().from(schema.platformAuditLogEntry).where(eq(schema.platformAuditLogEntry.targetTenantId, tenant.id)),
    );
    const reseedRows = auditRows.filter((r) => r.actionType === "tenant.reseed-quota");
    expect(reseedRows).toHaveLength(1);
    expect(reseedRows[0]?.actorLabel).toBe("operator-token-holder");
  });

  it("reflects a plan-tier-definition edit made after the tenant was labeled into that tier", async () => {
    const tenant = await makeTenant("Reseed Edited Co", "Starter");
    await updateTenantPlanTier(tenant.id, "Growth");

    // Operator edits the Growth tier's quota template.
    await updatePlanTierDefinition("Growth", { maxMcpConnectors: 42 });

    const result = await reseedTenantQuotaFromTier(tenant.id);
    expect(result?.maxMcpConnectors).toBe(42);
  });

  it("returns null for a nonexistent tenant id", async () => {
    const result = await reseedTenantQuotaFromTier(crypto.randomUUID());
    expect(result).toBeNull();
  });
});
