import { afterEach, describe, expect, it } from "vitest";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import type { TenantContext } from "@nextbot/db";
import { updateTenantDataPolicy, updateTenantStatus } from "@nextbot/tenancy";
import { startMockOpenAiCompatibleServer, type MockOpenAiServerHandle } from "@nextbot/testing";
import { createProviderRegistration, createRoute, createRouteVersion, declareCatalogEntry } from "@nextbot/model-gateway";
import { ensureTenantGraphDatabase, dropTenantGraphDatabase } from "@nextbot/graph-store/provisioning";
import { KnowledgeRegionMismatchError, EmbeddingModelChangeRequiresReembedError } from "@nextbot/contracts";
import { createCollection, createSource, storeUploadAndBuildLocator, buildGeneration, getGenerationOrThrow, getCollectionOrThrow, updateCollectionConfiguration } from "./index.js";
import { pumpIngestionJobs } from "./application/pipeline/pump.js";
import { getGeneration } from "./infrastructure/generation-repository.js";

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
    modelId: `model-${routeKey}`,
    displayName: `Model for ${routeKey}`,
    modality: opts.modality,
    contextWindow: 8192,
    maxOutput: 4096,
    dimension: opts.dimension,
    capabilities: { toolCalling: false, vision: false, streaming: true, structuredOutput: true, extendedThinking: false, promptCaching: false, jsonMode: true },
    tokenizer: "cl100k_base",
  });
  const route = await createRoute(ctx, { name: routeKey });
  await createRouteVersion(
    ctx,
    route.id,
    {
      chain: [{ ordinal: 0, providerId: provider.id, catalogEntryId: entry.id, params: {}, timeoutMs: 30000 }],
      policy: { strategy: "FixedPriority", failoverOn: ["429", "5xx", "timeout"], retry: { maxPerHop: 1, backoff: "exponential" }, totalTimeoutMs: 30000, cacheMode: "Off", onBudgetBreach: "Fail", allowOutOfRegionFailover: false },
    },
    true,
  );
  return { provider, entry, route };
}

function fakeEmbedding(text: string, dim: number): number[] {
  const vector = new Array(dim).fill(0);
  for (let i = 0; i < text.length; i += 1) vector[i % dim] += text.charCodeAt(i);
  return vector.map((v) => v / 1000);
}

async function driveToTerminal(ctx: TenantContext, generationId: string, maxTicks = 60): Promise<string> {
  let status = "Building";
  for (let i = 0; i < maxTicks; i += 1) {
    await pumpIngestionJobs({ maxConcurrentPerTenant: 10, leaseSeconds: 60 });
    const current = await getGenerationOrThrow(ctx, generationId);
    status = current.status;
    if (["Ready", "Failed", "Cancelled"].includes(status)) break;
  }
  return status;
}

describe("Knowledge collection/generation governance — real Postgres + real Neo4j + real HTTP", () => {
  let ctx: TenantContext;
  let server: MockOpenAiServerHandle | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
    if (ctx) {
      await dropTenantGraphDatabase(ctx.tenantId);
      await deleteFixtureTenant(ctx.tenantId);
    }
  });

  it("FR-KB-08: rejects a collection whose region does not match the tenant's residency region at save time (KNOWLEDGE_REGION_MISMATCH), and allows it once the tenant explicitly opts into out-of-region inference", async () => {
    ctx = await createFixtureTenant({ region: "US" }); // tenant_data_policy.residencyRegion defaults to the tenant's own region (US)
    await updateTenantStatus(ctx.tenantId, "Active");
    await ensureTenantGraphDatabase(ctx.tenantId);

    server = await startMockOpenAiCompatibleServer({ onChatCompletion: () => ({ content: "{}" }), onEmbedding: (body) => ({ embedding: fakeEmbedding(body.input, 384) }) });
    await pinRoute(ctx, "knowledge.extract.residency", { baseUrl: server.url, modality: "Text" });
    await pinRoute(ctx, "knowledge.embed.residency", { baseUrl: server.url, modality: "Embedding", dimension: 384 });

    await expect(
      createCollection(ctx, {
        name: "EU Collection (should be rejected)",
        region: "EU",
        extractionRouteKey: "knowledge.extract.residency",
        embeddingRouteKey: "knowledge.embed.residency",
      }),
    ).rejects.toThrow(KnowledgeRegionMismatchError);

    // Never silently allowed — must be an explicit tenant-level opt-in.
    await updateTenantDataPolicy(ctx, { allowOutOfRegionInference: true });

    const collection = await createCollection(ctx, {
      name: "EU Collection (now allowed)",
      region: "EU",
      extractionRouteKey: "knowledge.extract.residency",
      embeddingRouteKey: "knowledge.embed.residency",
    });
    expect(collection.region).toBe("EU");
  });

  it("FR-KB-03: an already-built generation's embedding_catalog_entry_id/dimension are IMMUTABLE — changing the collection's current embedding-model pin never retroactively alters a prior generation, and building a new generation without confirmReEmbed is rejected", async () => {
    ctx = await createFixtureTenant();
    await updateTenantStatus(ctx.tenantId, "Active");
    await ensureTenantGraphDatabase(ctx.tenantId);

    server = await startMockOpenAiCompatibleServer({ onChatCompletion: () => ({ content: JSON.stringify({ entities: [], relations: [] }) }), onEmbedding: (body) => ({ embedding: fakeEmbedding(body.input, 384) }) });
    await pinRoute(ctx, "knowledge.extract.pin", { baseUrl: server.url, modality: "Text" });
    await pinRoute(ctx, "knowledge.embed.pin.v1", { baseUrl: server.url, modality: "Embedding", dimension: 384 });

    const collection = await createCollection(ctx, {
      name: "Pinning Test Collection",
      region: ctx.region,
      extractionRouteKey: "knowledge.extract.pin",
      embeddingRouteKey: "knowledge.embed.pin.v1",
    });

    const locator = await storeUploadAndBuildLocator(ctx, "doc.txt", "text/plain", "A short test document with no notable entities.");
    await createSource(ctx, { collectionId: collection.id, kind: "Upload", name: "doc", locator, acl: { tags: [], visibility: "Tenant" } });

    const generation1 = await buildGeneration(ctx, collection.id);
    expect(generation1.dimension).toBe(384);
    const status1 = await driveToTerminal(ctx, generation1.id);
    expect(status1).toBe("Ready");

    const generation1CatalogEntryId = generation1.embeddingCatalogEntryId;

    // Now change the collection's embedding model to a DIFFERENT catalog entry
    // (different dimension entirely, 768) — this must NOT touch generation1 at all.
    await pinRoute(ctx, "knowledge.embed.pin.v2", { baseUrl: server.url, modality: "Embedding", dimension: 768 });
    await updateCollectionConfiguration(ctx, collection.id, { embeddingRouteKey: "knowledge.embed.pin.v2" });

    const generation1AfterConfigChange = await getGeneration(ctx, generation1.id);
    expect(generation1AfterConfigChange?.embeddingCatalogEntryId).toBe(generation1CatalogEntryId);
    expect(generation1AfterConfigChange?.dimension).toBe(384);
    expect(generation1AfterConfigChange?.status).toBe("Ready"); // untouched — still Ready, not silently invalidated

    // Building a new generation WITHOUT confirmReEmbed is rejected — never a silent re-embed.
    await expect(buildGeneration(ctx, collection.id)).rejects.toThrow(EmbeddingModelChangeRequiresReembedError);

    // With confirmReEmbed: true, a real new generation is built, pinned to the NEW model/dimension.
    const generation2 = await buildGeneration(ctx, collection.id, { confirmReEmbed: true });
    expect(generation2.dimension).toBe(768);
    expect(generation2.supersedesGenerationId).toBe(generation1.id);
    const status2 = await driveToTerminal(ctx, generation2.id);
    expect(status2).toBe("Ready");

    // generation1 is now Superseded (frozen, still queryable, never mixed with generation2's vector space) — and STILL immutable.
    const generation1Final = await getGeneration(ctx, generation1.id);
    expect(generation1Final?.status).toBe("Superseded");
    expect(generation1Final?.embeddingCatalogEntryId).toBe(generation1CatalogEntryId);
    expect(generation1Final?.dimension).toBe(384);

    const finalCollection = await getCollectionOrThrow(ctx, collection.id);
    expect(finalCollection.currentGenerationId).toBe(generation2.id);
  }, 30_000);
});
