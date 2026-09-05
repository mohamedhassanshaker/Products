import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@nextbot/db";
import { withPlatform } from "@nextbot/db/platform-only";
import { TenantAlreadyExistsError, RetentionPeriodInvalidError } from "@nextbot/contracts";
import { provisionTenant } from "./provision-tenant.js";
import { listActiveTenantContexts } from "./list-tenant-contexts.js";
import { dropFixtureTenantGraphDatabase } from "../testing/drop-graph-database.test-util.js";

/** Tracks tenant ids created by this file's tests so they can be cleaned up. */
const createdTenantIds: string[] = [];

afterEach(async () => {
  // Phase 7a (ADR-0018) — `provisionTenant()` now also provisions a real Neo4j
  // database per tenant (when the graph store is configured, as it is in this
  // test environment's .env.test) — drop it, and its Postgres routing row (whose
  // FK to `tenant` would otherwise block the `tenant` delete below), before the
  // rest of this cleanup runs.
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

describe("provisionTenant (BL-01 data/domain slice)", () => {
  it("seeds Starter quota defaults and a non-dedicated routing row", async () => {
    const { name, slug } = uniqueName("Starter Co");
    const result = await provisionTenant({
      name,
      slug,
      region: "US",
      planTier: "Starter",
      defaultLanguage: "en",
      retention: { transcriptsDays: 90, toolPayloadsDays: 30, toolMetadataDays: 90, piiDays: 30 },
    });
    createdTenantIds.push(result.id);

    await withPlatform(async (db) => {
      const [quota] = await db
        .select()
        .from(schema.tenantRuntimeQuota)
        .where(eq(schema.tenantRuntimeQuota.tenantId, result.id));
      expect(quota?.maxToolCallsPerSecond).toBe(1);
      expect(quota?.maxConcurrentConversations).toBe(50);
      expect(quota?.maxMcpConnectors).toBe(3);

      const [route] = await db
        .select()
        .from(schema.tenantDatabaseRoute)
        .where(eq(schema.tenantDatabaseRoute.tenantId, result.id));
      expect(route?.isDedicated).toBe(false);

      const [policy] = await db
        .select()
        .from(schema.tenantDataPolicy)
        .where(eq(schema.tenantDataPolicy.tenantId, result.id));
      expect(policy?.retentionTranscriptsDays).toBe(90);
    });
  });

  it("routes Enterprise tenants to the dedicated-database escape hatch record", async () => {
    const { name, slug } = uniqueName("Enterprise Co");
    const result = await provisionTenant({
      name,
      slug,
      region: "EU",
      planTier: "Enterprise",
      defaultLanguage: "en",
      retention: { mode: "indefinite" },
    });
    createdTenantIds.push(result.id);

    await withPlatform(async (db) => {
      const [route] = await db
        .select()
        .from(schema.tenantDatabaseRoute)
        .where(eq(schema.tenantDatabaseRoute.tenantId, result.id));
      expect(route?.isDedicated).toBe(true);

      const [policy] = await db
        .select()
        .from(schema.tenantDataPolicy)
        .where(eq(schema.tenantDataPolicy.tenantId, result.id));
      expect(policy?.retentionTranscriptsDays).toBe(-1);
    });
  });

  it("rejects a duplicate tenant name with TENANT_ALREADY_EXISTS", async () => {
    const { name, slug } = uniqueName("Dup Co");
    const first = await provisionTenant({
      name,
      slug,
      region: "US",
      planTier: "Starter",
      defaultLanguage: "en",
      retention: { mode: "indefinite" },
    });
    createdTenantIds.push(first.id);

    await expect(
      provisionTenant({
        name,
        slug: `${slug}-2`,
        region: "US",
        planTier: "Starter",
        defaultLanguage: "en",
        retention: { mode: "indefinite" },
      }),
    ).rejects.toThrow(TenantAlreadyExistsError);
  });

  it("regression (BE-1): a freshly-provisioned tenant has status Active and is picked up by listActiveTenantContexts()", async () => {
    const { name, slug } = uniqueName("Freshly Active Co");
    const result = await provisionTenant({
      name,
      slug,
      region: "US",
      planTier: "Starter",
      defaultLanguage: "en",
      retention: { mode: "indefinite" },
    });
    createdTenantIds.push(result.id);

    await withPlatform(async (db) => {
      const [row] = await db.select({ status: schema.tenant.status }).from(schema.tenant).where(eq(schema.tenant.id, result.id));
      expect(row?.status).toBe("Active");
    });

    const activeContexts = await listActiveTenantContexts();
    expect(activeContexts.some((ctx) => ctx.tenantId === result.id)).toBe(true);
  });

  it("rejects a blank retention period with RETENTION_PERIOD_INVALID", async () => {
    const { name, slug } = uniqueName("Bad Retention Co");
    await expect(
      provisionTenant({
        name,
        slug,
        region: "US",
        planTier: "Starter",
        defaultLanguage: "en",
        retention: { transcriptsDays: 0 },
      }),
    ).rejects.toThrow(RetentionPeriodInvalidError);
  });
});
