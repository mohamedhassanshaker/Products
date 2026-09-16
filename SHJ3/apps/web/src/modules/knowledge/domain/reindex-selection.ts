/**
 * The named hard invariant of this wave: **a re-index job with `reason =
 * 'EmbeddingModelChange'` must select every in-scope chunk, never only the ones that look
 * stale.** Two different embedding models must never coexist in one collection
 * (`CK_Chunks_dimension`/`RetrievalConfigs`' own doc comment), so "re-embed only the chunks
 * whose `vectorState` already says `Stale`" is actively wrong for this one reason: a chunk
 * still marked `Indexed` under the *old* model is not stale by that column's own definition,
 * yet it is exactly as wrong as one already marked `Stale` once the model itself has
 * changed. `Reconciliation`, by contrast, legitimately wants only the rows reconciliation
 * itself flagged (`Stale`/`Pending`/`Failed`) — reprocessing everything there would be
 * needless, expensive work for chunks that were never touched by the drift.
 *
 * Kept as one small, pure, directly-testable function — see this file's own `.test.ts` —
 * rather than inline in `run-reindex-job.ts`, so the invariant can be proven without a
 * database, a fake AI client, or any of `RunReindexJob`'s own orchestration.
 */

import type { DerivedIndexState, ReindexReason } from "./knowledge-catalog.js";

export interface ReindexCandidateChunk {
  readonly id: string;
  readonly vectorState: DerivedIndexState;
  readonly graphState: DerivedIndexState;
}

/** States that mean "reconciliation flagged this row" — the *only* thing a `Reconciliation`-reason job re-processes. */
const RECONCILIATION_TARGET_STATES: readonly DerivedIndexState[] = ["Stale", "Pending", "Failed"];

/**
 * Which of `chunks` a re-index job with this `reason` must process.
 *
 * `EmbeddingModelChange` (and `Restore`, `GraphMerge`, `Manual` — every reason that is not a
 * targeted drift repair) selects the full set unconditionally. Only `Reconciliation`
 * narrows to chunks whose vector or graph state already signals a problem.
 */
export function selectChunksForReindex<T extends ReindexCandidateChunk>(
  reason: ReindexReason,
  chunks: readonly T[],
): readonly T[] {
  if (reason === "Reconciliation") {
    return chunks.filter(
      (chunk) =>
        RECONCILIATION_TARGET_STATES.includes(chunk.vectorState) ||
        RECONCILIATION_TARGET_STATES.includes(chunk.graphState),
    );
  }
  return chunks;
}
