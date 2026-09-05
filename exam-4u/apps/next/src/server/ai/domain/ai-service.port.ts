import type {
  AiReadinessState,
  ClassifyContentIn,
  ClassifyContentOut,
  ExtractedQuestionDraft,
  ExtractPageIn,
  GeneratedQuestionDraft,
  ImageCaptionIn,
  ImageCaptionOut,
  LessonBatchIn,
  PromptPracticeIn,
  SubjectMapIn,
  SubjectMapOut,
} from '@examland/contracts';

/**
 * The AI port (migration plan Phase 5) — the ONLY surface application code uses for AI. Ported
 * verbatim (interface contract, not implementation) from
 * `legacy/api/src/ai/domain/ai-service.port.ts` — the operation shapes (`@examland/contracts`'s
 * `ai-service.dto.ts`) are unchanged even though the concrete implementation behind this port is
 * entirely new (real in-process `@google/adk` + `OpenRouterLlm`, not an mTLS hop to a Python engine).
 *
 * One method per operation, deliberately NOT a generic `run<T>()` — each operation has a distinct,
 * statically-typed contract that must be zod-validated at the boundary, and a generic port would
 * erase exactly the types that matter.
 *
 * Every method: resolves the tenant's model internally (via `AiModelResolver`), calls the model once
 * (through `adk/ai-runner.ts`), records usage into `ai_call_log` (via `AiUsageRecorderPort`), and
 * throws `AiServiceUnavailableError` on timeout/connection/5xx-after-retries/open-breaker/auth
 * failure. A schema-invalid model output is NOT thrown as an error — it is reflected in the returned
 * `droppedItems` count, since "this unit produced nothing" is a normal, handled outcome for a
 * pipeline consumer, not a port-level failure.
 */
export interface AiServicePort {
  classifyContent(input: ClassifyContentIn, ctx: AiInvocationContext): Promise<AiResult<ClassifyContentOut>>;
  generateLessonBatch(input: LessonBatchIn, ctx: AiInvocationContext): Promise<AiResult<GeneratedQuestionDraft[]>>;
  extractExamPage(input: ExtractPageIn, ctx: AiInvocationContext): Promise<AiResult<ExtractedQuestionDraft[]>>;
  classifySubject(input: SubjectMapIn, ctx: AiInvocationContext): Promise<AiResult<SubjectMapOut>>;
  promptPractice(input: PromptPracticeIn, ctx: AiInvocationContext): Promise<AiResult<GeneratedQuestionDraft[]>>;
  /** The only operation carrying image input. Same failure semantics as every other method (throws
   * `AiServiceUnavailableError`/`AiDisabledError`; a schema-invalid or unusable model output is
   * reflected as `droppedItems: 1`, not thrown). */
  captionImage(input: ImageCaptionIn, ctx: AiInvocationContext): Promise<AiResult<ImageCaptionOut>>;

  /** `false` when `AI_ENABLED=false` — callers check this (or simply call a method and catch
   * `AiDisabledError`) to decide whether to attempt AI work at all. */
  readonly available: boolean;

  /** Non-fatal readiness snapshot — no route consumes this yet in this dispatch (no
   * `GET /api/health/ready` exists anywhere in `apps/next` yet, see the Phase 5 plan doc's own
   * "Explicitly out of scope"), but the method is real and ready for whichever phase adds that route.
   * Never throws, never performs network I/O, and its result must never be a factor in overall
   * readiness once consumed. */
  getReadiness(): AiReadinessState;
}

/** Per-call context every `AiServicePort` method needs. */
export interface AiInvocationContext {
  tenantId: string;
  userId?: string;
  processingSessionId?: string;
  correlationId: string;
  budget: { tokensRemaining: number; costRemainingUsd: number };
}

/** Every `AiUsage`, as recorded by `AiUsageRecorderPort`. */
export interface AiUsage {
  model: string;
  promptTokens: number;
  completionTokens: number;
  costUsd: number | null;
  costUnavailable: boolean;
  latencyMs: number;
  attempts: number;
}

/** The successful-call return shape every `AiServicePort` method resolves with. */
export interface AiResult<T> {
  data: T;
  usage: AiUsage;
  droppedItems: number;
}
