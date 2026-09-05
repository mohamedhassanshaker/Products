import { requireTenantDataSource } from '@/server/context';
import { PdfProcessingService, buildPdfProcessingService, type UploadedFileLike } from './application/pdf-processing.service';
import { StaleSessionRecoveryWorker } from './application/stale-session-recovery.worker';
import { PdfProcessingSessionRepository } from './infrastructure/pdf-processing-session.repository';
import { GeneratedQuestionRepository } from './infrastructure/generated-question.repository';
import { SubjectClassificationService } from './application/subject-classification.service';
import { QuestionReviewService } from './application/question-review.service';
import { FinalizeExamService } from './application/finalize-exam.service';
import { AppendExamService } from './application/append-exam.service';
import { QuestionBankIndexingService } from './application/question-bank-indexing.service';
import { SimilarQuestionsService } from './application/similar-questions.service';
import { ConfidenceCalibrationService } from './application/confidence-calibration.service';
import { GenerationEvaluationService } from './application/generation-evaluation.service';
import { FinalizeExamRepository } from './infrastructure/finalize-exam.repository';
import { AppendExamRepository } from './infrastructure/append-exam.repository';
import { IdempotencyKeyRepository } from './infrastructure/idempotency-key.repository';
import { getAiService } from '@/server/ai';
import { SubjectRepository } from '@/server/taxonomy';
import { CurriculaRepository } from '@/server/curricula';
import { getStoragePortSingleton } from '@/server/files';
import { buildMediaServices } from '@/server/media';
import { getEmbeddingsPort } from '@/server/infrastructure/embeddings';
import { getQdrantVectorStoreAdapter } from '@/server/infrastructure/vector';

export { PdfProcessingService, buildPdfProcessingService, StaleSessionRecoveryWorker, PdfProcessingSessionRepository };
// Pure domain utilities re-exported for cross-module reuse (Phase 8's `server/practice` full-bank
// assessment reuses these verbatim rather than duplicating them — see
// `docs/plans/nextjs-rewrite-phase8-plan.md`'s "Decisions made"). Pure/I-O-free functions, no
// resource/state to protect, so re-exporting them through this barrel is the same "shared-kernel pure
// logic" precedent `common/errors/domain-error.ts` already establishes for cross-module reuse.
export { isBudgetExhausted } from './domain/budget';
export type { BudgetLimits, BudgetUsage } from './domain/budget';
export { mergeCoveredConcepts, COVERED_CONCEPTS_CAP } from './domain/covered-concepts';
export { calibrateConfidence } from './domain/confidence';
export type { ConfidenceInput, CalibrateConfidenceResult } from './domain/confidence';
export { planLessonBatches } from './domain/lesson-batch-planner';
export type { LessonBatchPlan, LessonBatchPlanInput } from './domain/lesson-batch-planner';
export { SubjectClassificationService, GeneratedQuestionRepository };
export { QuestionReviewService, FinalizeExamService, AppendExamService, QuestionBankIndexingService };
export { SimilarQuestionsService, ConfidenceCalibrationService, GenerationEvaluationService };
export type { SimilarQuestionMatch } from './application/similar-questions.service';
export type { CalibrationReport } from './application/confidence-calibration.service';
export type { CalibrationMethodReport, CalibrationBandStats } from './domain/confidence-calibration';
export type { EvaluationReport } from './domain/generation-evaluation';
// Re-exported so integration tests can spy on the idempotency-bookkeeping write to prove the
// two-transaction partial-failure-recovery guarantee (see `AppendExamRepository`'s own doc comment) —
// no other consumer outside this module constructs it directly (`getAppendExamService` already does).
export { IdempotencyKeyRepository } from './infrastructure/idempotency-key.repository';
export type { SubjectClassificationResult } from './application/subject-classification.service';
export type { UploadedFileLike };
export type { RecoveryOutcome } from './application/stale-session-recovery.worker';
export type {
  AppendExamInput,
  EditGeneratedQuestionInput,
  FinalizeExamInput,
  FinalizeExamModuleInput,
  GenerationMethod,
  GeneratedQuestionImage,
  GeneratedQuestionSummary,
  PaginatedGeneratedQuestions,
  PdfContentType,
  PdfProcessingSessionStatus,
  PdfProcessingSessionSummary,
  UploadPdfInput,
  UploadPdfResult,
} from './domain/pdf-processing.types';
export {
  AppendNotSupportedForLegacyZipError,
  EmptyFileError,
  FileTooLargeError,
  GeneratedQuestionNotFoundError,
  InvalidContextWeightError,
  InvalidExtensionError,
  InvalidFileSignatureError,
  NoEligibleQuestionsError,
  NotSessionOwnerError,
  PdfProcessingSessionNotFoundError,
  UnrecognizedContentTypeError,
} from './domain/errors';

/**
 * `server/pdf-processing`'s public barrel (migration plan Phase 6, sub-slice "6a") — upload/dedup/
 * extraction/classification/exam-question-extraction (FR-PDF-1/2/3/5) and the crash-safety
 * `StaleSessionRecoveryWorker` (FR-REL-3). Nothing outside this module may import `./domain/**`/
 * `./infrastructure/**`/`./application/**` directly (enforced by `apps/next/.eslintrc.cjs`'s
 * `pdf-processing` module-boundary rule).
 *
 * {@link getPdfProcessingService} builds a fresh instance per call, bound to the *current request's*
 * tenant-scoped `DataSource` — must be called inside `withTenantContext` (matches every other
 * tenant-scoped module's composition-root convention, e.g. `getExamAuthoringService`).
 *
 * {@link buildPdfProcessingService}/{@link PdfProcessingSessionRepository} are ALSO re-exported directly
 * (not just wrapped by `getPdfProcessingService`) because two cross-module composition roots outside
 * this module's own request path need to construct a tenant-scoped instance bound to an EXPLICIT,
 * already-acquired `DataSource` rather than reading one off the ambient ALS context:
 * `server/pdf-processing/application/pdf-processing.service.ts`'s own background-reschedule trampoline
 * (in-module, doesn't need this re-export) and `server/workers/pdf-stale-session-recovery.ts`'s
 * per-tenant sweep (a genuinely external, cross-module composition root, exactly like
 * `server/workers/tenant-maintenance.ts`'s own `hygieneFactory` closure needing `TenantHygieneService`'s
 * constructor pieces). This is the same "export the composition building-block, not just the
 * request-bound wrapper" precedent `server/reliability` already established for
 * `OutboxRepository`/`OutboxPublisherService` (consumed directly by `server/workers/outbox-publisher.ts`).
 */
export function getPdfProcessingService(): PdfProcessingService {
  const dataSource = requireTenantDataSource();
  return buildPdfProcessingService(dataSource);
}

/**
 * Composition root for FR-PDF-7/FR-AUTH-6's shared subject-classification mechanism (sub-slice "6b").
 * Exposed separately from {@link getPdfProcessingService} because its second consumer lives in a
 * different module: `server/exam-authoring`'s `fixSubjectMapping` (`POST /api/exam-types/:id/
 * fix-subject-mapping`) drives the SAME service the PDF pipeline's automatic post-generation pass uses,
 * which is exactly what makes "already-mapped rows are never disturbed" one implementation rather than
 * two agreeing ones. Must be called inside `withTenantContext`.
 */
export function getSubjectClassificationService(): SubjectClassificationService {
  const dataSource = requireTenantDataSource();
  return new SubjectClassificationService(getAiService(), new SubjectRepository(dataSource), new GeneratedQuestionRepository(dataSource));
}

/** Composition root for FR-PDF-8's review/edit/bulk-action screen (sub-slice "6c"). */
export function getQuestionReviewService(): QuestionReviewService {
  const dataSource = requireTenantDataSource();
  const { imageAssociation } = buildMediaServices(dataSource);
  return new QuestionReviewService(
    new GeneratedQuestionRepository(dataSource),
    new PdfProcessingSessionRepository(dataSource),
    getStoragePortSingleton(),
    getAiService(),
    imageAssociation,
  );
}

/** Shared by {@link getFinalizeExamService}/{@link getAppendExamService} — both need the identical
 * fire-and-forget question-bank indexing writer (sub-slice "6c"'s scope-adjustment, see
 * `QuestionBankIndexingService`'s own doc comment). Takes the concrete `QdrantVectorStoreAdapter`
 * directly for both the `VectorStorePort` param and the `pointId()`-exposing param, matching
 * `SemanticDedupService`'s identical "no DI-token indirection in this app" convention. */
function buildQuestionBankIndexingService(): QuestionBankIndexingService {
  const vectorAdapter = getQdrantVectorStoreAdapter();
  return new QuestionBankIndexingService(vectorAdapter, getEmbeddingsPort(), vectorAdapter);
}

/** Composition root for FR-PDF-9's finalize-into-Exam-Type flow (sub-slice "6c"). */
export function getFinalizeExamService(): FinalizeExamService {
  const dataSource = requireTenantDataSource();
  return new FinalizeExamService(
    new PdfProcessingSessionRepository(dataSource),
    new GeneratedQuestionRepository(dataSource),
    new SubjectRepository(dataSource),
    new CurriculaRepository(dataSource),
    new FinalizeExamRepository(dataSource),
    buildQuestionBankIndexingService(),
  );
}

/** Composition root for FR-PDF-10's append-to-an-existing-Exam-Type flow (sub-slice "6c"). */
export function getAppendExamService(): AppendExamService {
  const dataSource = requireTenantDataSource();
  return new AppendExamService(
    new GeneratedQuestionRepository(dataSource),
    new AppendExamRepository(dataSource),
    new IdempotencyKeyRepository(dataSource),
    buildQuestionBankIndexingService(),
    new CurriculaRepository(dataSource),
  );
}

/** Composition root for the "Find similar questions" reviewer tool (sub-slice "6d", the read-side
 * consumer of {@link buildQuestionBankIndexingService}'s write side). Takes the concrete
 * `QdrantVectorStoreAdapter` directly for the `VectorStorePort` param, matching every other
 * composition root in this module's identical "no DI-token indirection in this app" convention. */
export function getSimilarQuestionsService(): SimilarQuestionsService {
  const dataSource = requireTenantDataSource();
  return new SimilarQuestionsService(new GeneratedQuestionRepository(dataSource), getEmbeddingsPort(), getQdrantVectorStoreAdapter());
}

/** Composition root for the confidence-threshold recalibration analytics dashboard (sub-slice "6d"). */
export function getConfidenceCalibrationService(): ConfidenceCalibrationService {
  const dataSource = requireTenantDataSource();
  return new ConfidenceCalibrationService(new GeneratedQuestionRepository(dataSource));
}

/** Composition root for the generation-evaluation golden-set harness (sub-slice "6d") — CLI-only
 * caller (`scripts/evaluate-generation.ts`), no HTTP route. Reuses
 * {@link getConfidenceCalibrationService} for the historical-correlation half of its report. */
export function getGenerationEvaluationService(): GenerationEvaluationService {
  return new GenerationEvaluationService(getAiService(), getConfidenceCalibrationService());
}
