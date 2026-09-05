import { afterEach, describe, expect, it } from "vitest";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import { updateTenantStatus } from "@nextbot/tenancy";
import type { TenantContext } from "@nextbot/db";
import { setPiiPolicy } from "@nextbot/pii";
import { startMockOpenAiCompatibleServer, type MockOpenAiServerHandle } from "@nextbot/testing";
import { createProviderRegistration, createRoute, createRouteVersion, declareCatalogEntry } from "@nextbot/model-gateway";
import { ensureTenantGraphDatabase, dropTenantGraphDatabase } from "@nextbot/graph-store/provisioning";
import { createCollection, createSource, storeUploadAndBuildLocator, buildGeneration, getGenerationOrThrow, getChunkDetail } from "./index.js";
import { pumpIngestionJobs } from "./application/pipeline/pump.js";
import { listChunksForGeneration } from "./infrastructure/document-chunk-repository.js";

/**
 * Target Architecture Blueprint Phase 11 (BL-42, FR-KB-08) — the PII sub-
 * requirement's own adversarial exit gate: "detected entities are masked at index
 * time per the collection's trust level, and re-evaluated at read time against the
 * requesting agent's trust level (so the same indexed chunk can render differently
 * masked to different callers)." Proven end-to-end against real Postgres and the
 * real (local-disk) object store — no mocked masking.
 */

const DOCUMENT_WITH_EMAIL = `# Support Contact

For account issues, please contact John Smith at john.smith@example.com directly.
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

describe("FR-KB-08 PII governance — index-time masking + read-time re-evaluation (Postgres + real object store)", () => {
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

  it("masks an email at index time per the collection's SemiTrusted level, then shows it unmasked to a Trusted caller and re-masked to a SemiTrusted/Untrusted caller — same chunk, different callers", async () => {
    ctx = await createFixtureTenant();
    await updateTenantStatus(ctx.tenantId, "Active");
    await ensureTenantGraphDatabase(ctx.tenantId);

    // The masking-context matrix (FR-SEC-04): a SemiTrusted/Untrusted reader gets a
    // full mask, a Trusted reader sees the real value. Configured BEFORE ingestion so
    // index-time masking (SemiTrusted, the collection's own configured level) already
    // reflects this fail-closed default.
    await setPiiPolicy(ctx, "Email", "Knowledge", "SemiTrusted", "FullMask");
    await setPiiPolicy(ctx, "Email", "Knowledge", "Untrusted", "FullMask");
    await setPiiPolicy(ctx, "Email", "Knowledge", "Trusted", "Show");

    server = await startMockOpenAiCompatibleServer({
      onChatCompletion: (body) => {
        const messagesJson = JSON.stringify(body.messages);
        if (messagesJson.includes("Write a short title")) return { content: JSON.stringify({ title: "Support Docs", summary: "Support contact info." }) };
        return { content: JSON.stringify({ entities: [], relations: [] }) };
      },
      onEmbedding: (body) => {
        const vector = new Array(384).fill(0);
        for (let i = 0; i < body.input.length; i += 1) vector[i % 384] += body.input.charCodeAt(i);
        return { embedding: vector.map((v) => v / 1000) };
      },
    });

    await pinRoute(ctx, "knowledge.extract.pii-governance-test", { baseUrl: server.url, modality: "Text" });
    await pinRoute(ctx, "knowledge.embed.pii-governance-test", { baseUrl: server.url, modality: "Embedding", dimension: 384 });

    const collection = await createCollection(ctx, {
      name: "PII Governance Test Collection",
      region: ctx.region,
      trustLevel: "SemiTrusted",
      extractionRouteKey: "knowledge.extract.pii-governance-test",
      embeddingRouteKey: "knowledge.embed.pii-governance-test",
    });

    const locator = await storeUploadAndBuildLocator(ctx, "support-contact.md", "text/markdown", DOCUMENT_WITH_EMAIL);
    await createSource(ctx, { collectionId: collection.id, kind: "Upload", name: "Support contact doc", locator, acl: { tags: [], visibility: "Tenant" } });

    const generation = await buildGeneration(ctx, collection.id);
    let finalStatus: string = generation.status;
    for (let tick = 0; tick < 60; tick += 1) {
      await pumpIngestionJobs({ maxConcurrentPerTenant: 10, leaseSeconds: 60 });
      const current = await getGenerationOrThrow(ctx, generation.id);
      finalStatus = current.status;
      if (finalStatus === "Ready" || finalStatus === "Failed" || finalStatus === "Cancelled") break;
    }
    expect(finalStatus).toBe("Ready");

    const chunks = await listChunksForGeneration(ctx, generation.id);
    const chunkWithEmail = chunks.find((c) => c.text.includes("John Smith"));
    expect(chunkWithEmail).toBeDefined();

    // Index-time masking already applied: the raw email never survives into
    // `knowledge_chunk.text` for a SemiTrusted collection's own default handling.
    expect(chunkWithEmail!.text).not.toContain("john.smith@example.com");
    expect(chunkWithEmail!.textUnmaskedRef).toBeTruthy(); // retained for read-time re-evaluation

    // A caller with NO declared trust level (e.g. the console's own Graph Explorer,
    // an existing pre-Phase-11 call site) keeps getting the baked-in masked text —
    // zero behavior change for every pre-existing caller.
    const defaultView = await getChunkDetail(ctx, chunkWithEmail!.id);
    expect(defaultView.text).not.toContain("john.smith@example.com");

    // A SemiTrusted caller re-evaluating gets the SAME masking outcome (its own
    // trust level matches the collection's index-time level) — genuinely
    // recomputed, not merely "left alone", but arriving at an equivalent result.
    const semiTrustedView = await getChunkDetail(ctx, chunkWithEmail!.id, "SemiTrusted");
    expect(semiTrustedView.text).not.toContain("john.smith@example.com");

    // An Untrusted caller gets AT LEAST as much masking as SemiTrusted.
    const untrustedView = await getChunkDetail(ctx, chunkWithEmail!.id, "Untrusted");
    expect(untrustedView.text).not.toContain("john.smith@example.com");

    // THE adversarial assertion: a Trusted caller reading the IDENTICAL chunk
    // genuinely sees the real email — proving real, different-per-caller
    // re-evaluation, not a static/always-masked value.
    const trustedView = await getChunkDetail(ctx, chunkWithEmail!.id, "Trusted");
    expect(trustedView.text).toContain("john.smith@example.com");
    expect(trustedView.text).not.toEqual(defaultView.text);
  }, 120_000);
});
