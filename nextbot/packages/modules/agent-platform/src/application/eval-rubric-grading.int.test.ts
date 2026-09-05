import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import type { TenantContext } from "@nextbot/db";
import { startMockOpenAiCompatibleServer, type MockOpenAiServerHandle } from "@nextbot/testing";
import { createProviderRegistration, createRoute, createRouteVersion, declareCatalogEntry } from "@nextbot/model-gateway";
import { createAgentDefinition, createAgentDefinitionVersion, bindEvalSuite } from "./agent-definition-service.js";
import { createEvalSuite, addEvalCase, runEvalSuite, listEvalCaseResults } from "./eval-service.js";

/**
 * Target Architecture Blueprint Phase 12 (BL-44, FR-AGT-18, LLD §14.9.3) —
 * real, Postgres-backed proof that a case's `rubric` is genuinely graded by a
 * judge model pinned to `judgeRouteVersionId` (TypeBox structured output,
 * never hand-parsed JSON), and that a judge "did not pass" verdict fails the
 * case even when the case's own `expectedResponsePattern` matched.
 */
const ARTIFACT = (name: string) => ({
  apiVersion: "nextbot.io/v1" as const,
  kind: "AgentDefinition" as const,
  metadata: { name, version: "1.0.0" },
  spec: {
    graphType: "CustomFSM" as const,
    modelRoute: "chat.primary",
    instructions: "hi",
    toolPolicy: { source: "agent-tool-registry" as const, capabilityGroups: [], maxToolCallsPerTurn: 5 },
    guardrails: { minConfidenceForAutonomy: 0.6, escalateOn: [] },
    memory: { strategy: "rolling-window", maxTurns: 20 },
    budgets: { maxCostUsdPerConversation: "0.50", maxLatencyMsP95: 6000 },
  },
});

async function pinJudgeRoute(ctx: TenantContext, baseUrl: string) {
  const provider = await createProviderRegistration(ctx, { type: "openai-compatible", name: "Judge provider", baseUrl, region: ctx.region, retainsPrompts: false, trainsOnData: false });
  const entry = await declareCatalogEntry(ctx, {
    providerId: provider.id,
    modelId: "judge-test-model",
    displayName: "Judge Test Model",
    modality: "Text",
    contextWindow: 8192,
    maxOutput: 4096,
    capabilities: { toolCalling: false, vision: false, streaming: false, structuredOutput: true, extendedThinking: false, promptCaching: false, jsonMode: true },
    tokenizer: "cl100k_base",
    priceIn: 0.0000005,
    priceOut: 0.0000015,
  });
  const route = await createRoute(ctx, { name: "eval.judge" });
  const version = await createRouteVersion(
    ctx,
    route.id,
    {
      chain: [{ ordinal: 0, providerId: provider.id, catalogEntryId: entry.id, params: {}, timeoutMs: 30000 }],
      policy: { strategy: "FixedPriority", failoverOn: ["429", "5xx", "timeout"], retry: { maxPerHop: 1, backoff: "exponential" }, totalTimeoutMs: 30000, cacheMode: "Off", onBudgetBreach: "Fail", allowOutOfRegionFailover: false },
    },
    true,
  );
  return version.id;
}

describe("Eval rubric/judge grading — real judge model call, TypeBox structured output (FR-AGT-18)", () => {
  let answerServer: MockOpenAiServerHandle;
  let judgeServer: MockOpenAiServerHandle;
  let judgeVerdictContent = "";
  const createdTenantIds: string[] = [];

  beforeAll(async () => {
    answerServer = await startMockOpenAiCompatibleServer({ onChatCompletion: () => ({ content: "Sure, here is a helpful reply about your refund." }) });
    process.env.AI_PROVIDER = "openai-compatible";
    process.env.AI_BASE_URL = answerServer.url;
    process.env.AI_MODEL_CHAT_PRIMARY = "test-model";

    judgeServer = await startMockOpenAiCompatibleServer({ onChatCompletion: () => ({ content: judgeVerdictContent }) });
  });
  afterAll(async () => {
    await answerServer.close();
    await judgeServer.close();
    delete process.env.AI_PROVIDER;
    delete process.env.AI_BASE_URL;
    delete process.env.AI_MODEL_CHAT_PRIMARY;
  });
  afterEach(async () => {
    for (const id of createdTenantIds.splice(0)) await deleteFixtureTenant(id);
  });

  it("a case with rubric+judgeRouteVersionId is graded by the real judge model, and a 'did not pass' verdict fails the case despite a matching pattern", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    judgeVerdictContent = JSON.stringify({
      criteria: { politeness: { score: 0.9, rationale: "Polite tone throughout." }, accuracy: { score: 0.2, rationale: "Refund policy detail is wrong." } },
      overallScore: 0.55,
      passed: false,
    });

    const judgeRouteVersionId = await pinJudgeRoute(ctx, judgeServer.url);
    const definition = await createAgentDefinition(ctx, { name: "rubric-grading-target" });
    const version = await createAgentDefinitionVersion(
      ctx,
      definition.id,
      { version: "1.0.0", modelRouteKey: "chat.primary", graphType: "CustomFSM", artifact: ARTIFACT("rubric-grading-target") },
      "11111111-1111-1111-1111-111111111111",
    );
    const suite = await createEvalSuite(ctx, { name: "rubric-suite", passThresholdPct: 100 });
    await addEvalCase(ctx, suite.id, {
      name: "case-rubric-1",
      inputTranscript: [{ sender: "Customer", text: "Can I get a refund?" }],
      expectedResponsePattern: ".*", // matches trivially — the JUDGE verdict is what must fail this case.
      rubric: { criteria: [{ id: "politeness", description: "Is the tone polite?", weight: 0.3 }, { id: "accuracy", description: "Is the refund policy stated correctly?", weight: 0.7 }] },
      judgeRouteVersionId,
    });
    await bindEvalSuite(ctx, version.id, suite.id);

    const run = await runEvalSuite(ctx, { agentDefinitionVersionId: version.id, triggeredBy: "Manual" });
    expect(run.status).toBe("Failed");
    expect(Number(run.passRatePct)).toBe(0);

    const results = await listEvalCaseResults(ctx, run.id);
    expect(results).toHaveLength(1);
    expect(results[0]?.passed).toBe(false);
    expect(results[0]?.failureReason).toContain("Judge rubric verdict");
  });

  it("a case with rubric+judgeRouteVersionId PASSES when both the pattern and the judge agree", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    judgeVerdictContent = JSON.stringify({
      criteria: { politeness: { score: 0.95, rationale: "Polite." }, accuracy: { score: 0.9, rationale: "Correct." } },
      overallScore: 0.92,
      passed: true,
    });

    const judgeRouteVersionId = await pinJudgeRoute(ctx, judgeServer.url);
    const definition = await createAgentDefinition(ctx, { name: "rubric-grading-target-pass" });
    const version = await createAgentDefinitionVersion(
      ctx,
      definition.id,
      { version: "1.0.0", modelRouteKey: "chat.primary", graphType: "CustomFSM", artifact: ARTIFACT("rubric-grading-target-pass") },
      "11111111-1111-1111-1111-111111111111",
    );
    const suite = await createEvalSuite(ctx, { name: "rubric-suite-pass", passThresholdPct: 100 });
    await addEvalCase(ctx, suite.id, {
      name: "case-rubric-2",
      inputTranscript: [{ sender: "Customer", text: "Can I get a refund?" }],
      expectedResponsePattern: ".*",
      rubric: { criteria: [{ id: "politeness", description: "Is the tone polite?", weight: 0.5 }] },
      judgeRouteVersionId,
    });
    await bindEvalSuite(ctx, version.id, suite.id);

    const run = await runEvalSuite(ctx, { agentDefinitionVersionId: version.id, triggeredBy: "Manual" });
    expect(run.status).toBe("Passed");

    const results = await listEvalCaseResults(ctx, run.id);
    expect(results[0]?.passed).toBe(true);
  });
});
