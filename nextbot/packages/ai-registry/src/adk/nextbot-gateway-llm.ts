import { BaseLlm, type BaseLlmConnection, type LlmRequest, type LlmResponse } from "@google/adk";
import type { Content } from "@google/genai";
import { generateTextOverChain, type ResolvedChainEntry } from "../registry.js";
import type { ChatMessage } from "../providers/types.js";

/**
 * ADR-0003 rule 2: "ADK is given ... a model client that is the Model Gateway. ADK
 * never sees a URL, a credential, a vendor model id, or an MCP transport." This class
 * is that model client — a `BaseLlm` implementation whose `generateContentAsync`
 * delegates entirely to `@nextbot/ai-registry`'s own provider-agnostic
 * `generateTextOverChain` (fallback chain, timeout, retry) instead of ADK's built-in
 * Gemini/Vertex model clients. ADK is constructed with an **instance** of this class
 * (`LlmAgentConfig.model` accepts `string | BaseLlm`) — never a vendor model-id
 * string — so the boundary holds even at the ADK construction call site.
 *
 * `connect()` (ADK's live/bidi-streaming path) is intentionally unimplemented: voice/
 * live channels are BL-14, a later phase: LLD is silent on any MVP requirement for
 * live-connection support, so throwing here rather than half-implementing it is the
 * honest choice.
 */
export class NextBotGatewayLlm extends BaseLlm {
  constructor(
    model: string,
    private readonly chain: ResolvedChainEntry[],
    private readonly routeKeyForError: string,
  ) {
    super({ model });
  }

  async *generateContentAsync(llmRequest: LlmRequest): AsyncGenerator<LlmResponse, void> {
    const messages = contentsToChatMessages(llmRequest.contents);
    const system = extractSystemInstruction(llmRequest);
    const result = await generateTextOverChain(this.chain, this.routeKeyForError, { system, messages });
    yield {
      content: { role: "model", parts: [{ text: result.text }] },
      turnComplete: true,
      usageMetadata: { promptTokenCount: result.tokensIn, candidatesTokenCount: result.tokensOut, totalTokenCount: result.tokensIn + result.tokensOut },
    };
  }

  connect(): Promise<BaseLlmConnection> {
    throw new Error("NextBotGatewayLlm.connect(): live/bidi connections are not supported (voice channel, BL-14, is out of MVP scope).");
  }
}

function contentsToChatMessages(contents: Content[]): ChatMessage[] {
  const messages: ChatMessage[] = [];
  for (const content of contents) {
    const text = (content.parts ?? [])
      .map((p) => ("text" in p ? p.text : undefined))
      .filter((t): t is string => Boolean(t))
      .join("\n");
    if (!text) continue;
    messages.push({ role: content.role === "model" ? "assistant" : "user", content: text });
  }
  return messages;
}

/** ADK's `LlmRequest` carries the system instruction as a `systemInstruction` field on
 * `config` in some ADK versions and as a synthesized leading `Content` in others;
 * checking both keeps this adapter resilient to either shape without depending on
 * ADK-internal details beyond what `LlmRequest`'s own public type exposes. */
function extractSystemInstruction(llmRequest: LlmRequest): string | undefined {
  const config = llmRequest.config as { systemInstruction?: unknown } | undefined;
  const raw = config?.systemInstruction;
  if (typeof raw === "string") return raw;
  if (raw && typeof raw === "object" && "parts" in raw) {
    const parts = (raw as Content).parts ?? [];
    const text = parts.map((p) => ("text" in p ? p.text : undefined)).filter(Boolean).join("\n");
    return text || undefined;
  }
  return undefined;
}
