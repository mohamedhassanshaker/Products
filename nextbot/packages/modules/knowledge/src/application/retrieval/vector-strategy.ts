import { callModelGatewayEmbedding } from "@nextbot/model-gateway";
import { clampTopK } from "../../domain/retrieval-bounds.js";
import { topKByCosineSimilarity } from "../../infrastructure/embedding-table.js";
import { listChunksByIds } from "../../infrastructure/document-chunk-repository.js";
import { listSourcesByIds } from "../../infrastructure/source-repository.js";
import { estimateEmbeddingCallCostUsd, type RetrievalEvidenceItem, type RetrievalStrategyParams, type RetrievalStrategyResult } from "./retrieval-types.js";

/**
 * Target Architecture Blueprint Phase 9 (BL-40, FR-KB-05, §7.4) — the Vector
 * strategy: "top-k similarity over chunk embeddings... lowest [cost]... best for
 * lookup questions answered by a single passage." Embeds the QUERY with the SAME
 * embedding route the collection's current generation is pinned to
 * (`callModelGatewayEmbedding`, Phase 7b's own embedding call path — never a second
 * embedding call mechanism), then ranks `knowledge_chunk` embeddings by cosine
 * similarity. No graph traversal, no relation path — the strategy this phase's own
 * "distinguishable result sets" exit gate contrasts every other strategy against.
 */
export async function runVectorRetrieval(params: RetrievalStrategyParams): Promise<RetrievalStrategyResult> {
  const { ctx, collection, generation, query, aclTags } = params;
  const topK = clampTopK(params.topK);
  const started = Date.now();

  const { embedding, catalogEntryId } = await callModelGatewayEmbedding(ctx, {
    routeVersionId: collection.embeddingRouteVersionId,
    routeKeyForLog: "knowledge.playground.vector",
    input: query,
  });

  // Target Architecture Blueprint Phase 11 (BL-42, FR-KB-08) — ACL filtering applied
  // INSIDE this same top-K query, before ranking (see `topKByCosineSimilarity`'s own
  // doc comment) — a chunk the caller may not see never competes for a top-K slot.
  const hits = await topKByCosineSimilarity(ctx, generation.dimension, generation.id, "Chunk", embedding, topK, aclTags);
  const chunks = await listChunksByIds(ctx, hits.map((h) => h.ownerId));
  const chunkById = new Map(chunks.map((c) => [c.id, c]));
  const sources = await listSourcesByIds(ctx, [...new Set(chunks.map((c) => c.sourceId))]);
  const sourceById = new Map(sources.map((s) => [s.id, s]));

  const items: RetrievalEvidenceItem[] = [];
  for (const hit of hits) {
    const chunk = chunkById.get(hit.ownerId);
    if (!chunk) continue; // e.g. a chunk deleted since it was embedded — skip, never throw.
    items.push({
      kind: "Chunk",
      score: hit.score,
      chunkId: chunk.id,
      documentId: chunk.documentId,
      documentTitle: chunk.provenance.documentTitle ?? null,
      sourceId: chunk.sourceId,
      sourceName: sourceById.get(chunk.sourceId)?.name ?? "(unknown source)",
      snippet: chunk.text,
    });
  }

  const costUsd = await estimateEmbeddingCallCostUsd(ctx, catalogEntryId, query);
  return {
    strategy: "Vector",
    items,
    metrics: { groundednessScore: items[0]?.score ?? null, latencyMs: Date.now() - started, costUsd },
  };
}
