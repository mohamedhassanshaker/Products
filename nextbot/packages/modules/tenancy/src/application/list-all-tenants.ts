import { eq } from "drizzle-orm";
import { schema, type Region } from "@nextbot/db";
import { withPlatform, type PlatformClient } from "@nextbot/db/platform-only";
import type { PlanTierValue } from "@nextbot/contracts";
import { getLiveConcurrentRunCount } from "./runtime-quota.js";

/** `tenant.status` as Drizzle infers it from the `tenant_status` Postgres enum —
 * re-derived here (rather than adding a `contracts` TypeBox schema) since Phase 1
 * only ever *reads* this field; Phase 2 (`updateTenantStatus`) is the first caller
 * that will need a validated write-side schema for it. */
export type TenantStatusValue = (typeof schema.tenant.$inferSelect)["status"];

/**
 * One row of the Platform Manager console's Tenant List (NFR-11): status/plan-tier/
 * region plus the live "concurrent runs" quota gauge (current usage over the
 * configured cap, `null` cap meaning "no limit").
 */
export interface TenantSummary {
  id: string;
  name: string;
  slug: string;
  region: Region;
  status: TenantStatusValue;
  planTier: PlanTierValue;
  createdAt: Date;
  maxConcurrentRuns: number | null;
  liveConcurrentRuns: number;
}

/**
 * Cross-tenant tenant listing (NFR-11 — the Platform Operator persona's Tenant List
 * screen). Runs via `withPlatform`, one of the two call sites LLD §3.2 rule 4
 * permits (the other being provisioning) — a cross-tenant read has no single
 * `TenantContext` to scope a `withTenant` call to.
 *
 * The live "concurrent runs" gauge is read from Redis (`getLiveConcurrentRunCount`)
 * *outside* the DB transaction, one call per tenant — mirrors the existing
 * `apps/web/app/api/v1/admin/mcp-health/route.ts` composition pattern of enriching a
 * DB-sourced row list with a second, per-row live-data source.
 */
export async function listAllTenants(): Promise<TenantSummary[]> {
  const rows = await withPlatform(async (db: PlatformClient) => {
    return db
      .select({
        id: schema.tenant.id,
        name: schema.tenant.name,
        slug: schema.tenant.slug,
        region: schema.tenant.region,
        status: schema.tenant.status,
        planTier: schema.tenant.planTier,
        createdAt: schema.tenant.createdAt,
        maxConcurrentRuns: schema.tenantRuntimeQuota.maxConcurrentRuns,
      })
      .from(schema.tenant)
      .leftJoin(schema.tenantRuntimeQuota, eq(schema.tenantRuntimeQuota.tenantId, schema.tenant.id))
      .orderBy(schema.tenant.name);
  });

  return Promise.all(
    rows.map(async (row) => ({
      ...row,
      liveConcurrentRuns: await getLiveConcurrentRunCount(row.id),
    })),
  );
}
