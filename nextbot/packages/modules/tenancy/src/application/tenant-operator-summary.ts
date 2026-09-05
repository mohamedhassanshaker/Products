import { eq } from "drizzle-orm";
import { schema, type Region } from "@nextbot/db";
import { withPlatform, type PlatformClient } from "@nextbot/db/platform-only";
import type { PlanTierValue } from "@nextbot/contracts";
import { getLiveConcurrentRunCount } from "./runtime-quota.js";
import type { TenantStatusValue } from "./list-all-tenants.js";

/** Platform Manager console Tenant Detail screen (NFR-11), read-only this phase —
 * status/plan-tier change actions are Phase 2 scope. */
export interface TenantOperatorSummary {
  id: string;
  name: string;
  slug: string;
  region: Region;
  status: TenantStatusValue;
  planTier: PlanTierValue;
  defaultLanguage: string;
  createdAt: Date;
  isDedicatedDatabase: boolean;
  dataPolicy: {
    retentionTranscriptsDays: number;
    retentionToolPayloadsDays: number;
    retentionToolMetadataDays: number;
    retentionPiiDays: number;
    residencyRegion: Region;
  } | null;
  runtimeQuota: {
    maxConcurrentRuns: number | null;
    maxTokensPerMinute: number | null;
    maxToolCallsPerSecond: number | null;
    maxConcurrentConversations: number | null;
    maxMcpConnectors: number | null;
  } | null;
  liveConcurrentRuns: number;
}

/**
 * Cross-tenant single-tenant detail read (NFR-11), joining `tenant` + its 1:1
 * `tenant_data_policy`/`tenant_runtime_quota`/`tenant_database_route` rows, plus the
 * real live "concurrent runs" gauge (`getLiveConcurrentRunCount`, already
 * doc-commented in `runtime-quota.ts` as built for exactly this screen). Returns
 * `null` when no tenant with this id exists, so the caller can render a 404 rather
 * than a confusing empty-fields detail page.
 */
export async function getTenantOperatorSummary(tenantId: string): Promise<TenantOperatorSummary | null> {
  const result = await withPlatform(async (db: PlatformClient) => {
    const [tenantRow] = await db.select().from(schema.tenant).where(eq(schema.tenant.id, tenantId));
    if (!tenantRow) return null;

    const [policyRow] = await db
      .select()
      .from(schema.tenantDataPolicy)
      .where(eq(schema.tenantDataPolicy.tenantId, tenantId));
    const [quotaRow] = await db
      .select()
      .from(schema.tenantRuntimeQuota)
      .where(eq(schema.tenantRuntimeQuota.tenantId, tenantId));
    const [routeRow] = await db
      .select()
      .from(schema.tenantDatabaseRoute)
      .where(eq(schema.tenantDatabaseRoute.tenantId, tenantId));

    return { tenantRow, policyRow, quotaRow, routeRow };
  });

  if (!result) return null;
  const { tenantRow, policyRow, quotaRow, routeRow } = result;

  return {
    id: tenantRow.id,
    name: tenantRow.name,
    slug: tenantRow.slug,
    region: tenantRow.region,
    status: tenantRow.status,
    planTier: tenantRow.planTier,
    defaultLanguage: tenantRow.defaultLanguage,
    createdAt: tenantRow.createdAt,
    isDedicatedDatabase: routeRow?.isDedicated ?? false,
    dataPolicy: policyRow
      ? {
          retentionTranscriptsDays: policyRow.retentionTranscriptsDays,
          retentionToolPayloadsDays: policyRow.retentionToolPayloadsDays,
          retentionToolMetadataDays: policyRow.retentionToolMetadataDays,
          retentionPiiDays: policyRow.retentionPiiDays,
          residencyRegion: policyRow.residencyRegion,
        }
      : null,
    runtimeQuota: quotaRow
      ? {
          maxConcurrentRuns: quotaRow.maxConcurrentRuns,
          maxTokensPerMinute: quotaRow.maxTokensPerMinute,
          maxToolCallsPerSecond: quotaRow.maxToolCallsPerSecond,
          maxConcurrentConversations: quotaRow.maxConcurrentConversations,
          maxMcpConnectors: quotaRow.maxMcpConnectors,
        }
      : null,
    // Read outside the withPlatform transaction (Redis, not Postgres) — mirrors
    // `listAllTenants()`'s identical composition.
    liveConcurrentRuns: await getLiveConcurrentRunCount(tenantId),
  };
}
