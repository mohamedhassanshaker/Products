import { afterAll, beforeAll } from "vitest";
import { startMockOpenAiCompatibleServer, type MockOpenAiServerHandle } from "@nextbot/testing";
import { createAdkGraphRuntime } from "./adk-graph-runtime.js";
import { runGraphRuntimeConformanceSuite } from "../graph-runtime/conformance-suite.js";

// Same rationale as fsm-graph-runtime.int.test.ts — real (local) HTTP round trip for
// the resume() case's post-tool-result model call, proving the ADK adapter's own
// port-shape/suspend-resume mechanics (real `LlmAgent`/`Runner`/`InMemorySessionService`
// objects, real event-replay-based resume, real `NextBotGatewayLlm` bridging) without
// needing any live provider credentials.
let server: MockOpenAiServerHandle;
beforeAll(async () => {
  server = await startMockOpenAiCompatibleServer({ onChatCompletion: () => ({ content: "Sure, here's the result of that." }) });
});
afterAll(async () => {
  await server.close();
});

runGraphRuntimeConformanceSuite("Google ADK (ADR-0003 adapter)", () =>
  createAdkGraphRuntime({ resolveChain: () => [{ providerKey: "openai-compatible", model: "test-model", baseUrl: server.url }] }),
);
