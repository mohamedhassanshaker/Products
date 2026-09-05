import type { TenantContext } from "@nextbot/db";
import { resolveModelChainForRouteVersion, getCatalogEntry } from "@nextbot/model-gateway";
import { EmbeddingModelChangeRequiresReembedError, KnowledgeGenerationNotReadyError } from "@nextbot/contracts";
import { getCollectionOrThrow, setCollectionStatus } from "../infrastructure/collection-repository.js";
import {
  createGeneration as createGenerationRow,
  getCurrentReadyGenerationForCollection,
  getGenerationOrThrow,
  listGenerationsForCollection,
  markGenerationFailed,
  markGenerationCancelled,
  type KnowledgeGenerationRow,
} from "../infrastructure/generation-repository.js";
import { listSourcesForCollection } from "../infrastructure/source-repository.js";
import { enqueueJob } from "../infrastructure/ingestion-job-repository.js";
import { mintGenerationGraphLabel } from "../domain/graph-label.js";
import { assertSupportedDimension } from "../infrastructure/embedding-table.js";

export { listGenerationsForCollection, getGenerationOrThrow, markGenerationFailed };

export interface BuildGenerationRequest {
  confirmReEmbed?: boolean;
}

/**
 * `POST .../collections/{id}/generations` (LLD §14.4.5). Resolves the collection's
 * currently-pinned embedding/extraction route versions into their real catalog
 * entries (FR-KB-03/FR-AGT-21 — "the pin, not a string"), stamps them onto a NEW,
 * immutable generation row, and kicks off the pipeline by enqueuing one `Ingest`
 * job per non-purged source. **Never a silent re-embed** (FR-KB-03): if a Ready
 * generation already exists and its `embedding_catalog_entry_id` differs from what
 * the collection's CURRENT `embedding_route_version_id` resolves to, this call
 * requires `confirmReEmbed: true` or is rejected with
 * `EMBEDDING_MODEL_CHANGE_REQUIRES_REEMBED` (409) — the exact confirmation UX
 * FR-KB-03 specifies.
 */
export async function buildGeneration(ctx: TenantContext, collectionId: string, req: BuildGenerationRequest = {}): Promise<KnowledgeGenerationRow> {
  const collection = await getCollectionOrThrow(ctx, collectionId);

  const embeddingResolved = await resolveModelChainForRouteVersion(ctx, collection.embeddingRouteVersionId);
  const embeddingHop = embeddingResolved.hopAttribution[0];
  if (!embeddingHop) throw new Error("buildGeneration: the collection's pinned embedding route version resolved to no usable hop.");
  const embeddingCatalogEntry = await getCatalogEntry(ctx, embeddingHop.catalogEntryId);
  if (!embeddingCatalogEntry || embeddingCatalogEntry.dimension === null) throw new Error("buildGeneration: the pinned embedding catalog entry has no dimension recorded.");
  assertSupportedDimension(embeddingCatalogEntry.dimension); // throws EmbeddingDimensionUnsupportedError if out of the closed set

  const extractionResolved = await resolveModelChainForRouteVersion(ctx, collection.extractionRouteVersionId);
  const extractionHop = extractionResolved.hopAttribution[0];
  if (!extractionHop) throw new Error("buildGeneration: the collection's pinned extraction route version resolved to no usable hop.");

  const currentGeneration = await getCurrentReadyGenerationForCollection(ctx, collectionId);
  if (currentGeneration && currentGeneration.embeddingCatalogEntryId !== embeddingCatalogEntry.id && !req.confirmReEmbed) {
    throw new EmbeddingModelChangeRequiresReembedError();
  }

  const generation = await createGenerationRow(ctx, {
    collectionId,
    embeddingProviderId: embeddingHop.providerId,
    embeddingCatalogEntryId: embeddingCatalogEntry.id,
    dimension: embeddingCatalogEntry.dimension,
    extractionCatalogEntryId: extractionHop.catalogEntryId,
    graphGenerationLabel: mintGenerationGraphLabel(),
    supersedesGenerationId: currentGeneration?.id,
  });

  await setCollectionStatus(ctx, collectionId, "Building");

  const sources = (await listSourcesForCollection(ctx, collectionId)).filter((s) => !s.purgedAt);
  if (sources.length === 0) {
    // FR-KB-02's own boundary: a collection with zero sources is valid and reaches
    // Ready with an empty generation — nothing to wait for, so the collection-wide
    // chain starts immediately rather than waiting on an Ingest job that will never
    // exist.
    await enqueueJob(ctx, { generationId: generation.id, stage: "Resolve", input: {} });
  } else {
    for (const source of sources) {
      await enqueueJob(ctx, { generationId: generation.id, sourceId: source.id, stage: "Ingest", input: {} });
    }
  }

  return generation;
}

export async function cancelGeneration(ctx: TenantContext, generationId: string): Promise<void> {
  const generation = await getGenerationOrThrow(ctx, generationId);
  if (generation.status !== "Building") throw new KnowledgeGenerationNotReadyError(generationId);
  await markGenerationCancelled(ctx, generationId);
}
