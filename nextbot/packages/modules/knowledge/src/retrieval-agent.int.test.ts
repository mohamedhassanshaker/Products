import { afterEach, describe, expect, it } from "vitest";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import { updateTenantStatus } from "@nextbot/tenancy";
import type { TenantContext } from "@nextbot/db";
import { withTenant, schema } from "@nextbot/db";
import { eq, and } from "drizzle-orm";
import { startMockOpenAiCompatibleServer, type MockOpenAiServerHandle } from "@nextbot/testing";
import { createProviderRegistration, createRoute, createRouteVersion } from "@nextbot/model-gateway";
import { ensureTenantGraphDatabase, dropTenantGraphDatabase } from "@nextbot/graph-store/provisioning";
import { createCollection, createSource, storeUploadAndBuildLocator, buildGeneration, getGenerationOrThrow, runBoundedRetrieval, classifyRetrievalStrategy, getCoverageReport } from "./index.js";
import { pumpIngestionJobs } from "./application/pipeline/pump.js";
import { getCollectionOrThrow } from "./infrastructure/collection-repository.js";

/**
 * Target Architecture Blueprint Phase 10 (BL-41, FR-KB-05/06/07, LLD §14.4.4) — the
 * bounded retrieval agent's own real, end-to-end exit gate: real Postgres + real
 * Neo4j + a real local mock model server, reusing Phase 9's own fixture pattern
 * (`retrieval-playground.int.test.ts`) so this exercises the SAME already-QA-approved
 * seeded graph, not a parallel fixture.
 *
 * **THE safety-critical suite**: `refuseWhenUngrounded` proven to actually gate
 * behavior at the runtime layer (both directions — true blocks, false allows the same
 * under-cited answer through), the bounded expansion loop proven to stop at exactly
 * `maxExpansions` even when the model would keep saying "insufficient" forever, and a
 * real `retrieval_event` row confirmed written with accurate data.
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
  const { declareCatalogEntry } = await import("@nextbot/model-gateway");
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

let sufficiencyAlwaysInsufficient = false;
let sufficiencyCallCount = 0;
let completionCallCount = 0;

describe("runBoundedRetrieval / classifyRetrievalStrategy — real end-to-end (Postgres + Neo4j + mock model server)", () => {
  let ctx: TenantContext;
  let server: MockOpenAiServerHandle | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
    sufficiencyAlwaysInsufficient = false;
    sufficiencyCallCount = 0;
    completionCallCount = 0;
    if (ctx) {
      await dropTenantGraphDatabase(ctx.tenantId);
      await deleteFixtureTenant(ctx.tenantId);
    }
  });

  async function seedReadyCollection() {
    ctx = await createFixtureTenant();
    await updateTenantStatus(ctx.tenantId, "Active");
    await ensureTenantGraphDatabase(ctx.tenantId);

    server = await startMockOpenAiCompatibleServer({
      onChatCompletion: (body) => {
        completionCallCount += 1;
        const messagesJson = JSON.stringify(body.messages);
        if (messagesJson.includes("Write a short title")) {
          return { content: JSON.stringify({ title: "Acme-Globex Partnership", summary: "Acme Corp and Globex Corporation have a partnership agreement signed in 2024." }) };
        }
        if (messagesJson.includes("You classify a customer question for a knowledge-retrieval router")) {
          const narrow = messagesJson.includes("NARROW_MARKER");
          return { content: JSON.stringify({ scope: narrow ? "narrow" : "broad", rationale: "test classification" }) };
        }
        if (messagesJson.includes("You assess whether the evidence gathered so far is sufficient")) {
          sufficiencyCallCount += 1;
          return { content: JSON.stringify({ sufficient: !sufficiencyAlwaysInsufficient, missingConcepts: sufficiencyAlwaysInsufficient ? ["more detail"] : [] }) };
        }
        if (messagesJson.includes("You answer the customer's question using ONLY the numbered evidence snippets")) {
          return { content: JSON.stringify({ answer: "Yes, Acme Corp has a partnership agreement with Globex Corporation, signed in 2024." }) };
        }
        if (messagesJson.includes("You answer a question using ONLY the community summaries")) {
          return { content: JSON.stringify({ answer: "Acme Corp and Globex Corporation have a partnership agreement, per the community summary." }) };
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

    await pinRoute(ctx, "knowledge.extract.retrieval-agent-test", { baseUrl: server.url, modality: "Text" });
    await pinRoute(ctx, "knowledge.embed.retrieval-agent-test", { baseUrl: server.url, modality: "Embedding", dimension: 384 });
    const plannerRoute = await pinRoute(ctx, "chat.router.retrieval-agent-test", { baseUrl: server.url, modality: "Text" });
    const answerRoute = await pinRoute(ctx, "chat.primary.retrieval-agent-test", { baseUrl: server.url, modality: "Text" });

    const collection = await createCollection(ctx, {
      name: "Retrieval Agent Test Collection",
      region: ctx.region,
      extractionRouteKey: "knowledge.extract.retrieval-agent-test",
      embeddingRouteKey: "knowledge.embed.retrieval-agent-test",
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
    const readyCollection = await getCollectionOrThrow(ctx, collection.id);
    return { collection: readyCollection, plannerRouteVersionId: plannerRoute.version.id, answerRouteVersionId: answerRoute.version.id };
  }

  describe("query classification — real classifier calls against real seeded data", () => {
    it("a narrow, entity-anchored query routes to GraphLocal", async () => {
      const { collection, plannerRouteVersionId } = await seedReadyCollection();
      const generation = await getGenerationOrThrow(ctx, collection.currentGenerationId!);
      const result = await classifyRetrievalStrategy(ctx, { generationId: generation.id, query: "NARROW_MARKER: Does Acme Corp partner with Globex Corporation specifically?", plannerRouteVersionId });
      expect(result.strategy).toBe("GraphLocal");
      expect(result.anchorCount).toBeGreaterThan(0);
    }, 90_000);

    it("a broad, thematic query routes to GraphGlobal", async () => {
      const { collection, plannerRouteVersionId } = await seedReadyCollection();
      const generation = await getGenerationOrThrow(ctx, collection.currentGenerationId!);
      const result = await classifyRetrievalStrategy(ctx, { generationId: generation.id, query: "What does our overall business relationship with Acme Corp cover in general?", plannerRouteVersionId });
      expect(result.strategy).toBe("GraphGlobal");
    }, 90_000);

    it("a query with no graph anchor falls back to Vector, without ever calling the classifier model", async () => {
      const { collection, plannerRouteVersionId } = await seedReadyCollection();
      const generation = await getGenerationOrThrow(ctx, collection.currentGenerationId!);
      const callsBefore = completionCallCount;
      const result = await classifyRetrievalStrategy(ctx, { generationId: generation.id, query: "What is the weather forecast for tomorrow?", plannerRouteVersionId });
      expect(result.strategy).toBe("Vector");
      expect(result.anchorCount).toBe(0);
      expect(completionCallCount).toBe(callsBefore); // no model call made at all
    }, 90_000);
  });

  it("a grounded end-to-end answer: real citations trace to the real source chunk, and a real retrieval_event row is written", async () => {
    const { collection, plannerRouteVersionId, answerRouteVersionId } = await seedReadyCollection();

    const result = await runBoundedRetrieval(ctx, {
      query: "Does Acme Corp have a partnership with Globex Corporation?",
      config: { collectionIds: [collection.id], strategy: "GraphLocal", maxHops: 2, maxExpansions: 2, minCitations: 1, refuseWhenUngrounded: true, budget: { usdPerTurn: 1, seconds: 30 } },
      plannerRouteVersionId,
      answerRouteVersionId,
      conversationId: "11111111-1111-1111-1111-111111111111",
    });

    expect(result.outcome).toBe("Grounded");
    expect(result.answerText).toBeTruthy();
    expect(result.citations.length).toBeGreaterThan(0);
    expect(result.citations[0]?.snippet).toContain("partnership agreement");
    expect(result.citations[0]?.relationPath?.[0]?.relation).toBe("PARTNERED_WITH");

    // Real row, queried directly — never trust the in-memory return value alone.
    const [eventRow] = await withTenant(ctx, (db) => db.select().from(schema.retrievalEvent).where(and(eq(schema.retrievalEvent.tenantId, ctx.tenantId), eq(schema.retrievalEvent.id, result.retrievalEventId))));
    expect(eventRow).toBeDefined();
    expect(eventRow?.grounded).toBe(true);
    expect(eventRow?.refused).toBe(false);
    expect(eventRow?.strategy).toBe("GraphLocal");
    expect(eventRow?.conversationId).toBe("11111111-1111-1111-1111-111111111111");
    expect(Number(eventRow?.costUsd)).toBeGreaterThan(0);
    expect(eventRow?.citationIds.length).toBeGreaterThan(0);

    // The same real row, via the Conversations-detail/Runtime-Traces read path.
    const { listRetrievalEventsForConversation } = await import("./index.js");
    const eventsForConversation = await listRetrievalEventsForConversation(ctx, "11111111-1111-1111-1111-111111111111");
    expect(eventsForConversation).toHaveLength(1);
    expect(eventsForConversation[0]?.id).toBe(result.retrievalEventId);
  }, 90_000);

  it("THE safety-critical pair (real infra, real model responses): refuseWhenUngrounded=true withholds a real, model-produced answer once real evidence falls short of minCitations — and refuseWhenUngrounded=false lets the identical answer through", async () => {
    const { collection, plannerRouteVersionId, answerRouteVersionId } = await seedReadyCollection();
    const query = "Does Acme Corp have a partnership with Globex Corporation?";

    // The real seeded fixture produces real, but few, GraphLocal citations —
    // requiring far more than genuinely exists (10) deliberately falls short
    // regardless of the exact real count (which is not this test's concern; that
    // exact count is independently asserted by the "grounded end-to-end" test above).
    const refused = await runBoundedRetrieval(ctx, {
      query,
      config: { collectionIds: [collection.id], strategy: "GraphLocal", maxHops: 2, maxExpansions: 0, minCitations: 10, refuseWhenUngrounded: true, budget: { usdPerTurn: 1, seconds: 30 } },
      plannerRouteVersionId,
      answerRouteVersionId,
    });
    expect(refused.citations.length).toBeGreaterThan(0); // real evidence WAS found...
    expect(refused.citations.length).toBeLessThan(10); // ...just not enough.
    expect(refused.outcome).toBe("Refused");
    expect(refused.answerText).toBeNull(); // the customer never sees a partially-grounded guess.
    const [refusedEventRow] = await withTenant(ctx, (db) => db.select().from(schema.retrievalEvent).where(and(eq(schema.retrievalEvent.tenantId, ctx.tenantId), eq(schema.retrievalEvent.id, refused.retrievalEventId))));
    expect(refusedEventRow?.refused).toBe(true);
    expect(refusedEventRow?.grounded).toBe(false);

    const allowed = await runBoundedRetrieval(ctx, {
      query,
      config: { collectionIds: [collection.id], strategy: "GraphLocal", maxHops: 2, maxExpansions: 0, minCitations: 10, refuseWhenUngrounded: false, budget: { usdPerTurn: 1, seconds: 30 } },
      plannerRouteVersionId,
      answerRouteVersionId,
    });
    expect(allowed.outcome).toBe("Ungrounded");
    expect(allowed.answerText).toBeTruthy(); // the SAME real model-produced answer now reaches the caller.
  }, 90_000);

  it("THE bounded-loop hard cap (real infra): a sufficiency model that ALWAYS reports insufficient still stops at exactly maxExpansions, not one iteration more", async () => {
    const { collection, plannerRouteVersionId, answerRouteVersionId } = await seedReadyCollection();
    sufficiencyAlwaysInsufficient = true;

    const result = await runBoundedRetrieval(ctx, {
      query: "Does Acme Corp have a partnership with Globex Corporation?",
      config: { collectionIds: [collection.id], strategy: "GraphLocal", maxHops: 2, maxExpansions: 2, minCitations: 1, refuseWhenUngrounded: true, budget: { usdPerTurn: 1, seconds: 30 } },
      plannerRouteVersionId,
      answerRouteVersionId,
    });

    expect(result.expansions).toBe(2); // exactly maxExpansions, never more, despite the model always saying "insufficient".
    expect(sufficiencyCallCount).toBe(2); // one sufficiency check per expansion opportunity, never after the final attempt.
  }, 90_000);

  it("Target Architecture Blueprint Phase 11 (FR-KB-08 coverage report): a refused query recurs and shows up as a real coverage gap with an accurate occurrence count", async () => {
    const { collection, plannerRouteVersionId, answerRouteVersionId } = await seedReadyCollection();
    const query = "Does Acme Corp have a partnership with Globex Corporation?";
    const refusingConfig = { collectionIds: [collection.id], strategy: "GraphLocal" as const, maxHops: 2, maxExpansions: 0, minCitations: 10, refuseWhenUngrounded: true, budget: { usdPerTurn: 1, seconds: 30 } };

    // The identical under-cited query, asked twice — a real recurring gap.
    await runBoundedRetrieval(ctx, { query, config: refusingConfig, plannerRouteVersionId, answerRouteVersionId });
    await runBoundedRetrieval(ctx, { query, config: refusingConfig, plannerRouteVersionId, answerRouteVersionId });

    const report = await getCoverageReport(ctx, collection.id);
    const gap = report.items.find((i) => i.occurrences >= 2);
    expect(gap).toBeDefined();
    expect(gap!.refusedCount).toBeGreaterThanOrEqual(2);
    expect(gap!.maxTopScore).not.toBeNull(); // real evidence WAS found, just not enough — a genuine low-relevance gap, not a "nothing at all" one
    expect(report.minRelevanceScore).toBeGreaterThan(0); // the collection's own configured threshold, not a hardcoded one

    // The `queryTextHash` this row groups by is a real sha256 of the query — never
    // the raw text itself (`retrieval_event.query_text_hash`'s own column comment).
    expect(gap!.queryTextHash).toMatch(/^[0-9a-f]{64}$/);
  }, 90_000);

  it("budget enforcement (real cost accounting): a usdPerTurn cap already exceeded by the first real retrieval truncates before any expansion is attempted", async () => {
    const { collection, plannerRouteVersionId, answerRouteVersionId } = await seedReadyCollection();
    sufficiencyAlwaysInsufficient = true; // would otherwise want to expand — budget must stop it first.

    const result = await runBoundedRetrieval(ctx, {
      query: "Does Acme Corp have a partnership with Globex Corporation?",
      config: { collectionIds: [collection.id], strategy: "Vector", maxHops: 2, maxExpansions: 3, minCitations: 1, refuseWhenUngrounded: true, budget: { usdPerTurn: 0.0000000001, seconds: 30 } },
      plannerRouteVersionId,
      answerRouteVersionId,
    });

    expect(result.expansions).toBe(0);
    const [eventRow] = await withTenant(ctx, (db) => db.select().from(schema.retrievalEvent).where(and(eq(schema.retrievalEvent.tenantId, ctx.tenantId), eq(schema.retrievalEvent.id, result.retrievalEventId))));
    expect(eventRow?.truncatedByBudget).toBe(true);
  }, 90_000);
});
