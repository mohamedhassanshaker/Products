import { afterEach, describe, expect, it, vi } from "vitest";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import { withTenant, schema } from "@nextbot/db";
import { eq, and } from "drizzle-orm";
import type { AgentDefinitionArtifact } from "@nextbot/contracts";
import { createAgentDefinition, createAgentDefinitionVersion, getVersionToolPolicy } from "./agent-definition-service.js";

/**
 * Phase 17 (client-feedback-batch capability-group enforcement) — `getVersionToolPolicy`
 * is the lightweight, hot-path read `turn-pipeline.ts` calls on every live turn to learn
 * a deployed version's `toolPolicy.capabilityGroups`. Covers both its real-artifact
 * paths (real names / genuinely empty) and its defensive-degrade paths (corrupt YAML,
 * a `toolPolicy` node missing entirely) — every one of these must return an empty
 * array and never throw, since a bookkeeping read here must never fail a live turn.
 */
const createdTenantIds: string[] = [];
afterEach(async () => {
  for (const id of createdTenantIds.splice(0)) await deleteFixtureTenant(id);
  vi.restoreAllMocks();
});

function baseArtifact(capabilityGroups: string[]): AgentDefinitionArtifact {
  return {
    apiVersion: "nextbot.io/v1",
    kind: "AgentDefinition",
    metadata: { name: "get-version-tool-policy-test", version: "1.0.0" },
    spec: {
      graphType: "ADK",
      modelRoute: "chat.primary",
      instructions: "You are a test agent.",
      toolPolicy: { source: "agent-tool-registry", capabilityGroups, maxToolCallsPerTurn: 5 },
      guardrails: { minConfidenceForAutonomy: 0.6, escalateOn: [] },
      memory: { strategy: "rolling-window", maxTurns: 20 },
      budgets: { maxCostUsdPerConversation: "0.50", maxLatencyMsP95: 6000 },
    },
  };
}

async function overwriteDefinitionYaml(ctx: Awaited<ReturnType<typeof createFixtureTenant>>, versionId: string, definitionYaml: string): Promise<void> {
  await withTenant(ctx, async (db) => {
    await db
      .update(schema.agentDefinitionVersion)
      .set({ definitionYaml })
      .where(and(eq(schema.agentDefinitionVersion.tenantId, ctx.tenantId), eq(schema.agentDefinitionVersion.id, versionId)));
  });
}

describe("getVersionToolPolicy (Phase 17, real Postgres)", () => {
  it("returns the real, non-empty capabilityGroups names from a valid artifact", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const definition = await createAgentDefinition(ctx, { name: "def-1" });
    const version = await createAgentDefinitionVersion(
      ctx,
      definition.id,
      { version: "1.0.0", modelRouteKey: "chat.primary", artifact: baseArtifact(["billing", "orders"]) },
      null,
    );

    const result = await getVersionToolPolicy(ctx, version.id);
    expect(result).toEqual({ capabilityGroups: ["billing", "orders"] });
  });

  it("returns an empty array for a version whose toolPolicy.capabilityGroups is genuinely []", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const definition = await createAgentDefinition(ctx, { name: "def-2" });
    const version = await createAgentDefinitionVersion(
      ctx,
      definition.id,
      { version: "1.0.0", modelRouteKey: "chat.primary", artifact: baseArtifact([]) },
      null,
    );

    const result = await getVersionToolPolicy(ctx, version.id);
    expect(result).toEqual({ capabilityGroups: [] });
  });

  it("degrades to an empty array (never throws) when definitionYaml is unparsable garbage", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const definition = await createAgentDefinition(ctx, { name: "def-3" });
    const version = await createAgentDefinitionVersion(
      ctx,
      definition.id,
      { version: "1.0.0", modelRouteKey: "chat.primary", artifact: baseArtifact(["billing"]) },
      null,
    );
    // Simulates a corrupted/legacy row bypassing the write-time schema validation —
    // should never happen via the real write path, but this function must degrade
    // safely (never throw into a live turn) if it somehow did.
    await overwriteDefinitionYaml(ctx, version.id, ":\n  this is not: [valid, yaml:\n    - broken");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const result = await getVersionToolPolicy(ctx, version.id);

    expect(result).toEqual({ capabilityGroups: [] });
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("failed to parse definitionYaml"), expect.anything());
  });

  it("degrades to an empty array when toolPolicy is missing from the artifact entirely", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const definition = await createAgentDefinition(ctx, { name: "def-4" });
    const version = await createAgentDefinitionVersion(
      ctx,
      definition.id,
      { version: "1.0.0", modelRouteKey: "chat.primary", artifact: baseArtifact([]) },
      null,
    );
    await overwriteDefinitionYaml(ctx, version.id, "apiVersion: nextbot.io/v1\nkind: AgentDefinition\nmetadata:\n  name: x\n  version: '1.0.0'\nspec: {}\n");

    const result = await getVersionToolPolicy(ctx, version.id);
    expect(result).toEqual({ capabilityGroups: [] });
  });
});
