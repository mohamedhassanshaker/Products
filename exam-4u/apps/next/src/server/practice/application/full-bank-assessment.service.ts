import { randomUUID } from 'node:crypto';
import type { GeneratedQuestionDraft, LessonBatchIn } from '@examland/contracts';
import { getEnv } from '@/server/config';
import { getRequestContext, requireTenantDataSource, requireTenantId, runWithRequestContext } from '@/server/context';
import { getAiService, getRetrievalService, AiDisabledError, AiServiceUnavailableError } from '@/server/ai';
import type { AiInvocationContext } from '@/server/ai';
import { extractPdfPages } from '@/server/infrastructure/text-extraction';
import type { PageText } from '@/server/common/util/chunking.util';
import { DomainError, InternalDomainError } from '@/server/common/errors/domain-error';
import { getStoragePortSingleton } from '@/server/files';
import { getTenantsService } from '@/server/platform/tenants';
import { getTenantDataSourceRegistry, PdfProcessingSessionEntity, GeneratedQuestionEntity } from '@/server/infrastructure/database';
import {
  PdfProcessingSessionRepository,
  GeneratedQuestionRepository,
  isBudgetExhausted,
  mergeCoveredConcepts,
  calibrateConfidence,
  planLessonBatches,
  PdfProcessingSessionNotFoundError,
} from '@/server/pdf-processing';
import { DocumentNotFoundError, CurriculaRepository } from '@/server/curricula';
import { deriveDifficultyTier } from '../domain/full-bank-assessment.types';
import type { DifficultyTier, FullBankAssessmentSummary, StartFullBankAssessmentInput } from '../domain/full-bank-assessment.types';

/** LLD-equivalent grounding topK for full-bank generation — same value `RETRIEVAL_TOPK_LESSON` uses,
 * since this is the same `generateLessonBatch` call, just fixed-total-shaped. */
export const FULL_BANK_GROUNDING_TOP_K_ENV = 'RETRIEVAL_TOPK_LESSON' as const;

/**
 * FR-PDF-13's full-expression bank-generation feature (migration plan Phase 8 — "despite living in
 * legacy's `pdf-processing` module directory... port it here as part of the practice feature area,
 * reusing Phase 6's already-real `RetrievalService`/budget/covered-concepts/lesson-batch-planner/
 * confidence-calibration domain utilities rather than duplicating them"). Ported logic from
 * `legacy/api/src/modules/pdf-processing/application/full-bank-assessment.service.ts`.
 *
 * Generates a fixed-shape, whole-document, difficulty-tiered question bank for an already-ingested
 * `curriculum_document`, resumable across a genuine application restart via {@link resumeProcessing}
 * (called by whichever future dispatch wires `StaleSessionRecoveryWorker`'s multi-session-kind
 * dispatch — see `docs/plans/nextjs-rewrite-phase8-plan.md`'s "Decisions made" for why that wiring is
 * this dispatch's own documented, accepted deferral).
 *
 * **Fixed shape, never exceeded across any number of resumes**: unlike a rate-derived lesson-generation
 * loop, {@link runGenerationLoop} re-derives "how many questions are still needed" from the session's
 * *actual persisted* `generated_question` count every single call (including every resume) —
 * `targetQuestionCount - alreadyGenerated` — so a session that already reached its target never plans a
 * single further batch.
 *
 * **Re-extracts on every call, deliberately**: like `PdfProcessingService.processSession`, this class
 * always re-reads the source PDF from durable object storage and re-runs `extractPdfPages` rather than
 * caching pages in memory across calls — a cheap, deterministic CPU operation, and exactly what makes a
 * resume correct after a genuine process restart.
 */
export class FullBankAssessmentService {
  constructor(
    private readonly sessions: PdfProcessingSessionRepository,
    private readonly generatedQuestions: GeneratedQuestionRepository,
    private readonly curricula: CurriculaRepository,
    private readonly aiService: ReturnType<typeof getAiService>,
    private readonly retrieval: ReturnType<typeof getRetrievalService>,
  ) {}

  /**
   * Creates a `full_bank_assessment`-kind session targeting `documentId` (which must belong to
   * `curriculumId`) and schedules generation to run after the response is built — the same
   * 202-before-AI-work convention `PdfProcessingService.uploadPdf` established.
   *
   * @throws {DocumentNotFoundError} `documentId` does not exist under `curriculumId`.
   */
  async start(curriculumId: string, documentId: string, input: StartFullBankAssessmentInput): Promise<{ sessionId: string; status: string }> {
    const document = await this.curricula.findDocumentById(documentId);
    if (!document || document.curriculumId !== curriculumId) throw new DocumentNotFoundError();

    const curriculum = await this.curricula.findById(curriculumId);
    const env = getEnv();
    const tenantId = requireTenantIdOrInternal();
    const userId = getRequestContext()?.userId ?? null;

    const entity = new PdfProcessingSessionEntity();
    entity.id = randomUUID();
    entity.initiatedByUserId = userId;
    entity.sourceFileName = document.fileName;
    entity.contentTypeHint = null;
    // Already known — this document was ingested as Curriculum reference/lesson material; no fresh
    // classification call is needed.
    entity.contentType = 'Lesson';
    entity.status = 'Processing';
    entity.sessionKind = 'full_bank_assessment';
    entity.targetQuestionCount = input.targetQuestionCount ?? env.FULL_BANK_ASSESSMENT_DEFAULT_QUESTION_COUNT;
    entity.targetTotalMinutes = input.targetTotalMinutes ?? env.FULL_BANK_ASSESSMENT_DEFAULT_TOTAL_MINUTES;
    entity.storageKeyPrefix = `tenants/${tenantId}/pdf/${entity.id}/`;
    entity.sourceStorageKey = document.storageKey;
    entity.subjectId = curriculum?.subjectId ?? null;
    entity.curriculumId = curriculumId;
    entity.curriculumDocumentId = document.id;
    entity.fileHash = document.fileHash;
    entity.forceReprocess = false;
    entity.reusedFromSessionId = null;
    entity.pageCount = document.pageCount;
    entity.tokensUsed = 0;
    entity.totalCost = 0;
    entity.budgetExhausted = false;
    entity.lastCompletedPage = 0;
    entity.coveredConcepts = null;
    entity.resumeAttempts = 0;
    entity.workerId = null;
    entity.heartbeatAt = null;
    entity.completedAt = null;

    await this.sessions.insert(entity);

    scheduleProcessing(tenantId, entity.id);

    return { sessionId: entity.id, status: entity.status };
  }

  /** `GET /api/practice/full-bank/:id`'s poll contract. @throws {PdfProcessingSessionNotFoundError} */
  async getSummary(sessionId: string): Promise<FullBankAssessmentSummary> {
    const session = await this.sessions.findById(sessionId);
    if (!session) throw new PdfProcessingSessionNotFoundError();

    const questions = await this.generatedQuestions.findAllForSession(sessionId);
    const breakdown: Record<DifficultyTier, number> = { Easy: 0, Medium: 0, Hard: 0 };
    for (const question of questions) {
      breakdown[deriveDifficultyTier(question.bloomsLevel)] += 1;
    }

    return {
      id: session.id,
      status: session.status,
      curriculumId: session.curriculumId,
      curriculumDocumentId: session.curriculumDocumentId,
      targetQuestionCount: session.targetQuestionCount ?? 0,
      targetTotalMinutes: session.targetTotalMinutes ?? 0,
      questionsGenerated: questions.length,
      isComplete: questions.length >= (session.targetQuestionCount ?? 0),
      difficultyBreakdown: breakdown,
      lastCompletedPage: session.lastCompletedPage,
      pageCount: session.pageCount,
      tokensUsed: session.tokensUsed,
      totalCost: Number(session.totalCost),
      budgetExhausted: session.budgetExhausted,
      errorCode: session.errorCode,
      errorMessage: session.errorMessage,
      createdAt: session.createdAt,
      completedAt: session.completedAt,
    };
  }

  /** Resumes a stuck `full_bank_assessment` session. Safe to call any number of times: a call against
   * an already-`Completed`-shaped session (output-wise) is a cheap no-op, since
   * {@link runGenerationLoop}'s own re-derived "how many more are needed" check returns immediately. */
  async resumeProcessing(sessionId: string): Promise<void> {
    await this.processSession(sessionId);
  }

  async processSession(sessionId: string): Promise<void> {
    const session = await this.sessions.findById(sessionId);
    if (!session) return;
    if (session.status === 'Completed' || session.status === 'Failed') return;

    try {
      const { stream } = await getStoragePortSingleton().getStream(session.sourceStorageKey);
      const buffer = await streamToBuffer(stream);
      const pages = await extractPdfPages(buffer);
      if (session.pageCount === null) {
        session.pageCount = pages.length;
      }

      await this.runGenerationLoop(session, pages);

      const totalGenerated = await this.generatedQuestions.countForSession(session.id);
      session.totalQuestions = totalGenerated;
      session.successfulQuestions = totalGenerated;
      session.status = 'Completed';
      session.completedAt = new Date();
      await this.sessions.save(session);
    } catch (err) {
      if (err instanceof AiDisabledError || err instanceof AiServiceUnavailableError) {
        // Graceful degradation (FR-AI-1): status is left wherever `runGenerationLoop` last durably
        // advanced it (`Processing`), so a later resume can retry.
        session.errorCode = err.code;
        session.errorMessage = err.message;
        await this.sessions.save(session).catch(() => undefined);
        return;
      }

      const domainError = err instanceof DomainError ? err : new InternalDomainError(err);
      session.status = 'Failed';
      session.errorCode = domainError.code;
      session.errorMessage = domainError.message;
      await this.sessions.save(session).catch(() => undefined);
    }
  }

  private async runGenerationLoop(session: PdfProcessingSessionEntity, pages: PageText[]): Promise<void> {
    const env = getEnv();
    const target = session.targetQuestionCount ?? env.FULL_BANK_ASSESSMENT_DEFAULT_QUESTION_COUNT;
    const alreadyGenerated = await this.generatedQuestions.countForSession(session.id);
    const remainingTarget = Math.max(0, target - alreadyGenerated);
    if (remainingTarget === 0) return; // Fixed shape already reached — nothing more to do.

    const limits = { maxTokensPerSession: env.PDF_MAX_TOKENS_PER_SESSION, maxCostPerSessionUsd: env.PDF_MAX_COST_PER_SESSION_USD };
    let covered = session.coveredConcepts ?? [];

    const plans = planLessonBatches({
      pages,
      estimatedQuestionsPerPage: null, // Fixed total below, not a density-derived one.
      questionsMin: remainingTarget,
      questionsMax: remainingTarget,
      batchSize: env.PDF_QUESTIONS_BATCH_SIZE,
      resumeFromPage: session.lastCompletedPage,
    });

    let batchIndex = 0;
    for (const plan of plans) {
      if (isBudgetExhausted({ tokensUsed: session.tokensUsed, totalCost: Number(session.totalCost) }, limits)) {
        session.budgetExhausted = true;
        await this.sessions.save(session);
        break;
      }

      const tenantId = requireTenantIdOrInternal();
      const grounding = await this.retrieval.retrieve({ tenantId }, { curriculumId: session.curriculumId ?? undefined }, plan.excerpt, env.RETRIEVAL_TOPK_LESSON);

      const ctx = buildInvocationContext(session, limits);
      const input: LessonBatchIn = {
        excerpt: plan.excerpt,
        pageRange: plan.pageRange,
        targetQuestionCount: plan.targetQuestionCount,
        coveredConcepts: covered,
        grounding,
      };

      // A connection error/timeout/breaker-open here propagates uncaught — no batch is persisted, the
      // watermark does not advance; `processSession`'s own catch handles the graceful-degradation path.
      const result = await this.aiService.generateLessonBatch(input, ctx);

      const entities = result.data.map((draft) => toEntity(session.id, draft, batchIndex, env.REVIEW_FLAG_CONFIDENCE_THRESHOLD));
      covered = mergeCoveredConcepts(covered, result.data.map((draft) => draft.concept));

      // The one atomic checkpoint this feature's own exit gate depends on.
      await this.sessions.persistBatchAndAdvanceWatermark({
        sessionId: session.id,
        entities,
        tokensDelta: result.usage.promptTokens + result.usage.completionTokens,
        costDelta: result.usage.costUsd ?? 0,
        endPage: plan.endPage,
        coveredConcepts: covered,
      });

      session.tokensUsed += result.usage.promptTokens + result.usage.completionTokens;
      session.totalCost = Number(session.totalCost) + (result.usage.costUsd ?? 0);
      session.lastCompletedPage = plan.endPage;
      session.coveredConcepts = covered;
      batchIndex += 1;
    }
  }
}

function buildInvocationContext(
  session: PdfProcessingSessionEntity,
  limits: { maxTokensPerSession: number; maxCostPerSessionUsd: number },
): AiInvocationContext {
  return {
    tenantId: requireTenantIdOrInternal(),
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
  entity.subjectId = null;
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
  entity.generationMethod = 'full_bank_assessment';
  entity.isAutoGenerated = true;
  entity.isHumanEdited = false;
  entity.isReviewFlagged = reviewFlagged;
  entity.notes = null;
  entity.linkedExamTypeId = null;
  entity.batchIndex = batchIndex;
  return entity;
}

/** Buffers a `StoragePort.getStream` result — matches `PdfProcessingService`'s own identical helper. */
function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk: Buffer) => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

function requireTenantIdOrInternal(): string {
  try {
    return requireTenantId();
  } catch {
    throw new InternalDomainError(new Error('FullBankAssessmentService called outside any resolved tenant scope.'));
  }
}

/** Schedules {@link runFullBankAssessmentInFreshTenantScope} to run after the current call stack
 * unwinds — mirrors `PdfProcessingService`'s own `scheduleProcessing`/`runPdfProcessingInFreshTenantScope`
 * pattern exactly (re-acquires a fresh tenant `DataSource`/ALS scope rather than relying on the
 * original request's still being valid once the HTTP response has already been sent). */
function scheduleProcessing(tenantId: string, sessionId: string): void {
  setImmediate(() => {
    runFullBankAssessmentInFreshTenantScope(tenantId, sessionId).catch(() => undefined);
  });
}

async function runFullBankAssessmentInFreshTenantScope(tenantId: string, sessionId: string): Promise<void> {
  const tenants = await getTenantsService();
  const tenant = await tenants.get(tenantId);
  const registry = getTenantDataSourceRegistry();
  const dataSource = await registry.acquire(tenant.schemaName);
  try {
    await runWithRequestContext(
      { requestId: randomUUID(), tenantId: tenant.id, tenantSlug: tenant.subdomainSlug, tenantSchema: tenant.schemaName, tenantDataSource: dataSource },
      async () => {
        requireTenantDataSource();
        const service = new FullBankAssessmentService(
          new PdfProcessingSessionRepository(dataSource),
          new GeneratedQuestionRepository(dataSource),
          new CurriculaRepository(dataSource),
          getAiService(),
          getRetrievalService(),
        );
        await service.processSession(sessionId);
      },
    );
  } finally {
    registry.release(tenant.schemaName);
  }
}
