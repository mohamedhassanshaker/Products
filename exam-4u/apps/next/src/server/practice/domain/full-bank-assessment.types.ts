/**
 * Framework-free types for FR-PDF-13's full-bank lesson assessment feature (migration plan Phase 8 —
 * despite living in legacy's `pdf-processing` module directory, the migration plan's own phase list
 * puts "full-bank" practice under Phase 8, not Phase 6, so this type file lives in `server/practice`).
 * Ported from `legacy/api/src/modules/pdf-processing/domain/full-bank-assessment.types.ts`.
 */

/** `POST /api/practice/full-bank/:curriculumId/:documentId`'s optional body — both fields default to
 * `env.FULL_BANK_ASSESSMENT_DEFAULT_*` (FR-PDF-13: "a defined question count and duration") when
 * omitted. */
export interface StartFullBankAssessmentInput {
  targetQuestionCount?: number;
  targetTotalMinutes?: number;
}

/** The immediate `202` response (mirrors `UploadPdfResult`'s "202 before any AI work" shape). */
export interface StartFullBankAssessmentResult {
  sessionId: string;
  status: string;
}

/** The three difficulty buckets FR-PDF-13's "difficulty-tiered question bank" wording calls for —
 * derived from each generated question's own `blooms_level` rather than a second, duplicate AI-contract
 * field. */
export type DifficultyTier = 'Easy' | 'Medium' | 'Hard';

/**
 * Buckets a generated question's Bloom's taxonomy level into one of three difficulty tiers.
 *
 * **Documented judgment call (ported verbatim from legacy)**: `LessonBatchIn`/`GeneratedQuestionDraft`
 * (the AI contract every lesson-generation call site already shares) has no dedicated "difficulty"
 * field. Bloom's level (1=Remember .. 6=Create) is already a real, model-produced proxy for cognitive
 * difficulty, so this phase derives the tier from it at read time instead of persisting a second,
 * redundant difficulty signal. `null` defaults to `'Medium'` rather than skewing the reported
 * breakdown either way.
 */
export function deriveDifficultyTier(bloomsLevel: number | null): DifficultyTier {
  if (bloomsLevel === null) return 'Medium';
  if (bloomsLevel <= 2) return 'Easy';
  if (bloomsLevel <= 4) return 'Medium';
  return 'Hard';
}

/** `GET /api/practice/full-bank/:id`'s poll contract — its own summary shape (not
 * `PdfProcessingSessionSummary`), since a full-bank session's caller cares about its fixed target
 * shape and difficulty breakdown. */
export interface FullBankAssessmentSummary {
  id: string;
  status: string;
  curriculumId: string | null;
  curriculumDocumentId: string | null;
  targetQuestionCount: number;
  targetTotalMinutes: number;
  questionsGenerated: number;
  /** `true` once `questionsGenerated >= targetQuestionCount`. */
  isComplete: boolean;
  difficultyBreakdown: Record<DifficultyTier, number>;
  lastCompletedPage: number;
  pageCount: number | null;
  tokensUsed: number;
  totalCost: number;
  budgetExhausted: boolean;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: Date;
  completedAt: Date | null;
}
