import { reapWorkflowRunLeases } from "@nextbot/workflows";

/**
 * Target Architecture Blueprint Phase 16 (BL-47b, LLD §14.6.2's corrected job table) —
 * returns runs whose `workflow_run_lease` expired (their executor replica crashed
 * mid-run) to claimable. Modelled verbatim on `knowledge.lease-reaper` /
 * `reclaimExpiredLeases()`, the real lease-reclaim precedent in this codebase.
 *
 * Not what MAKES reclaim correct — `acquireRunLease`'s own
 * `ON CONFLICT ... WHERE expires_at < now()` already lets a new claimer take over an
 * expired lease with no reaper having run. This job exists so an abandoned lease does
 * not linger as a row an operator would read as "someone is working on this". 60s tick.
 */
export async function runWorkflowLeaseReaper(): Promise<ReturnType<typeof reapWorkflowRunLeases>> {
  return reapWorkflowRunLeases();
}
