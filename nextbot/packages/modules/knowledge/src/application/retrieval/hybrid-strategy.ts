import { Neo4jGraphStore, type GraphScope } from "@nextbot/graph-store";
import { callModelGatewayEmbedding } from "@nextbot/model-gateway";
import { clampMaxHops, clampMaxNodes, clampTopK } from "../../domain/retrieval-bounds.js";
import { topKByCosineSimilarity } from "../../infrastructure/embedding-table.js";
import { listChunksByIds, type KnowledgeChunkRow } from "../../infrastructure/document-chunk-repository.js";
import { listSourcesByIds } from "../../infrastructure/source-repository.js";
import { listEdgesByIds, listEdgesByProvenanceChunkIds, listEntitiesByIds, type GraphEdgeRow } from "../../infrastructure/graph-repository.js";
import { estimateEmbeddingCallCostUsd, type RetrievalEvidenceItem, type RetrievalStrategyParams, type RetrievalStrategyResult } from "./retrieval-types.js";

/** A vector-recalled chunk gets this much of a relevance boost (capped at 1.0) when
 *  one of its own provenance entities survived into the graph-expansion step's
 *  neighbourhood — a real, disclosed, deterministic non-LLM rerank (see this
 *  module's plan doc §8: `rerankRouteVersionId` is nullable this phase; an
 *  LLM-based rerank is a future enhancement, not a silent no-op today). */
const GRAPH_BOOST = 0.15;

/**
 * Target Architecture Blueprint Phase 9 (BL-40, FR-KB-05, §7.4) — the Hybrid
 * strategy: "vector recall, then graph expansion of the top entities, then rerank...
 * default when the query classifier is uncertain... [relative cost] Medium."
 *
 * 1. Vector recall — identical mechanism to the Vector strategy.
 * 2. Graph expansion — the entities already mentioned in the recalled chunks (via
 *    their own provenance edges) are used as anchors for a bounded
 *    `GraphStorePort.neighbourhood()` walk, surfacing related chunks a pure vector
 *    search's top-K cutoff might have missed.
 * 3. Rerank — every recalled chunk whose provenance entity survived into the
 *    expanded neighbourhood gets a real relevance boost and carries the specific
 *    relation path that justified it (FR-KB-06 evidence), then the set is re-sorted.
 */
export async function runHybridRetrieval(params: RetrievalStrategyParams): Promise<RetrievalStrategyResult> {
  const { ctx, collection, generation, query, aclTags } = params;
  const topK = clampTopK(params.topK);
  // Hybrid's own expansion step defaults to a shallow 1-hop walk (distinct from
  // GraphLocal's own default of 2) — it exists to catch near neighbours vector
  // recall's cutoff missed, not to re-run a full graph-local traversal; a caller may
  // still request more, still bounded by the same hard ceiling.
  const maxHops = clampMaxHops(params.maxHops ?? 1);
  const maxNodes = clampMaxNodes(params.maxNodes);
  const started = Date.now();

  const { embedding, catalogEntryId } = await callModelGatewayEmbedding(ctx, {
    routeVersionId: collection.embeddingRouteVersionId,
    routeKeyForLog: "knowledge.playground.hybrid.recall",
    input: query,
  });

  // Target Architecture Blueprint Phase 11 (BL-42, FR-KB-08) — the initial vector
  // recall step is now ACL-filtered before ranking too, closing a real gap this
  // strategy previously had (only its own graph-expansion step below was ever
  // ACL-aware; the vector-recall half had no filter at all).
  const hits = await topKByCosineSimilarity(ctx, generation.dimension, generation.id, "Chunk", embedding, topK, aclTags);
  if (hits.length === 0) {
    const costUsd = await estimateEmbeddingCallCostUsd(ctx, catalogEntryId, query);
    return { strategy: "Hybrid", items: [], metrics: { groundednessScore: null, latencyMs: Date.now() - started, costUsd }, note: "Vector recall returned nothing to expand." };
  }

  const chunks = await listChunksByIds(ctx, hits.map((h) => h.ownerId));
  const chunkById = new Map(chunks.map((c) => [c.id, c]));

  // Which entities does vector recall's own top chunks already mention?
  const recallEdges = await listEdgesByProvenanceChunkIds(ctx, generation.id, chunks.map((c) => c.id));
  const candidateEntityIds = [...new Set(recallEdges.flatMap((e) => [e.srcEntityId, e.dstEntityId]))];

  let expansionEdges: GraphEdgeRow[] = [];
  if (candidateEntityIds.length > 0) {
    const scope: GraphScope = { tenantId: ctx.tenantId, generationId: generation.graphGenerationLabel };
    const graphStore = new Neo4jGraphStore();
    const neighbourhood = await graphStore.neighbourhood(scope, { anchorNodeIds: candidateEntityIds, maxHops, maxNodes, aclTags: aclTags ?? [] });
    expansionEdges = await listEdgesByIds(ctx, neighbourhood.edgeIds);
  }

  const entities = await listEntitiesByIds(ctx, [...new Set(expansionEdges.flatMap((e) => [e.srcEntityId, e.dstEntityId]))]);
  const entityById = new Map(entities.map((e) => [e.id, e]));
  const edgesByProvenanceChunk = new Map<string, GraphEdgeRow[]>();
  for (const edge of expansionEdges) {
    const list = edgesByProvenanceChunk.get(edge.provenanceChunkId) ?? [];
    list.push(edge);
    edgesByProvenanceChunk.set(edge.provenanceChunkId, list);
  }

  const sources = await listSourcesByIds(ctx, [...new Set(chunks.map((c) => c.sourceId))]);
  const sourceById = new Map(sources.map((s) => [s.id, s]));

  const reranked = hits
    .map((hit) => {
      const chunk = chunkById.get(hit.ownerId);
      const relatedEdges = chunk ? (edgesByProvenanceChunk.get(chunk.id) ?? []) : [];
      const finalScore = Math.min(1, hit.score + (relatedEdges.length > 0 ? GRAPH_BOOST : 0));
      return { chunk, relatedEdges, finalScore };
    })
    .filter((r): r is { chunk: KnowledgeChunkRow; relatedEdges: GraphEdgeRow[]; finalScore: number } => r.chunk !== undefined)
    .sort((a, b) => b.finalScore - a.finalScore);

  const items: RetrievalEvidenceItem[] = reranked.map(({ chunk, relatedEdges, finalScore }) => ({
    kind: "Chunk",
    score: finalScore,
    chunkId: chunk.id,
    documentId: chunk.documentId,
    documentTitle: chunk.provenance.documentTitle ?? null,
    sourceId: chunk.sourceId,
    sourceName: sourceById.get(chunk.sourceId)?.name ?? "(unknown source)",
    snippet: chunk.text,
    relationPath:
      relatedEdges.length > 0
        ? relatedEdges.map((edge) => ({
            srcName: entityById.get(edge.srcEntityId)?.canonicalName ?? "(unknown entity)",
            relation: edge.relation,
            dstName: entityById.get(edge.dstEntityId)?.canonicalName ?? "(unknown entity)",
            provenanceChunkId: edge.provenanceChunkId,
          }))
        : undefined,
  }));

  const costUsd = await estimateEmbeddingCallCostUsd(ctx, catalogEntryId, query);
  return {
    strategy: "Hybrid",
    items,
    metrics: { groundednessScore: items[0]?.score ?? null, latencyMs: Date.now() - started, costUsd },
  };
}
