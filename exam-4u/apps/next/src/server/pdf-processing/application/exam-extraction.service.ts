import { randomUUID } from 'node:crypto';
import type { ExtractedQuestionDraft, ExtractPageIn } from '@examland/contracts';
import { getEnv } from '@/server/config';
import { requireTenantId } from '@/server/context';
import type { AiInvocationContext, AiServicePort, RetrievalService } from '@/server/ai';
import type { PageText } from '@/server/common/util/chunking.util';
import { isBudgetExhausted } from '../domain/budget';
import { calibrateConfidence } from '../domain/confidence';
import { GeneratedQuestionEntity, PdfProcessingSessionEntity } from '@/server/infrastructure/database';
import { PdfProcessingSessionRepository } from '../infrastructure/pdf-processing-session.repository';

/** LLD §9.3 table: "one page with <20 chars skipped without a model call" — pages below this
 * threshold are never sent to the engine at all (not even a degenerate call), matching legacy's
 * identical cost-control rule/constant. */
export const MIN_PAGE_TEXT_CHARS = 20;

/** LLD §9.4: exam extraction retrieves topK 12 grounding chunks per page. */
export const EXAM_GROUNDING_TOP_K = 12;

/**
 * FR-PDF-5's exam-extraction branch (LLD §8.3's `contentType = Exam` loop) — this sub-slice's ONE
 * fully-wired content-type strategy, the natural "smoke feature" for the real, now-built PDF pipeline
 * (analogous to how Phase 5 proved its own AI call path with `promptPractice`). Ported logic from
 * `legacy/api/src/modules/pdf-processing/application/exam-extraction.service.ts`, adapted to this
 * app's `getEnv()`-inline config convention (no injected `AppConfigService`) and an explicit
 * `RetrievalService.retrieve(tenant, scope, queryText, topK)` call (this app's own deviation from
 * legacy's ALS-reading `RetrievalService`, per `docs/plans/nextjs-rewrite-phase5-plan.md`'s "Decisions
 * made" #3).
 *
 * **Per-page unit, not batched** (LLD §9.3 table: "Extraction unit: one page") — one `extractExamPage`
 * call always covers exactly one source page; `session.lastCompletedPage` therefore always advances by
 * exactly one page per successful call, never by a chunk-derived page range.
 *
 * **Budget-before-call ordering** (this sub-slice's own exit gate): the loop checks the session's
 * *current* running totals before issuing that iteration's `extractExamPage` call — never after.
 *
 * **`provided` vs `inferred` distinction (FR-PDF-5)**: `answerSource` is a real, queryable column on
 * `generated_question` — populated verbatim from `ExtractedQuestionDraft.answerSource`, and the
 * calibrated `confidence_score` is derived by the matching `exam_extraction_provided`/
 * `exam_extraction_inferred` band in `calibrateConfidence`, never a single shared formula for both.
 *
 * **Grounded generation (FR-CUR-4)**: grounding is resolved via `RetrievalService.retrieve` before each
 * page's call (topK 12, using the page's own text as the query, scoped to `session.curriculumId` when
 * set), and an empty result is a valid, unremarkable retrieval outcome passed through unchanged.
 *
 * **Per-item parse-failure isolation and graceful AI-outage propagation**: `result.droppedItems` is
 * never inspected to decide whether to keep the rest of a page's output, and
 * `AiDisabledError`/`AiServiceUnavailableError` propagate uncaught so `PdfProcessingService`'s outer
 * catch handles them the same way (never `Failed`, watermark simply doesn't advance past the failing
 * page).
 *
 * **Per-page transactional checkpoint**: each page's `generated_question` rows (or, for a
 * negligible-text page that is skipped without a model call, just the watermark advance on its own) are
 * committed together with `last_completed_page`/`tokens_used`/`total_cost` in the SAME transaction via
 * {@link PdfProcessingSessionRepository.persistBatchAndAdvanceWatermark} — a crash mid-loop never
 * leaves the watermark unadvanced on disk for an already-durably-inserted page.
 */
export class ExamExtractionService {
  constructor(
    private readonly aiService: AiServicePort,
    private readonly sessions: PdfProcessingSessionRepository,
    private readonly retrieval: RetrievalService,
  ) {}

  /**
   * Mutates `session` in place (tokens/cost/watermark/budget-exhausted flag) as each page completes,
   * purely so this loop's own subsequent iterations read correct running totals — the DB row is the
   * actual durable source of truth a resume reads from (each page's rows/watermark advance are
   * committed before the next page starts). The caller (`PdfGenerationOrchestrator`) separately persists
   * `session`'s own terminal `status`/`totalQuestions` fields once the whole branch returns.
   */
  async generate(session: PdfProcessingSessionEntity, pages: PageText[]): Promise<void> {
    const env = getEnv();
    const limits = { maxTokensPerSession: env.PDF_MAX_TOKENS_PER_SESSION, maxCostPerSessionUsd: env.PDF_MAX_COST_PER_SESSION_USD };
    const remainingPages = pages
      .filter((page) => page.pageNumber > session.lastCompletedPage)
      .sort((a, b) => a.pageNumber - b.pageNumber);

    for (const page of remainingPages) {
      // Cost-control skip: a negligible-text page is never sent to the engine, and never counted as a
      // "call" at all — the watermark still advances so a resumed run doesn't re-inspect it. Still
      // persisted transactionally (zero rows, watermark-only) so this skip itself is crash-safe.
      if (page.text.trim().length < MIN_PAGE_TEXT_CHARS) {
        await this.sessions.persistBatchAndAdvanceWatermark({
          sessionId: session.id,
          entities: [],
          tokensDelta: 0,
          costDelta: 0,
          endPage: page.pageNumber,
          coveredConcepts: session.coveredConcepts ?? [],
        });
        session.lastCompletedPage = page.pageNumber;
        continue;
      }

      // Budget check BEFORE the call — see class doc comment.
      if (isBudgetExhausted({ tokensUsed: session.tokensUsed, totalCost: Number(session.totalCost) }, limits)) {
        session.budgetExhausted = true;
        break;
      }

      const tenantId = requireTenantId();
      const grounding = await this.retrieval.retrieve(
        { tenantId },
        { curriculumId: session.curriculumId ?? undefined },
        page.text,
        EXAM_GROUNDING_TOP_K,
      );

      const ctx = buildInvocationContext(session, limits, tenantId);
      const input: ExtractPageIn = {
        pageNumber: page.pageNumber,
        pageText: page.text,
        grounding,
      };

      // A connection error/timeout/breaker-open here propagates uncaught — no rows are persisted, the
      // watermark does not advance, and `PdfProcessingService`'s own catch handles the graceful-
      // degradation path.
      const result = await this.aiService.extractExamPage(input, ctx);

      const entities = result.data.map((draft) => toEntity(session.id, page.pageNumber, draft, env.REVIEW_FLAG_CONFIDENCE_THRESHOLD));

      await this.sessions.persistBatchAndAdvanceWatermark({
        sessionId: session.id,
        entities,
        tokensDelta: result.usage.promptTokens + result.usage.completionTokens,
        costDelta: result.usage.costUsd ?? 0,
        endPage: page.pageNumber,
        coveredConcepts: session.coveredConcepts ?? [],
      });

      session.tokensUsed += result.usage.promptTokens + result.usage.completionTokens;
      session.totalCost = Number(session.totalCost) + (result.usage.costUsd ?? 0);
      session.lastCompletedPage = page.pageNumber;
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

function toEntity(
  sessionId: string,
  pageNumber: number,
  draft: ExtractedQuestionDraft,
  reviewFlagThreshold: number,
): GeneratedQuestionEntity {
  const { score, reviewFlagged } =
    draft.answerSource === 'provided'
      ? calibrateConfidence({ kind: 'exam_extraction_provided', modelConfidence: draft.modelConfidence }, reviewFlagThreshold)
      : calibrateConfidence({ kind: 'exam_extraction_inferred', groundingStrength: draft.groundingStrength }, reviewFlagThreshold);

  const entity = new GeneratedQuestionEntity();
  entity.id = randomUUID();
  entity.processingSessionId = sessionId;
  entity.subjectId = null; // FR-PDF-7 mapping does not apply to the Exam branch
  entity.questionText = draft.questionText;
  entity.optionsJson = Object.fromEntries(draft.options.map((option) => [option.key, option.text]));
  entity.correctAnswer = draft.correctAnswer;
  entity.explanation = draft.explanation;
  entity.questionType = 'multiple_choice';
  entity.bloomsLevel = draft.bloomsLevel;
  entity.sourcePageRange = draft.sourcePageRange ?? String(pageNumber);
  entity.sourceSection = draft.sourceSection ?? null;
  entity.answerSource = draft.answerSource;
  entity.confidenceScore = score;
  entity.generationMethod = draft.answerSource === 'provided' ? 'exam_extraction_with_key' : 'exam_extraction_inferred';
  entity.isAutoGenerated = true;
  entity.isHumanEdited = false;
  entity.isReviewFlagged = reviewFlagged;
  entity.notes = null;
  entity.linkedExamTypeId = null;
  entity.batchIndex = null; // per-page, not batched
  return entity;
}
