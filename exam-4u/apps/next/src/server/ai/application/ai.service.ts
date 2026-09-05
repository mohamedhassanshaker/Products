import { randomUUID } from 'node:crypto';
import type {
  AiReadinessState,
  ClassifyContentIn,
  ClassifyContentOut,
  ExtractPageIn,
  ExtractedQuestionDraft,
  GeneratedQuestionDraft,
  GroundingChunk,
  ImageCaptionIn,
  ImageCaptionOut,
  LessonBatchIn,
  PromptPracticeIn,
  SubjectMapIn,
  SubjectMapOut,
} from '@examland/contracts';
import type { Schema } from '@google/genai';
import type { z } from 'zod';
import { getEnv } from '@/server/config';
import { logger } from '@/server/logging';
import { resolveModelForTenant } from '../ai-model-resolver';
import { AiRunnerCallError, runAiCall } from '../ai-runner';
import {
  classifyContentOutSchema,
  extractedQuestionDraftArraySchema,
  generatedQuestionDraftArraySchema,
  imageCaptionOutSchema,
  subjectMapOutSchema,
} from '../adk/operation-schemas';
import { AiCircuitBreaker } from '../domain/ai-circuit-breaker';
import {
  zClassifyContentOut,
  zExtractedQuestionDraftArray,
  zGeneratedQuestionDraftArray,
  zImageCaptionOut,
  zSubjectMapOut,
} from '../domain/ai-response.schemas';
import { AiContractViolationError, AiDisabledError, AiServiceUnavailableError } from '../domain/errors';
import type { AiInvocationContext, AiResult, AiServicePort, AiUsage } from '../domain/ai-service.port';
import type { AiUsageRecorderPort } from '../domain/ai-usage-recorder.port';

/** The six `AiOperation` string labels — used for the ADK agent name derivation, `ai_call_log.task`,
 * and log correlation. Kept local to this file (not re-exported) since no caller outside `AiService`
 * needs to name an operation directly. */
type AiOperation =
  | 'classify-content'
  | 'generate-lesson-batch'
  | 'extract-exam-page'
  | 'classify-subject'
  | 'prompt-practice'
  | 'caption-image';

/** 5 consecutive transport failures open the breaker; it re-probes after 30s — matches legacy's own
 * tuning exactly (no reason to retune given the failure semantics are identical). */
const BREAKER_FAILURE_THRESHOLD = 5;
const BREAKER_OPEN_MS = 30_000;
/** Per-call attempt budget, matching legacy's own generic timeout/retry/breaker flow. */
const MAX_ATTEMPTS = 3;

/** What one operation's prompt-building step returns — everything `invoke()` needs to actually run
 * the ADK call, decoupled from the typed input/output shapes each public method deals in. */
interface PromptSpec {
  systemInstruction: string;
  userMessage: string;
  outputSchema: Schema;
  image?: { base64: string; mimeType: string };
}

/**
 * The one {@link AiServicePort} implementation (migration plan Phase 5, the actual pivot) — ports
 * `AiServiceClient`'s `invoke()` discipline (availability gate → model resolve → breaker gate →
 * attempt loop → zod schema validation → usage recording) from
 * `legacy/api/src/infrastructure/ai/ai-service/ai-service.client.ts`, but calls `adk/ai-runner.ts`
 * (real in-process `@google/adk` `LlmAgent`/`Runner` → `OpenRouterLlm` → OpenRouter HTTP) instead of
 * an mTLS hop to a standalone Python engine.
 *
 * Every method genuinely reaches `runAiCall` — none is a hardcoded fake return (per this dispatch's
 * own explicit instruction) — but only `promptPractice`'s prompt is exercised end-to-end by this
 * dispatch's own smoke script; the other five have correct signatures/wiring with a minimal-but-real
 * system instruction, ready for their respective consuming phases to deepen.
 */
export class AiService implements AiServicePort {
  private readonly breaker = new AiCircuitBreaker(BREAKER_FAILURE_THRESHOLD, BREAKER_OPEN_MS);
  private lastSuccessAt: Date | null = null;
  private lastErrorCode: string | undefined;

  constructor(private readonly usageRecorder: AiUsageRecorderPort) {}

  get available(): boolean {
    return getEnv().AI_ENABLED;
  }

  /** Non-fatal readiness snapshot — never throws, never performs network I/O. */
  getReadiness(): AiReadinessState {
    const breakerState = this.breaker.getState();
    if (breakerState === 'closed') {
      return { state: 'up', breaker: 'closed', lastSuccessAt: this.lastSuccessAt?.toISOString() ?? null };
    }
    return {
      state: 'degraded',
      breaker: breakerState,
      lastSuccessAt: this.lastSuccessAt?.toISOString() ?? null,
      lastError: this.lastErrorCode ?? 'AI_SERVICE_UNAVAILABLE',
    };
  }

  async classifyContent(input: ClassifyContentIn, ctx: AiInvocationContext): Promise<AiResult<ClassifyContentOut>> {
    return this.invoke('classify-content', ctx, zClassifyContentOut, () => ({
      systemInstruction:
        'You are ExamLand\'s content classifier. Given a sample of extracted document text, classify it as ' +
        'exactly one of "lesson", "exam", or "reference", list up to 5 topics it covers, and estimate how ' +
        'many exam questions a single page of this content could reasonably produce. Respond with JSON only, ' +
        'matching the provided schema.',
      userMessage: `File name: ${input.fileName}\n\nSample text:\n${input.sampleText}`,
      outputSchema: classifyContentOutSchema,
    }));
  }

  async generateLessonBatch(input: LessonBatchIn, ctx: AiInvocationContext): Promise<AiResult<GeneratedQuestionDraft[]>> {
    return this.invoke('generate-lesson-batch', ctx, zGeneratedQuestionDraftArray, () => ({
      systemInstruction:
        'You are ExamLand\'s lesson-question generator. Given an excerpt of lesson content and grounding ' +
        `context, generate up to ${input.targetQuestionCount} original multiple-choice questions (4-5 ` +
        'options each, exactly one correct) that test understanding of the excerpt. Avoid repeating ' +
        'concepts already covered. Respond with a JSON array only, matching the provided schema.',
      userMessage: buildLessonBatchUserMessage(input),
      outputSchema: generatedQuestionDraftArraySchema,
    }));
  }

  async extractExamPage(input: ExtractPageIn, ctx: AiInvocationContext): Promise<AiResult<ExtractedQuestionDraft[]>> {
    return this.invoke('extract-exam-page', ctx, zExtractedQuestionDraftArray, () => ({
      systemInstruction:
        'You are ExamLand\'s exam-page extractor. Given one page of an exam document (which may already ' +
        'contain questions and an answer key, or may need original questions written from its content) and ' +
        'grounding context, extract or generate multiple-choice questions faithful to the page. For each ' +
        'question, set answerSource to "provided" if the correct answer was explicit on the page, otherwise ' +
        '"inferred"; set groundingStrength based on how well the grounding context supports the question. ' +
        'Respond with a JSON array only, matching the provided schema.',
      userMessage: buildExtractExamPageUserMessage(input),
      outputSchema: extractedQuestionDraftArraySchema,
    }));
  }

  async classifySubject(input: SubjectMapIn, ctx: AiInvocationContext): Promise<AiResult<SubjectMapOut>> {
    return this.invoke('classify-subject', ctx, zSubjectMapOut, () => ({
      systemInstruction:
        'You are ExamLand\'s subject classifier. Given a list of candidate Subjects and a list of exam ' +
        'question items, map each item to the single best-matching candidate subjectId — or null if none of ' +
        'the candidates are a good match (never guess a fallback subject). Include a confidence 0-1 for each ' +
        'mapping. Respond with JSON only, matching the provided schema.',
      userMessage: buildClassifySubjectUserMessage(input),
      outputSchema: subjectMapOutSchema,
    }));
  }

  async promptPractice(input: PromptPracticeIn, ctx: AiInvocationContext): Promise<AiResult<GeneratedQuestionDraft[]>> {
    return this.invoke('prompt-practice', ctx, zGeneratedQuestionDraftArray, () => ({
      systemInstruction:
        `You are ExamLand's Prompt Practice question generator. Given a learner's free-text prompt${
          input.subjectName ? ` (subject: ${input.subjectName})` : ''
        } and grounding context retrieved from the tenant's own curricula, generate exactly ${input.count} ` +
        'original multiple-choice questions (4-5 options each, exactly one correct) relevant to the prompt. ' +
        'Ground every question in the provided context where possible. Respond with a JSON array only, ' +
        'matching the provided schema.',
      userMessage: `Prompt: ${input.prompt}\n\n${buildGroundingText(input.grounding)}`,
      outputSchema: generatedQuestionDraftArraySchema,
    }));
  }

  async captionImage(input: ImageCaptionIn, ctx: AiInvocationContext): Promise<AiResult<ImageCaptionOut>> {
    return this.invoke('caption-image', ctx, zImageCaptionOut, () => ({
      systemInstruction:
        'You are ExamLand\'s image captioner. Given an image extracted from an exam/lesson document, write ' +
        'a content-rich caption describing what the image shows (for retrieval/grounding use) and a short, ' +
        'WCAG-appropriate screen-reader alt text. Respond with JSON only, matching the provided schema.',
      userMessage: input.pageContext ? `Surrounding page text:\n${input.pageContext}` : 'No surrounding page text was provided.',
      outputSchema: imageCaptionOutSchema,
      image: { base64: input.imageBase64, mimeType: input.mimeType },
    }));
  }

  /**
   * The one private generic core every public method is a thin, typed wrapper over.
   * @throws {AiDisabledError} when `AI_ENABLED=false` — WITHOUT opening a socket.
   * @throws {AiServiceUnavailableError} on a connection/timeout/5xx-after-retries/open-breaker/auth
   *   failure.
   * @throws {AiContractViolationError} when the response body fails the boundary zod schema.
   */
  private async invoke<TData>(
    operation: AiOperation,
    ctx: AiInvocationContext,
    schema: z.ZodType<TData>,
    buildPrompt: () => PromptSpec,
  ): Promise<AiResult<TData>> {
    if (!this.available) {
      throw new AiDisabledError();
    }

    const model = await resolveModelForTenant(ctx.tenantId);

    if (!this.breaker.allowRequest()) {
      throw new AiServiceUnavailableError('The AI service circuit breaker is open.');
    }

    const correlationId = ctx.correlationId || randomUUID();
    const spec = buildPrompt();
    let lastError: unknown;
    let attemptsMade = 0;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      attemptsMade = attempt;
      const startedAt = Date.now();
      try {
        const result = await runAiCall({
          operation,
          systemInstruction: spec.systemInstruction,
          userMessage: spec.userMessage,
          outputSchema: spec.outputSchema,
          image: spec.image,
          modelId: model.primary.openRouterModelId,
        });
        const latencyMs = Date.now() - startedAt;

        const parsed = safeParseJson(result.text);
        if (parsed === undefined) {
          // Unparseable output: not retried, does not trip the breaker — "this unit produced
          // nothing", a normal, handled outcome for a pipeline consumer, not a port-level failure.
          this.breaker.recordSuccess();
          this.lastSuccessAt = new Date();
          const usage = buildUsage(model.primary.openRouterModelId, result, latencyMs, attempt);
          this.recordUsage(operation, ctx, correlationId, usage, false, 1);
          return { data: undefined as never, usage, droppedItems: 1 };
        }

        const zodResult = schema.safeParse(parsed);
        if (!zodResult.success) {
          logger.error({ operation, issues: zodResult.error.issues }, 'ai.contract_violation');
          this.breaker.recordSuccess(); // a contract violation is not a transport failure
          throw new AiContractViolationError(operation);
        }

        this.breaker.recordSuccess();
        this.lastSuccessAt = new Date();
        const usage = buildUsage(model.primary.openRouterModelId, result, latencyMs, attempt);
        this.recordUsage(operation, ctx, correlationId, usage, true, 0);
        return { data: zodResult.data, usage, droppedItems: 0 };
      } catch (err) {
        if (err instanceof AiContractViolationError) throw err;
        if (isNonRetryable(err)) {
          lastError = toServiceUnavailableError(err, true);
          break; // our-bug/config failure: never retried, burning the budget cannot help
        }
        lastError = err;
        this.lastErrorCode = 'AI_SERVICE_UNAVAILABLE';
        this.breaker.recordFailure();
      }
    }

    logger.error({ operation, attempts: attemptsMade, err: lastError }, 'ai_service.call_failed');
    throw lastError instanceof AiServiceUnavailableError ? lastError : toServiceUnavailableError(lastError, false);
  }

  private recordUsage(operation: AiOperation, ctx: AiInvocationContext, correlationId: string, usage: AiUsage, ok: boolean, droppedItems: number): void {
    this.usageRecorder.record({
      tenantId: ctx.tenantId,
      operation,
      correlationId,
      processingSessionId: ctx.processingSessionId,
      userId: ctx.userId,
      usage,
      ok,
      droppedItems,
    });
  }
}

/** Builds the `AiUsage` shape recorded/returned for one attempt.
 *
 * **Documented gap**: `costUsd` is always `null`/`costUnavailable: true` this dispatch — OpenRouter's
 * per-call cost reporting requires an opt-in `usage: {include: true}` request field whose actual
 * response shape could not be live-verified in this environment (no `OPENROUTER_API_KEY` — see
 * `docs/plans/nextjs-rewrite-phase5-plan.md`'s "Decisions made" #2). Token counts ARE real (read
 * from OpenRouter's standard `usage.prompt_tokens`/`completion_tokens` response fields, which are
 * part of the stable OpenAI-compatible contract every provider implements identically). Flagged here
 * rather than silently wiring an unverified cost-parsing path. */
function buildUsage(model: string, result: { usage: { promptTokens: number; completionTokens: number } }, latencyMs: number, attempts: number): AiUsage {
  return {
    model,
    promptTokens: result.usage.promptTokens,
    completionTokens: result.usage.completionTokens,
    costUsd: null,
    costUnavailable: true,
    latencyMs,
    attempts,
  };
}

/** Parses `text` as JSON, tolerating a model wrapping its JSON in a markdown code fence (some models
 * do this even when `response_format` asks for raw JSON) — returns `undefined` (never throws) on
 * anything unparseable. */
function safeParseJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const candidate = fenced ? fenced[1] : trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
    return undefined;
  }
}

/** `401`/`403` (invalid/missing credential) and `400` (malformed request — our own bug, e.g. an
 * unsupported model id) are never retried — mirrors legacy's `OUR_BUG_ENGINE_CODES` classification,
 * adapted from engine error codes to raw OpenRouter HTTP status since there is no longer an
 * intermediate engine to report a structured code.
 *
 * Classifies against {@link AiRunnerCallError}, not `openrouter-llm.ts`'s own `OpenRouterHttpError`
 * directly — a real, previously-latent finding from actually running this against live
 * infrastructure: ADK's `LlmAgent` does not let a model-call exception cross `Runner.runAsync`'s
 * `for await` loop as a thrown value (see `ai-runner.ts`'s own doc comment for the full write-up), so
 * by the time an error reaches this layer it has already been re-packaged as an `AiRunnerCallError`. */
function isNonRetryable(err: unknown): boolean {
  return err instanceof AiRunnerCallError && (err.httpStatus === 401 || err.httpStatus === 403 || err.httpStatus === 400);
}

function toServiceUnavailableError(err: unknown, nonRetryable: boolean): AiServiceUnavailableError {
  if (err instanceof AiRunnerCallError) {
    const statusText = err.httpStatus ? `HTTP ${err.httpStatus}` : 'an unclassified failure';
    return new AiServiceUnavailableError(`The AI provider rejected the request (${statusText}).`, nonRetryable);
  }
  const message = err instanceof Error ? err.message : 'The AI service is temporarily unavailable. Please try again shortly.';
  return new AiServiceUnavailableError(message, nonRetryable);
}

function buildGroundingText(chunks: GroundingChunk[]): string {
  if (chunks.length === 0) return 'No grounding context was retrieved for this request.';
  return (
    'Grounding context:\n' +
    chunks.map((c, i) => `[${i + 1}] (${c.fileName}, p.${c.pageNumber}, relevance ${c.score.toFixed(2)}):\n${c.text}`).join('\n\n')
  );
}

function buildLessonBatchUserMessage(input: LessonBatchIn): string {
  const parts = [`Excerpt:\n${input.excerpt}`];
  if (input.sourceSection) parts.push(`Source section: ${input.sourceSection}`);
  if (input.pageRange) parts.push(`Page range: ${input.pageRange}`);
  if (input.coveredConcepts.length > 0) parts.push(`Already-covered concepts (avoid repeating): ${input.coveredConcepts.join(', ')}`);
  parts.push(buildGroundingText(input.grounding));
  return parts.join('\n\n');
}

function buildExtractExamPageUserMessage(input: ExtractPageIn): string {
  const parts = [`Page ${input.pageNumber} text:\n${input.pageText}`];
  if (input.answerKeyHints) parts.push(`Answer key hints:\n${input.answerKeyHints}`);
  parts.push(buildGroundingText(input.grounding));
  return parts.join('\n\n');
}

function buildClassifySubjectUserMessage(input: SubjectMapIn): string {
  const candidates = input.candidates.map((c) => `- subjectId=${c.subjectId}: ${c.name}`).join('\n');
  const items = input.items.map((i) => `- ref=${i.ref}: ${i.questionText}`).join('\n');
  return `Candidate subjects:\n${candidates}\n\nItems to classify:\n${items}`;
}
