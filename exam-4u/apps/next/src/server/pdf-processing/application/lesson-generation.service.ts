import { randomUUID } from 'node:crypto';
import type { GeneratedQuestionDraft, LessonBatchIn } from '@examland/contracts';
import { getEnv } from '@/server/config';
import { requireTenantId } from '@/server/context';
import type { AiInvocationContext, AiServicePort, RetrievalService } from '@/server/ai';
import type { PageText } from '@/server/common/util/chunking.util';
import { GeneratedQuestionEntity, PdfProcessingSessionEntity } from '@/server/infrastructure/database';
import { isBudgetExhausted } from '../domain/budget';
import { calibrateConfidence } from '../domain/confidence';
import { mergeCoveredConcepts } from '../domain/covered-concepts';
import { planLessonBatches } from '../domain/lesson-batch-planner';
import { PdfProcessingSessionRepository } from '../infrastructure/pdf-processing-session.repository';

/** LLD §9.4: lesson generation retrieves topK 5 grounding chunks per batch (`RETRIEVAL_TOPK_LESSON`). */
export const LESSON_GROUNDING_TOP_K = 5;

/**
 * FR-PDF-4's lesson-generation branch (LLD §8.3's `contentType = Lesson` loop) — the second wired
 * `PdfContentStrategy` (migration plan Phase 6, sub-slice "6b"), appended to
 * `buildPdfProcessingService`'s composition-root strategy array without any change to
 * `PdfGenerationOrchestrator` itself, exactly as sub-slice "6a" designed that skeleton for. Ported
 * logic from `legacy/api/src/modules/pdf-processing/application/lesson-generation.service.ts`, adapted
 * to this app's `getEnv()`-inline config convention (no injected `AppConfigService`) and an explicit
 * `RetrievalService.retrieve(tenant, scope, queryText, topK)` call (this app's own Phase 5 deviation
 * from legacy's ALS-reading `RetrievalService`).
 *
 * **Batched, not per-page** (unlike `ExamExtractionService`'s one-call-per-page loop): `planLessonBatches`
 * pure-computes the whole bounded plan up front — total question target derived from document length ×
 * classification's estimated density, clamped to `[PDF_QUESTIONS_MIN, PDF_QUESTIONS_MAX]`, split into
 * batches of at most 10 (LLD §7.11's "enforced both sides").
 *
 * **Budget-before-call ordering**: the loop checks {@link isBudgetExhausted} against the session's
 * *current* running totals **before** issuing that iteration's `generateLessonBatch` call — never
 * after. A session already exhausted before the very first batch never issues one billable call "to
 * see how close it is".
 *
 * **Per-item parse-failure isolation (FR-PDF-4)**: `result.data` already contains only the drafts that
 * survived the port's own per-item validation — a malformed item is reflected solely in
 * `result.droppedItems`. This method never inspects `droppedItems` to decide whether to keep the rest
 * of a batch, which is what makes "one malformed question in a batch does not discard the rest"
 * structural rather than a best-effort convention.
 *
 * **Concept carry-forward (FR-PDF-4)**: `mergeCoveredConcepts` folds each batch's concepts into the
 * rolling, capped list persisted on `pdf_processing_session.covered_concepts` and passed to the next
 * batch, so later batches don't repeat earlier ones — and a *resumed* session picks the list back up
 * from the DB rather than starting over.
 *
 * **Grounded generation (FR-CUR-4)**: grounding is resolved via `RetrievalService.retrieve` before each
 * batch (topK 5, using the batch's own excerpt as the query, scoped to `session.curriculumId` when
 * set). An empty result is a valid, unremarkable retrieval outcome passed through unchanged —
 * `calibrateConfidence`'s `lesson_generation` band does not vary with grounding (LLD §9.3: "model value
 * if present else 0.85"), so an empty result affects generation quality but not the stored confidence.
 *
 * **Graceful AI-outage propagation**: `AiDisabledError`/`AiServiceUnavailableError` propagate uncaught
 * so `PdfProcessingService`'s outer catch handles them identically to a classification-time outage
 * (never `Failed`; the watermark simply doesn't advance past the failing batch).
 *
 * **Per-batch transactional checkpoint (FR-REL-2)**: each batch's `generated_question` rows commit
 * together with `last_completed_page`/`covered_concepts`/`tokens_used`/`total_cost` in the SAME
 * transaction via `PdfProcessingSessionRepository.persistBatchAndAdvanceWatermark` — a crash mid-loop
 * never leaves the watermark unadvanced on disk for an already-durably-inserted batch.
 */
export class LessonGenerationService {
  constructor(
    private readonly aiService: AiServicePort,
    private readonly sessions: PdfProcessingSessionRepository,
    private readonly retrieval: RetrievalService,
  ) {}

  /**
   * Mutates `session` in place (tokens/cost/watermark/covered-concepts/budget-exhausted flag) as each
   * batch completes, purely so this loop's own subsequent iterations read correct running totals — the
   * DB row is the actual durable source of truth a resume reads from. The caller
   * (`PdfGenerationOrchestrator`) separately persists `session`'s own terminal
   * `status`/`totalQuestions` fields once the whole branch returns.
   */
  async generate(session: PdfProcessingSessionEntity, pages: PageText[]): Promise<void> {
    const env = getEnv();
    const limits = { maxTokensPerSession: env.PDF_MAX_TOKENS_PER_SESSION, maxCostPerSessionUsd: env.PDF_MAX_COST_PER_SESSION_USD };
    let covered = session.coveredConcepts ?? [];

    const plans = planLessonBatches({
      pages,
      estimatedQuestionsPerPage: session.estimatedQuestionsPerPage === null ? null : Number(session.estimatedQuestionsPerPage),
      questionsMin: env.PDF_QUESTIONS_MIN,
      questionsMax: env.PDF_QUESTIONS_MAX,
      batchSize: env.PDF_QUESTIONS_BATCH_SIZE,
      resumeFromPage: session.lastCompletedPage,
    });

    let batchIndex = 0;
    for (const plan of plans) {
      // Budget check BEFORE the call — see class doc comment.
      if (isBudgetExhausted({ tokensUsed: session.tokensUsed, totalCost: Number(session.totalCost) }, limits)) {
        session.budgetExhausted = true;
        break;
      }

      const tenantId = requireTenantId();
      const grounding = await this.retrieval.retrieve(
        { tenantId },
        { curriculumId: session.curriculumId ?? undefined },
        plan.excerpt,
        LESSON_GROUNDING_TOP_K,
      );

      const ctx = buildInvocationContext(session, limits, tenantId);
      const input: LessonBatchIn = {
        excerpt: plan.excerpt,
        pageRange: plan.pageRange,
        targetQuestionCount: plan.targetQuestionCount,
        coveredConcepts: covered,
        grounding,
      };

      // A connection error/timeout/breaker-open here propagates uncaught — no batch is persisted, the
      // watermark does not advance, and `PdfProcessingService`'s own catch handles the
      // graceful-degradation path.
      const result = await this.aiService.generateLessonBatch(input, ctx);

      const entities = result.data.map((draft) => toEntity(session.id, draft, batchIndex, env.REVIEW_FLAG_CONFIDENCE_THRESHOLD));
      covered = mergeCoveredConcepts(
        covered,
        result.data.map((draft) => draft.concept),
      );

      await this.sessions.persistBatchAndAdvanceWatermark({
        sessionId: session.id,
        entities,
        tokensDelta: result.usage.promptTokens + result.usage.completionTokens,
        costDelta: result.usage.costUsd ?? 0,
        endPage: plan.endPage,
        coveredConcepts: covered,
      });

      session.coveredConcepts = covered;
      session.tokensUsed += result.usage.promptTokens + result.usage.completionTokens;
      session.totalCost = Number(session.totalCost) + (result.usage.costUsd ?? 0);
      session.lastCompletedPage = plan.endPage;
      batchIndex += 1;
    }
  }
}

function buildInvocationContext(
  session: PdfProcessingSessionEntity,
  limits: { maxTokensPerSession: number; maxCostPerSessionUsd: number },
  tenantId: string,
): AiInvocationContext {
  return {
    tenantId,
    userId: session.initiatedByUserId ?? undefined,
    processingSessionId: session.id,
    correlationId: randomUUID(),
    budget: {
      tokensRemaining: Math.max(0, limits.maxTokensPerSession - session.tokensUsed),
      costRemainingUsd: Math.max(0, limits.maxCostPerSessionUsd - Number(session.totalCost)),
    },
  };
}

function toEntity(sessionId: string, draft: GeneratedQuestionDraft, batchIndex: number, reviewFlagThreshold: number): GeneratedQuestionEntity {
  const { score, reviewFlagged } = calibrateConfidence({ kind: 'lesson_generation', modelConfidence: draft.modelConfidence }, reviewFlagThreshold);

  const entity = new GeneratedQuestionEntity();
  entity.id = randomUUID();
  entity.processingSessionId = sessionId;
  entity.subjectId = null; // FR-PDF-7 mapping happens afterward, via SubjectClassificationService.
  entity.questionText = draft.questionText;
  entity.optionsJson = Object.fromEntries(draft.options.map((option) => [option.key, option.text]));
  entity.correctAnswer = draft.correctAnswer;
  entity.explanation = draft.explanation;
  entity.questionType = 'multiple_choice';
  entity.bloomsLevel = draft.bloomsLevel;
  entity.sourcePageRange = draft.sourcePageRange ?? null;
  entity.sourceSection = draft.sourceSection ?? null;
  entity.answerSource = null;
  entity.confidenceScore = score;
  entity.generationMethod = 'lesson_generation';
  entity.isAutoGenerated = true;
  entity.isHumanEdited = false;
  entity.isReviewFlagged = reviewFlagged;
  entity.notes = null;
  entity.linkedExamTypeId = null;
  entity.batchIndex = batchIndex;
  return entity;
}
