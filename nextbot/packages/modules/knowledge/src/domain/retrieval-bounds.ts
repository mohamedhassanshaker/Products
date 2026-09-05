/**
 * Target Architecture Blueprint Phase 9 (BL-40, FR-KB-05/06, LLD §14.4.4) — the
 * bounded-retrieval guardrails shared by every strategy. Pure/I-O-free (per
 * `no-db-inside-domain`), so every clamp here is exercised directly by a unit test
 * with no database/graph-store dependency.
 *
 * These mirror LLD §14.4.4's `RetrievalRequestSchema.limits` hard ceilings exactly
 * (`maxHops` 0-4, `maxNodes` 1-2000, `topK` 1-100) — the full bounded retrieval AGENT
 * (planner/sufficiency-check/expansion loop, budget-in-USD/seconds enforcement) is
 * Phase 10's job, not this phase's. What this phase must still guarantee on its own,
 * per its own brief, is that a single raw strategy call cannot be made to run away
 * even before Phase 10's agent-level governance exists — a caller passing an
 * unreasonably large `maxHops`/`maxNodes`/`topK` is clamped here, in-process, before
 * the value is ever handed to `GraphStorePort.neighbourhood()` (which separately
 * enforces `maxNodes` server-side inside its own Cypher query — two independent
 * layers, neither trusting the other alone).
 */

/** Hard ceilings no request may exceed, regardless of what it asks for. */
export const RETRIEVAL_HARD_CEILINGS = {
  maxHops: 4,
  maxNodes: 2000,
  topK: 100,
  // Target Architecture Blueprint Phase 10 (BL-41, FR-KB-06) — the bounded retrieval
  // agent's own expansion-loop ceiling (LLD §14.4.4 `RetrievalRequestSchema.limits.
  // maxExpansions`, `maximum: 5`). Phase 9's strategies never expand (single call,
  // no loop), so this ceiling was unused before this phase.
  maxExpansions: 5,
} as const;

/** Sane defaults applied when a caller doesn't specify a limit. */
export const RETRIEVAL_DEFAULTS = {
  maxHops: 2,
  maxNodes: 400,
  topK: 12,
  maxExpansions: 2,
} as const;

/** Clamps a requested hop count into `[0, RETRIEVAL_HARD_CEILINGS.maxHops]`. A
 *  non-finite/negative/fractional input falls back to the default rather than
 *  throwing — this is a bounding guardrail, not a request-validation layer (the HTTP
 *  boundary is responsible for rejecting a malformed request outright; this function's
 *  job is purely "never let the number that reaches the graph store exceed the
 *  ceiling," even if it's called directly by an internal caller that skipped HTTP
 *  validation). */
export function clampMaxHops(requested?: number): number {
  const value = requested === undefined || !Number.isFinite(requested) ? RETRIEVAL_DEFAULTS.maxHops : Math.trunc(requested);
  return Math.min(Math.max(value, 0), RETRIEVAL_HARD_CEILINGS.maxHops);
}

/** Clamps a requested max-node count into `[1, RETRIEVAL_HARD_CEILINGS.maxNodes]`. */
export function clampMaxNodes(requested?: number): number {
  const value = requested === undefined || !Number.isFinite(requested) ? RETRIEVAL_DEFAULTS.maxNodes : Math.trunc(requested);
  return Math.min(Math.max(value, 1), RETRIEVAL_HARD_CEILINGS.maxNodes);
}

/** Clamps a requested top-K into `[1, RETRIEVAL_HARD_CEILINGS.topK]`. */
export function clampTopK(requested?: number): number {
  const value = requested === undefined || !Number.isFinite(requested) ? RETRIEVAL_DEFAULTS.topK : Math.trunc(requested);
  return Math.min(Math.max(value, 1), RETRIEVAL_HARD_CEILINGS.topK);
}

/** Clamps a requested expansion-count ceiling into `[0, RETRIEVAL_HARD_CEILINGS.
 *  maxExpansions]` — THE hard iteration cap `retrieval-executor.ts`'s bounded
 *  expansion loop enforces regardless of what the sufficiency check concludes
 *  (FR-KB-06: "the sufficiency check's opinion cannot extend them"). */
export function clampMaxExpansions(requested?: number): number {
  const value = requested === undefined || !Number.isFinite(requested) ? RETRIEVAL_DEFAULTS.maxExpansions : Math.trunc(requested);
  return Math.min(Math.max(value, 0), RETRIEVAL_HARD_CEILINGS.maxExpansions);
}
