"""In-memory fakes for Graph RAG's application-layer tests.

One fake per port, mirroring `tests/provisioning/test_qdrant_provisioner.py`'s
`FakeCollectionAdmin` convention. These exist so `embed_and_index.py` and
`hybrid_retrieve.py`'s real orchestration logic — degradation branching
included — is unit-testable without a container, the same reason the
provisioning tests already work this way.
"""

from __future__ import annotations

from shj3_ai.ports.graph_store import (
    ChunkMention,
    DuplicateCandidateRef,
    GraphEntityRef,
    InvariantCounts,
    SubgraphResult,
)
from shj3_ai.ports.knowledge_sql import ChunkTextRow, RetrievalConfigRow
from shj3_ai.ports.reranker import RerankUnavailableError
from shj3_ai.ports.vector_store import VectorHit, VectorPoint


class FakeGraphStore:
    """Records every write; `fail_with` makes every read raise `GraphUnavailableError`."""

    def __init__(self, fail_with: Exception | None = None) -> None:
        self.fail_with = fail_with
        self.merged_entities: list[tuple[str, str, str]] = []
        self.merged_relationships: list[tuple[str, str, str]] = []
        self.merged_chunk_refs: list[str] = []
        self.merged_chunk_edges: list[tuple[str, str]] = []
        self.deleted: list[str] = []
        self.merged_duplicates: list[tuple[str, str]] = []
        self.ignored_duplicates: list[tuple[str, str]] = []
        #: What `search_seed_entities`/`expand_subgraph`/`mentioning_chunks` return.
        self.seed_entities: list[GraphEntityRef] = []
        self.subgraph = SubgraphResult(nodes=[], edges=[], rendered_path=None)
        self.mentions: list[ChunkMention] = []
        self.duplicate_candidates: list[DuplicateCandidateRef] = []
        self.invariants = InvariantCounts(0, 0, 0)
        self.observed_ids: list[str] = []

    def _maybe_fail(self) -> None:
        if self.fail_with is not None:
            raise self.fail_with

    async def search_seed_entities(self, text: str, limit: int = 25) -> list[GraphEntityRef]:
        self._maybe_fail()
        return self.seed_entities

    async def expand_subgraph(self, canonical_keys: list[str], max_hops: int = 2) -> SubgraphResult:
        self._maybe_fail()
        return self.subgraph

    async def mentioning_chunks(
        self, entity_keys: list[str], knowledge_collection_ids: list[str] | None, limit: int = 200
    ) -> list[ChunkMention]:
        self._maybe_fail()
        return self.mentions

    async def merge_entity(
        self, label: str, canonical_key: str, canonical_name: str, properties: dict
    ) -> None:
        self._maybe_fail()
        self.merged_entities.append((label, canonical_key, canonical_name))

    async def merge_relationship(
        self, relationship_type: str, from_key: str, to_key: str, properties: dict | None = None
    ) -> None:
        self._maybe_fail()
        self.merged_relationships.append((relationship_type, from_key, to_key))

    async def merge_chunk_ref(self, chunk_id: str, properties: dict) -> None:
        self._maybe_fail()
        self.merged_chunk_refs.append(chunk_id)

    async def merge_chunk_edge(
        self,
        relationship_type: str,
        chunk_id: str,
        entity_label: str,
        entity_key: str,
        properties: dict | None = None,
    ) -> None:
        self._maybe_fail()
        self.merged_chunk_edges.append((chunk_id, entity_key))

    async def delete_entity(self, canonical_key: str) -> None:
        self._maybe_fail()
        self.deleted.append(canonical_key)

    async def browse(self, root_key, depth, types, limit) -> SubgraphResult:
        self._maybe_fail()
        return self.subgraph

    async def detect_duplicates(self, label: str, limit: int = 50) -> list[DuplicateCandidateRef]:
        self._maybe_fail()
        return self.duplicate_candidates

    async def merge_duplicates(self, keep_key: str, absorb_key: str) -> None:
        self._maybe_fail()
        self.merged_duplicates.append((keep_key, absorb_key))

    async def ignore_duplicates(self, left_key: str, right_key: str, similarity: float) -> None:
        self._maybe_fail()
        self.ignored_duplicates.append((left_key, right_key))

    async def assert_invariants(self) -> InvariantCounts:
        self._maybe_fail()
        return self.invariants

    async def observed_chunk_ids(self, knowledge_source_id: str) -> list[str]:
        self._maybe_fail()
        return self.observed_ids


class FakeVectorStore:
    def __init__(self) -> None:
        self.upserted: list[VectorPoint] = []
        self.hits: list[VectorHit] = []
        self.deleted_sources: list[str] = []

    async def upsert(self, points: list[VectorPoint]) -> None:
        self.upserted.extend(points)

    async def search(self, embedding, limit, knowledge_collection_ids) -> list[VectorHit]:
        return self.hits

    async def delete_by_source(self, knowledge_source_id: str) -> None:
        self.deleted_sources.append(knowledge_source_id)

    async def scroll_chunk_ids(self, knowledge_source_id: str) -> list[str]:
        return []


class FakeEmbedder:
    """Returns a fixed-length zero vector per input, one call recorded per text."""

    def __init__(self, dimension: int = 8) -> None:
        self.dimension = dimension
        self.calls: list[str] = []

    async def embed(self, texts: list[str], model: str) -> list[list[float]]:
        self.calls.extend(texts)
        return [[0.0] * self.dimension for _ in texts]


class FakeReranker:
    """`fail=True` raises `RerankUnavailableError`; otherwise reverses the order,
    so a test can tell "reranked" apart from "hybrid order preserved" unambiguously.
    """

    def __init__(self, fail: bool = False) -> None:
        self.fail = fail

    async def rerank(self, query: str, documents: list[str], model: str) -> list[int]:
        if self.fail:
            raise RerankUnavailableError("fake rerank failure")
        return list(reversed(range(len(documents))))


class FakeKnowledgeSqlReader:
    def __init__(
        self, config: RetrievalConfigRow, chunks: dict[str, ChunkTextRow] | None = None
    ) -> None:
        self.config = config
        self.chunks = chunks or {}
        self.conflict_penalties: dict[str, float] = {}

    async def get_retrieval_config(
        self, knowledge_collection_ids: list[str] | None
    ) -> RetrievalConfigRow:
        return self.config

    async def get_chunks_by_ids(self, chunk_ids: list[str]) -> list[ChunkTextRow]:
        return [self.chunks[cid] for cid in chunk_ids if cid in self.chunks]

    async def get_open_conflict_penalties(self, chunk_ids: list[str]) -> dict[str, float]:
        return {cid: p for cid, p in self.conflict_penalties.items() if cid in chunk_ids}


def default_config(**overrides) -> RetrievalConfigRow:
    base = {
        "chunk_size_tokens": 512,
        "chunk_overlap_tokens": 64,
        "embedding_model": "text-embedding-3-large",
        "embedding_dimension": 8,
        "graph_weight": 0.6,
        "vector_weight": 0.4,
        "top_k": 8,
        "reranker_enabled": True,
        "reranker_model": "rerank-v3.5",
        "rerank_candidate_count": 40,
        "min_grounding_confidence": 0.6,
        "max_graph_hops": 3,
    }
    base.update(overrides)
    return RetrievalConfigRow(**base)
