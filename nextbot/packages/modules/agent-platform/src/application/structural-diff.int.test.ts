import { afterEach, describe, expect, it } from "vitest";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import { createAgentDefinition, createAgentDefinitionVersion, diffVersions, structuralDiffVersions } from "./agent-definition-service.js";

const AUTHOR = "11111111-1111-1111-1111-111111111111";

function artifact(overrides: Partial<{ maxToolCallsPerTurn: number; modelRoute: string }> = {}) {
  return {
    apiVersion: "nextbot.io/v1" as const,
    kind: "AgentDefinition" as const,
    metadata: { name: "structural-diff-target", version: "1.0.0" },
    spec: {
      graphType: "CustomFSM" as const,
      modelRoute: overrides.modelRoute ?? "chat.primary",
      instructions: "hi",
      toolPolicy: { source: "agent-tool-registry" as const, capabilityGroups: [], maxToolCallsPerTurn: overrides.maxToolCallsPerTurn ?? 5 },
      guardrails: { minConfidenceForAutonomy: 0.6, escalateOn: [] },
      memory: { strategy: "rolling-window", maxTurns: 20 },
      budgets: { maxCostUsdPerConversation: "0.50", maxLatencyMsP95: 6000 },
    },
  };
}

const createdTenantIds: string[] = [];
afterEach(async () => {
  for (const id of createdTenantIds.splice(0)) await deleteFixtureTenant(id);
});

describe("structuralDiffVersions — ADR-0016's Git-independent baseline (real database)", () => {
  it("Verification 1 (no-Git test): with zero git_connection rows for the tenant, structural diff returns a correct change set for two agent versions with no git_commit_sha at all", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    // Deliberately no connectGit call for this tenant — zero git_connection rows for
    // its entire lifetime in this test.
    const definition = await createAgentDefinition(ctx, { name: "structural-diff-no-git" });
    const versionA = await createAgentDefinitionVersion(ctx, definition.id, { version: "1.0.0", modelRouteKey: "chat.primary", graphType: "CustomFSM", artifact: artifact({ maxToolCallsPerTurn: 5 }) }, AUTHOR);
    const versionB = await createAgentDefinitionVersion(ctx, definition.id, { version: "1.1.0", modelRouteKey: "chat.primary", graphType: "CustomFSM", artifact: artifact({ maxToolCallsPerTurn: 8 }) }, AUTHOR);
    expect(versionA.gitCommitSha).toBeNull();
    expect(versionB.gitCommitSha).toBeNull();

    const changes = await structuralDiffVersions(ctx, versionA.id, versionB.id);
    expect(changes).toContainEqual({ op: "changed", path: "spec.toolPolicy.maxToolCallsPerTurn", before: 5, after: 8, securityRelevant: true });
  });

  it("Verification 5 (ADR-0009 non-regression): the Git diff endpoint still fails when either version lacks a git_commit_sha, and never silently falls back to the structural diff", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const definition = await createAgentDefinition(ctx, { name: "structural-diff-git-nonregression" });
    const versionA = await createAgentDefinitionVersion(ctx, definition.id, { version: "1.0.0", modelRouteKey: "chat.primary", graphType: "CustomFSM", artifact: artifact() }, AUTHOR);
    const versionB = await createAgentDefinitionVersion(ctx, definition.id, { version: "1.1.0", modelRouteKey: "chat.primary", graphType: "CustomFSM", artifact: artifact({ maxToolCallsPerTurn: 9 }) }, AUTHOR);

    // The Git diff endpoint is unaffected by the new structural-diff endpoint's
    // existence — it still refuses to operate without two real commit SHAs (this
    // codebase never gave these versions one, since no Git connection is configured).
    await expect(diffVersions(ctx, versionA.id, versionB.id)).rejects.toThrow(/git commit/i);

    // The structural-diff endpoint, called against the exact same two versions,
    // succeeds — proving the two are genuinely separate code paths, not one silently
    // falling back to the other.
    const changes = await structuralDiffVersions(ctx, versionA.id, versionB.id);
    expect(changes.length).toBeGreaterThan(0);
  });
});
