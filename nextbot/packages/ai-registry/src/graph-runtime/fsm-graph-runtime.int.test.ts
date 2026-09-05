import { afterAll, beforeAll } from "vitest";
import { startMockOpenAiCompatibleServer, type MockOpenAiServerHandle } from "@nextbot/testing";
import { createFsmGraphRuntime } from "./fsm-graph-runtime.js";
import { runGraphRuntimeConformanceSuite } from "./conformance-suite.js";

// Real HTTP round trip: the pending-approval-trigger cases never reach a model call,
// but the resume() case does (it produces a real `Final` response after the tool
// result) — pointed at a local OpenAI-compatible stand-in via `resolveChain` injection
// rather than requiring `AI_*` env vars for what would otherwise look like a pure unit
// test, and classified `.int.test.ts` per this codebase's own convention (any test
// touching a real socket, even a local one, is "integration").
let server: MockOpenAiServerHandle;
beforeAll(async () => {
  server = await startMockOpenAiCompatibleServer({ onChatCompletion: () => ({ content: "Sure, here's the result of that." }) });
});
afterAll(async () => {
  await server.close();
});

runGraphRuntimeConformanceSuite("CustomFSM (in-tree, ADR-0003)", () =>
  createFsmGraphRuntime({ resolveChain: () => [{ providerKey: "openai-compatible", model: "test-model", baseUrl: server.url }] }),
);
