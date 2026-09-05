import { chunkPages, type PageText } from '@/server/common/util/chunking.util';

/** LLD §7.11: "`<= 10`, enforced both sides" — this is the application-side half of that enforcement
 * (the engine enforces its own half independently; neither trusts the other). */
export const MAX_QUESTIONS_PER_BATCH = 10;

/** One excerpt-sized segment of source text a single `generateLessonBatch` call should cover,
 * pure-computed ahead of time so the batch-count/target-size math is independently unit-testable from
 * the actual AI call loop (`LessonGenerationService`). */
export interface LessonBatchPlan {
  excerpt: string;
  pageRange: string;
  /** <= {@link MAX_QUESTIONS_PER_BATCH}, per FR-PDF-4's "bounded batches (default <=10 questions per
   * LLM call)". */
  targetQuestionCount: number;
  /** The last source page number this excerpt covers — the caller advances `last_completed_page`
   * (FR-REL-2's watermark) to this value only after the batch's output is durably persisted, never
   * before. */
  endPage: number;
}

/** Everything {@link planLessonBatches} needs; every value is already-resolved config or session
 * state, so this function itself performs no I/O and reads no environment. */
export interface LessonBatchPlanInput {
  /** Full per-page extracted text, in page order. */
  pages: PageText[];
  /** `pdf_processing_session.estimated_questions_per_page` (from classification) — `null` (no
   * classification ran, e.g. a `contentTypeHint`-bypassed session) falls back to 1/page. */
  estimatedQuestionsPerPage: number | null;
  questionsMin: number;
  questionsMax: number;
  /** Configured target batch size (`PDF_QUESTIONS_BATCH_SIZE`) — still clamped to
   * {@link MAX_QUESTIONS_PER_BATCH} regardless of configuration, per the "enforced both sides" rule. */
  batchSize: number;
  /** `pdf_processing_session.last_completed_page` — pages at or before this watermark were already
   * covered by an earlier (possibly interrupted) run and are excluded from the plan, so a resumed
   * session never re-generates already-durable output (FR-REL-2/FR-REL-3). */
  resumeFromPage: number;
}

/** Chunk target size for lesson excerpts — deliberately larger than the `CHUNK_SIZE_CHARS`/
 * `CHUNK_OVERLAP_CHARS` RAG-chunk config: a lesson-generation excerpt is consumed by one LLM call as
 * source material to generate *new* questions from, not embedded for retrieval, so it favors fewer,
 * larger, more context-complete segments over the RAG chunker's smaller, retrieval-optimized ones. No
 * overlap — repeating text across two batches would only add noise to the "avoid duplicate concept
 * coverage" concern FR-PDF-4 already solves via `coveredConcepts`. */
const EXCERPT_TARGET_CHARS = 3000;
const EXCERPT_OVERLAP_CHARS = 0;

/**
 * FR-PDF-4 (migration plan Phase 6, sub-slice "6b"): plans a bounded sequence of `generateLessonBatch`
 * calls covering a document's not-yet-processed pages, targeting a total question count derived from
 * document length and estimated density, clamped to the configured `[questionsMin, questionsMax]`
 * range. Ported verbatim (logic) from
 * `legacy/api/src/modules/pdf-processing/domain/lesson-batch-planner.ts`.
 *
 * Pure and I/O-free — reuses `chunkPages` purely as a text-segmentation primitive, not for its
 * RAG-chunking purpose.
 *
 * @returns `[]` when every page is at/before `resumeFromPage`, or when every remaining page is blank
 *   (nothing left to plan) — the caller treats an empty plan as "nothing more to generate", not an
 *   error.
 */
export function planLessonBatches(input: LessonBatchPlanInput): LessonBatchPlan[] {
  const batchSize = Math.min(input.batchSize, MAX_QUESTIONS_PER_BATCH);
  const remainingPages = input.pages.filter((page) => page.pageNumber > input.resumeFromPage && page.text.trim().length > 0);
  if (remainingPages.length === 0) return [];

  const density = input.estimatedQuestionsPerPage ?? 1;
  const totalPlanned = clamp(Math.round(density * remainingPages.length), input.questionsMin, input.questionsMax);
  if (totalPlanned <= 0) return [];

  const excerptChunks = chunkPages(remainingPages, EXCERPT_TARGET_CHARS, EXCERPT_OVERLAP_CHARS);
  const batchCount = Math.max(1, Math.ceil(totalPlanned / batchSize));

  const plans: LessonBatchPlan[] = [];
  let remainingQuestions = totalPlanned;
  for (const chunk of excerptChunks) {
    if (plans.length >= batchCount || remainingQuestions <= 0) break;
    const targetQuestionCount = Math.min(batchSize, remainingQuestions);
    plans.push({
      excerpt: chunk.text,
      pageRange: String(chunk.pageNumber),
      targetQuestionCount,
      endPage: chunk.pageNumber,
    });
    remainingQuestions -= targetQuestionCount;
  }
  return plans;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
