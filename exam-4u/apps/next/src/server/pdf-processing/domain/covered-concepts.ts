/**
 * FR-PDF-4's "concepts already covered by earlier batches are carried forward so later batches don't
 * repeat them" (migration plan Phase 6, sub-slice "6b") — a pure, framework-free, unit-tested merge
 * function, ported verbatim (logic and rationale) from
 * `legacy/api/src/modules/pdf-processing/domain/covered-concepts.ts`. Sits alongside this module's
 * other pure business-rule files (`budget.ts`/`confidence.ts`/`lesson-batch-planner.ts`), matching the
 * precedent sub-slice "6a" already established for `domain/`.
 *
 * `pdf_processing_session.covered_concepts` (a JSON column, migration `20260815000007`) is the durable
 * carrier for this state across batches and across a resumed session.
 */

/** LLD §4 DDL's documented cap for `covered_concepts` — the engine receives at most this many concept
 * strings on any single `generateLessonBatch` call (LLD §7.11: "rolling, cap 80"). */
export const COVERED_CONCEPTS_CAP = 80;

/**
 * Merges newly-covered concepts (one per successfully-parsed question in a batch) into the existing
 * rolling list.
 *
 * - Case-insensitive de-duplication: a concept already present is moved to the end (treated as "most
 *   recently covered") rather than duplicated — this is what "carry-forward" means: the *set* of
 *   covered concepts persists and grows, it does not re-list a repeat.
 * - Blank/whitespace-only concept strings (a defensively-handled malformed draft field) are ignored
 *   rather than merged in as a meaningless empty entry.
 * - Once the merged list exceeds {@link COVERED_CONCEPTS_CAP}, the *oldest* entries are evicted first
 *   (FIFO) so the list always reflects the most recently seen 80 concepts — bounding the size of
 *   `coveredConcepts` sent to the engine on every subsequent call, regardless of how long or how many
 *   batches a document's generation runs for.
 */
export function mergeCoveredConcepts(existing: readonly string[], newConcepts: readonly (string | undefined | null)[]): string[] {
  const merged = [...existing];

  for (const raw of newConcepts) {
    const concept = (raw ?? '').trim();
    if (concept.length === 0) continue;

    const existingIndex = merged.findIndex((entry) => entry.toLowerCase() === concept.toLowerCase());
    if (existingIndex >= 0) {
      merged.splice(existingIndex, 1);
    }
    merged.push(concept);
  }

  while (merged.length > COVERED_CONCEPTS_CAP) {
    merged.shift();
  }

  return merged;
}
