import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import type { TenantContext } from "@nextbot/db";
import { startMockGitHubServer, createMockGitHubState, startMockOpenAiCompatibleServer, type MockOpenAiServerHandle } from "@nextbot/testing";
import { PromotionNotAllowedError } from "@nextbot/contracts";
import { connectGit } from "./git-connection-service.js";
import { createAgentDefinition, createAgentDefinitionVersion } from "./agent-definition-service.js";
import { createEvalSuite, addEvalCase, runEvalSuite } from "./eval-service.js";
import { bindEvalSuite } from "./agent-definition-service.js";
import { promoteAgentVersion, getAllowedTransitionsForVersion } from "./promote-version-service.js";
import { recordSandboxTest } from "./agent-definition-service.js";
import { listDeploymentsForAgent } from "../infrastructure/deployment-repository.js";
import { getAgentDefinitionVersion } from "../infrastructure/agent-definition-repository.js";

const ARTIFACT = {
  apiVersion: "nextbot.io/v1" as const,
  kind: "AgentDefinition" as const,
  metadata: { name: "promo-target", version: "1.0.0" },
  spec: {
    graphType: "CustomFSM" as const,
    modelRoute: "chat.primary",
    instructions: "hi",
    toolPolicy: { source: "agent-tool-registry" as const, capabilityGroups: [], maxToolCallsPerTurn: 5 },
    guardrails: { minConfidenceForAutonomy: 0.6, escalateOn: [] },
    memory: { strategy: "rolling-window", maxTurns: 20 },
    budgets: { maxCostUsdPerConversation: "0.50", maxLatencyMsP95: 6000 },
  },
};

describe("promote-version-service — full LLD §3.10 promotion lifecycle against a real database", () => {
  let ctx: TenantContext;
  // A second tenant, sharing this describe's one `aiServer`/env-config lifetime but
  // with `connectGit` deliberately never called for it — `@nextbot/ai-registry`'s
  // env config is cached process-wide on first load (see `resetAiRegistryEnvCacheForTests`'s
  // doc comment), so a second `startMockOpenAiCompatibleServer` + reassigned
  // `AI_BASE_URL` in a separate `describe` later in this same file would silently
  // resolve against the *first* (by-then-closed) server. Sharing one `aiServer` for
  // the whole file avoids that trap entirely, per ADR-0009's 2026-08-23 amendment
  // (§7(b)) verification requirement: a full Draft->Production walk for a tenant with
  // zero Git connection.
  let ctxNoGit: TenantContext;
  let gitServer: { url: string; close: () => Promise<void> };
  let aiServer: MockOpenAiServerHandle;

  beforeAll(async () => {
    ctx = await createFixtureTenant();
    ctxNoGit = await createFixtureTenant();
    gitServer = await startMockGitHubServer(createMockGitHubState());
    await connectGit(ctx, { provider: "GitHub", repoOwner: "acme", repoName: "agent-defs", baseUrl: gitServer.url, accessToken: "fake", createdByUserId: "11111111-1111-1111-1111-111111111111" });
    // ctxNoGit deliberately gets no connectGit call — it has zero `git_connection` row
    // for its entire lifetime in this suite.
    aiServer = await startMockOpenAiCompatibleServer({ onChatCompletion: () => ({ content: "ok" }) });
    process.env.AI_PROVIDER = "openai-compatible";
    process.env.AI_BASE_URL = aiServer.url;
    process.env.AI_MODEL_CHAT_PRIMARY = "test-model";
  });
  afterAll(async () => {
    await gitServer.close();
    await aiServer.close();
    await deleteFixtureTenant(ctx.tenantId);
    await deleteFixtureTenant(ctxNoGit.tenantId);
  });

  it("walks Draft -> EvalGated -> HumanReview -> Approved -> Production, creating a real active Deployment row atomically at Production", async () => {
    const definition = await createAgentDefinition(ctx, { name: "promo-target" });
    const version = await createAgentDefinitionVersion(ctx, definition.id, { version: "1.0.0", modelRouteKey: "chat.primary", graphType: "CustomFSM", artifact: ARTIFACT }, "11111111-1111-1111-1111-111111111111");
    expect(version.status).toBe("Draft");

    const suite = await createEvalSuite(ctx, { name: "promo-suite" });
    await addEvalCase(ctx, suite.id, { name: "case-1", inputTranscript: [{ sender: "Customer", text: "hi" }], expectedResponsePattern: ".*" });
    await bindEvalSuite(ctx, version.id, suite.id);

    const afterEvalGated = await promoteAgentVersion(ctx, version.id, "EvalGated", "11111111-1111-1111-1111-111111111111");
    expect(afterEvalGated.status).toBe("EvalGated");

    await runEvalSuite(ctx, { agentDefinitionVersionId: version.id, triggeredBy: "VersionSubmitted" });

    const afterHumanReview = await promoteAgentVersion(ctx, version.id, "HumanReview", "11111111-1111-1111-1111-111111111111");
    expect(afterHumanReview.status).toBe("HumanReview");

    // Self-approval must be rejected — the reviewer must differ from the creator.
    await expect(promoteAgentVersion(ctx, version.id, "Approved", "11111111-1111-1111-1111-111111111111")).rejects.toBeInstanceOf(PromotionNotAllowedError);

    const afterApproved = await promoteAgentVersion(ctx, version.id, "Approved", "22222222-2222-2222-2222-222222222222");
    expect(afterApproved.status).toBe("Approved");
    expect(afterApproved.approvedByUserId).toBe("22222222-2222-2222-2222-222222222222");

    // Phase 7 (client-feedback-batch item 6): Approved -> Production now also
    // requires a real, completed sandbox test against this exact version — proven
    // as its own dedicated, isolated test below; recorded here so this walk-the-
    // whole-lifecycle test keeps proving the *other* gates unaffected by this one.
    await recordSandboxTest(ctx, version.id);

    const afterProduction = await promoteAgentVersion(ctx, version.id, "Production", "22222222-2222-2222-2222-222222222222");
    expect(afterProduction.status).toBe("Production");

    const deployments = await listDeploymentsForAgent(ctx, definition.id);
    expect(deployments).toHaveLength(1);
    expect(deployments[0]).toMatchObject({ agentDefinitionVersionId: version.id, environment: "Production", trafficSplitPct: 100, isActive: true });
  });

  /**
   * Phase 7 (client-feedback-batch item 6) — the sandbox-test gate, proven against
   * the real database and the real `promoteAgentVersion` service, isolated from
   * every other Approved -> Production condition (this version passes all of
   * them: installed graph type, a real passing eval run, a real distinct reviewer).
   */
  it("Approved -> Production requires a real, completed sandbox test against this exact version first (client-feedback-batch item 6)", async () => {
    const definition = await createAgentDefinition(ctx, { name: "sandbox-gate-target" });
    const version = await createAgentDefinitionVersion(ctx, definition.id, { version: "1.0.0", modelRouteKey: "chat.primary", graphType: "CustomFSM", artifact: ARTIFACT }, "11111111-1111-1111-1111-111111111111");
    const suite = await createEvalSuite(ctx, { name: "sandbox-gate-suite" });
    await addEvalCase(ctx, suite.id, { name: "case-1", inputTranscript: [{ sender: "Customer", text: "hi" }], expectedResponsePattern: ".*" });
    await bindEvalSuite(ctx, version.id, suite.id);
    await promoteAgentVersion(ctx, version.id, "EvalGated", "11111111-1111-1111-1111-111111111111");
    await runEvalSuite(ctx, { agentDefinitionVersionId: version.id, triggeredBy: "VersionSubmitted" });
    await promoteAgentVersion(ctx, version.id, "HumanReview", "11111111-1111-1111-1111-111111111111");
    await promoteAgentVersion(ctx, version.id, "Approved", "22222222-2222-2222-2222-222222222222");

    const freshBeforeSandboxTest = await getAgentDefinitionVersion(ctx, version.id);
    expect(freshBeforeSandboxTest.lastSandboxTestAt).toBeNull();

    // No sandbox test recorded yet — every other condition passes, but this one
    // real gate still blocks it.
    await expect(promoteAgentVersion(ctx, version.id, "Production", "22222222-2222-2222-2222-222222222222")).rejects.toThrow(
      /sandbox test/i,
    );

    // The exact same real write path a genuine completed sandbox turn goes
    // through (`apps/gateway`'s turn-pipeline adapter calls this same function —
    // see its own doc comment).
    await recordSandboxTest(ctx, version.id);
    const freshAfterSandboxTest = await getAgentDefinitionVersion(ctx, version.id);
    expect(freshAfterSandboxTest.lastSandboxTestAt).not.toBeNull();

    const afterProduction = await promoteAgentVersion(ctx, version.id, "Production", "22222222-2222-2222-2222-222222222222");
    expect(afterProduction.status).toBe("Production");
  });

  it("rejects HumanReview -> Approved when the eval run has not passed yet, and _allowedTransitions correctly omits it", async () => {
    const definition = await createAgentDefinition(ctx, { name: "promo-target-no-eval" });
    const version = await createAgentDefinitionVersion(ctx, definition.id, { version: "1.0.0", modelRouteKey: "chat.primary", graphType: "CustomFSM", artifact: ARTIFACT }, "11111111-1111-1111-1111-111111111111");
    await expect(promoteAgentVersion(ctx, version.id, "EvalGated", "11111111-1111-1111-1111-111111111111")).resolves.toMatchObject({ status: "EvalGated" });

    const allowed = await getAllowedTransitionsForVersion(ctx, version.id, "22222222-2222-2222-2222-222222222222");
    expect(allowed).not.toContain("HumanReview");
    expect(allowed).toContain("Deprecated");

    await expect(promoteAgentVersion(ctx, version.id, "HumanReview", "11111111-1111-1111-1111-111111111111")).rejects.toBeInstanceOf(PromotionNotAllowedError);
  });

  it("an uninstalled graph type (NFR-12 seam) cannot even pass its eval gate, so it never reaches HumanReview — GRAPH_TYPE_NOT_INSTALLED's own explicit Production-gate check (unit-proven in promotion-policy.test.ts) is defense in depth behind this earlier, real failure", async () => {
    const definition = await createAgentDefinition(ctx, { name: "promo-target-bad-graph" });
    const version = await createAgentDefinitionVersion(
      ctx,
      definition.id,
      { version: "1.0.0", modelRouteKey: "chat.primary", graphType: "LangGraph", artifact: { ...ARTIFACT, spec: { ...ARTIFACT.spec, graphType: "LangGraph" as const } } },
      "11111111-1111-1111-1111-111111111111",
    );
    const suite = await createEvalSuite(ctx, { name: "bad-graph-suite" });
    await addEvalCase(ctx, suite.id, { name: "case-1", inputTranscript: [{ sender: "Customer", text: "hi" }] });
    await bindEvalSuite(ctx, version.id, suite.id);
    await promoteAgentVersion(ctx, version.id, "EvalGated", "11111111-1111-1111-1111-111111111111");

    // resolveGraphRuntime("LangGraph") throws (no adapter installed) — runEvalSuite
    // records the run as Error (never leaves it stuck at Running) and rethrows.
    await expect(runEvalSuite(ctx, { agentDefinitionVersionId: version.id, triggeredBy: "Manual" })).rejects.toThrow(/GRAPH_TYPE_NOT_INSTALLED/);

    // The eval gate blocks HumanReview because the last eval run never passed.
    await expect(promoteAgentVersion(ctx, version.id, "HumanReview", "11111111-1111-1111-1111-111111111111")).rejects.toBeInstanceOf(PromotionNotAllowedError);
  });

  it("BE2 regression: concurrent Approved -> Production promotions of the exact same version only let one succeed, never two active 100%-traffic Deployment rows (closes the check-then-act race)", async () => {
    const definition = await createAgentDefinition(ctx, { name: "promo-race-target" });
    const version = await createAgentDefinitionVersion(ctx, definition.id, { version: "1.0.0", modelRouteKey: "chat.primary", graphType: "CustomFSM", artifact: ARTIFACT }, "11111111-1111-1111-1111-111111111111");
    const suite = await createEvalSuite(ctx, { name: "promo-race-suite" });
    await addEvalCase(ctx, suite.id, { name: "case-1", inputTranscript: [{ sender: "Customer", text: "hi" }], expectedResponsePattern: ".*" });
    await bindEvalSuite(ctx, version.id, suite.id);
    await promoteAgentVersion(ctx, version.id, "EvalGated", "11111111-1111-1111-1111-111111111111");
    await runEvalSuite(ctx, { agentDefinitionVersionId: version.id, triggeredBy: "VersionSubmitted" });
    await promoteAgentVersion(ctx, version.id, "HumanReview", "11111111-1111-1111-1111-111111111111");
    await promoteAgentVersion(ctx, version.id, "Approved", "22222222-2222-2222-2222-222222222222");
    await recordSandboxTest(ctx, version.id);

    // Real concurrency, not sequential awaits — this is the exact repro shape QA
    // described: N truly-concurrent Approved -> Production promote calls for the same
    // version. Before the BE2 fix, all of these succeeded and each created its own
    // active 100%-traffic Deployment row.
    const attempts = 10;
    const outcomes = await Promise.allSettled(
      Array.from({ length: attempts }, () => promoteAgentVersion(ctx, version.id, "Production", "22222222-2222-2222-2222-222222222222")),
    );
    const succeeded = outcomes.filter((o) => o.status === "fulfilled");
    const failed = outcomes.filter((o) => o.status === "rejected");
    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(attempts - 1);
    for (const outcome of failed) {
      if (outcome.status === "rejected") expect(outcome.reason).toBeInstanceOf(PromotionNotAllowedError);
    }

    const deployments = await listDeploymentsForAgent(ctx, definition.id);
    const active = deployments.filter((d) => d.isActive);
    expect(active).toHaveLength(1);
    expect(active.reduce((sum, d) => sum + d.trafficSplitPct, 0)).toBe(100);
  });

  /**
   * QA fix (client-feedback-batch Phase 7, 2026-08-21 batch, "blocking defect"):
   * promoting a follow-up version to Production for an agent that already has an
   * active Production deployment used to crash with an unhandled 500 — the
   * `enforce_deployment_traffic_split_invariant()` trigger (migration 0016) rejected
   * the second active 100%-traffic row because the prior one was never deactivated.
   * This is exactly the path Phase 7's own Restore feature makes routine: create a
   * follow-up version of an already-live agent, walk it through the same gates, and
   * promote it. Proves both directions of the fix: the second promotion succeeds
   * (not a 500), and the first version's deployment row is genuinely deactivated in
   * the database afterward — not just left dangling at 100% alongside the new one.
   */
  it("promoting a second version to Production for an agent that already has a live Production deployment replaces it (client-feedback-batch Phase 7 QA fix), leaving exactly one active 100%-traffic deployment", async () => {
    const definition = await createAgentDefinition(ctx, { name: "promo-replace-target" });

    // Version A: walk it all the way to Production first, exactly like any
    // already-live agent.
    const versionA = await createAgentDefinitionVersion(ctx, definition.id, { version: "1.0.0", modelRouteKey: "chat.primary", graphType: "CustomFSM", artifact: ARTIFACT }, "11111111-1111-1111-1111-111111111111");
    const suiteA = await createEvalSuite(ctx, { name: "promo-replace-suite-a" });
    await addEvalCase(ctx, suiteA.id, { name: "case-1", inputTranscript: [{ sender: "Customer", text: "hi" }], expectedResponsePattern: ".*" });
    await bindEvalSuite(ctx, versionA.id, suiteA.id);
    await promoteAgentVersion(ctx, versionA.id, "EvalGated", "11111111-1111-1111-1111-111111111111");
    await runEvalSuite(ctx, { agentDefinitionVersionId: versionA.id, triggeredBy: "VersionSubmitted" });
    await promoteAgentVersion(ctx, versionA.id, "HumanReview", "11111111-1111-1111-1111-111111111111");
    await promoteAgentVersion(ctx, versionA.id, "Approved", "22222222-2222-2222-2222-222222222222");
    await recordSandboxTest(ctx, versionA.id);
    await promoteAgentVersion(ctx, versionA.id, "Production", "22222222-2222-2222-2222-222222222222");

    const afterA = await listDeploymentsForAgent(ctx, definition.id);
    expect(afterA).toHaveLength(1);
    expect(afterA[0]).toMatchObject({ agentDefinitionVersionId: versionA.id, isActive: true, trafficSplitPct: 100 });

    // Version B: a genuine follow-up version of the *same* agent definition — the
    // Restore-then-promote path Phase 7 makes routine. Before the fix, this last
    // `promoteAgentVersion` call threw an unhandled error from the DB trigger.
    const versionB = await createAgentDefinitionVersion(ctx, definition.id, { version: "1.1.0", modelRouteKey: "chat.primary", graphType: "CustomFSM", artifact: ARTIFACT }, "11111111-1111-1111-1111-111111111111");
    const suiteB = await createEvalSuite(ctx, { name: "promo-replace-suite-b" });
    await addEvalCase(ctx, suiteB.id, { name: "case-1", inputTranscript: [{ sender: "Customer", text: "hi" }], expectedResponsePattern: ".*" });
    await bindEvalSuite(ctx, versionB.id, suiteB.id);
    await promoteAgentVersion(ctx, versionB.id, "EvalGated", "11111111-1111-1111-1111-111111111111");
    await runEvalSuite(ctx, { agentDefinitionVersionId: versionB.id, triggeredBy: "VersionSubmitted" });
    await promoteAgentVersion(ctx, versionB.id, "HumanReview", "11111111-1111-1111-1111-111111111111");
    await promoteAgentVersion(ctx, versionB.id, "Approved", "22222222-2222-2222-2222-222222222222");
    await recordSandboxTest(ctx, versionB.id);

    // This is the exact call that used to 500 — reproduced against the real
    // database, real trigger, real repository code, before asserting the fix.
    await expect(promoteAgentVersion(ctx, versionB.id, "Production", "22222222-2222-2222-2222-222222222222")).resolves.toMatchObject({ status: "Production" });

    const afterB = await listDeploymentsForAgent(ctx, definition.id);
    expect(afterB).toHaveLength(2);

    const deploymentA = afterB.find((d) => d.agentDefinitionVersionId === versionA.id);
    const deploymentB = afterB.find((d) => d.agentDefinitionVersionId === versionB.id);
    // The OLD version's deployment is genuinely deactivated in the database, not
    // merely superseded in application logic.
    expect(deploymentA).toMatchObject({ isActive: false });
    expect(deploymentB).toMatchObject({ isActive: true, trafficSplitPct: 100 });

    // "What's currently serving Production traffic for this agent" returns exactly
    // the new version — the active rows sum to exactly 100, never more.
    const active = afterB.filter((d) => d.isActive);
    expect(active).toHaveLength(1);
    expect(active[0]?.agentDefinitionVersionId).toBe(versionB.id);
    expect(active.reduce((sum, d) => sum + d.trafficSplitPct, 0)).toBe(100);
  });

  /**
   * ADR-0009's 2026-08-23 amendment (§7(b)): the in-app reviewer!=author check is now
   * the documented approval mechanism when a version has no Git-hosted PR/MR. `ctxNoGit`
   * has **zero** `git_connection` row for its entire lifetime in this suite —
   * `connectGit` is never called for it — proving the full promotion lifecycle reaches
   * Production without any Git involvement at all, using a real distinct-user reviewer
   * to satisfy the existing check (no new/looser approval path — the exact same
   * `promotion-policy.ts` logic the Git-connected tenant above goes through).
   */
  it("walks Draft -> EvalGated -> HumanReview -> Approved -> Production for a tenant with NO Git connection, gated only by the eval pass + reviewer!=author checks", async () => {
    const definition = await createAgentDefinition(ctxNoGit, { name: "no-git-promo-target" });
    const version = await createAgentDefinitionVersion(ctxNoGit, definition.id, { version: "1.0.0", modelRouteKey: "chat.primary", graphType: "CustomFSM", artifact: ARTIFACT }, "11111111-1111-1111-1111-111111111111");
    expect(version.status).toBe("Draft");
    expect(version.gitCommitSha).toBeNull();
    expect(version.gitPrNumber).toBeNull();

    const suite = await createEvalSuite(ctxNoGit, { name: "no-git-promo-suite" });
    await addEvalCase(ctxNoGit, suite.id, { name: "case-1", inputTranscript: [{ sender: "Customer", text: "hi" }], expectedResponsePattern: ".*" });
    await bindEvalSuite(ctxNoGit, version.id, suite.id);

    await expect(promoteAgentVersion(ctxNoGit, version.id, "EvalGated", "11111111-1111-1111-1111-111111111111")).resolves.toMatchObject({ status: "EvalGated" });
    await runEvalSuite(ctxNoGit, { agentDefinitionVersionId: version.id, triggeredBy: "VersionSubmitted" });
    await expect(promoteAgentVersion(ctxNoGit, version.id, "HumanReview", "11111111-1111-1111-1111-111111111111")).resolves.toMatchObject({ status: "HumanReview" });

    // Self-approval still rejected — the reviewer!=author check applies identically
    // whether or not Git is connected; disconnected Git is never a looser path.
    await expect(promoteAgentVersion(ctxNoGit, version.id, "Approved", "11111111-1111-1111-1111-111111111111")).rejects.toBeInstanceOf(PromotionNotAllowedError);

    const afterApproved = await promoteAgentVersion(ctxNoGit, version.id, "Approved", "22222222-2222-2222-2222-222222222222");
    expect(afterApproved.status).toBe("Approved");
    expect(afterApproved.approvedByUserId).toBe("22222222-2222-2222-2222-222222222222");
    await recordSandboxTest(ctxNoGit, version.id);

    const afterProduction = await promoteAgentVersion(ctxNoGit, version.id, "Production", "22222222-2222-2222-2222-222222222222");
    expect(afterProduction.status).toBe("Production");

    const deployments = await listDeploymentsForAgent(ctxNoGit, definition.id);
    expect(deployments).toHaveLength(1);
    expect(deployments[0]).toMatchObject({ agentDefinitionVersionId: version.id, environment: "Production", trafficSplitPct: 100, isActive: true });
  });
});
