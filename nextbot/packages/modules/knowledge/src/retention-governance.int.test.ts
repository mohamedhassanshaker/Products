import { afterEach, describe, expect, it } from "vitest";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import { updateTenantStatus } from "@nextbot/tenancy";
import type { TenantContext } from "@nextbot/db";
import { startMockOpenAiCompatibleServer, type MockOpenAiServerHandle } from "@nextbot/testing";
import { createProviderRegistration, createRoute, createRouteVersion, declareCatalogEntry } from "@nextbot/model-gateway";
import { ensureTenantGraphDatabase, dropTenantGraphDatabase } from "@nextbot/graph-store/provisioning";
import { createCollection, createSource, storeUploadAndBuildLocator, buildGeneration, getGenerationOrThrow, deleteSource, getSourceOrThrow } from "./index.js";
import { pumpIngestionJobs } from "./application/pipeline/pump.js";
import { listChunksForGeneration } from "./infrastructure/document-chunk-repository.js";
import { listEntitiesForGeneration, listEdgesForGeneration } from "./infrastructure/graph-repository.js";

/**
 * Target Architecture Blueprint Phase 11 (BL-42, FR-KB-08/FR-ADM-06) — the
 * Retention sub-requirement's own real, end-to-end exit gate: "purging a source
 * removes its chunks and any extracted entities with no other provenance." Proven
 * against real Postgres + real Neo4j — a full ingestion pipeline run, then a real
 * `deleteSource` call, with every affected row re-read fresh from the database
 * (never trusting the in-memory return value alone).
 */

const TEST_DOCUMENT = `# Acme Corp

Acme Corp signed a partnership agreement with Globex Corporation in 2024.
`;

async function pinRoute(ctx: TenantContext, routeKey: string, opts: { baseUrl: string; modality: "Text" | "Embedding"; dimension?: number }) {
  const provider = await createProviderRegistration(ctx, { type: "openai-compatible", name: `Provider for ${routeKey}`, baseUrl: opts.baseUrl, region: ctx.region, retainsPrompts: false, trainsOnData: false });
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
    priceIn: 0.0000005,
    priceOut: 0.0000015,
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

describe("FR-KB-08/FR-ADM-06 retention cascade — real deleteSource against Postgres + Neo4j", () => {
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

  it("removes a purged source's chunks and its now-unreferenced entities/edges, and marks the source Purged", async () => {
    ctx = await createFixtureTenant();
    await updateTenantStatus(ctx.tenantId, "Active");
    await ensureTenantGraphDatabase(ctx.tenantId);

    server = await startMockOpenAiCompatibleServer({
      onChatCompletion: (body) => {
        const messagesJson = JSON.stringify(body.messages);
        if (messagesJson.includes("Write a short title")) return { content: JSON.stringify({ title: "Acme-Globex", summary: "Acme and Globex partnered." }) };
        return {
          content: JSON.stringify({
            entities: [
              { name: "Acme Corp", type: "Organization" },
              { name: "Globex Corporation", type: "Organization" },
            ],
            relations: [{ srcName: "Acme Corp", relation: "PARTNERED_WITH", dstName: "Globex Corporation", confidence: 0.9 }],
          }),
        };
      },
      onEmbedding: (body) => {
        const vector = new Array(384).fill(0);
        for (let i = 0; i < body.input.length; i += 1) vector[i % 384] += body.input.charCodeAt(i);
        return { embedding: vector.map((v) => v / 1000) };
      },
    });

    await pinRoute(ctx, "knowledge.extract.retention-test", { baseUrl: server.url, modality: "Text" });
    await pinRoute(ctx, "knowledge.embed.retention-test", { baseUrl: server.url, modality: "Embedding", dimension: 384 });

    const collection = await createCollection(ctx, {
      name: "Retention Governance Test Collection",
      region: ctx.region,
      extractionRouteKey: "knowledge.extract.retention-test",
      embeddingRouteKey: "knowledge.embed.retention-test",
    });

    const locator = await storeUploadAndBuildLocator(ctx, "acme-globex.md", "text/markdown", TEST_DOCUMENT);
    const source = await createSource(ctx, { collectionId: collection.id, kind: "Upload", name: "Acme/Globex test document", locator, acl: { tags: [], visibility: "Tenant" } });

    const generation = await buildGeneration(ctx, collection.id);
    let finalStatus: string = generation.status;
    for (let tick = 0; tick < 60; tick += 1) {
      await pumpIngestionJobs({ maxConcurrentPerTenant: 10, leaseSeconds: 60 });
      const current = await getGenerationOrThrow(ctx, generation.id);
      finalStatus = current.status;
      if (finalStatus === "Ready" || finalStatus === "Failed" || finalStatus === "Cancelled") break;
    }
    expect(finalStatus).toBe("Ready");

    // Real, pre-purge state: chunks and at least one real entity/edge extracted.
    const chunksBefore = await listChunksForGeneration(ctx, generation.id);
    const entitiesBefore = await listEntitiesForGeneration(ctx, generation.id);
    const edgesBefore = await listEdgesForGeneration(ctx, generation.id);
    expect(chunksBefore.length).toBeGreaterThan(0);
    expect(entitiesBefore.length).toBeGreaterThan(0);
    expect(edgesBefore.length).toBeGreaterThan(0);

    // THE real cascade.
    await deleteSource(ctx, source.id);

    // Re-read fresh from Postgres — never trust the in-memory call alone.
    const chunksAfter = await listChunksForGeneration(ctx, generation.id);
    const entitiesAfter = await listEntitiesForGeneration(ctx, generation.id);
    const edgesAfter = await listEdgesForGeneration(ctx, generation.id);
    expect(chunksAfter).toHaveLength(0); // every chunk this (only) source produced is gone
    expect(edgesAfter).toHaveLength(0); // every edge whose sole provenance was one of those chunks is gone
    expect(entitiesAfter).toHaveLength(0); // both entities had no other provenance — genuinely removed

    const purgedSource = await getSourceOrThrow(ctx, source.id);
    expect(purgedSource.status).toBe("Purged");
    expect(purgedSource.purgedAt).toBeTruthy();
  }, 120_000);
});
