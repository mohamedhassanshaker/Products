import { InMemorySessionService, LlmAgent, Runner } from '@google/adk';
import type { Schema } from '@google/genai';
// Side-effect import: registers `OpenRouterLlm` with `LLMRegistry` on first load of this module
// (module-level singletons in Node are evaluated once per process, so this registration happens
// exactly once regardless of how many times `runAiCall` is invoked).
import './adk/openrouter-llm';

/** One `runAiCall` invocation's input — everything `adk/ai-runner.ts` needs to build a fresh
 * `LlmAgent`/`Runner` and drive one turn. */
export interface AiRunnerCallInput {
  /** The `AiOperation` string (e.g. `'prompt-practice'`) — used to derive a valid ADK agent name and
   * to label the ADK session's `appName` for observability. */
  operation: string;
  systemInstruction: string;
  userMessage: string;
  /** Optional base64-encoded image bytes + MIME type — only `AiService.captionImage` supplies this
   * (the one operation, of six, whose input carries image bytes). Threaded through as an ADK `Part`
   * with `inlineData` set; `openrouter-llm.ts`'s own message builder detects it and emits an
   * OpenAI-compatible multi-modal content block, genuinely transmitting the image, not a
   * text-only placeholder. */
  image?: { base64: string; mimeType: string };
  /** The resolved OpenRouter model id (`AiModelResolver`'s output) — passed to `LlmAgent` as a
   * plain string, resolved to a live `OpenRouterLlm` instance via `LLMRegistry` (migration plan's own
   * explicit "registered via `LLMRegistry.register`" requirement). */
  modelId: string;
  /** A Gemini-style `Schema` (not a zod object — see `openrouter-llm.ts`'s own doc comment for why)
   * constraining the model's JSON output. Omit for free-text generation. */
  outputSchema?: Schema;
  /** Bounds the call's real HTTP request (`AI_SERVICE_TIMEOUT_MS`) — threaded by ADK's `Runner` all
   * the way down to `OpenRouterLlm.generateContentAsync`'s own third parameter (confirmed by reading
   * `@google/adk`'s actual `llm_agent.js`, see the Phase 5 plan doc's "Decisions made" #6). */
  abortSignal?: AbortSignal;
}

export interface AiRunnerCallResult {
  /** The model's raw output text (JSON, when `outputSchema` was supplied — still re-validated by the
   * caller against this app's own zod schemas, never trusted blindly). */
  text: string;
  usage: { promptTokens: number; completionTokens: number };
  finishReason?: string;
}

/**
 * Thrown when ADK's own `Runner`/`LlmAgent` machinery reports a model-call failure via an event's
 * `errorCode`/`errorMessage` fields rather than a re-thrown exception — see this file's own doc
 * comment on {@link runAiCall} for why that distinction matters and how it was discovered.
 * `httpStatus` is best-effort-parsed back out of `errorMessage`'s text (see {@link extractHttpStatus})
 * since ADK's `LlmAgent.runAndHandleError` only preserves the caught error's `message` string, not the
 * original `OpenRouterHttpError` object/its `status` property.
 */
export class AiRunnerCallError extends Error {
  constructor(
    message: string,
    public readonly httpStatus?: number,
  ) {
    super(message);
    this.name = 'AiRunnerCallError';
  }
}

/** Best-effort extraction of the HTTP status `openrouter-llm.ts`'s `OpenRouterHttpError` embeds in
 * its own `message` text (`"OpenRouter responded ${status}: ..."`) — the only channel available once
 * that error has crossed ADK's `runAndHandleError` boundary (see {@link runAiCall}'s doc comment). */
function extractHttpStatus(message: string): number | undefined {
  const match = message.match(/OpenRouter responded (\d+):/);
  return match ? Number(match[1]) : undefined;
}

/**
 * The composition point that turns one ADK `LlmAgent`/`Runner`/session-service invocation into a
 * single AI call (migration plan Phase 5's own `server/ai/ai-runner.ts` naming). Builds a fresh
 * `LlmAgent` + `Runner` **per call** (cheap — no persistent connection/pool to reuse; `LlmAgent`
 * construction is pure object setup) with an explicit `new InMemorySessionService()` — the migration
 * plan's own explicit instruction ("Use ADK's `InMemorySessionService` only — do NOT adopt ADK's
 * MikroORM-backed persistent session store"). No durable pipeline state is ever read from or written
 * to this session — every durable concern (cost/usage accounting, resumability watermarks) stays
 * owned by TypeORM tenant tables exactly as the migration plan requires; the ADK session exists only
 * to satisfy `Runner.runAsync`'s own API shape for the single turn this function drives.
 *
 * **A real, previously-latent behavior found only by actually running this against live
 * infrastructure (no `OPENROUTER_API_KEY` in this environment reliably reproduces it): ADK's own
 * `LlmAgent.runAndHandleError` does NOT re-throw an exception thrown by `BaseLlm.generateContentAsync`
 * (confirmed by reading `@google/adk`'s actual `llm_agent.js`)** — it catches it and yields a normal
 * `Event` with `errorCode`/`errorMessage` fields set instead, so `runner.runAsync`'s `for await` loop
 * never throws on a model failure by itself. Without accounting for this, a real OpenRouter `401`
 * would have been silently swallowed and misreported as "the model produced an empty/unparseable
 * response" (`AiService`'s own droppedItems=1 branch) rather than the real transport/auth failure it
 * actually is. This function therefore inspects every event's `errorCode`/`errorMessage` and throws
 * {@link AiRunnerCallError} when one is present and no usable text was ever produced.
 *
 * @throws {AiRunnerCallError} when ADK reports a model-call failure via an event (see above).
 * @throws Whatever else `OpenRouterLlm.generateContentAsync`/ADK itself throws synchronously (rare —
 *   an `Error`-typed throw is normally converted to the above instead) — never swallowed;
 *   `AiService.invoke()` is the layer that classifies and retries.
 */
export async function runAiCall(input: AiRunnerCallInput): Promise<AiRunnerCallResult> {
  const agent = new LlmAgent({
    name: sanitizeAgentName(input.operation),
    model: input.modelId,
    instruction: input.systemInstruction,
    ...(input.outputSchema ? { outputSchema: input.outputSchema } : {}),
  });

  const appName = 'examland-ai';
  const userId = 'ai-service';
  const sessionService = new InMemorySessionService();
  const runner = new Runner({ appName, agent, sessionService });
  const session = await sessionService.createSession({ appName, userId });

  let lastText = '';
  let usage = { promptTokens: 0, completionTokens: 0 };
  let finishReason: string | undefined;
  let capturedErrorMessage: string | undefined;

  for await (const event of runner.runAsync({
    userId,
    sessionId: session.id,
    newMessage: {
      role: 'user',
      parts: input.image
        ? [{ text: input.userMessage }, { inlineData: { data: input.image.base64, mimeType: input.image.mimeType } }]
        : [{ text: input.userMessage }],
    },
    abortSignal: input.abortSignal,
  })) {
    if (event.errorMessage) {
      // See this function's own doc comment — ADK reports a model-call failure this way, not by
      // re-throwing. Captured, not thrown immediately, so a legitimate later event in the same run
      // (there normally won't be one, but nothing here assumes so) still gets a chance to supply
      // real text first.
      capturedErrorMessage = event.errorMessage;
      continue;
    }
    const text = (event.content?.parts ?? []).map((part) => part.text ?? '').join('');
    if (text) lastText = text;
    if (event.usageMetadata) {
      usage = {
        promptTokens: event.usageMetadata.promptTokenCount ?? usage.promptTokens,
        completionTokens: event.usageMetadata.candidatesTokenCount ?? usage.completionTokens,
      };
    }
    if (event.finishReason) finishReason = String(event.finishReason);
  }

  if (capturedErrorMessage && !lastText) {
    throw new AiRunnerCallError(capturedErrorMessage, extractHttpStatus(capturedErrorMessage));
  }

  return { text: lastText, usage, finishReason };
}

/** ADK requires an agent `name` to be a valid JS identifier — derives one deterministically from the
 * `AiOperation` string (e.g. `'prompt-practice'` -> `'ai_prompt_practice'`). */
function sanitizeAgentName(operation: string): string {
  return `ai_${operation.replace(/[^a-zA-Z0-9_]/g, '_')}`;
}
