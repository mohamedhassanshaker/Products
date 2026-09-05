import { listActiveTenantContexts } from "@nextbot/tenancy";
import { reclaimExpiredShadowLeases } from "@nextbot/agent-platform";

/**
 * **`deployment.shadow-lease-reaper`** (Target Architecture Blueprint Phase 17, BL-48,
 * ADR-0019 §2.5, LLD §15.5) — returns a `shadow_run` whose lease expired (the worker
 * replica that claimed it crashed mid-replay) to `Pending` so a later pump tick can retry
 * it, bounded by the row's own `attempts` counter.
 *
 * 60s cadence, the same as `knowledge.lease-reaper` and `workflow.lease-reaper`, whose
 * claim/lease/reclaim idiom this mirrors verbatim (ADR-0013 §7). Without it a crashed
 * replica would strand a row in `Claimed` forever — the fail-safe every lease-based design
 * needs.
 */
export async function runDeploymentShadowLeaseReaper(): Promise<{ tenantsChecked: number; reclaimed: number }> {
  const tenants = await listActiveTenantContexts();
  let reclaimed = 0;
  for (const ctx of tenants) {
    try {
      reclaimed += await reclaimExpiredShadowLeases(ctx);
    } catch (err) {
      // One tenant's failure never aborts the sweep for every other tenant — the same
      // contract every `apps/worker` cross-tenant job already has.
      console.error(`NextBot worker: shadow lease-reaper failed for tenant "${ctx.tenantId}"`, err);
    }
  }
  return { tenantsChecked: tenants.length, reclaimed };
}
