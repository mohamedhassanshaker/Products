import { randomUUID } from 'node:crypto';
import type { PromptPracticeIn } from '@examland/contracts';
import type { AiInvocationContext, AiServicePort, RetrievalService } from '@/server/ai';
import { getEnv } from '@/server/config';
import { getRequestContext } from '@/server/context';
import { InternalDomainError } from '@/server/common/errors/domain-error';
import { CurriculumNotFoundError, type CurriculaRepository } from '@/server/curricula';
import { AiDisabledError } from '@/server/ai';
import { EmptyPromptError, InvalidQuestionCountError } from '../domain/errors';
import type { PromptPracticeInput, PromptPracticeResult } from '../domain/practice.types';

/** Same grounding topK every other non-lesson-batch retrieval call in this app uses (`RETRIEVAL_TOPK_
 * PROMPT`, env-default 12) — Prompt Practice reuses the identical retrieval convention exam extraction
 * and Lesson Practice's shortfall-fill both already established. */
export const PROMPT_PRACTICE_GROUNDING_TOP_K_ENV = 'RETRIEVAL_TOPK_PROMPT' as const;

/** Inclusive question-count bounds (FR-CUR-5: "1-30 practice questions"). Exported so
 * `LessonPracticeService` (FR-CUR-6, which bounds `count` identically) reuses the same constants
 * rather than duplicating them. */
export const MIN_QUESTION_COUNT = 1;
export const MAX_QUESTION_COUNT = 30;

/**
 * FR-CUR-5's live, on-demand Prompt Practice generation (migration plan Phase 8) — deliberately
 * synchronous and NOT modeled as a `pdf_processing_session`-style background job: a single Prompt
 * Practice request is one bounded `AiServicePort.promptPractice` call the HTTP request can simply
 * await — there is no watermark to persist, no multi-step resumability requirement, and no packaged
 * question-bank persistence (that's Adaptive Lesson Practice's own job). Generated questions are
 * therefore never written to `generated_question` here — they exist only for the lifetime of this
 * response, matching the spec's own "generated live from a free-text prompt" framing. Ported logic
 * from `legacy/api/src/modules/practice/application/prompt-practice.service.ts`.
 *
 * **Validation ordering (this phase's own exit gate — three distinct, named errors, not one generic
 * `VALIDATION_FAILED`)**: {@link generate} checks, in order: prompt non-empty after trimming
 * (`EmptyPromptError`), count within [1,30] (`InvalidQuestionCountError`), then Curriculum existence
 * (`CurriculumNotFoundError`, also covering "exists but not owned by this caller" — deliberately
 * non-distinguishing, mirroring `CurriculaService`'s own convention for this same non-distinguishing
 * detail-screen behavior).
 *
 * **Zero-usable-questions handling (FR-CUR-5)**: a successful `AiServicePort.promptPractice` call
 * that returns an empty `data` array is reflected as `{status: 'failed', message: ...}` — a normal
 * `200`, never an HTTP-level error — with an actionable message.
 */
export class PromptPracticeService {
  constructor(
    private readonly aiService: AiServicePort,
    private readonly retrieval: RetrievalService,
    private readonly curricula: CurriculaRepository,
  ) {}

  /**
   * @throws {EmptyPromptError} @throws {InvalidQuestionCountError} @throws {CurriculumNotFoundError}
   */
  async generate(input: PromptPracticeInput): Promise<PromptPracticeResult> {
    const prompt = input.prompt.trim();
    if (prompt.length === 0) {
      throw new EmptyPromptError();
    }
    if (!Number.isInteger(input.count) || input.count < MIN_QUESTION_COUNT || input.count > MAX_QUESTION_COUNT) {
      throw new InvalidQuestionCountError();
    }

    const curriculum = await this.curricula.findById(input.curriculumId);
    // Owner check deliberately omitted here (not merely forgotten) — a Curriculum belonging to
    // another user in this tenant is reported identically to a nonexistent one, matching legacy's
    // documented non-distinguishing convention for this endpoint.
    if (!curriculum || curriculum.ownerUserId !== requireUserId()) {
      throw new CurriculumNotFoundError();
    }

    // **Real bug found + fixed by Phase 10 sub-slice "10b1"'s own AI-outage-isolation e2e proof**:
    // this method used to call `this.retrieval.retrieve(...)` (which embeds `prompt` via the real
    // embeddings provider, entirely OUTSIDE `AiServicePort`'s own `AI_ENABLED` gate) BEFORE ever
    // reaching `this.aiService.promptPractice(...)` (the call that actually throws the intended, clean
    // `AiDisabledError`). With `AI_ENABLED=false` and no live embeddings credential (this app's own
    // documented default "configured but not live" shape — see `docker-compose.next.yml`'s own
    // `EMBEDDINGS_PROVIDER` comment), that meant a real, uncaught `Error: Embeddings provider returned
    // 401` propagated all the way to the HTTP boundary as a bare `500 INTERNAL_ERROR` — never the
    // documented `503 AI_DISABLED` this app's own AI-outage-isolation contract promises every AI-backed
    // feature will fail with. Checking `aiService.available` up front (mirroring
    // `AiService.assertEnabled`'s own "WITHOUT opening a socket" contract) closes this gap: when AI is
    // disabled, this method now fails fast with the correct, documented error before ever touching the
    // embeddings network call at all.
    if (!this.aiService.available) {
      throw new AiDisabledError();
    }

    const env = getEnv();
    const tenantId = requireTenantId();
    const grounding = await this.retrieval.retrieve({ tenantId }, { curriculumId: input.curriculumId }, prompt, env.RETRIEVAL_TOPK_PROMPT);

    const aiInput: PromptPracticeIn = { prompt, count: input.count, grounding };
    const ctx: AiInvocationContext = {
      tenantId,
      userId: requireUserId(),
      correlationId: randomUUID(),
      budget: { tokensRemaining: env.PDF_MAX_TOKENS_PER_SESSION, costRemainingUsd: env.PDF_MAX_COST_PER_SESSION_USD },
    };

    const result = await this.aiService.promptPractice(aiInput, ctx);

    if (result.data.length === 0) {
      // FR-CUR-5: a normal 200, never thrown as an HTTP error.
      return {
        status: 'failed',
        message:
          "We couldn't generate usable questions from this prompt. Try being more specific about a topic or concept from this Curriculum, or choose a different Curriculum if this one doesn't cover what you're asking about.",
      };
    }

    // Confidence is deliberately never computed/returned here — there is no persisted
    // `generated_question` row for a Prompt Practice question to attach a stored `confidence_score`
    // to (see this class's own doc comment for why these questions are never persisted).
    return {
      status: 'completed',
      questions: result.data.map((draft) => ({
        questionText: draft.questionText,
        options: draft.options,
        correctAnswer: draft.correctAnswer,
        explanation: draft.explanation,
        bloomsLevel: draft.bloomsLevel,
      })),
    };
  }
}

/** Programmer-error guard, matching every other tenant-scoped service's identical shape. */
function requireTenantId(): string {
  const tenantId = getRequestContext()?.tenantId;
  if (!tenantId) {
    throw new InternalDomainError(new Error('PromptPracticeService called outside any resolved tenant scope.'));
  }
  return tenantId;
}

/** Programmer-error guard: every route this service backs sits behind `requireTenantUser`. */
function requireUserId(): string {
  const userId = getRequestContext()?.userId;
  if (!userId) {
    throw new InternalDomainError(new Error('PromptPracticeService called outside any authenticated request.'));
  }
  return userId;
}
