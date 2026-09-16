"""Hybrid retrieval: vector half + graph half, blended, reranked, degraded honestly.

data-model.md §6.5's blend, `POST /v1/knowledge/retrieval/query`'s real
implementation:

    hybridScore = graphWeight·normalise(graph) + vectorWeight·normalise(vector) - penalty
    then rerank top rerankCandidateCount via Cohere, if enabled
    then truncate to topK

Two independent degradation paths, both real and both proven by this wave's
live-infrastructure verification, not merely asserted in a comment:

* **Graph unavailable → vector-only.** Caught here as `GraphUnavailableError`
  (the one exception `GraphStore`'s real adapter promises to raise on a
  connectivity failure, never anything else) — the blend collapses to the
  vector half alone, `degraded=True`, `"graph_unavailable"` recorded, and
  grounding confidence drops (`domain.knowledge.grounding_confidence`). The
  vector half is always attempted first and unconditionally, precisely so a
  graph outage never has anything to cascade into — retrieval never *fails*
  because the graph is down.
* **Rerank unavailable → unreranked hybrid order.** Caught as
  `RerankUnavailableError` (also raised by `reranker_from_environment()`'s
  `None` return being handled the same way) — the hybrid order stands,
  `rerankApplied=False`, `"rerank_unavailable"` recorded.
"""

from __future__ import annotations

from dataclasses import dataclass
from time import perf_counter

from shj3_ai.domain.knowledge import extract_entities, grounding_confidence, hybrid_score, normalise
from shj3_ai.ports.embedding import EmbeddingPort
from shj3_ai.ports.graph_store import GraphStore, GraphUnavailableError, SubgraphResult
from shj3_ai.ports.knowledge_sql import KnowledgeSqlReader
from shj3_ai.ports.reranker import RerankPort, RerankUnavailableError
from shj3_ai.ports.vector_store import VectorStore


@dataclass(frozen=True, slots=True)
class ScoredPassage:
    chunk_id: str
    score: float
    graph_score: float
    vector_score: float
    text: str
    section_path: str | None
    page_number: int | None
    knowledge_source_id: str
    knowledge_source_name: str
    retrieved_via: str  # "Graph" | "Vector" | "Hybrid"


@dataclass(frozen=True, slots=True)
class RetrievalOutcome:
    results: list[ScoredPassage]
    matched_subgraph: SubgraphResult
    degraded: bool
    degradation_reasons: list[str]
    rerank_applied: bool
    grounding_confidence: float
    duration_ms: int


class HybridRetrieve:
    def __init__(
        self,
        graph: GraphStore,
        vector: VectorStore,
        embedder: EmbeddingPort,
        reranker: RerankPort | None,
        sql: KnowledgeSqlReader,
    ) -> None:
        self._graph = graph
        self._vector = vector
        self._embedder = embedder
        self._reranker = reranker
        self._sql = sql

    async def execute(
        self, query: str, knowledge_collection_ids: list[str] | None
    ) -> RetrievalOutcome:
        started = perf_counter()
        config = await self._sql.get_retrieval_config(knowledge_collection_ids)
        degraded = False
        reasons: list[str] = []

        [query_embedding] = await self._embedder.embed([query], config.embedding_model)

        # Vector half — always attempted, the retrieval baseline (ADR-0009).
        vector_hits = await self._vector.search(
            query_embedding, config.rerank_candidate_count, knowledge_collection_ids
        )
        vector_scores = {h.chunk_id: h.score for h in vector_hits}

        # Graph half — best-effort. A connectivity failure degrades rather
        # than propagates; any other exception (a real defect) still does.
        graph_scores: dict[str, float] = {}
        matched_subgraph = SubgraphResult(nodes=[], edges=[], rendered_path=None)
        try:
            # Two seed sources, combined: `search_entities` is a substring
            # match of the *whole* query against an entity's name (narrow —
            # it will not find "SEWA" inside "how do I pay my SEWA bill"
            # unless the query happens to equal or extend the entity's name
            # verbatim, since `CONTAINS` is directional the other way), and
            # `extract_entities` runs the same gazetteer matcher ingestion
            # uses, over the query text itself, which is what actually finds
            # named entities *within* a longer natural-language question.
            # Found empirically: a real retrieval call against a real
            # ingested chunk returned the correct vector hit but an empty
            # graph half until this was added, because `search_entities`
            # alone never matches a realistic citizen question.
            seed_keys = [e.canonical_key for e in extract_entities(query)]
            seeds = await self._graph.search_seed_entities(query, limit=10)
            seed_keys.extend(s.canonical_key for s in seeds if s.canonical_key not in seed_keys)
            if seed_keys:
                matched_subgraph = await self._graph.expand_subgraph(
                    seed_keys, max_hops=config.max_graph_hops
                )
                all_keys = [n.canonical_key for n in matched_subgraph.nodes] or seed_keys
                mentions = await self._graph.mentioning_chunks(
                    all_keys, knowledge_collection_ids, limit=config.rerank_candidate_count
                )
                for mention in mentions:
                    graph_scores[mention.chunk_id] = max(
                        graph_scores.get(mention.chunk_id, 0.0), mention.salience
                    )
        except GraphUnavailableError:
            degraded = True
            reasons.append("graph_unavailable")

        # Blend.
        conflict_penalties = await self._sql.get_open_conflict_penalties(
            list({*vector_scores.keys(), *graph_scores.keys()})
        )
        max_vector = max(vector_scores.values(), default=0.0)
        max_graph = max(graph_scores.values(), default=0.0)
        candidate_ids = set(vector_scores) | set(graph_scores)
        blended: dict[str, tuple[float, float, float]] = {}
        for chunk_id in candidate_ids:
            v = normalise(vector_scores.get(chunk_id, 0.0), max_vector)
            g = normalise(graph_scores.get(chunk_id, 0.0), max_graph)
            score = hybrid_score(
                g,
                v,
                config.graph_weight,
                config.vector_weight,
                conflict_penalties.get(chunk_id, 0.0),
            )
            blended[chunk_id] = (score, g, v)

        ranked_ids = sorted(blended, key=lambda cid: blended[cid][0], reverse=True)[
            : config.rerank_candidate_count
        ]

        # Resolve text (§5.1 step 4) — this is also G14's real post-filter for
        # this path: a foreign chunk_id resolves to nothing (see
        # `ports/knowledge_sql.py`'s module docstring).
        chunk_rows = {row.chunk_id: row for row in await self._sql.get_chunks_by_ids(ranked_ids)}
        ranked_ids = [cid for cid in ranked_ids if cid in chunk_rows]

        rerank_applied = False
        if config.reranker_enabled and self._reranker is not None and ranked_ids:
            try:
                order = await self._reranker.rerank(
                    query, [chunk_rows[cid].text for cid in ranked_ids], config.reranker_model or ""
                )
                ranked_ids = [ranked_ids[i] for i in order if 0 <= i < len(ranked_ids)]
                rerank_applied = True
            except RerankUnavailableError:
                degraded = True
                reasons.append("rerank_unavailable")
        elif config.reranker_enabled and self._reranker is None:
            degraded = True
            reasons.append("rerank_unavailable")

        top_ids = ranked_ids[: config.top_k]
        results = [
            ScoredPassage(
                chunk_id=cid,
                score=blended[cid][0],
                graph_score=blended[cid][1],
                vector_score=blended[cid][2],
                text=chunk_rows[cid].text,
                section_path=chunk_rows[cid].section_path,
                page_number=chunk_rows[cid].page_number,
                knowledge_source_id=chunk_rows[cid].knowledge_source_id,
                knowledge_source_name=chunk_rows[cid].knowledge_source_name,
                retrieved_via=_retrieved_via(cid, vector_scores, graph_scores),
            )
            for cid in top_ids
        ]

        top_score = results[0].score if results else 0.0
        top_penalty = conflict_penalties.get(results[0].chunk_id, 0.0) if results else 0.0
        confidence = grounding_confidence(top_score, top_penalty, degraded)

        return RetrievalOutcome(
            results=results,
            matched_subgraph=matched_subgraph,
            degraded=degraded,
            degradation_reasons=reasons,
            rerank_applied=rerank_applied,
            grounding_confidence=confidence,
            duration_ms=int((perf_counter() - started) * 1000),
        )


def _retrieved_via(
    chunk_id: str, vector_scores: dict[str, float], graph_scores: dict[str, float]
) -> str:
    in_vector, in_graph = chunk_id in vector_scores, chunk_id in graph_scores
    if in_vector and in_graph:
        return "Hybrid"
    return "Graph" if in_graph else "Vector"
