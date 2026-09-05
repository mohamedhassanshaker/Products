import { BaseLlm, LLMRegistry, type BaseLlmConnection } from '@google/adk';
import type { LlmRequest, LlmResponse } from '@google/adk';
import type { Content, Part } from '@google/genai';
import { getEnv } from '@/server/config';
import { schemaToJsonSchema } from './schema-to-json-schema';

/**
 * `OpenRouterLlm extends BaseLlm` (migration plan Phase 5, the actual pivot) — calls OpenRouter's
 * OpenAI-compatible `POST {base}/chat/completions` endpoint directly (no LiteLLM needed in Node),
 * registered via {@link LLMRegistry.register} below at module load. This is the ONLY file in this app
 * that speaks OpenRouter's wire protocol — `AiService`/`adk/ai-runner.ts` never construct an HTTP
 * request themselves, they only ever go through ADK's `LlmAgent`/`Runner` machinery, which resolves
 * to an instance of this class via the registry.
 *
 * **Real `@google/adk` API shape found by reading its actual `.d.ts` files** (see
 * `docs/plans/nextjs-rewrite-phase5-plan.md`'s "Decisions made" #6 for the full write-up):
 * `BaseLlm`'s only required method is `generateContentAsync(llmRequest, stream?, abortSignal?)`;
 * `connect()` (live/bidi) is a second abstract method this class must still implement, and does so by
 * throwing — nothing in this app ever opens a live connection. `llmRequest.config.responseSchema` is
 * always a plain Gemini-style `Schema` object by the time it reaches this class (never a raw zod
 * object — `LlmAgent`'s own constructor already converts one if given), so
 * {@link schemaToJsonSchema} converts it to a standard JSON Schema for OpenRouter's
 * `response_format: {type: 'json_schema'}`.
 */
export class OpenRouterLlm extends BaseLlm {
  /** Matches any `provider/model[:variant]`-shaped string (OpenRouter's own model-id convention,
   * e.g. `anthropic/claude-3.5-haiku`) — chosen to never collide with ADK's built-in `Gemini`
   * registration (`gemini-*`, no literal `/`). */
  static readonly supportedModels = [/^[a-z0-9_.-]+\/[a-z0-9:._-]+$/i];

  constructor(params: { model: string }) {
    super(params);
  }

  async *generateContentAsync(llmRequest: LlmRequest, stream = false, abortSignal?: AbortSignal): AsyncGenerator<LlmResponse, void> {
    if (stream) {
      // Nothing in this app ever requests streaming generation (no chat UI consumes token-by-token
      // output) — left unimplemented rather than half-implemented against an untested code path.
      throw new Error('OpenRouterLlm does not support streaming generation.');
    }

    const env = getEnv();
    const messages = buildOpenAiMessages(llmRequest);
    const responseFormat = buildResponseFormat(llmRequest);

    const timeoutController = new AbortController();
    const timeoutHandle = setTimeout(
      () => timeoutController.abort(new Error(`OpenRouter request timed out after ${env.AI_SERVICE_TIMEOUT_MS}ms`)),
      env.AI_SERVICE_TIMEOUT_MS,
    );
    const onExternalAbort = () => timeoutController.abort(abortSignal?.reason);
    abortSignal?.addEventListener('abort', onExternalAbort);

    try {
      const response = await fetch(`${env.OPENROUTER_BASE_URL.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages,
          ...(llmRequest.config?.temperature !== undefined ? { temperature: llmRequest.config.temperature } : {}),
          ...(llmRequest.config?.maxOutputTokens !== undefined ? { max_tokens: llmRequest.config.maxOutputTokens } : {}),
          ...(responseFormat ? { response_format: responseFormat } : {}),
        }),
        signal: timeoutController.signal,
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new OpenRouterHttpError(response.status, body);
      }

      const json = (await response.json()) as OpenRouterChatCompletionResponse;
      const choice = json.choices?.[0];
      const text = choice?.message?.content ?? '';

      yield {
        content: { role: 'model', parts: [{ text }] },
        finishReason: mapFinishReason(choice?.finish_reason),
        usageMetadata: {
          promptTokenCount: json.usage?.prompt_tokens ?? 0,
          candidatesTokenCount: json.usage?.completion_tokens ?? 0,
          totalTokenCount: json.usage?.total_tokens ?? 0,
        },
      };
    } finally {
      clearTimeout(timeoutHandle);
      abortSignal?.removeEventListener('abort', onExternalAbort);
    }
  }

  async connect(): Promise<BaseLlmConnection> {
    throw new Error('OpenRouterLlm does not support live/bidi connections.');
  }
}

LLMRegistry.register(OpenRouterLlm);

/** The subset of an OpenAI-compatible `chat/completions` response body this app reads. */
interface OpenRouterChatCompletionResponse {
  choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}

/** Thrown for any non-2xx OpenRouter HTTP response — carries the raw status so `AiService`'s
 * `invoke()` can classify it (401/403/400 = non-retryable "our bug/config"; 408/429/5xx = retryable
 * transport failure; ported from legacy's `RETRYABLE_ENGINE_CODES`/`OUR_BUG_ENGINE_CODES`
 * classification, adapted from engine error codes to raw HTTP status since there is no longer an
 * intermediate engine to report a structured code). */
export class OpenRouterHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
  ) {
    super(`OpenRouter responded ${status}: ${body.slice(0, 500)}`);
    this.name = 'OpenRouterHttpError';
  }
}

/** Extracts and concatenates every `Part.text` in a `Content`'s `parts` array — mirrors ADK's own
 * `maybeAppendUserContent`/event-text-concatenation convention (a `Content` may have multiple text
 * parts; non-text parts, e.g. function calls, are not supported by this operation set and are
 * skipped rather than erroring, since none of this app's six AI operations ever send one). */
function contentToText(content: Content | undefined): string {
  if (!content?.parts) return '';
  return content.parts.map((part: Part) => part.text ?? '').join('');
}

/** Translates one `Content` into an OpenAI-compatible `messages[].content` value — a plain string
 * for text-only content (every operation except `captionImage`), or a multi-modal content-block
 * array (`[{type:'text',...},{type:'image_url',...}]`) when any `Part` carries `inlineData` (the
 * `captionImage` operation's image bytes, base64-encoded per its own `ImageCaptionIn` contract) —
 * OpenRouter's own OpenAI-compatible vision-input shape. Genuinely multi-modal, not a text-only
 * placeholder: the image bytes are actually transmitted to the model as a `data:` URL. */
function contentToOpenAiContent(content: Content | undefined): string | Array<Record<string, unknown>> {
  const parts = content?.parts ?? [];
  const hasImage = parts.some((part) => part.inlineData?.data);
  if (!hasImage) return contentToText(content);

  const blocks: Array<Record<string, unknown>> = [];
  for (const part of parts) {
    if (part.text) {
      blocks.push({ type: 'text', text: part.text });
    } else if (part.inlineData?.data) {
      const mimeType = part.inlineData.mimeType ?? 'image/png';
      blocks.push({ type: 'image_url', image_url: { url: `data:${mimeType};base64,${part.inlineData.data}` } });
    }
  }
  return blocks;
}

/** Translates `llmRequest.config.systemInstruction` (a Gemini `ContentUnion` — string, `Content`, or
 * an array of either) into a single system-prompt string. */
function systemInstructionToText(systemInstruction: unknown): string {
  if (!systemInstruction) return '';
  if (typeof systemInstruction === 'string') return systemInstruction;
  if (Array.isArray(systemInstruction)) {
    return systemInstruction
      .map((item) => (typeof item === 'string' ? item : contentToText(item as Content)))
      .join('\n\n');
  }
  return contentToText(systemInstruction as Content);
}

/** Builds the OpenAI-compatible `messages` array from an ADK `LlmRequest` — one `system` message
 * (if `config.systemInstruction` is set) followed by each `Content` in `llmRequest.contents`,
 * mapping ADK's `'model'` role to OpenAI's `'assistant'` role (every other role, i.e. `'user'`,
 * passes through unchanged). */
function buildOpenAiMessages(llmRequest: LlmRequest): Array<{ role: string; content: string | Array<Record<string, unknown>> }> {
  const messages: Array<{ role: string; content: string | Array<Record<string, unknown>> }> = [];
  const systemText = systemInstructionToText(llmRequest.config?.systemInstruction);
  if (systemText) {
    messages.push({ role: 'system', content: systemText });
  }
  for (const content of llmRequest.contents) {
    messages.push({ role: content.role === 'model' ? 'assistant' : 'user', content: contentToOpenAiContent(content) });
  }
  return messages;
}

/** Builds OpenRouter's `response_format` from `llmRequest.config.responseSchema` (a Gemini `Schema`,
 * per this class's own doc comment) when present; falls back to a bare `json_object` mode when the
 * request asked for JSON (`responseMimeType === 'application/json'`) but supplied no schema. Returns
 * `undefined` (free-text generation) when neither is set. */
function buildResponseFormat(llmRequest: LlmRequest): Record<string, unknown> | undefined {
  const schema = llmRequest.config?.responseSchema;
  if (schema && typeof schema === 'object' && 'type' in schema) {
    return {
      type: 'json_schema',
      json_schema: { name: 'output', schema: schemaToJsonSchema(schema as Parameters<typeof schemaToJsonSchema>[0]), strict: false },
    };
  }
  if (llmRequest.config?.responseMimeType === 'application/json') {
    return { type: 'json_object' };
  }
  return undefined;
}

/** Maps OpenAI's `finish_reason` string vocabulary to ADK's `FinishReason` enum values it
 * understands as plain strings (ADK's `LlmResponse.finishReason` is typed against `@google/genai`'s
 * own `FinishReason` enum, whose string values happen to overlap for the cases this app cares about
 * — `'stop'`→`'STOP'`, `'length'`→`'MAX_TOKENS'` — anything else is passed through as `undefined`
 * rather than guessed). */
function mapFinishReason(reason: string | undefined): LlmResponse['finishReason'] {
  if (reason === 'stop') return 'STOP' as LlmResponse['finishReason'];
  if (reason === 'length') return 'MAX_TOKENS' as LlmResponse['finishReason'];
  return undefined;
}
