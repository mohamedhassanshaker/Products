import { afterEach, describe, expect, it } from "vitest";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import { updateTenantStatus } from "@nextbot/tenancy";
import type { TenantContext } from "@nextbot/db";
import { startMockOpenAiCompatibleServer, type MockOpenAiServerHandle } from "@nextbot/testing";
import { createProviderRegistration, createRoute, createRouteVersion, declareCatalogEntry } from "@nextbot/model-gateway";
import { ensureTenantGraphDatabase, dropTenantGraphDatabase } from "@nextbot/graph-store/provisioning";
import { deriveAclTags } from "./domain/acl.js";
import { createCollection, createSource, storeUploadAndBuildLocator, buildGeneration, getGenerationOrThrow, runBoundedRetrieval } from "./index.js";
import { pumpIngestionJobs } from "./application/pipeline/pump.js";
import { getCollectionOrThrow } from "./infrastructure/collection-repository.js";

/**
 * Target Architecture Blueprint Phase 11 (BL-42, FR-KB-08) — the ACL sub-requirement's
 * own adversarial exit gate: "retrieval filters candidate chunks/entities/edges by the
 * requesting agent's ACL scope BEFORE ranking, never after — a chunk the caller may not
 * see must never influence the ranking of chunks it may see." Proven here against REAL
 * Postgres + a real pgvector index (not mocked ACL filtering) by seeding one collection
 * with two sources — one broadly "Tenant"-visible, one "Restricted" behind a specific
 * tag — and running the identical query through the bounded retrieval agent under TWO
 * different resolved `ResolvedAgentKnowledgeConfig.aclTags` scopes: a low-privilege
 * caller (the Tenant-visibility default only) and a high-privilege caller (also holding
 * the Restricted source's own grant tag). The two runs must produce genuinely different
 * (not merely differently-labelled) result sets against the SAME query/collection/
 * generation.
 */

const PUBLIC_DOCUMENT = `# Public Refund Policy

Refunds are processed within 14 days of a valid return request.
`;

const RESTRICTED_DOCUMENT = `# Confidential Executive Memo

The board privately authorized a confidential acquisition of Initech Holdings for 50 million dollars, pending regulatory approval.
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

describe("FR-KB-08 ACL governance — real per-caller pre-ranking filtering (Postgres + Neo4j + mock model server)", () => {
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

  it("a caller without the Restricted source's grant tag never retrieves it, while a caller WITH that grant does — same query, same collection, same generation", async () => {
    ctx = await createFixtureTenant();
    await updateTenantStatus(ctx.tenantId, "Active");
    await ensureTenantGraphDatabase(ctx.tenantId);

    server = await startMockOpenAiCompatibleServer({
      onChatCompletion: (body) => {
        const messagesJson = JSON.stringify(body.messages);
        if (messagesJson.includes("Write a short title")) {
          return { content: JSON.stringify({ title: "Corporate Documents", summary: "Mixed corporate documents." }) };
        }
        // No entities/relations worth extracting from either fixture document —
        // this test is about chunk-level Vector retrieval's ACL filter, not the graph.
        return { content: JSON.stringify({ entities: [], relations: [] }) };
      },
      onEmbedding: (body) => {
        // A cheap, deterministic embedding: each document's own distinctive
        // vocabulary dominates its vector, so a query mentioning that vocabulary
        // recalls the matching document first when it's not excluded by ACL.
        const vector = new Array(384).fill(0);
        for (let i = 0; i < body.input.length; i += 1) vector[i % 384] += body.input.charCodeAt(i);
        return { embedding: vector.map((v) => v / 1000) };
      },
    });

    await pinRoute(ctx, "knowledge.extract.acl-governance-test", { baseUrl: server.url, modality: "Text" });
    await pinRoute(ctx, "knowledge.embed.acl-governance-test", { baseUrl: server.url, modality: "Embedding", dimension: 384 });
    const answerRoute = await pinRoute(ctx, "chat.primary.acl-governance-test", { baseUrl: server.url, modality: "Text" });

    const collection = await createCollection(ctx, {
      name: "ACL Governance Test Collection",
      region: ctx.region,
      extractionRouteKey: "knowledge.extract.acl-governance-test",
      embeddingRouteKey: "knowledge.embed.acl-governance-test",
    });

    const publicLocator = await storeUploadAndBuildLocator(ctx, "public-refund-policy.md", "text/markdown", PUBLIC_DOCUMENT);
    await createSource(ctx, { collectionId: collection.id, kind: "Upload", name: "Public refund policy", locator: publicLocator, acl: { tags: [], visibility: "Tenant" } });

    const restrictedLocator = await storeUploadAndBuildLocator(ctx, "confidential-memo.md", "text/markdown", RESTRICTED_DOCUMENT);
    await createSource(ctx, {
      collectionId: collection.id,
      kind: "Upload",
      name: "Confidential executive memo",
      locator: restrictedLocator,
      acl: { tags: ["confidential-legal"], visibility: "Restricted" },
    });

    const generation = await buildGeneration(ctx, collection.id);
    let finalStatus: string = generation.status;
    for (let tick = 0; tick < 60; tick += 1) {
      await pumpIngestionJobs({ maxConcurrentPerTenant: 10, leaseSeconds: 60 });
      const current = await getGenerationOrThrow(ctx, generation.id);
      finalStatus = current.status;
      if (finalStatus === "Ready" || finalStatus === "Failed" || finalStatus === "Cancelled") break;
    }
    expect(finalStatus).toBe("Ready");
    const readyCollection = await getCollectionOrThrow(ctx, collection.id);

    const query = "What did the board authorize regarding the confidential acquisition of Initech Holdings?";
    const baseRequest = {
      query,
      plannerRouteVersionId: answerRoute.version.id,
      answerRouteVersionId: answerRoute.version.id,
    };

    // Low-privilege caller: the default any knowledge-scoped agent gets when its own
    // `spec.knowledge.aclScope` declares nothing extra — Tenant-visibility content
    // only, mirroring `retrieval-executor.ts`'s own legacy-config fallback exactly.
    const lowPrivilegeAclTags = deriveAclTags(ctx.tenantId, { visibility: "Tenant", tags: [] });
    const lowPrivilegeResult = await runBoundedRetrieval(ctx, {
      ...baseRequest,
      config: {
        collectionIds: [readyCollection.id],
        strategy: "Vector",
        maxHops: 0,
        maxExpansions: 0,
        minCitations: 0,
        refuseWhenUngrounded: false,
        budget: { usdPerTurn: 1, seconds: 30 },
        aclTags: lowPrivilegeAclTags,
      },
    });

    // High-privilege caller: additionally holds the Restricted source's own grant tag.
    const highPrivilegeAclTags = deriveAclTags(ctx.tenantId, { visibility: "Tenant", tags: ["confidential-legal"] });
    const highPrivilegeResult = await runBoundedRetrieval(ctx, {
      ...baseRequest,
      config: {
        collectionIds: [readyCollection.id],
        strategy: "Vector",
        maxHops: 0,
        maxExpansions: 0,
        minCitations: 0,
        refuseWhenUngrounded: false,
        budget: { usdPerTurn: 1, seconds: 30 },
        aclTags: highPrivilegeAclTags,
      },
    });

    // THE adversarial assertion: the confidential document's own content must never
    // appear anywhere in the low-privilege caller's citations — not merely ranked
    // lower, genuinely absent, because it was excluded BEFORE ranking.
    const lowPrivilegeSnippets = lowPrivilegeResult.citations.map((c) => c.snippet).join(" | ");
    expect(lowPrivilegeSnippets).not.toContain("Initech");
    expect(lowPrivilegeSnippets).not.toContain("confidential acquisition");

    // The high-privilege caller, running the IDENTICAL query against the IDENTICAL
    // generation, genuinely retrieves the Restricted content the low-privilege caller
    // could not — proving this is real per-caller narrowing, not a no-op filter.
    const highPrivilegeSnippets = highPrivilegeResult.citations.map((c) => c.snippet).join(" | ");
    expect(highPrivilegeSnippets).toContain("Initech");

    // And the two callers' own result sets are genuinely different in size/content —
    // never identical, which would indicate the ACL argument was accepted but ignored.
    expect(highPrivilegeResult.citations.map((c) => c.chunkId)).not.toEqual(lowPrivilegeResult.citations.map((c) => c.chunkId));
  }, 120_000);

  it("a caller whose own resolved aclTags is empty (no visibility grant at all) retrieves nothing from either source — fail-closed, not fail-open", async () => {
    ctx = await createFixtureTenant();
    await updateTenantStatus(ctx.tenantId, "Active");
    await ensureTenantGraphDatabase(ctx.tenantId);

    server = await startMockOpenAiCompatibleServer({
      onChatCompletion: () => ({ content: JSON.stringify({ entities: [], relations: [] }) }),
      onEmbedding: (body) => {
        const vector = new Array(384).fill(0);
        for (let i = 0; i < body.input.length; i += 1) vector[i % 384] += body.input.charCodeAt(i);
        return { embedding: vector.map((v) => v / 1000) };
      },
    });

    await pinRoute(ctx, "knowledge.extract.acl-failclosed-test", { baseUrl: server.url, modality: "Text" });
    await pinRoute(ctx, "knowledge.embed.acl-failclosed-test", { baseUrl: server.url, modality: "Embedding", dimension: 384 });
    const answerRoute = await pinRoute(ctx, "chat.primary.acl-failclosed-test", { baseUrl: server.url, modality: "Text" });

    const collection = await createCollection(ctx, {
      name: "ACL Fail-Closed Test Collection",
      region: ctx.region,
      extractionRouteKey: "knowledge.extract.acl-failclosed-test",
      embeddingRouteKey: "knowledge.embed.acl-failclosed-test",
    });

    const locator = await storeUploadAndBuildLocator(ctx, "public-refund-policy.md", "text/markdown", PUBLIC_DOCUMENT);
    await createSource(ctx, { collectionId: collection.id, kind: "Upload", name: "Public refund policy", locator, acl: { tags: [], visibility: "Tenant" } });

    const generation = await buildGeneration(ctx, collection.id);
    let finalStatus: string = generation.status;
    for (let tick = 0; tick < 60; tick += 1) {
      await pumpIngestionJobs({ maxConcurrentPerTenant: 10, leaseSeconds: 60 });
      const current = await getGenerationOrThrow(ctx, generation.id);
      finalStatus = current.status;
      if (finalStatus === "Ready" || finalStatus === "Failed" || finalStatus === "Cancelled") break;
    }
    expect(finalStatus).toBe("Ready");
    const readyCollection = await getCollectionOrThrow(ctx, collection.id);

    const result = await runBoundedRetrieval(ctx, {
      query: "What is the refund window?",
      plannerRouteVersionId: answerRoute.version.id,
      answerRouteVersionId: answerRoute.version.id,
      config: {
        collectionIds: [readyCollection.id],
        strategy: "Vector",
        maxHops: 0,
        maxExpansions: 0,
        minCitations: 0,
        refuseWhenUngrounded: false,
        budget: { usdPerTurn: 1, seconds: 30 },
        aclTags: [], // genuinely no grant at all
      },
    });

    expect(result.citations).toHaveLength(0);
  }, 120_000);
});
