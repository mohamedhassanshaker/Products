import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import type { TenantContext } from "@nextbot/db";
import { updateTenantStatus } from "@nextbot/tenancy";
import { startMockOpenAiCompatibleServer, type MockOpenAiServerHandle } from "@nextbot/testing";
import { createProviderRegistration, createRoute, createRouteVersion, declareCatalogEntry } from "@nextbot/model-gateway";
import { ensureTenantGraphDatabase, dropTenantGraphDatabase } from "@nextbot/graph-store/provisioning";
import { createCollection, createSource, buildGeneration, getSourceOrThrow } from "./index.js";
import { pumpIngestionJobs } from "./application/pipeline/pump.js";

async function pinRoute(ctx: TenantContext, routeKey: string, opts: { baseUrl: string; modality: "Text" | "Embedding"; dimension?: number }) {
  const provider = await createProviderRegistration(ctx, { type: "openai-compatible", name: `Provider for ${routeKey}`, baseUrl: opts.baseUrl, region: ctx.region, retainsPrompts: false, trainsOnData: false });
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
  await createRouteVersion(ctx, route.id, { chain: [{ ordinal: 0, providerId: provider.id, catalogEntryId: entry.id, params: {}, timeoutMs: 30000 }], policy: { strategy: "FixedPriority", failoverOn: ["429", "5xx", "timeout"], retry: { maxPerHop: 1, backoff: "exponential" }, totalTimeoutMs: 30000, cacheMode: "Off", onBudgetBreach: "Fail", allowOutOfRegionFailover: false } }, true);
}

/** Ticks the pump until the source reaches a terminal status (or `maxTicks` is
 *  exhausted) — a single tick is USUALLY enough since Ingest is this source's
 *  only job, but `pumpIngestionJobs()` also processes every OTHER active
 *  tenant's jobs in the same call (concurrently-running test files' fixture
 *  tenants included), so under real resource contention (e.g. coverage
 *  instrumentation slowing every DB/HTTP round trip) more than one tick may
 *  genuinely be needed — this loop is the same robust pattern the pipeline e2e
 *  and governance tests already use, just for a single-source case. */
async function driveSourceToTerminal(ctx: TenantContext, sourceId: string, maxTicks = 15): Promise<Awaited<ReturnType<typeof getSourceOrThrow>>> {
  let source = await getSourceOrThrow(ctx, sourceId);
  for (let i = 0; i < maxTicks && !["Synced", "PartiallyFailed", "Failed", "Purged"].includes(source.status); i += 1) {
    await pumpIngestionJobs({ maxConcurrentPerTenant: 10, leaseSeconds: 60 });
    source = await getSourceOrThrow(ctx, sourceId);
  }
  return source;
}

async function startPlainHttpServer(content: string): Promise<{ url: string; close: () => Promise<void> }> {
  const server: Server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end(content);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return { url: `http://127.0.0.1:${port}`, close: () => new Promise((resolve) => server.close(() => resolve())) };
}

describe("Knowledge source kinds — Ingest stage real fetch behavior per kind (FR-KB-01/02)", () => {
  let ctx: TenantContext;
  let server: MockOpenAiServerHandle | undefined;
  let plainServer: { url: string; close: () => Promise<void> } | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
    await plainServer?.close();
    plainServer = undefined;
    if (ctx) {
      await dropTenantGraphDatabase(ctx.tenantId);
      await deleteFixtureTenant(ctx.tenantId);
    }
  });

  async function setUpCollection(): Promise<{ collectionId: string }> {
    ctx = await createFixtureTenant();
    await updateTenantStatus(ctx.tenantId, "Active");
    await ensureTenantGraphDatabase(ctx.tenantId);
    server = await startMockOpenAiCompatibleServer({ onChatCompletion: () => ({ content: JSON.stringify({ entities: [], relations: [] }) }), onEmbedding: () => ({ embedding: Array.from({ length: 384 }, () => 0.1) }) });
    await pinRoute(ctx, "knowledge.extract.kinds", { baseUrl: server.url, modality: "Text" });
    await pinRoute(ctx, "knowledge.embed.kinds", { baseUrl: server.url, modality: "Embedding", dimension: 384 });
    const collection = await createCollection(ctx, { name: "Source Kinds Test Collection", region: ctx.region, extractionRouteKey: "knowledge.extract.kinds", embeddingRouteKey: "knowledge.embed.kinds" });
    return { collectionId: collection.id };
  }

  it("a real Url source is fetched successfully at Ingest time", async () => {
    const { collectionId } = await setUpCollection();
    plainServer = await startPlainHttpServer("Real fetched content from a live URL.");
    const source = await createSource(ctx, {
      collectionId,
      kind: "Url",
      name: "A real page",
      locator: { kind: "Url", url: plainServer.url, crawlDepth: 0, includePatterns: [], excludePatterns: [], respectRobots: true },
      acl: { tags: [], visibility: "Tenant" },
    });

    await buildGeneration(ctx, collectionId);
    const refreshed = await driveSourceToTerminal(ctx, source.id);
    expect(refreshed.status).toBe("Synced");
    expect(refreshed.documentCount).toBe(1);
    expect(refreshed.failedDocumentCount).toBe(0);
  }, 30_000);

  it("a Url source whose fetch fails (unreachable) records a real per-document failure without blocking the collection", async () => {
    const { collectionId } = await setUpCollection();
    const source = await createSource(ctx, {
      collectionId,
      kind: "Url",
      name: "An unreachable page",
      locator: { kind: "Url", url: "http://127.0.0.1:1", crawlDepth: 0, includePatterns: [], excludePatterns: [], respectRobots: true }, // port 1 — nothing listens there
      acl: { tags: [], visibility: "Tenant" },
    });

    await buildGeneration(ctx, collectionId);
    const refreshed = await driveSourceToTerminal(ctx, source.id);
    expect(refreshed.status).toBe("Failed");
    expect(refreshed.failedDocumentCount).toBe(1);
    expect(refreshed.failures?.[0]?.code).toBe("URL_FETCH_FAILED");
  }, 30_000);

  it("an McpResource source (not yet integrated for real content fetch this phase) records SOURCE_KIND_NOT_YET_INTEGRATED, without blocking the collection", async () => {
    const { collectionId } = await setUpCollection();
    const source = await createSource(ctx, {
      collectionId,
      kind: "McpResource",
      name: "An MCP resource",
      locator: { kind: "McpResource", mcpManifestItemId: "m1", mcpServerVersionId: "v1", uri: "res://doc" },
      acl: { tags: [], visibility: "Tenant" },
    });

    await buildGeneration(ctx, collectionId);
    const refreshed = await driveSourceToTerminal(ctx, source.id);
    expect(refreshed.status).toBe("Failed");
    expect(refreshed.failures?.[0]?.code).toBe("SOURCE_KIND_NOT_YET_INTEGRATED");
  }, 30_000);
});
