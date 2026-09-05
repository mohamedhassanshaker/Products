import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema, getOwnerPool } from "@nextbot/db";
import { withPlatform } from "@nextbot/db/platform-only";
import { provisionTenant } from "./provision-tenant.js";
import { dropFixtureTenantGraphDatabase } from "../testing/drop-graph-database.test-util.js";

const createdTenantIds: string[] = [];

afterEach(async () => {
  for (const id of createdTenantIds) {
    // Genuinely append-only for both "app"/"platform" (that's what
    // `platform-audit-log-append-only.int.test.ts` proves) — only the schema-owner
    // role retains DELETE, same test-hygiene exception as `audit_log_entry`'s.
    // `target_tenant_id` is also `ON DELETE SET NULL`, so this step is optional for
    // the *tenant* delete below to succeed, but keeps the test database tidy.
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

/**
 * Platform Manager console Phase 1 (NFR-11) — `provisionTenant()` must write exactly
 * one `platform_audit_log_entry` row, in the same transaction as the tenant itself.
 */
describe("provisionTenant audit trail (NFR-11)", () => {
  it("writes one platform_audit_log_entry row with the real operator actor label", async () => {
    const { name, slug } = uniqueName("Audited Co");
    const result = await provisionTenant(
      { name, slug, region: "US", planTier: "Growth", defaultLanguage: "en", retention: { mode: "indefinite" } },
      "operator-token-holder",
    );
    createdTenantIds.push(result.id);

    const rows = await withPlatform(async (db) =>
      db
        .select()
        .from(schema.platformAuditLogEntry)
        .where(eq(schema.platformAuditLogEntry.targetTenantId, result.id)),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.actionType).toBe("tenant.provision");
    expect(rows[0]?.actorLabel).toBe("operator-token-holder");
    expect(rows[0]?.details).toMatchObject({ name, slug, region: "US", planTier: "Growth" });
  });

  it("defaults the actor label to 'system' for existing non-operator call sites (scripts/seed.ts, tests)", async () => {
    const { name, slug } = uniqueName("Default Actor Co");
    const result = await provisionTenant({
      name,
      slug,
      region: "US",
      planTier: "Starter",
      defaultLanguage: "en",
      retention: { mode: "indefinite" },
    });
    createdTenantIds.push(result.id);

    const rows = await withPlatform(async (db) =>
      db
        .select()
        .from(schema.platformAuditLogEntry)
        .where(eq(schema.platformAuditLogEntry.targetTenantId, result.id)),
    );
    expect(rows[0]?.actorLabel).toBe("system");
  });
});
