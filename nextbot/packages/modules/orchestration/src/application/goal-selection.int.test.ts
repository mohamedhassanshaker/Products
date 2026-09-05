import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { startMockOpenAiCompatibleServer, type MockOpenAiServerHandle } from "@nextbot/testing";

/**
 * A genuinely real HTTP round trip through `@nextbot/ai-registry`'s structured-output
 * facility (`generateStructured`) — the mock server is indistinguishable, protocol-
 * wise, from a real OpenAI-compatible endpoint (see `startMockOpenAiCompatibleServer`'s
 * own doc). Env vars are set once in `beforeAll`, before this worker's first call into
 * `@nextbot/ai-registry` (which lazily caches its parsed env on first use), matching
 * the convention `@nextbot/ai-registry`'s own `.int.test.ts` files use.
 */
let server: MockOpenAiServerHandle;
beforeAll(async () => {
  server = await startMockOpenAiCompatibleServer({
    onChatCompletion: () => ({ content: JSON.stringify({ action: "call_tool", toolName: "tool-1", args: { orderId: "42" }, confidence: 0.9 }) }),
  });
  process.env.AI_PROVIDER = "openai-compatible";
  process.env.AI_BASE_URL = server.url;
  process.env.AI_MODEL_CHAT_PRIMARY = "test-model";
  process.env.AI_MODEL_REASONING_PLANNER = "test-model";
  process.env.AI_API_KEY = "test-key";
});
afterEach(async () => undefined);

describe("selectGoalAndTool (Phase 12 — real HTTP round trip via ai-registry, no hand-parsed JSON)", () => {
  it("selects the permitted tool the model chose, with args threaded through unchanged", async () => {
    const { selectGoalAndTool } = await import("./goal-selection.js");
    const result = await selectGoalAndTool("where is my order", [{ toolId: "tool-1", name: "get_order", description: "Look up an order" }]);
    expect(result).toEqual({ action: "call_tool", toolName: "tool-1", args: { orderId: "42" }, confidence: 0.9 });
  });

  it("degrades to not_understood if the model hallucinates a tool id outside the offered catalog", async () => {
    const { selectGoalAndTool } = await import("./goal-selection.js");
    const result = await selectGoalAndTool("where is my order", [{ toolId: "some-other-tool", name: "unrelated", description: "n/a" }]);
    expect(result).toEqual({ action: "not_understood", confidence: 0.9 });
  });
});
