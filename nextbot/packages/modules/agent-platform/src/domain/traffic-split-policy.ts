/**
 * The pure allocation-shape rules for `setTrafficSplit` (Target Architecture Blueprint
 * Phase 17, BL-48/BL-13, ADR-0019 §2.7, LLD §15.4 step 2).
 *
 * Kept in `domain/` (no I/O, no `@nextbot/db` edge) so the "what is a valid split"
 * question is answerable and testable without a database, exactly like
 * `promotion-policy.ts` and `emergency-rollback-policy.ts` already are for their own
 * gates. The *database* invariant (`enforce_deployment_traffic_split_invariant()`,
 * migration `0016`) stays the backstop; this is the friendly, attributable error.
 */

/** One requested allocation: give this version this whole-percent share of traffic. */
export interface TrafficAllocationInput {
  agentDefinitionVersionId: string;
  trafficSplitPct: number;
}

export type TrafficSplitCheck =
  | { valid: true }
  | { valid: false; code: "TRAFFIC_SPLIT_MUST_SUM_TO_100"; detail: string }
  | { valid: false; code: "TRAFFIC_SPLIT_ALLOCATION_INVALID"; detail: string };

/**
 * Validates the *shape* of a requested split. Deliberately says nothing about whether
 * the versions exist, belong to this agent definition, or hold `Production` status —
 * those need database reads and live in `application/traffic-split-service.ts`.
 *
 * Rules, all from LLD §15.4 step 2:
 *  - at least one allocation (an empty split would leave the agent serving nothing);
 *  - every `trafficSplitPct` an integer in 1..100 (a 0% allocation is not a canary, it
 *    is an absent row — writing it would create an active deployment that can never be
 *    selected, which is worse than not writing it);
 *  - no version allocated twice (two rows for one version is not expressible as a
 *    meaningful split, and would make the deployments screen ambiguous);
 *  - the percentages sum to **exactly** 100.
 *
 * @param allocations the requested allocation set.
 * @returns `{valid: true}`, or the specific failure with a human-readable `detail`.
 */
export function checkTrafficSplitAllocations(allocations: TrafficAllocationInput[]): TrafficSplitCheck {
  if (allocations.length === 0) {
    return { valid: false, code: "TRAFFIC_SPLIT_ALLOCATION_INVALID", detail: "At least one version allocation is required." };
  }
  for (const allocation of allocations) {
    if (!Number.isInteger(allocation.trafficSplitPct) || allocation.trafficSplitPct < 1 || allocation.trafficSplitPct > 100) {
      return {
        valid: false,
        code: "TRAFFIC_SPLIT_ALLOCATION_INVALID",
        detail: `Each allocation must be a whole percentage between 1 and 100 (got ${String(allocation.trafficSplitPct)}).`,
      };
    }
  }
  const seen = new Set<string>();
  for (const allocation of allocations) {
    if (seen.has(allocation.agentDefinitionVersionId)) {
      return { valid: false, code: "TRAFFIC_SPLIT_ALLOCATION_INVALID", detail: "The same version cannot be allocated traffic twice in one split." };
    }
    seen.add(allocation.agentDefinitionVersionId);
  }
  const total = allocations.reduce((sum, a) => sum + a.trafficSplitPct, 0);
  if (total !== 100) {
    return { valid: false, code: "TRAFFIC_SPLIT_MUST_SUM_TO_100", detail: `Traffic allocations must sum to exactly 100% (got ${total}%).` };
  }
  return { valid: true };
}
