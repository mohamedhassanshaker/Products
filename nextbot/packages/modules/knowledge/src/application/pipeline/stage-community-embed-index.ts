import { Type } from "@sinclair/typebox";
import { Neo4jGraphStore, type GraphScope } from "@nextbot/graph-store";
import type { TenantContext } from "@nextbot/db";
import { callModelGatewayStructuredPinned, callModelGatewayEmbedding } from "@nextbot/model-gateway";
import { getGenerationOrThrow, updateGenerationCounts, markGenerationReadyAndSetCurrent } from "../../infrastructure/generation-repository.js";
import { getCollectionOrThrow } from "../../infrastructure/collection-repository.js";
import { listChunksForGeneration } from "../../infrastructure/document-chunk-repository.js";
import {
  listEntitiesForGeneration,
  listEdgesForGeneration,
  updateEntityCommunity,
  insertCommunities,
  listStaleCommunitiesForGeneration,
  listCommunitiesForGeneration,
  setCommunitySummary,
} from "../../infrastructure/graph-repository.js";
import { tableForDimension, upsertEmbedding, getEmbedding } from "../../infrastructure/embedding-table.js";
import { completeJob, failJob, enqueueJob, type KnowledgeIngestionJobRow } from "../../infrastructure/ingestion-job-repository.js";
import { detectCommunitiesLabelPropagation } from "../../domain/community-detect.js";
import { unionAclTags } from "../../domain/acl.js";

const CommunitySummarySchema = Type.Object({ title: Type.String({ minLength: 1 }), summary: Type.String({ minLength: 1 }) });

/**
 * Stage 7 — CommunityDetection (LLD §14.4.3, per generation; ADR-0018 §2.5: runs in
 * the worker, not the database). Reads the edge list via `GraphStorePort.
 * projectEdges` (read-only projection, per the port's own doc comment — detection
 * happens here, not via Neo4j GDS), clusters with `detectCommunitiesLabelPropagation`,
 * writes the result back via `GraphStorePort.assignCommunities` plus real
 * `graph_community` rows in Postgres. Single-level (0) only this phase (see this
 * module's README for the disclosed hierarchical-clustering narrowing).
 */
export async function runCommunityDetectionStage(ctx: TenantContext, job: KnowledgeIngestionJobRow): Promise<void> {
  try {
    const generation = await getGenerationOrThrow(ctx, job.generationId);
    const scope: GraphScope = { tenantId: ctx.tenantId, generationId: generation.graphGenerationLabel };
    const graphStore = new Neo4jGraphStore();

    const entities = await listEntitiesForGeneration(ctx, job.generationId);
    const edges = await listEdgesForGeneration(ctx, job.generationId);
    const nodeIds = entities.map((e) => e.id);

    const communities = entities.length > 0 ? detectCommunitiesLabelPropagation(edges.map((e) => ({ srcId: e.srcEntityId, dstId: e.dstEntityId, weight: e.weight })), nodeIds) : [];

    if (communities.length > 0) {
      await graphStore.assignCommunities(
        scope,
        communities.flatMap((c) => c.nodeIds.map((nodeId) => ({ nodeId, level: 0, externalKey: c.externalKey }))),
      );
    }

    const entityById = new Map(entities.map((e) => [e.id, e]));
    const communityRows = await insertCommunities(
      ctx,
      communities.map((c) => ({
        generationId: job.generationId,
        level: 0,
        externalKey: c.externalKey,
        entityCount: c.nodeIds.length,
        aclTags: unionAclTags(...c.nodeIds.map((id) => entityById.get(id)?.aclTags ?? [])),
      })),
    );

    for (const [index, community] of communities.entries()) {
      const row = communityRows[index];
      if (!row) continue;
      for (const nodeId of community.nodeIds) await updateEntityCommunity(ctx, nodeId, row.id);
    }

    await updateGenerationCounts(ctx, job.generationId, { communityCount: communityRows.length });
    await completeJob(ctx, job.id, { communityCount: communityRows.length });
    await enqueueJob(ctx, { generationId: job.generationId, stage: "CommunitySummaries", input: {} });
  } catch (err) {
    await failJob(ctx, job.id, { code: "COMMUNITY_DETECTION_STAGE_ERROR", message: err instanceof Error ? err.message.slice(0, 500) : String(err), retriable: true });
  }
}

/**
 * Stage 8 — CommunitySummaries (LLD §14.4.3, scope "per stale community" —
 * collapsed to ONE job per generation for this phase, looping internally; see
 * `pipeline-common.ts`'s doc comment for why). Only regenerates communities with
 * `summary_stale = true` (FR-KB-02 "regenerated incrementally"); a per-community
 * summarization failure leaves that one `summary_stale = true` and the loop
 * continues — the generation still reaches Ready (LLD's own stage-table wording).
 */
export async function runCommunitySummariesStage(ctx: TenantContext, job: KnowledgeIngestionJobRow): Promise<void> {
  try {
    const generation = await getGenerationOrThrow(ctx, job.generationId);
    const collection = await getCollectionOrThrow(ctx, generation.collectionId);
    const staleCommunities = await listStaleCommunitiesForGeneration(ctx, job.generationId);
    const entities = await listEntitiesForGeneration(ctx, job.generationId);
    const entitiesByCommunity = new Map<string, typeof entities>();
    for (const entity of entities) {
      if (!entity.communityId) continue;
      const list = entitiesByCommunity.get(entity.communityId) ?? [];
      list.push(entity);
      entitiesByCommunity.set(entity.communityId, list);
    }

    let summarized = 0;
    for (const community of staleCommunities) {
      try {
        const members = entitiesByCommunity.get(community.id) ?? [];
        const memberDescriptions = members.map((m) => `${m.canonicalName} (${m.type})`).join("; ");
        const result = await callModelGatewayStructuredPinned(ctx, {
          routeVersionId: collection.extractionRouteVersionId,
          routeKeyForLog: "knowledge.community-summary",
          schema: CommunitySummarySchema,
          system: "Write a short title and a one-paragraph summary describing the common theme connecting these entities.",
          messages: [{ role: "user", content: memberDescriptions || "(no member entities)" }],
          knowledgeGenerationId: job.generationId,
        });
        await setCommunitySummary(ctx, community.id, result.title, result.summary);
        summarized += 1;
      } catch {
        // Leaves summary_stale=true — the generation still reaches Ready (LLD's own wording).
      }
    }

    await completeJob(ctx, job.id, { summarized, staleCount: staleCommunities.length });
    await enqueueJob(ctx, { generationId: job.generationId, stage: "Embed", input: {} });
  } catch (err) {
    await failJob(ctx, job.id, { code: "COMMUNITY_SUMMARIES_STAGE_ERROR", message: err instanceof Error ? err.message.slice(0, 500) : String(err), retriable: true });
  }
}

/**
 * Stage 9 — Embed (LLD §14.4.3). Embeds every chunk, every entity with a summary,
 * and every community with a summary — through the collection's pinned
 * `embedding_route_version_id`, into the `knowledge_embedding_d<dimension>` table
 * `tableForDimension()` resolves for the GENERATION's own pinned dimension (never
 * re-derived per item). Collapsed to ONE job per generation (see
 * `pipeline-common.ts`'s doc comment); a per-item embedding failure excludes only
 * that item from ranking (LLD's own stage-table wording: "that owner has no vector
 * and is excluded from ranking"), never blocks the rest.
 */
export async function runEmbedStage(ctx: TenantContext, job: KnowledgeIngestionJobRow): Promise<void> {
  try {
    const generation = await getGenerationOrThrow(ctx, job.generationId);
    const collection = await getCollectionOrThrow(ctx, generation.collectionId);
    tableForDimension(generation.dimension); // fails fast (EmbeddingDimensionUnsupportedError) before any embedding call if the pinned dimension is somehow invalid.

    let embedded = 0;
    let failed = 0;

    async function embedOwner(kind: "Chunk" | "EntitySummary" | "CommunitySummary", ownerId: string, text: string): Promise<void> {
      const already = await getEmbedding(ctx, generation.dimension, job.generationId, kind, ownerId);
      if (already) return; // already embedded (a retry/re-run) — never re-call the model for the same owner.
      try {
        const { embedding } = await callModelGatewayEmbedding(ctx, {
          routeVersionId: collection.embeddingRouteVersionId,
          routeKeyForLog: "knowledge.embed",
          input: text,
          knowledgeGenerationId: job.generationId,
        });
        await upsertEmbedding(ctx, { generationId: job.generationId, dimension: generation.dimension, kind, ownerId, embedding });
        embedded += 1;
      } catch {
        failed += 1;
      }
    }

    const chunks = await listChunksForGeneration(ctx, job.generationId);
    for (const chunk of chunks) await embedOwner("Chunk", chunk.id, chunk.text);

    const entities = await listEntitiesForGeneration(ctx, job.generationId);
    for (const entity of entities) if (entity.summary) await embedOwner("EntitySummary", entity.id, entity.summary);

    // Any community still stale here had a failed CommunitySummaries attempt —
    // `community.summary` stays null for it, so the `if (community.summary)` guard
    // below naturally excludes it from embedding without needing a separate check.
    const allCommunities = await listCommunitiesForGeneration(ctx, job.generationId);
    for (const community of allCommunities) if (community.summary) await embedOwner("CommunitySummary", community.id, community.summary);

    await completeJob(ctx, job.id, { embedded, failed });
    await enqueueJob(ctx, { generationId: job.generationId, stage: "Index", input: {} });
  } catch (err) {
    await failJob(ctx, job.id, { code: "EMBED_STAGE_ERROR", message: err instanceof Error ? err.message.slice(0, 500) : String(err), retriable: true });
  }
}

/**
 * Stage 10 — Index (LLD §14.4.3 — "only here" flips `generation.status='Ready'` and
 * `collection.current_generation_id`, in one transaction). Terminal stage — no
 * further job is enqueued.
 */
export async function runIndexStage(ctx: TenantContext, job: KnowledgeIngestionJobRow): Promise<void> {
  try {
    const generation = await getGenerationOrThrow(ctx, job.generationId);
    await markGenerationReadyAndSetCurrent(ctx, job.generationId, generation.collectionId);
    await completeJob(ctx, job.id, { indexedAt: new Date().toISOString() });
  } catch (err) {
    await failJob(ctx, job.id, { code: "INDEX_STAGE_ERROR", message: err instanceof Error ? err.message.slice(0, 500) : String(err), retriable: true });
  }
}
