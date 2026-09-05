import type { TenantContext } from "@nextbot/db";
import { createCollection, listCollections, getCollectionOrThrow, updateCollection, updateCollectionConfiguration, softDeleteCollection, type CreateCollectionRequest, type UpdateCollectionConfigRequest } from "../application/collection-service.js";
import { createSource, listSourcesForCollection, getSourceOrThrow, deleteSource, triggerSourceSync, storeUploadAndBuildLocator, type CreateSourceRequest } from "../application/source-service.js";
import { buildGeneration, listGenerationsForCollection, getGenerationOrThrow, cancelGeneration, type BuildGenerationRequest } from "../application/generation-service.js";
import {
  listGraphEntities,
  getGraphEntityDetail,
  listGraphCommunities,
  getGraphCommunityDetail,
  getChunkDetail,
  type ListGraphEntitiesQuery,
} from "../application/graph-explorer-service.js";
import type { UpdateCollectionFields } from "../infrastructure/collection-repository.js";
import { runRetrievalPlayground, type RetrievalPlaygroundRequest } from "../application/retrieval/playground-service.js";
import { getCollectionFreshness } from "../application/freshness-service.js";
import { getCoverageReport, type CoverageReportQuery } from "../application/coverage-service.js";

/**
 * Thin HTTP handlers — RBAC (`knowledge`/`knowledge_config`, per spec/blueprint
 * §5.2) is applied by the composition root (`apps/web`'s route handlers), same
 * convention every other module in this codebase follows (e.g. `skills`,
 * `mcp-registry`). This file has no permission awareness of its own.
 */

export async function handleListCollections(ctx: TenantContext) {
  return listCollections(ctx);
}

export async function handleCreateCollection(ctx: TenantContext, body: CreateCollectionRequest) {
  return createCollection(ctx, body);
}

export async function handleGetCollection(ctx: TenantContext, id: string) {
  return getCollectionOrThrow(ctx, id);
}

export async function handleUpdateCollection(ctx: TenantContext, id: string, body: UpdateCollectionFields) {
  return updateCollection(ctx, id, body);
}

export async function handleUpdateCollectionConfig(ctx: TenantContext, id: string, body: UpdateCollectionConfigRequest) {
  return updateCollectionConfiguration(ctx, id, body);
}

export async function handleDeleteCollection(ctx: TenantContext, id: string) {
  await softDeleteCollection(ctx, id);
  return { deleted: true };
}

export async function handleListSources(ctx: TenantContext, collectionId: string) {
  return listSourcesForCollection(ctx, collectionId);
}

export async function handleCreateSource(ctx: TenantContext, body: CreateSourceRequest) {
  return createSource(ctx, body);
}

export async function handleUploadFile(ctx: TenantContext, filename: string, mimeType: string, content: Buffer | string) {
  return storeUploadAndBuildLocator(ctx, filename, mimeType, content);
}

export async function handleGetSource(ctx: TenantContext, id: string) {
  return getSourceOrThrow(ctx, id);
}

export async function handleDeleteSource(ctx: TenantContext, id: string) {
  await deleteSource(ctx, id);
  return { deleted: true };
}

export async function handleSyncSource(ctx: TenantContext, id: string) {
  return triggerSourceSync(ctx, id);
}

export async function handleGetSourceFailures(ctx: TenantContext, id: string) {
  const source = await getSourceOrThrow(ctx, id);
  return { failures: source.failures ?? [] };
}

export async function handleListGenerations(ctx: TenantContext, collectionId: string) {
  return listGenerationsForCollection(ctx, collectionId);
}

export async function handleBuildGeneration(ctx: TenantContext, collectionId: string, body: BuildGenerationRequest) {
  return buildGeneration(ctx, collectionId, body);
}

export async function handleGetGenerationProgress(ctx: TenantContext, id: string) {
  const generation = await getGenerationOrThrow(ctx, id);
  return { status: generation.status, stageProgress: generation.stageProgress, chunkCount: generation.chunkCount, entityCount: generation.entityCount, edgeCount: generation.edgeCount, communityCount: generation.communityCount };
}

export async function handleCancelGeneration(ctx: TenantContext, id: string) {
  await cancelGeneration(ctx, id);
  return { cancelled: true };
}

// ---------------------------------------------------------------------------
// Graph Explorer (Target Architecture Blueprint Phase 8, BL-39, FR-KB-04,
// LLD §14.4.5) — read-only; this phase adds no mutation capability over the graph.
// ---------------------------------------------------------------------------

export async function handleListGraphEntities(ctx: TenantContext, generationId: string, query: ListGraphEntitiesQuery) {
  return listGraphEntities(ctx, generationId, query);
}

export async function handleGetGraphEntity(ctx: TenantContext, generationId: string, entityId: string) {
  return getGraphEntityDetail(ctx, generationId, entityId);
}

export async function handleListGraphCommunities(ctx: TenantContext, generationId: string, level?: number) {
  return listGraphCommunities(ctx, generationId, level);
}

export async function handleGetGraphCommunity(ctx: TenantContext, generationId: string, communityId: string) {
  return getGraphCommunityDetail(ctx, generationId, communityId);
}

export async function handleGetChunk(ctx: TenantContext, chunkId: string) {
  return getChunkDetail(ctx, chunkId);
}

// ---------------------------------------------------------------------------
// Retrieval Playground (Target Architecture Blueprint Phase 9, BL-40, FR-KB-05,
// LLD §14.4.5) — runs the four independently-callable retrieval strategies (no
// query classifier, no bounded-agent loop — see this module's Phase 9 plan doc for
// the disclosed scope boundary against Phase 10's retrieval executor).
// ---------------------------------------------------------------------------

export async function handleRunRetrievalPlayground(ctx: TenantContext, collectionId: string, body: RetrievalPlaygroundRequest) {
  return runRetrievalPlayground(ctx, collectionId, body);
}

// ---------------------------------------------------------------------------
// Target Architecture Blueprint Phase 11 (BL-42, FR-KB-08) — Knowledge Governance:
// the staleness badge and the coverage report, both read-only.
// ---------------------------------------------------------------------------

export async function handleGetCollectionFreshness(ctx: TenantContext, collectionId: string) {
  return getCollectionFreshness(ctx, collectionId);
}

export async function handleGetCoverageReport(ctx: TenantContext, collectionId: string, query: CoverageReportQuery) {
  return getCoverageReport(ctx, collectionId, query);
}
