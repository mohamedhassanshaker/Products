import { afterEach, describe, expect, it } from "vitest";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import type { TenantContext } from "@nextbot/db";
import { startMockOpenAiCompatibleServer, type MockOpenAiServerHandle } from "@nextbot/testing";
import { Type } from "@sinclair/typebox";
import { createProviderRegistration, createRoute, createRouteVersion, declareCatalogEntry } from "@nextbot/model-gateway";
import { resolveModelChainForRouteVersion, callModelGatewayStructuredPinned, callModelGatewayEmbedding } from "./gateway-call-service.js";
import { getRouteByName } from "../infrastructure/route-repository.js";
import { listUsageEventsInRange } from "../infrastructure/route-repository.js";

/**
 * Target Architecture Blueprint Phase 7b — real, unmocked HTTP round trips for the
 * two model-gateway additions this phase needs: pinned-by-version structured output
 * (the Extract stage) and the gateway's first embedding call path (the Embed stage).
 * Both must call through the EXACT pinned `model_route_version`, not whatever a
 * route's "current" version happens to be — the point of `resolveModelChainForRouteVersion`.
 */
async function pinRoute(ctx: TenantContext, routeKey: string, opts: { baseUrl: string; modality: "Text" | "Embedding"; dimension?: number }) {
  const provider = await createProviderRegistration(ctx, {
    type: "openai-compatible",
    name: `Provider for ${routeKey}`,
    baseUrl: opts.baseUrl,
    region: ctx.region,
    retainsPrompts: false,
    trainsOnData: false,
  });
  const entry = await declareCatalogEntry(ctx, {
    providerId: provider.id,
    modelId: "test-model",
    displayName: "Test Model",
    modality: opts.modality,
    contextWindow: 8192,
    maxOutput: 4096,
    dimension: opts.dimension,
    capabilities: { toolCalling: false, vision: false, streaming: true, structuredOutput: true, extendedThinking: false, promptCaching: false, jsonMode: true },
    tokenizer: "cl100k_base",
  });
  const route = await createRoute(ctx, { name: routeKey });
  const version = await createRouteVersion(
    ctx,
    route.id,
    {
      chain: [{ ordinal: 0, providerId: provider.id, catalogEntryId: entry.id, params: {}, timeoutMs: 30000 }],
      policy: { strategy: "FixedPriority", failoverOn: ["429", "5xx", "timeout"], retry: { maxPerHop: 1, backoff: "exponential" }, totalTimeoutMs: 30000, cacheMode: "Off", onBudgetBreach: "Fail", allowOutOfRegionFailover: false },
    },
    true,
  );
  return { provider, entry, route, version };
}

describe("gateway-call-service pinned-version + embedding additions (Phase 7b)", () => {
  let ctx: TenantContext;
  let server: MockOpenAiServerHandle | undefined;
  afterEach(async () => {
    await server?.close();
    server = undefined;
    if (ctx) await deleteFixtureTenant(ctx.tenantId);
  });

  it("callModelGatewayStructuredPinned calls through the pinned version's real HTTP endpoint and logs usage with knowledgeGenerationId", async () => {
    ctx = await createFixtureTenant();
    server = await startMockOpenAiCompatibleServer({ onChatCompletion: () => ({ content: JSON.stringify({ entities: ["Acme Corp"] }) }) });
    const { version } = await pinRoute(ctx, "knowledge.extract.test", { baseUrl: server.url, modality: "Text" });

    const Schema = Type.Object({ entities: Type.Array(Type.String()) });
    const result = await callModelGatewayStructuredPinned(ctx, {
      routeVersionId: version.id,
      routeKeyForLog: "knowledge.extract.test",
      schema: Schema,
      system: "Extract entities.",
      messages: [{ role: "user", content: "Acme Corp signed a contract." }],
      knowledgeGenerationId: "11111111-1111-1111-1111-111111111111",
    });
    expect(result).toEqual({ entities: ["Acme Corp"] });

    const events = await listUsageEventsInRange(ctx, new Date(Date.now() - 60_000), new Date(Date.now() + 60_000));
    const ours = events.find((e) => e.routeKey === "knowledge.extract.test");
    expect(ours?.knowledgeGenerationId).toBe("11111111-1111-1111-1111-111111111111");
    expect(ours?.outcome).toBe("Success");
  });

  it("resolveModelChainForRouteVersion resolves the SAME pinned version even after the route's current version changes (FR-KB-03 immutability)", async () => {
    ctx = await createFixtureTenant();
    server = await startMockOpenAiCompatibleServer({ onChatCompletion: () => ({ content: "{}" }) });
    const { route, version: v1, provider } = await pinRoute(ctx, "knowledge.extract.pin-test", { baseUrl: server.url, modality: "Text" });

    // Publish a SECOND version on the same route (simulating an admin later
    // reconfiguring the route) — the pin must keep resolving to v1's model, never v2's.
    const entryV2 = await declareCatalogEntry(ctx, {
      providerId: provider.id,
      modelId: "a-different-model-v2",
      displayName: "V2 Model",
      modality: "Text",
      contextWindow: 8192,
      maxOutput: 4096,
      capabilities: { toolCalling: false, vision: false, streaming: true, structuredOutput: true, extendedThinking: false, promptCaching: false, jsonMode: true },
      tokenizer: "cl100k_base",
    });
    await createRouteVersion(
      ctx,
      route.id,
      {
        chain: [{ ordinal: 0, providerId: provider.id, catalogEntryId: entryV2.id, params: {}, timeoutMs: 30000 }],
        policy: { strategy: "FixedPriority", failoverOn: ["429", "5xx", "timeout"], retry: { maxPerHop: 1, backoff: "exponential" }, totalTimeoutMs: 30000, cacheMode: "Off", onBudgetBreach: "Fail", allowOutOfRegionFailover: false },
      },
      true,
    );

    const currentRoute = await getRouteByName(ctx, "knowledge.extract.pin-test");
    expect(currentRoute?.currentVersionId).not.toBe(v1.id); // the route itself moved on

    const pinnedResolution = await resolveModelChainForRouteVersion(ctx, v1.id);
    expect(pinnedResolution.chain[0]?.model).toBe("test-model"); // still v1's model, not v2's
  });

  it("callModelGatewayEmbedding performs a real embedding HTTP round trip and returns the vector", async () => {
    ctx = await createFixtureTenant();
    server = await startMockOpenAiCompatibleServer({ onEmbedding: () => ({ embedding: [0.1, 0.2, 0.3] }) });
    const { version, entry } = await pinRoute(ctx, "knowledge.embed.test", { baseUrl: server.url, modality: "Embedding", dimension: 3 });

    const result = await callModelGatewayEmbedding(ctx, {
      routeVersionId: version.id,
      routeKeyForLog: "knowledge.embed.test",
      input: "some chunk text",
    });
    expect(result.embedding).toEqual([0.1, 0.2, 0.3]);
    expect(result.catalogEntryId).toBe(entry.id);
  });
});
