/**
 * Pure rules for `RetrievalConfig` (B6 tab 3) — kept out of the repository/UI so the
 * "weights sum to one" rule and the documented defaults exist in exactly one place, tested
 * without a database.
 */

import type { ConflictPolicy } from "./knowledge-catalog.js";

/** FR-KNOW-11's documented defaults, verbatim. Used both by `ensureDefault` (repository) and by the retrieval tab's own client-side validation baseline. */
export const RETRIEVAL_CONFIG_DEFAULTS = {
  chunkSizeTokens: 512,
  chunkOverlapTokens: 64,
  embeddingModel: "text-embedding-3-large",
  embeddingDimension: 3072,
  graphWeight: 0.6,
  vectorWeight: 0.4,
  topK: 8,
  rerankerEnabled: true,
  rerankerModel: "rerank-v3.5",
  rerankCandidateCount: 40,
  minGroundingConfidence: 0.6,
  defaultConflictPolicy: "PreferMostRecentlyUpdated" as ConflictPolicy,
  maxGraphHops: 3,
} as const;

/** Floating-point tolerance for "sums to one" — `CK_RetrievalConfigs_weightsSumToOne` compares at `Decimal(4,3)` precision, so anything tighter than half a thousandth is spurious. */
const WEIGHT_SUM_EPSILON = 0.0005;

/**
 * `CK_RetrievalConfigs_weightsSumToOne`'s client-side mirror (FR-KNOW-12's "the B6 slider is
 * one degree of freedom"). The UI should refuse a bad submit locally rather than round-trip
 * to a 500 to learn what the database already knows.
 */
export function weightsSumToOne(graphWeight: number, vectorWeight: number): boolean {
  return Math.abs(graphWeight + vectorWeight - 1) <= WEIGHT_SUM_EPSILON;
}

/** `CK_RetrievalConfigs_overlapLessThanSize`'s client-side mirror. */
export function overlapIsValid(chunkSizeTokens: number, chunkOverlapTokens: number): boolean {
  return chunkOverlapTokens >= 0 && chunkOverlapTokens < chunkSizeTokens;
}

/** `CK_RetrievalConfigs_topK CHECK (topK BETWEEN 1 AND 50)`. */
export function topKIsValid(topK: number): boolean {
  return Number.isInteger(topK) && topK >= 1 && topK <= 50;
}

/**
 * FR-KNOW-13: changing the embedding model or its dimension is the one change that always
 * requires a full re-index (never a partial one — `domain/reindex-selection.ts` is the
 * matching invariant on the job-execution side). This is the single place that decides
 * "did the model identity change", so the confirmation dialog and the actual DB-trigger-
 * driven re-index agree about what counts as a change.
 */
export function embeddingModelChanged(
  before: { readonly embeddingModel: string; readonly embeddingDimension: number },
  after: { readonly embeddingModel: string; readonly embeddingDimension: number },
): boolean {
  return (
    before.embeddingModel !== after.embeddingModel ||
    before.embeddingDimension !== after.embeddingDimension
  );
}
