/**
 * Framework-free types for the `pdf-processing` module (migration plan Phase 6, sub-slice "6a").
 * Mirrors `legacy/api/src/modules/pdf-processing/domain/pdf-processing.types.ts`'s LLD §4-DDL-derived
 * shape, trimmed to what THIS sub-slice reads/writes (upload, tier-1/tier-2 dedup, extraction,
 * classification, the one wired exam-extraction generation branch, and the minimal status-poll
 * summary). Fields legacy declares for question-review/finalize/append/full-bank-assessment
 * (`GeneratedQuestionSummary`'s pagination/edit shapes, `FinalizeExamInput`, `AppendExamInput`,
 * `session_kind`, …) are deliberately NOT ported here — those belong to whichever later sub-slice
 * (6b/6c/6d) builds their owning feature, matching this project's "declare only what this dispatch's
 * own scope needs" discipline.
 */

/** The three recognized content classifications (LLD §4 DDL enum — capitalized storage form). The AI
 * engine itself returns lowercase raw labels (`lesson`/`exam`/`reference`); this module normalizes a
 * recognized label to this capitalized form for storage, and a caller-supplied `contentTypeHint` is
 * validated directly against this same set. */
export type PdfContentType = 'Lesson' | 'Exam' | 'Reference';

/** `pdf_processing_session.status` (LLD §4 DDL). `Processing` is this sub-slice's own "dispatched to
 * a content-type generation branch" state — a session classified `Lesson`/`Reference` completes with
 * zero generated questions this sub-slice (no branch registered yet for those two content types, see
 * `PdfGenerationOrchestrator`'s own doc comment); only `Exam` has a real, wired generation branch this
 * dispatch (`ExamExtractionService`). A session that hits `AI_SERVICE_UNAVAILABLE`/`AI_DISABLED` while
 * classifying (or generating) is deliberately left at whichever in-flight status it already reached
 * (never `Failed`) — see `PdfProcessingService.processSession`'s doc comment. */
export type PdfProcessingSessionStatus = 'Pending' | 'Extracting' | 'Classifying' | 'Processing' | 'Completed' | 'Failed';

/** Input accepted by `POST /api/pdf-processing/upload` (LLD §7.3's documented body shape). */
export interface UploadPdfInput {
  contentTypeHint?: PdfContentType;
  subjectId?: number;
  curriculumId?: string;
  forceReprocess?: boolean;
}

/** The immediate `202` response body — deliberately minimal (FR-PDF-1: "202 {sessionId,status} before
 * any AI work"). The full session detail (topics, tokens, cost, generated-question count) is only
 * available once polled via `GET /api/pdf-processing/sessions/:id`. */
export interface UploadPdfResult {
  sessionId: string;
  status: PdfProcessingSessionStatus;
}

/** The public shape returned by `GET /api/pdf-processing/sessions/:id` (a minimal status-poll
 * contract — the full review-table shape question-review.service.ts will eventually add is 6c's own
 * scope, not this sub-slice's). */
export interface PdfProcessingSessionSummary {
  id: string;
  sourceFileName: string;
  status: PdfProcessingSessionStatus;
  contentTypeHint: PdfContentType | null;
  contentType: PdfContentType | null;
  errorCode: string | null;
  errorMessage: string | null;
  detectedTopics: string[] | null;
  estimatedQuestionsPerPage: number | null;
  pageCount: number | null;
  tokensUsed: number;
  totalCost: number;
  fileHash: string;
  reusedFromSessionId: string | null;
  initiatedByUserId: string | null;
  totalQuestions: number;
  successfulQuestions: number;
  createdAt: Date;
  completedAt: Date | null;
}

/** `generated_question.generation_method` (LLD §4 DDL) — declared with its FULL legacy union
 * (matching `pdf_processing_session`/`generated_question`'s own "one shared table, not a per-phase
 * one" precedent) even though this sub-slice's own `ExamExtractionService` writer only ever produces
 * `'exam_extraction_with_key'`/`'exam_extraction_inferred'`, and the tier-1/tier-2 dedup reuse path
 * never writes a NEW `generated_question` row at all (it reuses the matched session's already-written
 * rows in place, so it never needs `'reused_from_cache'` as a writable value here — kept in the union
 * anyway since it is part of the DDL's own documented enum). The other values (`'lesson_generation'`,
 * `'regenerated'`, `'prompt_practice'`, `'full_bank_assessment'`) are written by later sub-slices/
 * phases (6b, 6c, Phase 8) once their own generation branches exist. */
export type GenerationMethod =
  | 'lesson_generation'
  | 'exam_extraction_with_key'
  | 'exam_extraction_inferred'
  | 'reused_from_cache'
  | 'regenerated'
  | 'prompt_practice'
  | 'full_bank_assessment';

/**
 * Sub-slice "6c" additions (FR-PDF-8/9/10) — question review/edit/bulk-actions, finalize-into-Exam-Type,
 * append-to-an-existing-Exam-Type. Mirrors
 * `legacy/api/src/modules/pdf-processing/domain/pdf-processing.types.ts`'s equivalent shapes.
 */

/** One image inline-rendered with a question in the review screen (FR-PDF-11/FR-FILE-3 UI) — mirrors
 * `server/media`'s `QuestionImageView` exactly; re-declared here (rather than importing across the
 * `media`/`pdf-processing` module boundary into this `domain/` layer) since `domain/` stays framework-
 * and cross-module-import-free. */
export interface GeneratedQuestionImage {
  id: string;
  storageKey: string;
  altText: string;
  caption: string | null;
  position: 'question_text' | 'option' | 'explanation';
  optionKey: string | null;
  width: number | null;
  height: number | null;
}

/** One `generated_question` row's public shape (FR-PDF-8's paginated review list).
 * `isHumanEdited`/`isReviewFlagged` are deliberately two independent booleans on the wire, never
 * folded into one — see `QuestionReviewService`'s class doc comment. `images` is always present as an
 * array (never omitted), empty when the question has no associated images. */
export interface GeneratedQuestionSummary {
  id: string;
  processingSessionId: string;
  subjectId: number | null;
  questionText: string;
  options: Record<string, string>;
  correctAnswer: string;
  explanation: string | null;
  questionType: string;
  bloomsLevel: number | null;
  sourcePageRange: string | null;
  sourceSection: string | null;
  answerSource: 'provided' | 'inferred' | null;
  confidenceScore: number;
  generationMethod: GenerationMethod;
  isAutoGenerated: boolean;
  isHumanEdited: boolean;
  isReviewFlagged: boolean;
  notes: string | null;
  linkedExamTypeId: string | null;
  createdAt: Date;
  updatedAt: Date;
  images: GeneratedQuestionImage[];
}

/** `GET /pdf-processing/sessions/:id/questions?page=&pageSize=`'s paginated response shape. */
export interface PaginatedGeneratedQuestions {
  items: GeneratedQuestionSummary[];
  total: number;
  page: number;
  pageSize: number;
}

/** `PATCH /pdf-processing/questions/:id`'s body (FR-PDF-8: "full text/option/answer/explanation
 * editing"). Every field is optional so a reviewer can patch just one field at a time. */
export interface EditGeneratedQuestionInput {
  questionText?: string;
  options?: Record<string, string>;
  correctAnswer?: string;
  explanation?: string | null;
  bloomsLevel?: number | null;
  notes?: string | null;
}

/** One declared module in `POST .../finalize`'s optional `modules[]` (FR-PDF-9: "configures
 * modules"). `sourceSections` names the raw `generated_question.source_section` values that roll up
 * into this one named module. */
export interface FinalizeExamModuleInput {
  name: string;
  sourceSections: string[];
}

/** One entry of `POST .../finalize`'s optional `curriculumLinks[]` (FR-AUTH-4). */
export interface FinalizeCurriculumLinkInput {
  curriculumId: string;
  contextWeight: number;
  applicableModules?: string[];
}

/** `POST /pdf-processing/sessions/:id/finalize`'s body (LLD §7.3/§8.5). */
export interface FinalizeExamInput {
  examName: string;
  description?: string;
  totalMinutes: number;
  totalQuestions: number;
  minConfidence: number;
  autoGeneratedOnly?: boolean;
  modules?: FinalizeExamModuleInput[];
  curriculumLinks?: FinalizeCurriculumLinkInput[];
}

/** `POST /pdf-processing/sessions/:id/append`'s body (LLD §7.6, FR-PDF-10). `ids[]` names
 * `generated_question` rows belonging to the `:id` session — any id already linked to an Exam Type
 * (this one or another) is silently excluded rather than erroring. */
export interface AppendExamInput {
  examTypeId: string;
  ids: string[];
}
