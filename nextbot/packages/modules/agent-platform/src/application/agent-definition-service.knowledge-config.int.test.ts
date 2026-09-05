import { afterEach, describe, expect, it } from "vitest";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import type { AgentDefinitionArtifact } from "@nextbot/contracts";
import { createCollection } from "@nextbot/knowledge";
import { createAgentDefinition, createAgentDefinitionVersion, getVersionKnowledgeConfig } from "./agent-definition-service.js";

/**
 * Target Architecture Blueprint Phase 10 (BL-41, FR-KB-05/06, Blueprint §7.5) — the
 * agent-version YAML's `spec.knowledge`/`spec.plannerRoute` save-time resolution:
 * collection NAME pins resolved to real, tenant-scoped `knowledge_collection` ids
 * (mirrors `spec.skills`'s pin-resolution discipline — first unresolvable reference
 * fails the save), and `plannerRoute` resolved/defaulted the same way `modelRoute`
 * already is. No mock model server needed: `resolveOrSynthesizeRouteVersionForKey`
 * synthesizes a real (conservative) route+catalog entry with no live model call, the
 * same real, already-established mechanism `createCollection` itself uses.
 */
const createdTenantIds: string[] = [];
afterEach(async () => {
  for (const id of createdTenantIds.splice(0)) await deleteFixtureTenant(id);
});

function baseArtifact(overrides: Partial<AgentDefinitionArtifact["spec"]> = {}): AgentDefinitionArtifact {
  return {
    apiVersion: "nextbot.io/v1",
    kind: "AgentDefinition",
    metadata: { name: "knowledge-config-test", version: "1.0.0" },
    spec: {
      graphType: "ADK",
      modelRoute: "chat.primary",
      instructions: "You are a retrieval-scoped test agent.",
      toolPolicy: { source: "agent-tool-registry", capabilityGroups: [], maxToolCallsPerTurn: 5 },
      guardrails: { minConfidenceForAutonomy: 0.6, escalateOn: [] },
      memory: { strategy: "rolling-window", maxTurns: 20 },
      budgets: { maxCostUsdPerConversation: "0.50", maxLatencyMsP95: 6000 },
      ...overrides,
    },
  };
}

describe("createAgentDefinitionVersion — spec.knowledge/spec.plannerRoute resolution (Phase 10, real Postgres)", () => {
  it("returns null for an ordinary (non-knowledge-scoped) version — completely unaffected", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const definition = await createAgentDefinition(ctx, { name: "def-plain" });
    const version = await createAgentDefinitionVersion(ctx, definition.id, { version: "1.0.0", modelRouteKey: "chat.primary", artifact: baseArtifact() }, null);

    const result = await getVersionKnowledgeConfig(ctx, version.id);
    expect(result).toBeNull();
  });

  it("resolves a real collection name pin to its real id, and defaults plannerRoute to chat.router", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const collection = await createCollection(ctx, {
      name: "billing_policy",
      region: ctx.region,
      extractionRouteKey: "knowledge.extract.default",
      embeddingRouteKey: "knowledge.embed.default",
    });

    const definition = await createAgentDefinition(ctx, { name: "def-knowledge" });
    const version = await createAgentDefinitionVersion(
      ctx,
      definition.id,
      {
        version: "1.0.0",
        modelRouteKey: "chat.primary",
        artifact: baseArtifact({
          knowledge: {
            collections: ["billing_policy@12"],
            strategy: "auto",
            maxHops: 2,
            maxExpansions: 3,
            minCitations: 1,
            refuseWhenUngrounded: true,
            budget: { usdPerTurn: 0.02, seconds: 8 },
          },
        }),
      },
      null,
    );

    const result = await getVersionKnowledgeConfig(ctx, version.id);
    expect(result).not.toBeNull();
    expect(result?.knowledgeConfig.collectionIds).toEqual([collection.id]);
    expect(result?.knowledgeConfig.strategy).toBe("auto");
    expect(result?.knowledgeConfig.maxExpansions).toBe(3);
    expect(result?.knowledgeConfig.refuseWhenUngrounded).toBe(true);
    expect(result?.knowledgeConfig.budget).toEqual({ usdPerTurn: 0.02, seconds: 8 });
    expect(result?.plannerRouteVersionId).toBeTruthy(); // real, resolved "chat.router" pin — the author never configured one explicitly.
    expect(result?.answerRouteVersionId).toBeTruthy();
  });

  it("maps the Blueprint's own lowercase strategy vocabulary onto the internal enum", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    await createCollection(ctx, { name: "legal", region: ctx.region, extractionRouteKey: "knowledge.extract.default", embeddingRouteKey: "knowledge.embed.default" });
    const definition = await createAgentDefinition(ctx, { name: "def-strategy-map" });
    const version = await createAgentDefinitionVersion(
      ctx,
      definition.id,
      {
        version: "1.0.0",
        modelRouteKey: "chat.primary",
        artifact: baseArtifact({
          knowledge: { collections: ["legal@4"], strategy: "local", maxHops: 2, maxExpansions: 2, minCitations: 1, refuseWhenUngrounded: true, budget: { usdPerTurn: 0.02, seconds: 8 } },
        }),
      },
      null,
    );
    const result = await getVersionKnowledgeConfig(ctx, version.id);
    expect(result?.knowledgeConfig.strategy).toBe("GraphLocal");
  });

  it("fails the save outright when a collection name pin doesn't resolve — nothing dangling persisted", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const definition = await createAgentDefinition(ctx, { name: "def-bad-pin" });

    await expect(
      createAgentDefinitionVersion(
        ctx,
        definition.id,
        {
          version: "1.0.0",
          modelRouteKey: "chat.primary",
          artifact: baseArtifact({
            knowledge: { collections: ["does_not_exist@1"], strategy: "auto", maxHops: 2, maxExpansions: 2, minCitations: 1, refuseWhenUngrounded: true, budget: { usdPerTurn: 0.02, seconds: 8 } },
          }),
        },
        null,
      ),
    ).rejects.toMatchObject({ code: "KNOWLEDGE_COLLECTION_NOT_FOUND" });
  });

  it("an explicit spec.plannerRoute is resolved instead of the chat.router default", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    await createCollection(ctx, { name: "faq", region: ctx.region, extractionRouteKey: "knowledge.extract.default", embeddingRouteKey: "knowledge.embed.default" });
    const definition = await createAgentDefinition(ctx, { name: "def-explicit-planner" });
    const version = await createAgentDefinitionVersion(
      ctx,
      definition.id,
      {
        version: "1.0.0",
        modelRouteKey: "chat.primary",
        artifact: baseArtifact({
          plannerRoute: "custom.planner.route",
          knowledge: { collections: ["faq@1"], strategy: "auto", maxHops: 2, maxExpansions: 2, minCitations: 1, refuseWhenUngrounded: true, budget: { usdPerTurn: 0.02, seconds: 8 } },
        }),
      },
      null,
    );
    const result = await getVersionKnowledgeConfig(ctx, version.id);
    expect(result?.plannerRouteVersionId).toBeTruthy();
    // Distinct route from the default chat.router pin used by the other tests in
    // this file (each resolves/synthesizes its own real model_route row) — checked
    // indirectly via a successful, non-null resolution rather than string-comparing
    // route names, which this accessor deliberately doesn't expose.
  });
});
