import type { EmbedParams, EmbedResult, ModelProviderClient, ProviderCallParams, ProviderCallResult } from "./types.js";
import { ProviderCallError } from "./types.js";

/**
 * OpenAI-compatible chat/completions + embeddings client (ADR-0006 §2.2). This is the
 * **default** transport for every provider — OpenAI itself, Azure OpenAI, and every
 * on-prem/self-hosted target (Ollama, vLLM, LM Studio, an internal enterprise gateway)
 * all speak this same REST shape, so "on-prem is first-class" costs nothing beyond
 * setting `AI_BASE_URL` / a `model_route.chain` entry's `baseUrl`.
 *
 * Deliberately implemented with plain `fetch` rather than the `openai` npm package:
 * the OpenAI-compatible surface this product needs (chat completions with an optional
 * JSON-schema `response_format`, plus embeddings) is a handful of stable REST calls,
 * and avoiding the SDK keeps this the lowest-risk, dependency-free path to genuinely
 * supporting arbitrary self-hosted `baseURL` targets (some of which — Ollama, LM
 * Studio — do not implement 100% of the SDK's assumed surface). The request/response
 * shapes below are the real OpenAI Chat Completions API contract, not a bespoke one.
 */
export function createOpenAiCompatibleClient(): ModelProviderClient {
  return {
    async generateText(params: ProviderCallParams): Promise<ProviderCallResult> {
      const baseUrl = (params.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "");
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), params.timeoutMs);
      if (params.signal) {
        params.signal.addEventListener("abort", () => controller.abort(), { once: true });
      }

      const messages = [
        ...(params.system ? [{ role: "system" as const, content: params.system }] : []),
        ...params.messages,
      ];

      const body: Record<string, unknown> = {
        model: params.model,
        messages,
        ...(params.maxTokens ? { max_tokens: params.maxTokens } : {}),
      };
      if (params.jsonSchema) {
        // OpenAI Chat Completions structured-output contract: a JSON Schema object
        // wrapped under `response_format.json_schema.schema`. Providers that don't
        // support this (older Ollama builds) simply ignore an unknown field — the
        // registry's re-validation step (`structured.ts`) is what actually enforces
        // conformance either way, so this is a request-side optimization, not the
        // sole safeguard.
        body.response_format = {
          type: "json_schema",
          json_schema: { name: "nextbot_structured_output", schema: params.jsonSchema, strict: true },
        };
      }

      let response: Response;
      try {
        response = await fetch(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(params.apiKey ? { authorization: `Bearer ${params.apiKey}` } : {}),
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } catch (cause) {
        clearTimeout(timer);
        if (controller.signal.aborted) {
          throw new ProviderCallError(`openai-compatible request to ${baseUrl} timed out after ${params.timeoutMs}ms`, "Timeout", true);
        }
        throw new ProviderCallError(`openai-compatible request to ${baseUrl} failed: ${(cause as Error).message}`, "NetworkError", true);
      } finally {
        clearTimeout(timer);
      }

      if (!response.ok) {
        const retryable = response.status === 429 || response.status >= 500;
        const kind = response.status === 429 ? "RateLimited" : response.status >= 500 ? "ServerError" : "ClientError";
        const detail = await response.text().catch(() => "");
        throw new ProviderCallError(
          `openai-compatible request failed with status ${response.status}: ${detail.slice(0, 500)}`,
          kind,
          retryable,
        );
      }

      const json = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      const text = json.choices?.[0]?.message?.content ?? "";
      return {
        text,
        tokensIn: json.usage?.prompt_tokens ?? 0,
        tokensOut: json.usage?.completion_tokens ?? 0,
      };
    },

    async embed(params: EmbedParams): Promise<EmbedResult> {
      const baseUrl = (params.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "");
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), params.timeoutMs);
      let response: Response;
      try {
        response = await fetch(`${baseUrl}/embeddings`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(params.apiKey ? { authorization: `Bearer ${params.apiKey}` } : {}),
          },
          body: JSON.stringify({ model: params.model, input: params.input }),
          signal: controller.signal,
        });
      } catch (cause) {
        if (controller.signal.aborted) {
          throw new ProviderCallError(`openai-compatible embed request timed out after ${params.timeoutMs}ms`, "Timeout", true);
        }
        throw new ProviderCallError(`openai-compatible embed request failed: ${(cause as Error).message}`, "NetworkError", true);
      } finally {
        clearTimeout(timer);
      }
      if (!response.ok) {
        const retryable = response.status === 429 || response.status >= 500;
        throw new ProviderCallError(`openai-compatible embed request failed with status ${response.status}`, retryable ? "ServerError" : "ClientError", retryable);
      }
      const json = (await response.json()) as { data?: Array<{ embedding?: number[] }>; usage?: { prompt_tokens?: number } };
      return { embedding: json.data?.[0]?.embedding ?? [], tokensIn: json.usage?.prompt_tokens ?? 0 };
    },
  };
}
