import type { ModelProviderClient } from "./types.js";
import { createOpenAiCompatibleClient } from "./openai-compatible.js";
import { createAnthropicClient } from "./anthropic.js";

/**
 * Provider factory keyed by `model_provider.key` / `AI_PROVIDER` (LLD §7.1). `gemini`
 * and `azure-openai` are not yet implemented as dedicated adapters this phase — both
 * are OpenAI-compatible-shaped enough in the common case (Azure OpenAI literally is
 * the OpenAI REST contract; Gemini's own OpenAI-compatibility endpoint covers the
 * chat/completions shape) that they route through the same `openai-compatible` client
 * via `baseUrl`, consistent with ADR-0006 §2.2's "every provider is reached through an
 * OpenAI-compatible client by default, [materially different APIs] get a thin adapter"
 * — Anthropic is the one that genuinely needed its own adapter this phase.
 */
export function getProviderClient(providerKey: string): ModelProviderClient {
  switch (providerKey) {
    case "anthropic":
      return createAnthropicClient();
    case "openai":
    case "openai-compatible":
    case "gemini":
    case "azure-openai":
      return createOpenAiCompatibleClient();
    default:
      throw new Error(`Unknown model provider key '${providerKey}'.`);
  }
}
