import { createHash } from "node:crypto";

/**
 * The pure, I/O-free half of the Phase 17 traffic-split resolver (ADR-0019 §2.3 step 4,
 * LLD §15.3 step 3). Kept in `domain/` so it has no `@nextbot/db` edge at all (LLD §2.2,
 * enforced by dependency-cruiser's `no-db-inside-domain` rule) and so the weighting rule
 * itself is directly unit-testable without a database.
 */

/** Basis points of the whole: `traffic_split_pct` is a whole percent, but the bucket
 *  space is deliberately finer (10 000) so a hash lands evenly across a 90/10 split
 *  rather than being quantized to 100 coarse slots. */
export const TRAFFIC_BUCKET_SPACE = 10_000;

/** One active deployment row, reduced to the two fields the weighting needs. */
export interface TrafficAllocationCandidate {
  /** `deployment.id`. Also the ORDERING key — see `chooseTrafficAllocation`. */
  deploymentId: string;
  agentDefinitionVersionId: string;
  /** `deployment.traffic_split_pct` — a whole percent, 0..100. */
  trafficSplitPct: number;
}

/**
 * Maps a conversation onto a bucket in `[0, TRAFFIC_BUCKET_SPACE)`.
 *
 * **Deterministic on purpose, never `Math.random()`** (ADR-0019 §3): a deterministic
 * bucket is reproducible in tests, stable per conversation independent of storage, and
 * re-derives the *same* answer if the `deployment_traffic_assignment` row is ever missing
 * (purged, or never written because the first turn's write failed). A random draw would
 * make all three false.
 *
 * `agentDefinitionId` is mixed in so the same conversation talking to two different bots
 * does not inherit one bot's bucket for the other's split.
 *
 * @param conversationId the conversation this turn belongs to.
 * @param agentDefinitionId the agent definition whose split is being resolved.
 * @returns an integer in `[0, 10000)`.
 */
export function trafficBucketFor(conversationId: string, agentDefinitionId: string): number {
  const digest = createHash("sha256").update(`${conversationId}:${agentDefinitionId}`).digest("hex");
  // First 8 hex chars = 32 bits, comfortably inside `Number.MAX_SAFE_INTEGER`, so the
  // modulo is exact (no float rounding) — the reason a slice is taken rather than the
  // whole 256-bit digest being coerced.
  return parseInt(digest.slice(0, 8), 16) % TRAFFIC_BUCKET_SPACE;
}

/**
 * Picks which allocation serves `bucket`, walking the candidates **in the caller's given
 * order** and accumulating `trafficSplitPct * 100` until `bucket < cumulative`.
 *
 * The caller must supply the rows ordered by `deployment.id` (LLD §15.3 step 3). That
 * ordering is not cosmetic: it is what makes the choice stable across processes and
 * across repeated reads, so two gateway replicas resolving the same conversation in the
 * same instant agree without coordinating.
 *
 * @param candidates active deployments for one `(tenant, agentDefinition, environment)`,
 *   pre-ordered by `deploymentId`.
 * @param bucket the value from {@link trafficBucketFor}.
 * @returns the chosen candidate, or `null` when `candidates` is empty.
 */
export function chooseTrafficAllocation(candidates: TrafficAllocationCandidate[], bucket: number): TrafficAllocationCandidate | null {
  if (candidates.length === 0) return null;
  let cumulative = 0;
  for (const candidate of candidates) {
    cumulative += candidate.trafficSplitPct * (TRAFFIC_BUCKET_SPACE / 100);
    if (bucket < cumulative) return candidate;
  }
  // Only reachable if the active rows sum to < 100 — which migration `0016`'s trigger
  // permits (it rejects > 100, not < 100) and which `setTrafficSplit`'s domain validation
  // rejects. Falling back to the last row is the safe direction: a live turn always gets
  // SOME already-Production version rather than an unhandled null, and the shortfall is a
  // configuration problem to be surfaced by the deployments screen, never a dropped turn.
  return candidates[candidates.length - 1] ?? null;
}
