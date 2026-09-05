import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema, getOwnerPool } from "@nextbot/db";
import { withPlatform } from "@nextbot/db/platform-only";
import { provisionTenant } from "./provision-tenant.js";
import { updateTenantStatus } from "./update-tenant-status.js";
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

describe("updateTenantStatus (Platform Manager console Phase 2, NFR-11)", () => {
  it("writes the new status and exactly one audit row, atomically", async () => {
    const tenant = await makeTenant("Status Co");

    const result = await updateTenantStatus(tenant.id, "Suspended", "operator-token-holder");
    expect(result).toEqual({ id: tenant.id, status: "Suspended" });

    const [row] = await withPlatform(async (db) => db.select().from(schema.tenant).where(eq(schema.tenant.id, tenant.id)));
    expect(row?.status).toBe("Suspended");

    const auditRows = await withPlatform(async (db) =>
      db.select().from(schema.platformAuditLogEntry).where(eq(schema.platformAuditLogEntry.targetTenantId, tenant.id)),
    );
    // One from provisionTenant, one from this status change.
    const statusRows = auditRows.filter((r) => r.actionType === "tenant.update-status");
    expect(statusRows).toHaveLength(1);
    expect(statusRows[0]?.actorLabel).toBe("operator-token-holder");
    expect(statusRows[0]?.details).toMatchObject({ previousStatus: "Active", newStatus: "Suspended" });
  });

  it("returns null for a nonexistent tenant id and writes no audit row", async () => {
    const missingId = crypto.randomUUID();
    const result = await updateTenantStatus(missingId, "Suspended");
    expect(result).toBeNull();

    const auditRows = await withPlatform(async (db) =>
      db.select().from(schema.platformAuditLogEntry).where(eq(schema.platformAuditLogEntry.targetTenantId, missingId)),
    );
    expect(auditRows).toHaveLength(0);
  });
});
