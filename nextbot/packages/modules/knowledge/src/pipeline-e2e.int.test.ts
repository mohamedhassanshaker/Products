import { afterEach, describe, expect, it } from "vitest";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import { updateTenantStatus } from "@nextbot/tenancy";
import type { TenantContext } from "@nextbot/db";
import { startMockOpenAiCompatibleServer, type MockOpenAiServerHandle } from "@nextbot/testing";
import { createProviderRegistration, createRoute, createRouteVersion, declareCatalogEntry } from "@nextbot/model-gateway";
import { ensureTenantGraphDatabase, dropTenantGraphDatabase } from "@nextbot/graph-store/provisioning";
import { Neo4jGraphStore, type GraphScope } from "@nextbot/graph-store";
import {
  createCollection,
  createSource,
  storeUploadAndBuildLocator,
  buildGeneration,
  getGenerationOrThrow,
  listEntitiesForGeneration,
  listEdgesForGeneration,
  getCollectionOrThrow,
} from "./index.js";
import { pumpIngestionJobs } from "./application/pipeline/pump.js";
import { listChunksForGeneration } from "./infrastructure/document-chunk-repository.js";
import { countEmbeddingsForGeneration } from "./infrastructure/embedding-table.js";

/**
 * Target Architecture Blueprint Phase 7b (BL-38) — the plan's own explicit 7b
 * exit-gate requirement: a real (small) test document ingested through ALL 9
 * stages, producing a real queryable graph — real entities/edges in Neo4j, real
 * chunks/embeddings in Postgres — for a seeded tenant. Every model call goes
 * through a REAL HTTP round trip to a local mock OpenAI-compatible server (never a
 * mock at the knowledge-module-internal service layer); the graph store side is a
 * REAL Neo4j database via `@nextbot/graph-store`'s real primitives.
 */

const TEST_DOCUMENT = `# Acme Corp

Acme Corp signed a partnership agreement with Globex Corporation in 2024. Acme Corp is headquartered in Springfield.

| Product | Price |
| --- | --- |
| Widget | 9.99 |
| Gadget | 19.99 |
`;

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

describe("Knowledge ingestion pipeline — real end-to-end (9 stages, real Postgres + real Neo4j + real HTTP model calls)", () => {
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

  it("ingests a real document through all 9 stages and produces a real, queryable graph", async () => {
    ctx = await createFixtureTenant();
    // `createFixtureTenant()` leaves `tenant.status` at its schema default
    // ("Trial") — the ingestion pump only processes `Active` tenants
    // (`listActiveTenantContexts()`), same as a real tenant only starts getting
    // swept once `provisionTenant()`'s own explicit Active stamp lands. Flip it
    // here so this test exercises the real pump exactly as it runs in production.
    await updateTenantStatus(ctx.tenantId, "Active");
    await ensureTenantGraphDatabase(ctx.tenantId);

    server = await startMockOpenAiCompatibleServer({
      onChatCompletion: (body) => {
        const isCommunitySummaryCall = JSON.stringify(body.messages).includes("Write a short title");
        if (isCommunitySummaryCall) {
          return { content: JSON.stringify({ title: "Acme-Globex Partnership", summary: "Acme Corp and Globex Corporation have a partnership." }) };
        }
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
      // A deterministic, INPUT-SENSITIVE fake embedding (never a fixed constant
      // vector) — two different names must NOT collide onto the same vector, or
      // the real Resolve-stage auto-merge logic would (correctly, given identical
      // embeddings) incorrectly merge two genuinely distinct entities. This is
      // exactly the kind of real bug a naive "always return [0.1, 0.1, ...]" mock
      // would mask.
      onEmbedding: (body) => {
        const vector = new Array(384).fill(0);
        for (let i = 0; i < body.input.length; i += 1) {
          vector[i % 384] += body.input.charCodeAt(i);
        }
        return { embedding: vector.map((v) => v / 1000) };
      },
    });

    await pinRoute(ctx, "knowledge.extract.e2e", { baseUrl: server.url, modality: "Text" });
    await pinRoute(ctx, "knowledge.embed.e2e", { baseUrl: server.url, modality: "Embedding", dimension: 384 });

    const collection = await createCollection(ctx, {
      name: "E2E Test Collection",
      region: ctx.region,
      extractionRouteKey: "knowledge.extract.e2e",
      embeddingRouteKey: "knowledge.embed.e2e",
    });

    const locator = await storeUploadAndBuildLocator(ctx, "acme-globex.md", "text/markdown", TEST_DOCUMENT);
    await createSource(ctx, {
      collectionId: collection.id,
      kind: "Upload",
      name: "Acme/Globex test document",
      locator,
      acl: { tags: ["public"], visibility: "Tenant" },
    });

    const generation = await buildGeneration(ctx, collection.id);
    expect(generation.dimension).toBe(384);

    // Drive the pump directly (real function, real DB, real HTTP, real Neo4j) —
    // each tick advances the pipeline by one stage layer (a stage's completion
    // enqueues the next stage as a new Queued row the NEXT tick picks up).
    let finalStatus: string = generation.status;
    for (let tick = 0; tick < 60; tick += 1) {
      await pumpIngestionJobs({ maxConcurrentPerTenant: 10, leaseSeconds: 60 });
      const current = await getGenerationOrThrow(ctx, generation.id);
      finalStatus = current.status;
      if (finalStatus === "Ready" || finalStatus === "Failed" || finalStatus === "Cancelled") break;
    }
    expect(finalStatus).toBe("Ready");

    // The collection now points at this generation as current, and is Ready.
    const finalCollection = await getCollectionOrThrow(ctx, collection.id);
    expect(finalCollection.currentGenerationId).toBe(generation.id);
    expect(finalCollection.status).toBe("Ready");

    // Real chunks in Postgres — including the table preserved as its own
    // structured chunk (FR-KB-02).
    const chunks = await listChunksForGeneration(ctx, generation.id);
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.some((c) => c.text.includes("Widget"))).toBe(true);

    // Real entities/edges in Postgres, resolved+deduped across the document's
    // multiple chunks (Acme Corp appears in both the text and — via the mock's
    // fixed response — the table chunk's extraction call too, so a real dedup
    // collapse genuinely happened if there's exactly one Acme Corp entity).
    const entities = await listEntitiesForGeneration(ctx, generation.id);
    const acmeEntities = entities.filter((e) => e.canonicalName === "acme corp");
    expect(acmeEntities).toHaveLength(1);
    expect(entities.some((e) => e.canonicalName === "globex corporation")).toBe(true);

    const edges = await listEdgesForGeneration(ctx, generation.id);
    expect(acmeEntities[0]?.degree).toBeGreaterThan(0);
    expect(edges.length).toBeGreaterThan(0);
    expect(edges.some((e) => e.relation === "PARTNERED_WITH")).toBe(true);
    // Every edge traces to a real provenance chunk (FR-KB-04).
    for (const edge of edges) expect(edge.provenanceChunkId).toBeTruthy();

    // Real embeddings in the real knowledge_embedding_d384 table.
    const embeddingCount = await countEmbeddingsForGeneration(ctx, 384, generation.id);
    expect(embeddingCount).toBeGreaterThan(0);

    // The graph is REAL and QUERYABLE in Neo4j — not just Postgres bookkeeping.
    // Query it via the real GraphStorePort, through withTenantGraph() internally.
    const graphStore = new Neo4jGraphStore();
    const scope: GraphScope = { tenantId: ctx.tenantId, generationId: generation.graphGenerationLabel };
    const acmeEntity = acmeEntities[0]!;
    const neighbourhood = await graphStore.neighbourhood(scope, { anchorNodeIds: [acmeEntity.id], maxHops: 1, maxNodes: 100, aclTags: acmeEntity.aclTags });
    expect(neighbourhood.nodeIds).toContain(acmeEntity.id);
    expect(neighbourhood.edgeIds.length).toBeGreaterThan(0);

    const degrees = await graphStore.degrees(scope, [acmeEntity.id]);
    expect(degrees[acmeEntity.id]).toBeGreaterThan(0);
  }, 60_000);
});
