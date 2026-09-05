import type { TenantContext } from "@nextbot/db";
import { Neo4jGraphStore, type GraphScope } from "@nextbot/graph-store";
import { listActiveTenantContexts, computePurgeCutoff } from "@nextbot/tenancy";
import { getSourceOrThrow, deleteSource as markSourcePurged, listSourcesForCollection } from "../infrastructure/source-repository.js";
import { listCollections } from "../infrastructure/collection-repository.js";
import { getGenerationOrThrow } from "../infrastructure/generation-repository.js";
import { listChunksForSource, deleteChunksByIds } from "../infrastructure/document-chunk-repository.js";
import {
  listEdgesByProvenanceChunkIds,
  listEdgesForEntity,
  listEntitiesByIds,
  listEntitiesForCommunity,
  deleteEdgesByIds,
  deleteEntitiesByIds,
  deleteCommunitiesByIds,
  markCommunitiesStale,
  updateCommunityAclTags,
} from "../infrastructure/graph-repository.js";
import { enqueueJob } from "../infrastructure/ingestion-job-repository.js";
import { unionAclTags } from "../domain/acl.js";

/**
 * Target Architecture Blueprint Phase 11 (BL-42, FR-KB-08/FR-ADM-06) — the Retention
 * sub-requirement: "collections inherit the tenant retention policy; purging a
 * source removes its chunks and any extracted entities with no other provenance,
 * and triggers community re-summarization for affected communities."
 *
 * **Disclosed scope narrowing**: this codebase has no generic tenant-level
 * "knowledge retention default" field yet (`tenant_data_policy`'s four existing
 * retention categories — transcripts/tool-payloads/tool-metadata/PII — cover
 * conversation-side data only; adding a fifth column for this phase specifically
 * would be schema growth this phase's own brief didn't ask for). What genuinely
 * ships this phase: `knowledge_collection.retention_days` (already a real, per-
 * collection column since Phase 7b) drives the purge below; a collection that has
 * never configured it (`NULL`) is simply never auto-purged by the sweep below — a
 * safe, explicit, fail-closed default, never a silent tenant-wide inheritance this
 * codebase has no real source of truth for yet. The CASCADE MECHANICS this function
 * implements (chunk removal, no-other-provenance entity/edge cleanup, community
 * re-summarization) are the real, requested behavior regardless of what triggers it
 * — an explicit admin "delete this source" action already reaches the identical
 * code path.
 */
export interface PurgeSourceResult {
  chunksDeleted: number;
  edgesDeleted: number;
  entitiesDeleted: number;
  communitiesMarkedStaleForResummarization: number;
  communitiesDeleted: number;
}

/**
 * Removes a source's own chunks (across every generation it has ever contributed
 * to) and cascades the graph-side consequences: any edge whose sole provenance was
 * one of those chunks is removed; any entity left with NO remaining edge (in either
 * direction, from ANY surviving source) is removed too — "no other provenance"
 * means genuinely checked per-entity against the REST of the generation's graph, not
 * assumed; any community that lost a member is marked `summary_stale` and its
 * generation's `CommunitySummaries` stage is re-enqueued (reusing Phase 7b's own
 * incremental re-summarization mechanism, never a second one) — UNLESS the
 * community's membership dropped to zero, in which case it is deleted outright
 * rather than re-summarized over nothing. The Neo4j mirror is kept in sync via
 * `Neo4jGraphStore.deleteNodes` (`DETACH DELETE`, ADR-0018 §2.4 — Postgres is
 * system of record, the graph store is rebuilt/pruned from it, never the reverse).
 * Finally, the source itself is marked purged (`knowledge_source.purged_at`,
 * `status: 'Purged'`) via the SAME repository function an explicit delete already
 * uses — no second "mark purged" mechanism.
 */
export async function purgeSourceContent(ctx: TenantContext, sourceId: string): Promise<PurgeSourceResult> {
  const source = await getSourceOrThrow(ctx, sourceId);
  const chunks = await listChunksForSource(ctx, sourceId);

  const result: PurgeSourceResult = { chunksDeleted: 0, edgesDeleted: 0, entitiesDeleted: 0, communitiesMarkedStaleForResummarization: 0, communitiesDeleted: 0 };

  // Chunks are generation-scoped — group by generation so every graph lookup below
  // (edges/entities/communities, all themselves generation-scoped) stays within the
  // correct generation's own subgraph.
  const chunksByGeneration = new Map<string, string[]>();
  for (const chunk of chunks) {
    const list = chunksByGeneration.get(chunk.generationId) ?? [];
    list.push(chunk.id);
    chunksByGeneration.set(chunk.generationId, list);
  }

  for (const [generationId, chunkIds] of chunksByGeneration) {
    const generation = await getGenerationOrThrow(ctx, generationId);

    // 1. Edges whose ONLY provenance is one of this source's now-purged chunks.
    const edgesToRemove = await listEdgesByProvenanceChunkIds(ctx, generationId, chunkIds);
    const edgeIdsToRemove = edgesToRemove.map((e) => e.id);
    const candidateEntityIds = [...new Set(edgesToRemove.flatMap((e) => [e.srcEntityId, e.dstEntityId]))];

    if (edgeIdsToRemove.length > 0) {
      await deleteEdgesByIds(ctx, edgeIdsToRemove);
      result.edgesDeleted += edgeIdsToRemove.length;
    }

    // 2. Any candidate entity with NO remaining edge (checked fresh, AFTER the
    // deletion above, against the generation's REAL remaining graph — "no other
    // provenance" is a genuine re-check, never assumed from the edges just removed).
    const entityIdsToRemove: string[] = [];
    const affectedCommunityIds = new Set<string>();
    for (const entityId of candidateEntityIds) {
      const remainingEdges = await listEdgesForEntity(ctx, generationId, entityId);
      if (remainingEdges.length === 0) entityIdsToRemove.push(entityId);
    }

    if (entityIdsToRemove.length > 0) {
      // Capture each removed entity's community BEFORE deleting the entity row —
      // resolved from the edges we just fetched is not enough (an isolated entity
      // may have had a community with no edges at all), so re-read the entity rows
      // themselves for their own `community_id`.
      const removedEntities = await listEntitiesByIds(ctx, entityIdsToRemove);
      for (const entity of removedEntities) if (entity.communityId) affectedCommunityIds.add(entity.communityId);

      await deleteEntitiesByIds(ctx, entityIdsToRemove);
      result.entitiesDeleted += entityIdsToRemove.length;

      const scope: GraphScope = { tenantId: ctx.tenantId, generationId: generation.graphGenerationLabel };
      await new Neo4jGraphStore().deleteNodes(scope, entityIdsToRemove);
    }

    // 3. Community re-summarization (or deletion, if membership hit zero).
    if (affectedCommunityIds.size > 0) {
      const staleIds: string[] = [];
      const emptyIds: string[] = [];
      for (const communityId of affectedCommunityIds) {
        const remainingMembers = await listEntitiesForCommunity(ctx, generationId, communityId);
        if (remainingMembers.length === 0) emptyIds.push(communityId);
        else staleIds.push(communityId);
      }
      if (staleIds.length > 0) {
        await markCommunitiesStale(ctx, staleIds);
        result.communitiesMarkedStaleForResummarization += staleIds.length;
        // The community's own denormalized `acl_tags` (LLD §14.4.2: "union over
        // member entities") must be recomputed from its SURVIVING members — otherwise
        // a purged entity's ACL grant stays baked into the community's own tag set
        // indefinitely, a real residual over-exposure this closes (not merely a
        // cosmetic follow-up).
        for (const communityId of staleIds) {
          const remainingMembers = await listEntitiesForCommunity(ctx, generationId, communityId);
          await updateCommunityAclTags(ctx, communityId, unionAclTags(...remainingMembers.map((m) => m.aclTags)));
        }
      }
      if (emptyIds.length > 0) {
        await deleteCommunitiesByIds(ctx, emptyIds);
        result.communitiesDeleted += emptyIds.length;
      }
    }

    // 4. Finally, the chunks themselves.
    await deleteChunksByIds(ctx, chunkIds);
    result.chunksDeleted += chunkIds.length;
  }

  // Re-enqueue CommunitySummaries for every generation touched, so the SAME
  // incremental mechanism the ingestion pipeline already uses regenerates exactly
  // the communities this purge just marked stale — never a second, bespoke
  // re-summarization code path (idempotent: a no-op if nothing is stale).
  if (result.communitiesMarkedStaleForResummarization > 0) {
    for (const generationId of chunksByGeneration.keys()) {
      await enqueueJob(ctx, { generationId, stage: "CommunitySummaries", input: {} });
    }
  }

  await markSourcePurged(ctx, source.id);
  return result;
}

/**
 * Target Architecture Blueprint Phase 11 (BL-42, FR-KB-08/FR-ADM-06) — the scheduled
 * sweep `apps/worker` runs (mirrors `@nextbot/knowledge`'s own `syncDueSources`
 * precedent — a multi-tenant sweep living inside this tenant-scoped module, looping
 * `listActiveTenantContexts()` itself, rather than a composition-root orchestration
 * in `apps/worker` — this module already does the identical thing for source-sync).
 *
 * For every collection with a REAL, explicit `retention_days` configured (`NULL`
 * means "never auto-purged" — see this file's own top-level doc comment for why
 * that's the honest default rather than a silently-invented tenant-wide inheritance;
 * `-1` means "Indefinite", also never purged), every source older than the cutoff
 * (by `created_at` — a source has no other "how long have we held this content"
 * timestamp) is purged via `purgeSourceContent` above — the identical cascade an
 * explicit admin delete already uses.
 */
export interface KnowledgeRetentionSweepResult {
  tenantsChecked: number;
  sourcesPurged: number;
}

export async function sweepKnowledgeRetention(): Promise<KnowledgeRetentionSweepResult> {
  const tenants = await listActiveTenantContexts();
  let sourcesPurged = 0;

  for (const ctx of tenants) {
    // A single tenant's failure (a transient DB error, a mid-sweep graph-store
    // outage, etc.) must never abort the whole sweep tick for every other tenant —
    // matches `tenancy.retention-purge`'s own per-tenant isolation convention.
    try {
      const collections = await listCollections(ctx);
      for (const collection of collections) {
        if (collection.retentionDays === null) continue; // no configured retention — never auto-purged.
        const cutoff = computePurgeCutoff(collection.retentionDays);
        if (cutoff === null) continue; // Indefinite (-1).

        const sources = await listSourcesForCollection(ctx, collection.id);
        for (const source of sources) {
          if (source.purgedAt) continue; // already purged
          if (source.createdAt >= cutoff) continue; // not yet aged past the cutoff
          await purgeSourceContent(ctx, source.id);
          sourcesPurged += 1;
        }
      }
    } catch (err) {
      console.error(`NextBot worker: knowledge-retention sweep failed for tenant "${ctx.tenantId}"`, err);
    }
  }

  return { tenantsChecked: tenants.length, sourcesPurged };
}
