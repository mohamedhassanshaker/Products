import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import { updateTenantStatus } from "@nextbot/tenancy";
import type { TenantContext } from "@nextbot/db";
import { schema, withTenant } from "@nextbot/db";
import { eq, and } from "drizzle-orm";
import { startMockOpenAiCompatibleServer, type MockOpenAiServerHandle } from "@nextbot/testing";
import { createAgentDefinition, createAgentDefinitionVersion, bindEvalSuite } from "./agent-definition-service.js";
import { createEvalSuite, addEvalCase, runEvalSuite } from "./eval-service.js";
import { createInitialProductionDeployment } from "../infrastructure/deployment-repository.js";
import { runContinuousEvalSweep } from "./continuous-eval-service.js";

/**
 * Target Architecture Blueprint Phase 12 (BL-44, FR-AGT-17/18, LLD §14.9.3) —
 * real, Postgres-backed proof of:
 *  1. A `Continuous` run's regression writes `domain_event`
 *     `eval.regression_detected` — a distinct alert class from a
 *     pre-promotion gate failure.
 *  2. A `PrePromotion` run's own regression (under the identical
 *     `RegressionBaseline` gate mode, compared against an explicit
 *     `regressionBaselineVersionId`) fails its own gate through the
 *     already-established `status` mechanism, but never additionally writes
 *     the Continuous-only alert event.
 *  3. `runContinuousEvalSweep` (the worker-facing entry point) genuinely
 *     discovers a tenant's currently-deployed Production version and runs it.
 *
 * **One shared mock model server for the whole file** (`beforeAll`/`afterAll`,
 * env vars set once), mirroring `eval-service.int.test.ts`'s own established
 * convention exactly — an EARLIER version of this file mutated `process.env.
 * AI_BASE_URL`/`AI_PROVIDER` per-test with a fresh server per test, which
 * reproduced the SAME class of bug this project's own Phase 7b history
 * already documented once: `@nextbot/ai-registry`'s env-driven default chain
 * resolves/caches its provider config once per process, so a later test's
 * env-var change had no effect and every subsequent test's model call
 * silently hit the FIRST test's already-closed server. Fixed structurally by
 * never mutating the env vars/server after the first test, not by adding a
 * cache-busting workaround.
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

async function domainEventsFor(ctx: TenantContext, type: string) {
  return withTenant(ctx, (db) => db.select().from(schema.domainEvent).where(and(eq(schema.domainEvent.tenantId, ctx.tenantId), eq(schema.domainEvent.type, type))));
}

describe("Continuous eval runs — regression is a distinct alert class from a pre-promotion gate failure (FR-AGT-17/18)", () => {
  let aiServer: MockOpenAiServerHandle;
  const createdTenantIds: string[] = [];

  beforeAll(async () => {
    aiServer = await startMockOpenAiCompatibleServer({ onChatCompletion: () => ({ content: "Sure, here is a helpful reply." }) });
    process.env.AI_PROVIDER = "openai-compatible";
    process.env.AI_BASE_URL = aiServer.url;
    process.env.AI_MODEL_CHAT_PRIMARY = "test-model";
  });
  afterAll(async () => {
    await aiServer.close();
    delete process.env.AI_PROVIDER;
    delete process.env.AI_BASE_URL;
    delete process.env.AI_MODEL_CHAT_PRIMARY;
  });
  afterEach(async () => {
    for (const id of createdTenantIds.splice(0)) await deleteFixtureTenant(id);
  });

  it("a Continuous run that regresses below the prior Continuous run writes eval.regression_detected", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const definition = await createAgentDefinition(ctx, { name: "continuous-target-1" });
    const version = await createAgentDefinitionVersion(
      ctx,
      definition.id,
      { version: "1.0.0", modelRouteKey: "chat.primary", graphType: "CustomFSM", artifact: ARTIFACT("continuous-target-1") },
      "11111111-1111-1111-1111-111111111111",
    );
    const suite = await createEvalSuite(ctx, { name: "continuous-suite-1", passThresholdPct: 100, gateMode: "RegressionBaseline" });
    await addEvalCase(ctx, suite.id, { name: "case-1", inputTranscript: [{ sender: "Customer", text: "hello" }], expectedResponsePattern: ".*" });
    await bindEvalSuite(ctx, version.id, suite.id);

    const baseline = await runEvalSuite(ctx, { agentDefinitionVersionId: version.id, triggeredBy: "Manual", runKind: "Continuous" });
    expect(baseline.regressed).toBe(false); // first-ever continuous run — nothing to regress against.
    expect(Number(baseline.passRatePct)).toBe(100);

    // A second case the harness always fails (tool-call expectations aren't
    // evaluated by this harness, per its own disclosed scoping) drags the
    // SECOND run's pass rate below the recorded baseline.
    await addEvalCase(ctx, suite.id, {
      name: "case-2-requires-tool-call",
      inputTranscript: [{ sender: "Customer", text: "book a flight" }],
      expectedToolCalls: [{ toolName: "book_flight" }],
    });
    const secondContinuous = await runEvalSuite(ctx, { agentDefinitionVersionId: version.id, triggeredBy: "Scheduled", runKind: "Continuous" });
    expect(secondContinuous.regressed).toBe(true);
    expect(Number(secondContinuous.passRatePct)).toBeLessThan(Number(baseline.passRatePct));
    expect(secondContinuous.baselineRunId).toBe(baseline.id);

    const regressionEvents = await domainEventsFor(ctx, "eval.regression_detected");
    expect(regressionEvents).toHaveLength(1);
    expect(regressionEvents[0]?.payload).toMatchObject({ evalRunId: secondContinuous.id, evalSuiteId: suite.id });
  });

  it("a PrePromotion run's own regression (explicit regressionBaselineVersionId) fails its gate but never writes eval.regression_detected", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const definitionA = await createAgentDefinition(ctx, { name: "pre-promotion-baseline" });
    const versionA = await createAgentDefinitionVersion(
      ctx,
      definitionA.id,
      { version: "1.0.0", modelRouteKey: "chat.primary", graphType: "CustomFSM", artifact: ARTIFACT("pre-promotion-baseline") },
      "11111111-1111-1111-1111-111111111111",
    );
    const suite = await createEvalSuite(ctx, { name: "pre-promotion-suite", passThresholdPct: 100, gateMode: "RegressionBaseline", regressionBaselineVersionId: versionA.id });
    await addEvalCase(ctx, suite.id, { name: "case-1", inputTranscript: [{ sender: "Customer", text: "hello" }], expectedResponsePattern: ".*" });
    await bindEvalSuite(ctx, versionA.id, suite.id);

    // versionA's own PrePromotion run under this suite: no prior baseline
    // exists for versionA itself yet, so this simply records the 100% data
    // point the LATER version will be compared against.
    const versionARun = await runEvalSuite(ctx, { agentDefinitionVersionId: versionA.id, triggeredBy: "Manual", runKind: "PrePromotion" });
    expect(versionARun.status).toBe("Passed");
    expect(Number(versionARun.passRatePct)).toBe(100);

    const definitionB = await createAgentDefinition(ctx, { name: "pre-promotion-regressed" });
    const versionB = await createAgentDefinitionVersion(
      ctx,
      definitionB.id,
      { version: "1.0.0", modelRouteKey: "chat.primary", graphType: "CustomFSM", artifact: ARTIFACT("pre-promotion-regressed") },
      "11111111-1111-1111-1111-111111111111",
    );
    await addEvalCase(ctx, suite.id, {
      name: "case-2-requires-tool-call",
      inputTranscript: [{ sender: "Customer", text: "book a flight" }],
      expectedToolCalls: [{ toolName: "book_flight" }],
    });
    await bindEvalSuite(ctx, versionB.id, suite.id);

    const versionBRun = await runEvalSuite(ctx, { agentDefinitionVersionId: versionB.id, triggeredBy: "Manual", runKind: "PrePromotion" });
    expect(versionBRun.regressed).toBe(true);
    expect(versionBRun.status).toBe("Failed");
    expect(versionBRun.baselineRunId).toBe(versionARun.id);

    // The already-established `status !== 'Passed'` mechanism blocks
    // promotion — this is NOT the Continuous-only alert class, so no
    // `eval.regression_detected` event is ever written for it.
    expect(await domainEventsFor(ctx, "eval.regression_detected")).toHaveLength(0);
  });

  it("runContinuousEvalSweep discovers the tenant's currently-deployed Production version and runs it for real", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    await updateTenantStatus(ctx.tenantId, "Active");
    const definition = await createAgentDefinition(ctx, { name: "continuous-sweep-target" });
    const version = await createAgentDefinitionVersion(
      ctx,
      definition.id,
      { version: "1.0.0", modelRouteKey: "chat.primary", graphType: "CustomFSM", artifact: ARTIFACT("continuous-sweep-target") },
      "11111111-1111-1111-1111-111111111111",
    );
    const suite = await createEvalSuite(ctx, { name: "continuous-sweep-suite", passThresholdPct: 0 });
    await addEvalCase(ctx, suite.id, { name: "case-1", inputTranscript: [{ sender: "Customer", text: "hello" }], expectedResponsePattern: ".*" });
    await bindEvalSuite(ctx, version.id, suite.id);
    await createInitialProductionDeployment(ctx, { agentDefinitionId: definition.id, agentDefinitionVersionId: version.id, environment: "Production", actorUserId: null });

    const result = await runContinuousEvalSweep();
    expect(result.runsExecuted).toBeGreaterThanOrEqual(1);

    const rows = await withTenant(ctx, (db) =>
      db
        .select({ id: schema.evalRun.id, runKind: schema.evalRun.runKind })
        .from(schema.evalRun)
        .where(and(eq(schema.evalRun.tenantId, ctx.tenantId), eq(schema.evalRun.agentDefinitionVersionId, version.id), eq(schema.evalRun.runKind, "Continuous"))),
    );
    expect(rows).toHaveLength(1);
  });
});
