import { reconcileStrandedGraphProvisioning } from "@nextbot/tenancy";

/**
 * Target Architecture Blueprint Phase 7b fast-follow (ADR-0018 §4) — repairs any
 * tenant left with `tenant_graph_database_route.provisioned_at IS NULL` (a graph
 * store that was unreachable/unconfigured at tenant-creation time, per Phase 7a's
 * best-effort `provisionTenantGraphDatabase()`). Runs every 5 minutes: this is a
 * repair sweep for a rare, already-non-fatal condition, not a hot path, so a
 * slower cadence than the 60s connector/MCP health sweeps is appropriate.
 */
export async function runTenancyGraphProvisioningReconcile(): Promise<ReturnType<typeof reconcileStrandedGraphProvisioning>> {
  return reconcileStrandedGraphProvisioning();
}
