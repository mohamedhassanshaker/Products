import { and, eq, isNull } from "drizzle-orm";
import { schema } from "@nextbot/db";
import { withPlatform, type PlatformClient } from "@nextbot/db/platform-only";
import { provisionTenantGraphDatabase } from "./provision-tenant-graph.js";

/**
 * Target Architecture Blueprint Phase 7b fast-follow (ADR-0018 §4, QA's 7a-pass
 * finding) — the missing "repairable by a re-run, not by hand" mechanism ADR-0018
 * §4 requires for a tenant left half-provisioned (`tenant_graph_database_route.
 * provisioned_at IS NULL`).
 *
 * `provisionTenantGraphDatabase()` (called eagerly from `provisionTenant()`, Phase
 * 7a) is best-effort and never blocks tenant creation — a missing/unreachable graph
 * store at tenant-creation time leaves the tenant's routing row at
 * `provisionedAt IS NULL` with `lastProvisionError` populated. Nothing previously
 * re-drove that repair automatically. This sweep does: it lists every stranded
 * routing row (a cross-tenant, platform-level read — `withPlatform()`, per LLD §3.2
 * rule 4) and re-invokes `provisionTenantGraphDatabase(tenantId)` for each, which is
 * itself already idempotent and safe to call any number of times
 * (`ensureTenantGraphDatabase()`'s own contract).
 *
 * Follows the exact shape `reconcileDueServersAcrossAllTenants`
 * (`@nextbot/mcp-registry`) established for a cross-tenant scheduled sweep: one
 * `withPlatform` read to enumerate the affected rows, then a per-tenant repair call
 * that does its own error handling and never lets one tenant's failure stop the
 * sweep for the rest.
 */
export interface ReconcileGraphProvisioningResult {
  /** How many tenants were found with a stranded `provisionedAt IS NULL` row this
   *  sweep tick. */
  strandedCount: number;
  /** Tenant ids whose repair attempt this tick left `provisionedAt` populated
   *  (either it succeeded now, or the row already flipped between the list read and
   *  the repair call — either way, fixed). */
  repairedTenantIds: string[];
  /** Tenant ids still `provisionedAt IS NULL` after this tick's repair attempt —
   *  e.g. the graph store is still unreachable, or genuinely unconfigured in this
   *  environment. Not an error; the next tick tries again. */
  stillStrandedTenantIds: string[];
}

/**
 * Lists every tenant currently recorded as half-provisioned
 * (`tenant_graph_database_route.provisioned_at IS NULL`) — a platform-level read,
 * since this spans every tenant rather than operating inside any one tenant's RLS
 * scope.
 */
async function listStrandedGraphProvisioningTenantIds(): Promise<string[]> {
  return withPlatform(async (db: PlatformClient) => {
    const rows = await db
      .select({ tenantId: schema.tenantGraphDatabaseRoute.tenantId })
      .from(schema.tenantGraphDatabaseRoute)
      .where(isNull(schema.tenantGraphDatabaseRoute.provisionedAt));
    return rows.map((r) => r.tenantId);
  });
}

/** Re-reads one specific tenant's routing row after a repair attempt, to report an
 *  accurate before/after tally — `provisionTenantGraphDatabase()` itself never
 *  throws and never returns a success/failure signal by its own best-effort design,
 *  so this is the only way to know whether a given repair attempt actually landed. */
async function isStillStranded(tenantId: string): Promise<boolean> {
  return withPlatform(async (db: PlatformClient) => {
    const rows = await db
      .select({ tenantId: schema.tenantGraphDatabaseRoute.tenantId })
      .from(schema.tenantGraphDatabaseRoute)
      .where(and(eq(schema.tenantGraphDatabaseRoute.tenantId, tenantId), isNull(schema.tenantGraphDatabaseRoute.provisionedAt)));
    return rows.length > 0;
  });
}

/**
 * The scheduled sweep itself (registered in `apps/worker`'s job registry as
 * `tenancy.graph-provisioning-reconcile`). Idempotent and safe to run concurrently
 * across replicas — same contract every other `apps/worker` job already has
 * (`ensureTenantGraphDatabase()` is itself idempotent, and this function's own
 * "list, then repair" read is not required to be atomic with the repair: a tenant
 * that gets fixed by a concurrent replica between this tick's list-read and its own
 * repair attempt just gets a redundant, harmless re-provisioning call).
 */
export async function reconcileStrandedGraphProvisioning(): Promise<ReconcileGraphProvisioningResult> {
  const strandedTenantIds = await listStrandedGraphProvisioningTenantIds();
  const repairedTenantIds: string[] = [];
  const stillStrandedTenantIds: string[] = [];

  for (const tenantId of strandedTenantIds) {
    try {
      await provisionTenantGraphDatabase(tenantId);
    } catch (err) {
      // provisionTenantGraphDatabase() is documented as never throwing, but this
      // sweep must never let one tenant's unexpected failure stop the rest of the
      // batch regardless — matching every other cross-tenant sweep's per-item
      // isolation (e.g. Phase 5's upgradeConsumers per-consumer try/catch).
      console.error("[tenancy] reconcileStrandedGraphProvisioning: unexpected error repairing tenant", {
        tenantId,
        message: err instanceof Error ? err.message : String(err),
      });
    }

    if (await isStillStranded(tenantId)) {
      stillStrandedTenantIds.push(tenantId);
    } else {
      repairedTenantIds.push(tenantId);
    }
  }

  return { strandedCount: strandedTenantIds.length, repairedTenantIds, stillStrandedTenantIds };
}
