import Anthropic from "@anthropic-ai/sdk";
import type { EmbedParams, EmbedResult, ModelProviderClient, ProviderCallParams, ProviderCallResult } from "./types.js";
import { ProviderCallError } from "./types.js";

/**
 * Anthropic adapter (ADR-0006 §2.2 — "providers with materially different APIs get a
 * thin adapter behind the same internal interface"). This is the one real provider SDK
 * import in this file — permitted only here, under `packages/ai-registry/src/providers`
 * (dependency-cruiser's `no-provider-sdk-outside-ai-registry` rule).
 *
 * Anthropic's Messages API has no native `response_format: json_schema` the way
 * OpenAI-compatible does; structured output is obtained the SDK-documented way —
 * a single forced tool call whose `input_schema` *is* the requested JSON Schema, with
 * `tool_choice` pinned to that tool so the model has no path to reply with anything
 * else. The resulting `tool_use` block's `input` is what `structured.ts` re-validates
 * with `Value.Check` — this adapter never trusts it as already-conformant.
 */
export function createAnthropicClient(): ModelProviderClient {
  return {
    async generateText(params: ProviderCallParams): Promise<ProviderCallResult> {
      const client = new Anthropic({
        apiKey: params.apiKey ?? "",
        baseURL: params.baseUrl,
        timeout: params.timeoutMs,
      });

      try {
        if (params.jsonSchema) {
          const response = await client.messages.create(
            {
              model: params.model,
              max_tokens: params.maxTokens ?? 4096,
              system: params.system,
              messages: params.messages
                .filter((m) => m.role !== "system")
                .map((m) => ({ role: m.role === "assistant" ? ("assistant" as const) : ("user" as const), content: m.content })),
              tools: [{ name: "structured_output", description: "Return the structured result.", input_schema: params.jsonSchema as Anthropic.Tool.InputSchema }],
              tool_choice: { type: "tool", name: "structured_output" },
            },
            { signal: params.signal },
          );
          const toolUse = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
          return {
            text: toolUse ? JSON.stringify(toolUse.input) : "",
            tokensIn: response.usage.input_tokens,
            tokensOut: response.usage.output_tokens,
          };
        }

        const response = await client.messages.create(
          {
            model: params.model,
            max_tokens: params.maxTokens ?? 4096,
            system: params.system,
            messages: params.messages
              .filter((m) => m.role !== "system")
              .map((m) => ({ role: m.role === "assistant" ? ("assistant" as const) : ("user" as const), content: m.content })),
          },
          { signal: params.signal },
        );
        const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === "text");
        return { text: textBlock?.text ?? "", tokensIn: response.usage.input_tokens, tokensOut: response.usage.output_tokens };
      } catch (cause) {
        throw mapAnthropicError(cause);
      }
    },

    // Anthropic does not offer a first-party embeddings endpoint (LLD §7.1's
    // `embed.knowledge` logical name is expected to route to an OpenAI-compatible
    // provider in practice) — failing loudly here is more honest than silently
    // returning a zero vector.
    async embed(_params: EmbedParams): Promise<EmbedResult> {
      throw new ProviderCallError("Anthropic has no embeddings endpoint — route embed.* logical names to an openai-compatible provider.", "ClientError", false);
    },
  };
}

function mapAnthropicError(cause: unknown): ProviderCallError {
  if (cause instanceof Anthropic.APIError) {
    const retryable = cause.status === 429 || (cause.status ?? 0) >= 500;
    const kind = cause.status === 429 ? "RateLimited" : (cause.status ?? 0) >= 500 ? "ServerError" : "ClientError";
    return new ProviderCallError(`Anthropic request failed: ${cause.message}`, kind, retryable);
  }
  if (cause instanceof Error && cause.name === "AbortError") {
    return new ProviderCallError("Anthropic request timed out", "Timeout", true);
  }
  return new ProviderCallError(`Anthropic request failed: ${(cause as Error).message}`, "NetworkError", true);
}
