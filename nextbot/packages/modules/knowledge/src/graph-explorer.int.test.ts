import { afterEach, describe, expect, it } from "vitest";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import { updateTenantStatus } from "@nextbot/tenancy";
import type { TenantContext } from "@nextbot/db";
import { startMockOpenAiCompatibleServer, type MockOpenAiServerHandle } from "@nextbot/testing";
import { createProviderRegistration, createRoute, createRouteVersion, declareCatalogEntry } from "@nextbot/model-gateway";
import { ensureTenantGraphDatabase, dropTenantGraphDatabase } from "@nextbot/graph-store/provisioning";
import { GraphEntityNotFoundError, GraphCommunityNotFoundError, KnowledgeChunkNotFoundError } from "@nextbot/contracts";
import {
  createCollection,
  createSource,
  storeUploadAndBuildLocator,
  buildGeneration,
  getGenerationOrThrow,
  listGraphEntities,
  getGraphEntityDetail,
  listGraphCommunities,
  getGraphCommunityDetail,
  getChunkDetail,
} from "./index.js";
import { pumpIngestionJobs } from "./application/pipeline/pump.js";

/**
 * Target Architecture Blueprint Phase 8 (BL-39, FR-KB-04, LLD §14.4.5) — the Graph
 * Explorer's own real end-to-end verification. Drives the SAME real 9-stage
 * pipeline `pipeline-e2e.int.test.ts` (Phase 7b) already proved produces a real,
 * queryable graph, then exercises Phase 8's read-only application layer against
 * that real seeded data — real Postgres, real HTTP round trips to a local mock
 * model server, zero mocks inside the module boundary. This is the phase's own
 * explicit exit-gate requirement: "a live check against a Phase 7 seeded graph
 * shows correct entity/relation/community rendering and provenance drill-down."
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

describe("Graph Explorer (Phase 8, FR-KB-04) — real Postgres, real seeded graph data", () => {
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

  /** Ingests `TEST_DOCUMENT` through the real 9-stage pipeline and returns the
   *  Ready generation id + collection id, so each test below only has to describe
   *  what it asserts against the resulting real graph. */
  async function seedRealGeneration(): Promise<{ generationId: string; collectionId: string }> {
    ctx = await createFixtureTenant();
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
      onEmbedding: (body) => {
        const vector = new Array(384).fill(0);
        for (let i = 0; i < body.input.length; i += 1) vector[i % 384] += body.input.charCodeAt(i);
        return { embedding: vector.map((v) => v / 1000) };
      },
    });

    await pinRoute(ctx, "knowledge.extract.explorer", { baseUrl: server.url, modality: "Text" });
    await pinRoute(ctx, "knowledge.embed.explorer", { baseUrl: server.url, modality: "Embedding", dimension: 384 });

    const collection = await createCollection(ctx, {
      name: "Explorer Test Collection",
      region: ctx.region,
      extractionRouteKey: "knowledge.extract.explorer",
      embeddingRouteKey: "knowledge.embed.explorer",
    });

    const locator = await storeUploadAndBuildLocator(ctx, "acme-globex.md", "text/markdown", TEST_DOCUMENT);
    await createSource(ctx, { collectionId: collection.id, kind: "Upload", name: "Acme/Globex test document", locator, acl: { tags: ["public"], visibility: "Tenant" } });

    const generation = await buildGeneration(ctx, collection.id);

    let finalStatus: string = generation.status;
    for (let tick = 0; tick < 60; tick += 1) {
      await pumpIngestionJobs({ maxConcurrentPerTenant: 10, leaseSeconds: 60 });
      const current = await getGenerationOrThrow(ctx, generation.id);
      finalStatus = current.status;
      if (finalStatus === "Ready" || finalStatus === "Failed" || finalStatus === "Cancelled") break;
    }
    expect(finalStatus).toBe("Ready");
    return { generationId: generation.id, collectionId: collection.id };
  }

  it("lists real entities with correct type/summary/community, and paginates via keyset cursor", async () => {
    const { generationId } = await seedRealGeneration();

    const page1 = await listGraphEntities(ctx, generationId, { limit: 1 });
    expect(page1.entities).toHaveLength(1);
    expect(page1.nextCursor).not.toBeNull();
    // Both real entities are Organizations, each with real degree > 0 and a real
    // community assignment (the pipeline's own community-detection stage ran).
    expect(page1.entities[0]!.type).toBe("Organization");
    expect(page1.entities[0]!.degree).toBeGreaterThan(0);
    expect(page1.entities[0]!.communityId).toBeTruthy();
    expect(page1.entities[0]!.communityTitle).toBe("Acme-Globex Partnership");

    const page2 = await listGraphEntities(ctx, generationId, { limit: 1, cursor: page1.nextCursor! });
    expect(page2.entities).toHaveLength(1);
    expect(page2.entities[0]!.id).not.toBe(page1.entities[0]!.id);
    expect(page2.nextCursor).toBeNull(); // exactly 2 entities exist — second page is the last

    const names = [page1.entities[0]!.canonicalName, page2.entities[0]!.canonicalName].sort();
    expect(names).toEqual(["acme corp", "globex corporation"]);

    // Filters narrow correctly against real data.
    const filteredByQ = await listGraphEntities(ctx, generationId, { q: "acme", limit: 50 });
    expect(filteredByQ.entities).toHaveLength(1);
    expect(filteredByQ.entities[0]!.canonicalName).toBe("acme corp");

    const filteredByMinDegree = await listGraphEntities(ctx, generationId, { minDegree: 9999, limit: 50 });
    expect(filteredByMinDegree.entities).toHaveLength(0);
  }, 60_000);

  it("FR-KB-04 CRITICAL PATH: an entity's relations carry real provenance that resolves to the actual source chunk TEXT — the sentence that produced the edge, not merely a chunk id", async () => {
    const { generationId } = await seedRealGeneration();

    const { entities } = await listGraphEntities(ctx, generationId, { q: "acme", limit: 1 });
    const acme = entities[0]!;

    const detail = await getGraphEntityDetail(ctx, generationId, acme.id);
    expect(detail.entity.canonicalName).toBe("acme corp");
    expect(detail.relations.length).toBeGreaterThan(0);

    const partneredWith = detail.relations.find((r) => r.relation === "PARTNERED_WITH");
    expect(partneredWith).toBeDefined();
    expect(partneredWith!.direction).toBe("outgoing");
    expect(partneredWith!.otherEntity.canonicalName).toBe("globex corporation");
    expect(partneredWith!.provenance.chunkId).toBeTruthy();

    // The drill-down itself: follow the provenance chunk id to the REAL chunk text.
    const chunk = await getChunkDetail(ctx, partneredWith!.provenance.chunkId);
    expect(chunk.text).toContain("partnership agreement");
    expect(chunk.text).toContain("Globex Corporation");
    expect(chunk.documentTitle).toBeTruthy();
    expect(chunk.sourceName).toBe("Acme/Globex test document");
    expect(chunk.generationId).toBe(generationId);
  }, 60_000);

  it("communities view: entities grouped by community with the community's own generated summary visible", async () => {
    const { generationId } = await seedRealGeneration();

    const communities = await listGraphCommunities(ctx, generationId);
    expect(communities.length).toBeGreaterThan(0);
    const community = communities[0]!;
    expect(community.title).toBe("Acme-Globex Partnership");
    expect(community.summary).toBe("Acme Corp and Globex Corporation have a partnership.");

    const detail = await getGraphCommunityDetail(ctx, generationId, community.id);
    expect(detail.community.id).toBe(community.id);
    const memberNames = detail.members.map((m) => m.canonicalName).sort();
    expect(memberNames).toEqual(["acme corp", "globex corporation"]);
  }, 60_000);

  it("boundary: an entity with a real relation still 404s cleanly when looked up under the WRONG generation id", async () => {
    const { generationId } = await seedRealGeneration();
    const { entities } = await listGraphEntities(ctx, generationId, { q: "acme", limit: 1 });
    const acme = entities[0]!;

    await expect(getGraphEntityDetail(ctx, "00000000-0000-0000-0000-000000000000", acme.id)).rejects.toThrow();
    // A syntactically-valid but non-existent entity id 404s as GraphEntityNotFoundError.
    await expect(getGraphEntityDetail(ctx, generationId, "00000000-0000-0000-0000-000000000000")).rejects.toThrow(GraphEntityNotFoundError);
  }, 60_000);

  it("boundary: a non-existent community/chunk id 404s with the correct domain error, never a silent empty result", async () => {
    const { generationId } = await seedRealGeneration();
    await expect(getGraphCommunityDetail(ctx, generationId, "00000000-0000-0000-0000-000000000000")).rejects.toThrow(GraphCommunityNotFoundError);
    await expect(getChunkDetail(ctx, "00000000-0000-0000-0000-000000000000")).rejects.toThrow(KnowledgeChunkNotFoundError);
  }, 60_000);
});
