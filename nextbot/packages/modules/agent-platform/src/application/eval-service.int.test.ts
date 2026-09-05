import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import type { TenantContext } from "@nextbot/db";
import { startMockGitHubServer, createMockGitHubState, startMockOpenAiCompatibleServer, type MockOpenAiServerHandle } from "@nextbot/testing";
import { connectGit } from "./git-connection-service.js";
import { createAgentDefinition, createAgentDefinitionVersion } from "./agent-definition-service.js";
import { createEvalSuite, addEvalCase, runEvalSuite, listEvalCaseResults } from "./eval-service.js";
import { bindEvalSuite } from "./agent-definition-service.js";

const ARTIFACT = (instructions: string) => ({
  apiVersion: "nextbot.io/v1" as const,
  kind: "AgentDefinition" as const,
  metadata: { name: "eval-target", version: "1.0.0" },
  spec: {
    graphType: "CustomFSM" as const,
    modelRoute: "chat.primary",
    instructions,
    toolPolicy: { source: "agent-tool-registry" as const, capabilityGroups: [], maxToolCallsPerTurn: 5 },
    guardrails: { minConfidenceForAutonomy: 0.6, escalateOn: [] },
    memory: { strategy: "rolling-window", maxTurns: 20 },
    budgets: { maxCostUsdPerConversation: "0.50", maxLatencyMsP95: 6000 },
  },
});

describe("eval-service (FR-AGT-06 promotion gate — real GraphRuntime execution, single-turn)", () => {
  let ctx: TenantContext;
  let server: { url: string; close: () => Promise<void> };
  let aiServer: MockOpenAiServerHandle;

  beforeAll(async () => {
    ctx = await createFixtureTenant();
    server = await startMockGitHubServer(createMockGitHubState());
    await connectGit(ctx, { provider: "GitHub", repoOwner: "acme", repoName: "agent-defs", baseUrl: server.url, accessToken: "fake", createdByUserId: "11111111-1111-1111-1111-111111111111" });

    // The CustomFSM GraphRuntime's non-trigger path calls @nextbot/ai-registry's
    // env-driven default chain (`resolveModel`) — pointed at a local OpenAI-compatible
    // stand-in so this eval run genuinely executes a real (if trivial) model call
    // without needing a live provider credential.
    aiServer = await startMockOpenAiCompatibleServer({ onChatCompletion: () => ({ content: "Sure, here is a helpful reply." }) });
    process.env.AI_PROVIDER = "openai-compatible";
    process.env.AI_BASE_URL = aiServer.url;
    process.env.AI_MODEL_CHAT_PRIMARY = "test-model";
  });
  afterAll(async () => {
    await server.close();
    await aiServer.close();
    await deleteFixtureTenant(ctx.tenantId);
  });

  it("runs every case through the CustomFSM GraphRuntime and records a pass/fail verdict per expectedResponsePattern", async () => {
    const definition = await createAgentDefinition(ctx, { name: "eval-target" });
    const version = await createAgentDefinitionVersion(ctx, definition.id, { version: "1.0.0", modelRouteKey: "chat.primary", graphType: "CustomFSM", artifact: ARTIFACT("hi") }, "11111111-1111-1111-1111-111111111111");
    const suite = await createEvalSuite(ctx, { name: "golden-v1", passThresholdPct: 50 });
    await addEvalCase(ctx, suite.id, { name: "case-1", inputTranscript: [{ sender: "Customer", text: "hello" }], expectedResponsePattern: ".*" });
    await addEvalCase(ctx, suite.id, {
      name: "case-2-requires-tool-call",
      inputTranscript: [{ sender: "Customer", text: "book a flight" }],
      expectedToolCalls: [{ toolName: "book_flight" }],
    });
    await bindEvalSuite(ctx, version.id, suite.id);

    const run = await runEvalSuite(ctx, { agentDefinitionVersionId: version.id, triggeredBy: "Manual" });
    // 1 of 2 cases passes (the tool-call case fails, honestly, per the scope decision
    // documented in eval-service.ts) = 50% pass rate, which meets this suite's 50%
    // threshold exactly, so the run still status Passed overall.
    expect(run.status).toBe("Passed");
    expect(Number(run.passRatePct)).toBe(50);

    const results = await listEvalCaseResults(ctx, run.id);
    expect(results).toHaveLength(2);
    const toolCallResult = results.find((r) => r.failureReason?.includes("Phase 12"));
    expect(toolCallResult).toBeDefined();
    expect(toolCallResult?.passed).toBe(false);
  });

  it("passes when every case's expectedResponsePattern matches the FSM's real completion output", async () => {
    const definition = await createAgentDefinition(ctx, { name: "eval-target-pass" });
    const version = await createAgentDefinitionVersion(ctx, definition.id, { version: "1.0.0", modelRouteKey: "chat.primary", graphType: "CustomFSM", artifact: ARTIFACT("hi") }, "11111111-1111-1111-1111-111111111111");
    const suite = await createEvalSuite(ctx, { name: "golden-v2" });
    await addEvalCase(ctx, suite.id, { name: "case-1", inputTranscript: [{ sender: "Customer", text: "hello" }], expectedResponsePattern: ".*" });
    await bindEvalSuite(ctx, version.id, suite.id);

    const run = await runEvalSuite(ctx, { agentDefinitionVersionId: version.id, triggeredBy: "VersionSubmitted" });
    expect(run.status).toBe("Passed");
    expect(Number(run.passRatePct)).toBe(100);
  });
});
