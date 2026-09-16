"""Unit tests for `EmbedAndIndexChunks` against fakes — the ingestion compute path.

Real Neo4j/Qdrant coverage lives in the isolation suite and the live-infra
proof; this file is about the orchestration logic itself: per-chunk failure
isolation, and that graph writes are honestly reported per chunk rather than
failing the whole batch.
"""

from __future__ import annotations

import pytest

from shj3_ai.application.embed_and_index import ChunkToIndex, EmbedAndIndexChunks
from shj3_ai.ports.graph_store import GraphUnavailableError
from tests.application.fakes import FakeEmbedder, FakeGraphStore, FakeVectorStore


def _chunk(chunk_id: str, text: str, ordinal: int = 0) -> ChunkToIndex:
    return ChunkToIndex(
        chunk_id=chunk_id,
        text=text,
        ordinal=ordinal,
        section_path=None,
        page_number=None,
        locale_code="en",
    )


@pytest.mark.asyncio
async def test_a_chunk_mentioning_a_known_entity_writes_vector_and_graph() -> None:
    graph, vector = FakeGraphStore(), FakeVectorStore()
    use_case = EmbedAndIndexChunks(FakeEmbedder(), vector, graph)

    outcome = await use_case.execute(
        [_chunk("c1", "Pay your SEWA utilities bill online.")],
        knowledge_collection_id="kc1",
        knowledge_source_id="ks1",
        embedding_model="text-embedding-3-large",
        embedding_dimension=8,
    )

    result = outcome.results[0]
    assert result.chunk_id == "c1"
    assert result.vector_state == "Indexed"
    assert result.graph_state == "Indexed"
    assert result.error is None
    assert len(vector.upserted) == 1
    assert any(key == "sewa" for _, key, _ in graph.merged_entities)
    assert any(g.canonical_key == "sewa" for g in outcome.graph_writes)


@pytest.mark.asyncio
async def test_a_graph_failure_marks_only_that_chunks_graph_state_failed() -> None:
    graph = FakeGraphStore(fail_with=GraphUnavailableError("down"))
    vector = FakeVectorStore()
    use_case = EmbedAndIndexChunks(FakeEmbedder(), vector, graph)

    outcome = await use_case.execute(
        [_chunk("c1", "Pay your SEWA utilities bill.")],
        knowledge_collection_id="kc1",
        knowledge_source_id="ks1",
        embedding_model="m",
        embedding_dimension=8,
    )

    result = outcome.results[0]
    assert result.vector_state == "Indexed", (
        "the vector half must not be affected by a graph failure"
    )
    assert result.graph_state == "Failed"
    assert result.error is not None and "graph write failed" in result.error


@pytest.mark.asyncio
async def test_one_bad_chunk_does_not_fail_the_rest_of_the_batch() -> None:
    graph = FakeGraphStore()

    class FlakyVectorStore(FakeVectorStore):
        async def upsert(self, points) -> None:
            if points and points[0].chunk_id == "bad":
                raise RuntimeError("simulated vector failure")
            await super().upsert(points)

    flaky_vector = FlakyVectorStore()
    use_case = EmbedAndIndexChunks(FakeEmbedder(), flaky_vector, graph)

    outcome = await use_case.execute(
        [_chunk("bad", "irrelevant text", 0), _chunk("good", "more irrelevant text", 1)],
        knowledge_collection_id="kc1",
        knowledge_source_id="ks1",
        embedding_model="m",
        embedding_dimension=8,
    )

    by_id = {r.chunk_id: r for r in outcome.results}
    assert by_id["bad"].vector_state == "Failed"
    assert by_id["good"].vector_state == "Indexed", (
        "a failure on one chunk must not abort the batch"
    )


@pytest.mark.asyncio
async def test_no_entities_found_still_writes_the_chunk_reference_node() -> None:
    graph, vector = FakeGraphStore(), FakeVectorStore()
    use_case = EmbedAndIndexChunks(FakeEmbedder(), vector, graph)

    outcome = await use_case.execute(
        [_chunk("c1", "completely unrelated text about gardening")],
        knowledge_collection_id="kc1",
        knowledge_source_id="ks1",
        embedding_model="m",
        embedding_dimension=8,
    )

    assert outcome.results[0].graph_state == "Indexed"
    assert graph.merged_chunk_refs == ["c1"]
    assert outcome.graph_writes == []
