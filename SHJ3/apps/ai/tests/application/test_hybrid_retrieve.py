"""Unit tests for `HybridRetrieve` against fakes — including the two named
degradation paths (ADR-0009 / FR-KNOW-14), proven here at the orchestration
level and again for real against live infrastructure in the wave's
live-infrastructure proof.
"""

from __future__ import annotations

import pytest

from shj3_ai.application.hybrid_retrieve import HybridRetrieve
from shj3_ai.ports.graph_store import (
    ChunkMention,
    GraphEntityRef,
    GraphUnavailableError,
    SubgraphResult,
)
from shj3_ai.ports.knowledge_sql import ChunkTextRow
from shj3_ai.ports.vector_store import VectorHit
from tests.application.fakes import (
    FakeEmbedder,
    FakeGraphStore,
    FakeKnowledgeSqlReader,
    FakeReranker,
    FakeVectorStore,
    default_config,
)


def _chunk_row(chunk_id: str, text: str = "some passage text") -> ChunkTextRow:
    return ChunkTextRow(
        chunk_id=chunk_id,
        text=text,
        section_path=None,
        page_number=None,
        knowledge_source_id="ks1",
        knowledge_source_name="Source One",
    )


@pytest.mark.asyncio
async def test_healthy_path_blends_graph_and_vector_and_reranks() -> None:
    graph, vector = FakeGraphStore(), FakeVectorStore()
    graph.seed_entities = [
        GraphEntityRef(label="Provider", canonical_key="sewa", canonical_name="SEWA", properties={})
    ]
    graph.subgraph = SubgraphResult(
        nodes=[
            GraphEntityRef(
                label="Provider", canonical_key="sewa", canonical_name="SEWA", properties={}
            )
        ],
        edges=[],
        rendered_path="SEWA",
    )
    graph.mentions = [ChunkMention(chunk_id="c1", entity_key="sewa", salience=1.0)]
    vector.hits = [VectorHit(chunk_id="c1", score=0.9)]
    sql = FakeKnowledgeSqlReader(default_config(), {"c1": _chunk_row("c1")})

    use_case = HybridRetrieve(graph, vector, FakeEmbedder(), FakeReranker(), sql)
    outcome = await use_case.execute("pay my SEWA bill", None)

    assert not outcome.degraded
    assert outcome.rerank_applied
    assert len(outcome.results) == 1
    assert outcome.results[0].chunk_id == "c1"
    assert outcome.results[0].retrieved_via == "Hybrid"
    assert outcome.matched_subgraph.rendered_path == "SEWA"


@pytest.mark.asyncio
async def test_graph_unavailable_degrades_to_vector_only_and_never_raises() -> None:
    graph = FakeGraphStore(fail_with=GraphUnavailableError("neo4j down"))
    vector = FakeVectorStore()
    vector.hits = [VectorHit(chunk_id="c1", score=0.9)]
    sql = FakeKnowledgeSqlReader(default_config(), {"c1": _chunk_row("c1")})

    use_case = HybridRetrieve(graph, vector, FakeEmbedder(), FakeReranker(), sql)
    outcome = await use_case.execute("pay my SEWA bill", None)

    # The whole point: this must complete, not raise, and still return the
    # vector-half result — "a citizen conversation must never fail because
    # the graph is down" (ADR-0009).
    assert outcome.degraded is True
    assert "graph_unavailable" in outcome.degradation_reasons
    assert len(outcome.results) == 1
    assert outcome.results[0].chunk_id == "c1"
    assert outcome.results[0].graph_score == 0.0
    assert outcome.results[0].retrieved_via == "Vector"


@pytest.mark.asyncio
async def test_graph_unavailable_lowers_grounding_confidence_versus_the_healthy_path() -> None:
    vector = FakeVectorStore()
    vector.hits = [VectorHit(chunk_id="c1", score=0.9)]
    sql = FakeKnowledgeSqlReader(default_config(), {"c1": _chunk_row("c1")})

    healthy = await HybridRetrieve(
        FakeGraphStore(), vector, FakeEmbedder(), FakeReranker(), sql
    ).execute("pay my bill", None)
    degraded = await HybridRetrieve(
        FakeGraphStore(fail_with=GraphUnavailableError("down")),
        vector,
        FakeEmbedder(),
        FakeReranker(),
        sql,
    ).execute("pay my bill", None)

    assert degraded.grounding_confidence < healthy.grounding_confidence


@pytest.mark.asyncio
async def test_rerank_unavailable_degrades_to_unreranked_hybrid_order() -> None:
    graph, vector = FakeGraphStore(), FakeVectorStore()
    vector.hits = [VectorHit(chunk_id="c1", score=0.9), VectorHit(chunk_id="c2", score=0.5)]
    sql = FakeKnowledgeSqlReader(default_config(), {"c1": _chunk_row("c1"), "c2": _chunk_row("c2")})

    use_case = HybridRetrieve(graph, vector, FakeEmbedder(), FakeReranker(fail=True), sql)
    outcome = await use_case.execute("pay my bill", None)

    assert outcome.degraded is True
    assert "rerank_unavailable" in outcome.degradation_reasons
    assert outcome.rerank_applied is False
    # Hybrid order stands: c1 (higher vector score) ranks first, not reversed
    # (a reversed order is exactly what `FakeReranker` would have produced
    # had it actually run).
    assert [r.chunk_id for r in outcome.results] == ["c1", "c2"]


@pytest.mark.asyncio
async def test_no_reranker_configured_degrades_the_same_way_a_failure_would() -> None:
    graph, vector = FakeGraphStore(), FakeVectorStore()
    vector.hits = [VectorHit(chunk_id="c1", score=0.9)]
    sql = FakeKnowledgeSqlReader(default_config(), {"c1": _chunk_row("c1")})

    use_case = HybridRetrieve(graph, vector, FakeEmbedder(), reranker=None, sql=sql)
    outcome = await use_case.execute("pay my bill", None)

    assert "rerank_unavailable" in outcome.degradation_reasons
    assert outcome.rerank_applied is False


@pytest.mark.asyncio
async def test_a_chunk_id_with_no_sql_row_is_silently_dropped() -> None:
    """G14's real mechanism for this path: a chunk_id that does not resolve
    through this tenant's own SQL schema is simply absent from the result,
    proven here at the orchestration level by a `FakeKnowledgeSqlReader`
    that has no row for it (standing in for "this chunk belongs to another
    tenant's schema" — see `ports/knowledge_sql.py`'s module docstring).
    """
    graph, vector = FakeGraphStore(), FakeVectorStore()
    vector.hits = [VectorHit(chunk_id="foreign-chunk", score=0.99)]
    sql = FakeKnowledgeSqlReader(default_config(), {})  # no rows at all

    use_case = HybridRetrieve(graph, vector, FakeEmbedder(), FakeReranker(), sql)
    outcome = await use_case.execute("anything", None)

    assert outcome.results == []
