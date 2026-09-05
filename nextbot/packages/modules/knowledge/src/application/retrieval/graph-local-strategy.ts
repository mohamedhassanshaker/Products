import { Neo4jGraphStore, type GraphScope } from "@nextbot/graph-store";
import { clampMaxHops, clampMaxNodes } from "../../domain/retrieval-bounds.js";
import { findAnchorEntitiesByQueryMention, listEdgesByIds, listEntitiesByIds } from "../../infrastructure/graph-repository.js";
import { listChunksByIds } from "../../infrastructure/document-chunk-repository.js";
import { listSourcesByIds } from "../../infrastructure/source-repository.js";
import type { RetrievalEvidenceItem, RetrievalStrategyParams, RetrievalStrategyResult } from "./retrieval-types.js";

/**
 * Target Architecture Blueprint Phase 9 (BL-40, FR-KB-05/06, §7.4) — the GraphLocal
 * strategy: "anchor on entities mentioned in the query, walk N hops, return neighbour
 * chunks plus the relation path... best for questions whose answer spans related
 * concepts." No model call is made — anchor resolution is a literal substring match
 * (`findAnchorEntitiesByQueryMention`, no query classifier per this phase's own
 * scope boundary) and the traversal itself is pure graph-store structure, so this is
 * the ONLY strategy of the four with a genuine $0 cost, matching §7.4's "Low to
 * medium" relative-cost column (cost here is latency/compute, not model spend).
 *
 * The ENTIRE graph-store access path is `new Neo4jGraphStore().neighbourhood(...)` —
 * the exact same call shape Phase 7b's own pipeline stages already make (e.g.
 * `stage-extract-resolve-buildgraph.ts`), through `withTenantGraph()` internally.
 * No raw driver import, no bypass.
 */
export async function runGraphLocalRetrieval(params: RetrievalStrategyParams): Promise<RetrievalStrategyResult> {
  const { ctx, generation, query, aclTags } = params;
  const maxHops = clampMaxHops(params.maxHops);
  const maxNodes = clampMaxNodes(params.maxNodes);
  const started = Date.now();

  // Anchor entity mentions capped at 10 — bounding the anchor set itself keeps the
  // downstream neighbourhood() call's fan-out sane even if the query text happens to
  // mention many entity names (FR-KB-06 boundedness applies to the anchor set too,
  // not only to hops/nodes).
  const anchors = await findAnchorEntitiesByQueryMention(ctx, generation.id, query, 10);
  if (anchors.length === 0) {
    return {
      strategy: "GraphLocal",
      items: [],
      metrics: { groundednessScore: null, latencyMs: Date.now() - started, costUsd: "0.00000000" },
      note: "No entity mentioned in the query text was found in this generation's graph — graph-local retrieval needs a recognizable anchor entity.",
    };
  }

  // Target Architecture Blueprint Phase 11 (BL-42, FR-KB-08) — `aclTags` is now the
  // REAL, resolved per-caller scope (`ResolvedAgentKnowledgeConfig.aclTags`) rather
  // than the whole generation's own tag union — `undefined` only reaches here from a
  // pre-Phase-11 test fixture (see `RetrievalStrategyParams.aclTags`'s own doc
  // comment); `neighbourhood()`'s own Cypher predicate treats an empty array as
  // "matches nothing" (fail-closed), never as "no restriction".
  const scope: GraphScope = { tenantId: ctx.tenantId, generationId: generation.graphGenerationLabel };
  const graphStore = new Neo4jGraphStore();
  const neighbourhood = await graphStore.neighbourhood(scope, {
    anchorNodeIds: anchors.map((a) => a.id),
    maxHops,
    maxNodes,
    aclTags: aclTags ?? [],
  });

  if (neighbourhood.edgeIds.length === 0) {
    return {
      strategy: "GraphLocal",
      items: [],
      metrics: { groundednessScore: null, latencyMs: Date.now() - started, costUsd: "0.00000000" },
      note: `Found ${anchors.length} anchor ${anchors.length === 1 ? "entity" : "entities"} but no relations within ${maxHops} hop(s).`,
    };
  }

  // Structure/ids only came back from the graph store (ADR-0018 §2.4) — resolve the
  // readable relation name/weight/confidence/provenance from Postgres, the same
  // "graph store holds ids, Postgres holds content" split the Graph Explorer (Phase
  // 8) already established for entities/communities.
  const edges = await listEdgesByIds(ctx, neighbourhood.edgeIds);
  const entityIds = [...new Set(edges.flatMap((e) => [e.srcEntityId, e.dstEntityId]))];
  const [entities, chunks] = await Promise.all([listEntitiesByIds(ctx, entityIds), listChunksByIds(ctx, [...new Set(edges.map((e) => e.provenanceChunkId))])]);
  const entityById = new Map(entities.map((e) => [e.id, e]));
  const chunkById = new Map(chunks.map((c) => [c.id, c]));
  const sources = await listSourcesByIds(ctx, [...new Set(chunks.map((c) => c.sourceId))]);
  const sourceById = new Map(sources.map((s) => [s.id, s]));

  // One evidence item per relation edge — every item carries its OWN relation path
  // as the evidence a pure vector search could never surface (this phase's own
  // "distinguishable result sets" exit gate). Highest-confidence edges first.
  const items: RetrievalEvidenceItem[] = [...edges]
    .sort((a, b) => b.confidence - a.confidence)
    .map((edge) => {
      const chunk = chunkById.get(edge.provenanceChunkId);
      const src = entityById.get(edge.srcEntityId);
      const dst = entityById.get(edge.dstEntityId);
      return {
        kind: "Chunk",
        score: edge.confidence,
        chunkId: edge.provenanceChunkId,
        documentId: chunk?.documentId,
        documentTitle: chunk?.provenance.documentTitle ?? null,
        sourceId: chunk?.sourceId,
        sourceName: chunk ? (sourceById.get(chunk.sourceId)?.name ?? "(unknown source)") : undefined,
        snippet: chunk?.text,
        relationPath: [{ srcName: src?.canonicalName ?? "(unknown entity)", relation: edge.relation, dstName: dst?.canonicalName ?? "(unknown entity)", provenanceChunkId: edge.provenanceChunkId }],
      };
    });

  const groundednessScore = items.length > 0 ? items.reduce((sum, item) => sum + item.score, 0) / items.length : null;
  return {
    strategy: "GraphLocal",
    items,
    metrics: { groundednessScore, latencyMs: Date.now() - started, costUsd: "0.00000000" },
  };
}
