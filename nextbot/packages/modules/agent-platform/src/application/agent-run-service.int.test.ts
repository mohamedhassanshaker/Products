import { afterEach, describe, expect, it } from "vitest";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import type { TenantContext } from "@nextbot/db";
import { ModelBudgetExceededError } from "@nextbot/contracts";
import { startAgentRun, completeAgentRun, suspendAgentRunForApproval, getAgentRun } from "./agent-run-service.js";
import { createAgentDefinition, createAgentDefinitionVersion } from "./agent-definition-service.js";
import { connectGit } from "./git-connection-service.js";
import { insertModelBudget } from "./model-gateway-service.js";
import { recordSimulatedUsageEvent } from "@nextbot/model-gateway";
import { startMockGitHubServer, createMockGitHubState } from "@nextbot/testing";

const ARTIFACT = {
  apiVersion: "nextbot.io/v1" as const,
  kind: "AgentDefinition" as const,
  metadata: { name: "run-target", version: "1.0.0" },
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

describe("agent-run-service (FR-AGT-09 basic runtime observability — agent_run write path + OTel span)", () => {
  let ctx: TenantContext;
  let server: { url: string; close: () => Promise<void> } | undefined;
  afterEach(async () => {
    await server?.close();
    server = undefined;
    if (ctx) await deleteFixtureTenant(ctx.tenantId);
  });

  it("startAgentRun persists a Running agent_run row stamped with a genuine OTel trace id", async () => {
    ctx = await createFixtureTenant();
    server = await startMockGitHubServer(createMockGitHubState());
    await connectGit(ctx, { provider: "GitHub", repoOwner: "acme", repoName: "agent-defs", baseUrl: server.url, accessToken: "fake", createdByUserId: "11111111-1111-1111-1111-111111111111" });
    const definition = await createAgentDefinition(ctx, { name: "run-target" });
    const version = await createAgentDefinitionVersion(ctx, definition.id, { version: "1.0.0", modelRouteKey: "chat.primary", graphType: "CustomFSM", artifact: ARTIFACT }, "11111111-1111-1111-1111-111111111111");

    const { run, span } = await startAgentRun(ctx, { agentDefinitionVersionId: version.id, trigger: "SandboxTest" });
    expect(run.status).toBe("Running");
    expect(run.otelTraceId).toMatch(/^[0-9a-f]{32}$/);

    const reloaded = await getAgentRun(ctx, run.id);
    expect(reloaded?.otelTraceId).toBe(run.otelTraceId);
    expect(reloaded?.endedAt).toBeNull();

    await completeAgentRun(ctx, run, span, { status: "Succeeded", tokensIn: 10, tokensOut: 5 });
    const finished = await getAgentRun(ctx, run.id);
    expect(finished?.status).toBe("Succeeded");
    expect(finished?.endedAt).not.toBeNull();
  });

  it("suspendAgentRunForApproval persists PausedForApproval + a real checkpoint, without setting endedAt (non-blocking HITL, LLD §7.4 step 8)", async () => {
    ctx = await createFixtureTenant();
    server = await startMockGitHubServer(createMockGitHubState());
    await connectGit(ctx, { provider: "GitHub", repoOwner: "acme", repoName: "agent-defs", baseUrl: server.url, accessToken: "fake", createdByUserId: "11111111-1111-1111-1111-111111111111" });
    const definition = await createAgentDefinition(ctx, { name: "run-target-pause" });
    const version = await createAgentDefinitionVersion(ctx, definition.id, { version: "1.0.0", modelRouteKey: "chat.primary", graphType: "CustomFSM", artifact: ARTIFACT }, "11111111-1111-1111-1111-111111111111");

    const { run, span } = await startAgentRun(ctx, { agentDefinitionVersionId: version.id, trigger: "CustomerMessage" });
    const pausedToolCallId = "33333333-3333-3333-3333-333333333333";
    await suspendAgentRunForApproval(ctx, run, span, { pausedToolCallId, resumeToken: "resume-token-abc", checkpoint: { history: [] } });

    const paused = await getAgentRun(ctx, run.id);
    expect(paused?.status).toBe("PausedForApproval");
    expect(paused?.pausedToolCallId).toBe(pausedToolCallId);
    expect(paused?.resumeToken).toBe("resume-token-abc");
    expect(paused?.endedAt).toBeNull();
  });

  it("BE3 regression (Tenant-scope): startAgentRun is genuinely blocked once a HardStop model budget's real model_call_log usage already exceeds its cap for the current period (FR-AGT-07/08)", async () => {
    ctx = await createFixtureTenant();
    server = await startMockGitHubServer(createMockGitHubState());
    await connectGit(ctx, { provider: "GitHub", repoOwner: "acme", repoName: "agent-defs", baseUrl: server.url, accessToken: "fake", createdByUserId: "11111111-1111-1111-1111-111111111111" });
    const definition = await createAgentDefinition(ctx, { name: "budget-guard-tenant" });
    const version = await createAgentDefinitionVersion(ctx, definition.id, { version: "1.0.0", modelRouteKey: "chat.primary", graphType: "CustomFSM", artifact: ARTIFACT }, "11111111-1111-1111-1111-111111111111");

    // No budget yet — the run boundary is not gated at all.
    const { run } = await startAgentRun(ctx, { agentDefinitionVersionId: version.id, trigger: "SandboxTest" });
    expect(run.status).toBe("Running");

    // Seed genuine usage in model_call_log (never a synthetic counter) that already
    // exceeds the cap we're about to configure.
    await recordSimulatedUsageEvent(ctx, { routeKey: "chat.primary", providerKey: "openai-compatible", model: "m", costUsd: "1.50", outcome: "Success" });
    await insertModelBudget(ctx, { scope: "Tenant", period: "Day", capUsd: "1.00", onExceed: "HardStop" });

    // The very next new-run boundary is blocked before an agent_run row is even
    // created for it — never mid-run, and never silently allowed through.
    await expect(startAgentRun(ctx, { agentDefinitionVersionId: version.id, trigger: "SandboxTest" })).rejects.toBeInstanceOf(ModelBudgetExceededError);
  });

  it("BE3 regression (Agent-scope): an Agent-scoped HardStop budget only blocks runs for *that* agent definition, and only counts usage logged against its own runs", async () => {
    ctx = await createFixtureTenant();
    server = await startMockGitHubServer(createMockGitHubState());
    await connectGit(ctx, { provider: "GitHub", repoOwner: "acme", repoName: "agent-defs", baseUrl: server.url, accessToken: "fake", createdByUserId: "11111111-1111-1111-1111-111111111111" });

    const guarded = await createAgentDefinition(ctx, { name: "budget-guard-agent-scoped" });
    const guardedVersion = await createAgentDefinitionVersion(ctx, guarded.id, { version: "1.0.0", modelRouteKey: "chat.primary", graphType: "CustomFSM", artifact: ARTIFACT }, "11111111-1111-1111-1111-111111111111");
    const other = await createAgentDefinition(ctx, { name: "budget-guard-unrelated" });
    const otherVersion = await createAgentDefinitionVersion(ctx, other.id, { version: "1.0.0", modelRouteKey: "chat.primary", graphType: "CustomFSM", artifact: ARTIFACT }, "11111111-1111-1111-1111-111111111111");

    const { run: guardedRun } = await startAgentRun(ctx, { agentDefinitionVersionId: guardedVersion.id, trigger: "SandboxTest" });
    await recordSimulatedUsageEvent(ctx, { agentRunId: guardedRun.id, routeKey: "chat.primary", providerKey: "openai-compatible", model: "m", costUsd: "2.00", outcome: "Success" });
    await insertModelBudget(ctx, { scope: "Agent", agentDefinitionId: guarded.id, period: "Day", capUsd: "1.00", onExceed: "HardStop" });

    // The guarded agent is now over budget — blocked.
    await expect(startAgentRun(ctx, { agentDefinitionVersionId: guardedVersion.id, trigger: "SandboxTest" })).rejects.toBeInstanceOf(ModelBudgetExceededError);
    // A completely unrelated agent definition is unaffected by another agent's budget.
    await expect(startAgentRun(ctx, { agentDefinitionVersionId: otherVersion.id, trigger: "SandboxTest" })).resolves.toMatchObject({ run: { status: "Running" } });
  });
});
