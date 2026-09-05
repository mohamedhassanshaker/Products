import { afterEach, describe, expect, it } from "vitest";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import type { TenantContext } from "@nextbot/db";
import type { AgentDefinitionArtifact } from "@nextbot/contracts";
import { RouteCapabilityUnsatisfiedError } from "@nextbot/contracts";
import { createProviderRegistration, createRoute, createRouteVersion, declareCatalogEntry } from "@nextbot/model-gateway";
import { createAgentDefinition, createAgentDefinitionVersion } from "./agent-definition-service.js";

/**
 * Target Architecture Blueprint Phase 2 (BL-33, ADR-0011 §2.2, LLD §14.8.4,
 * FR-AGT-22) — real-Postgres proof of the second half of the save-time capability
 * gate: an agent version whose `toolPolicy.capabilityGroups` is non-empty (inferring
 * a `toolCalling` requirement) is REJECTED AT ITS OWN SAVE if its pinned route's
 * frozen `advertised_capabilities` doesn't support tool calling — never accepted and
 * left to fail later at conversation-turn time.
 */
function artifact(capabilityGroups: string[]): AgentDefinitionArtifact {
  return {
    apiVersion: "nextbot.io/v1",
    kind: "AgentDefinition",
    metadata: { name: "route-capability-test", version: "1.0.0" },
    spec: {
      graphType: "ADK",
      modelRoute: "chat.no-tools",
      instructions: "You are a test agent.",
      toolPolicy: { source: "agent-tool-registry", capabilityGroups, maxToolCallsPerTurn: 5 },
      guardrails: { minConfidenceForAutonomy: 0.6, escalateOn: [] },
      memory: { strategy: "rolling-window", maxTurns: 20 },
      budgets: { maxCostUsdPerConversation: "0.50", maxLatencyMsP95: 6000 },
    },
  };
}

describe("createAgentDefinitionVersion — save-time route-capability gate (FR-AGT-22, real Postgres)", () => {
  let ctx: TenantContext;
  afterEach(async () => {
    if (ctx) await deleteFixtureTenant(ctx.tenantId);
  });

  it("rejects a version requiring tool calling when its pinned route's only hop does not support it", async () => {
    ctx = await createFixtureTenant();
    const provider = await createProviderRegistration(ctx, { type: "openai-compatible", name: "No tool calling", baseUrl: "http://localhost:9/v1", retainsPrompts: false, trainsOnData: false });
    const entry = await declareCatalogEntry(ctx, {
      providerId: provider.id,
      modelId: "no-tools-model",
      displayName: "no-tools-model",
      modality: "Text",
      contextWindow: 8192,
      maxOutput: 4096,
      capabilities: { toolCalling: false, vision: false, streaming: true, structuredOutput: false, extendedThinking: false, promptCaching: false, jsonMode: false },
      tokenizer: "cl100k_base",
    });
    const route = await createRoute(ctx, { name: "chat.no-tools" });
    await createRouteVersion(
      ctx,
      route.id,
      {
        chain: [{ ordinal: 0, providerId: provider.id, catalogEntryId: entry.id, params: {}, timeoutMs: 30000 }],
        policy: { strategy: "FixedPriority", failoverOn: ["429"], retry: { maxPerHop: 1, backoff: "none" }, totalTimeoutMs: 30000, cacheMode: "Off", onBudgetBreach: "Fail", allowOutOfRegionFailover: false },
      },
      true,
    );

    const definition = await createAgentDefinition(ctx, { name: "route-capability-test" });
    await expect(
      createAgentDefinitionVersion(ctx, definition.id, { version: "1.0.0", modelRouteKey: "chat.no-tools", artifact: artifact(["billing"]) }, null),
    ).rejects.toBeInstanceOf(RouteCapabilityUnsatisfiedError);
  });

  it("accepts the identical version once the route is re-pinned to a hop that DOES support tool calling", async () => {
    ctx = await createFixtureTenant();
    const provider = await createProviderRegistration(ctx, { type: "openai-compatible", name: "Tool calling", baseUrl: "http://localhost:9/v1", retainsPrompts: false, trainsOnData: false });
    const entry = await declareCatalogEntry(ctx, {
      providerId: provider.id,
      modelId: "tools-model",
      displayName: "tools-model",
      modality: "Text",
      contextWindow: 8192,
      maxOutput: 4096,
      capabilities: { toolCalling: true, vision: false, streaming: true, structuredOutput: false, extendedThinking: false, promptCaching: false, jsonMode: false },
      tokenizer: "cl100k_base",
    });
    const route = await createRoute(ctx, { name: "chat.no-tools" });
    await createRouteVersion(
      ctx,
      route.id,
      {
        chain: [{ ordinal: 0, providerId: provider.id, catalogEntryId: entry.id, params: {}, timeoutMs: 30000 }],
        policy: { strategy: "FixedPriority", failoverOn: ["429"], retry: { maxPerHop: 1, backoff: "none" }, totalTimeoutMs: 30000, cacheMode: "Off", onBudgetBreach: "Fail", allowOutOfRegionFailover: false },
      },
      true,
    );

    const definition = await createAgentDefinition(ctx, { name: "route-capability-test-ok" });
    const version = await createAgentDefinitionVersion(ctx, definition.id, { version: "1.0.0", modelRouteKey: "chat.no-tools", artifact: artifact(["billing"]) }, null);
    expect(version.modelRouteVersionId).toBeTruthy();
  });
});
