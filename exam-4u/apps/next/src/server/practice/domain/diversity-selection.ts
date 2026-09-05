/**
 * FR-CUR-6's subject/curriculum-scoped diversity selection (migration plan Phase 8) — a pure, I/O-free
 * function ported verbatim (logic) from
 * `legacy/api/src/modules/practice/domain/diversity-selection.ts`.
 *
 * **Algorithm (greedy farthest-point selection with a near-duplicate floor)**: candidates are assumed
 * pre-sorted by relevance/confidence, descending (this function itself never re-sorts —
 * `LessonPracticeService` passes `findPackagedForSubject`/`findPackagedForCurriculum`'s own
 * `confidence_score DESC` order straight through, so the deterministic seed is always the single
 * most-confident candidate, not an arbitrary one). The seed is selected first; every subsequent pick
 * is the remaining candidate whose *minimum* cosine distance to every already-selected item is
 * largest — i.e. the one that is "farthest," in embedding space, from everything picked so far,
 * maximizing topical spread across the final set. A candidate whose cosine similarity to ANY
 * already-selected item is `>=` {@link NEAR_DUPLICATE_THRESHOLD} is skipped entirely (never
 * selected), even if it would otherwise be the farthest-scoring remaining candidate.
 *
 * Returns fewer than `count` items when either the candidate pool is smaller than `count` or every
 * remaining unselected candidate is a near-duplicate of something already chosen — `count` is a
 * ceiling, never a promise; `LessonPracticeService` fills any remaining shortfall with freshly
 * generated questions, per FR-CUR-6's own "before generating any new questions to fill a shortfall"
 * framing.
 */
export const NEAR_DUPLICATE_THRESHOLD = 0.93;

export interface DiversityCandidate<T> {
  item: T;
  embedding: number[];
}

/** Greedy farthest-point selection, capped at `count`, honoring {@link NEAR_DUPLICATE_THRESHOLD}. */
export function selectDiverse<T>(candidates: DiversityCandidate<T>[], count: number): T[] {
  if (candidates.length === 0 || count <= 0) return [];

  const selected: DiversityCandidate<T>[] = [candidates[0]];
  const remaining = candidates.slice(1);

  while (selected.length < count && remaining.length > 0) {
    let bestIndex = -1;
    let bestMinDistance = -Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const candidate = remaining[i];
      let minDistanceToSelected = Infinity;
      let isNearDuplicate = false;

      for (const s of selected) {
        const similarity = cosineSimilarity(candidate.embedding, s.embedding);
        if (similarity >= NEAR_DUPLICATE_THRESHOLD) {
          isNearDuplicate = true;
          break;
        }
        const distance = 1 - similarity;
        if (distance < minDistanceToSelected) {
          minDistanceToSelected = distance;
        }
      }

      if (isNearDuplicate) continue;
      if (minDistanceToSelected > bestMinDistance) {
        bestMinDistance = minDistanceToSelected;
        bestIndex = i;
      }
    }

    // Every remaining candidate is a near-duplicate of something already selected — no further pick
    // is possible; the caller's shortfall-fill generation covers the rest.
    if (bestIndex === -1) break;

    selected.push(remaining[bestIndex]);
    remaining.splice(bestIndex, 1);
  }

  return selected.map((s) => s.item);
}

/** Standard cosine similarity in `[-1, 1]`; returns `0` for a degenerate zero-length vector rather
 * than `NaN`. */
function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  const length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
