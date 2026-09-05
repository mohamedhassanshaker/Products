import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema, getOwnerPool } from "@nextbot/db";
import { withPlatform } from "@nextbot/db/platform-only";
import { provisionTenant } from "./provision-tenant.js";
import { updateTenantPlanTier } from "./update-tenant-plan-tier.js";
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
});

function uniqueName(label: string): { name: string; slug: string } {
  const suffix = crypto.randomUUID().slice(0, 8);
  return { name: `${label} ${suffix}`, slug: `${label.toLowerCase()}-${suffix}` };
}

async function makeTenant(label: string) {
  const { name, slug } = uniqueName(label);
  const result = await provisionTenant({
    name,
    slug,
    region: "US",
    planTier: "Starter",
    defaultLanguage: "en",
    retention: { mode: "indefinite" },
  });
  createdTenantIds.push(result.id);
  return result;
}

describe("updateTenantPlanTier (Platform Manager console Phase 2, NFR-11)", () => {
  it("changes only the plan_tier label and leaves tenant_runtime_quota untouched — the plan's hard requirement", async () => {
    const tenant = await makeTenant("Relabel Co");

    const [quotaBefore] = await withPlatform(async (db) =>
      db.select().from(schema.tenantRuntimeQuota).where(eq(schema.tenantRuntimeQuota.tenantId, tenant.id)),
    );
    // Starter defaults, per PLAN_TIER_DEFAULTS.
    expect(quotaBefore?.maxToolCallsPerSecond).toBe(1);
    expect(quotaBefore?.maxConcurrentConversations).toBe(50);
    expect(quotaBefore?.maxMcpConnectors).toBe(3);

    const result = await updateTenantPlanTier(tenant.id, "Enterprise", "operator-token-holder");
    expect(result).toEqual({ id: tenant.id, planTier: "Enterprise" });

    const [tenantRow] = await withPlatform(async (db) => db.select().from(schema.tenant).where(eq(schema.tenant.id, tenant.id)));
    expect(tenantRow?.planTier).toBe("Enterprise");

    // The hard requirement under verification: relabeling to Enterprise (whose
    // defaults are wildly different — 16/5000/null) must NOT have touched the
    // Starter-seeded quota row at all.
    const [quotaAfter] = await withPlatform(async (db) =>
      db.select().from(schema.tenantRuntimeQuota).where(eq(schema.tenantRuntimeQuota.tenantId, tenant.id)),
    );
    expect(quotaAfter?.maxToolCallsPerSecond).toBe(1);
    expect(quotaAfter?.maxConcurrentConversations).toBe(50);
    expect(quotaAfter?.maxMcpConnectors).toBe(3);

    const auditRows = await withPlatform(async (db) =>
      db.select().from(schema.platformAuditLogEntry).where(eq(schema.platformAuditLogEntry.targetTenantId, tenant.id)),
    );
    const planTierRows = auditRows.filter((r) => r.actionType === "tenant.update-plan-tier");
    expect(planTierRows).toHaveLength(1);
    expect(planTierRows[0]?.details).toMatchObject({ previousPlanTier: "Starter", newPlanTier: "Enterprise" });
  });

  it("returns null for a nonexistent tenant id", async () => {
    const result = await updateTenantPlanTier(crypto.randomUUID(), "Growth");
    expect(result).toBeNull();
  });
});
