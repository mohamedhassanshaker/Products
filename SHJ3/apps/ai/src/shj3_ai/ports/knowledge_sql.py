"""Read-only SQL access `shj3-ai` needs for Graph RAG (data-model.md §3.6).

`shj3-ai` holds `GRANT SELECT ON SCHEMA::[<tenant>]` — everything here is a
read. The database grant only permits `INSERT`/`UPDATE` on six tables
(`ConversationTurns`, `OrchestrationTraces`, `OrchestrationTraceSteps`,
`GroundingCitations`, `ReindexJobs`, `IngestionRuns`), none of which this
module writes to in this pass — re-index execution and ingestion-run
bookkeeping are driven from `shj3-web` (the only writer of `Chunks`,
`KnowledgeSources`, `GraphNodeRecords`/`GraphEdgeRecords` and everything else
Graph RAG needs persisted), which is also why this port has no write methods
at all. Resolving a `chunk_id` through this port is also the mechanism behind
G14, the post-retrieval re-filter: a `chunk_id` belonging to another tenant
simply is not a row in *this* tenant's schema, so it resolves to nothing and
is silently dropped — schema-per-tenant (ADR-0002) doing real, independent
work underneath ADR-0009's graph-side defences.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True, slots=True)
class RetrievalConfigRow:
    chunk_size_tokens: int
    chunk_overlap_tokens: int
    embedding_model: str
    embedding_dimension: int
    graph_weight: float
    vector_weight: float
    top_k: int
    reranker_enabled: bool
    reranker_model: str | None
    rerank_candidate_count: int
    min_grounding_confidence: float
    max_graph_hops: int


@dataclass(frozen=True, slots=True)
class ChunkTextRow:
    chunk_id: str
    text: str
    section_path: str | None
    page_number: int | None
    knowledge_source_id: str
    knowledge_source_name: str


class KnowledgeSqlReader(Protocol):
    async def get_retrieval_config(
        self, knowledge_collection_ids: list[str] | None
    ) -> RetrievalConfigRow:
        """The tenant's live config, or the collection-scoped override when exactly one
        collection is requested and it has one (`RetrievalConfigs.scope='Collection'`).
        """

    async def get_chunks_by_ids(self, chunk_ids: list[str]) -> list[ChunkTextRow]:
        """Resolve chunk ids to their authoritative text (§5.1 step 4; G14's post-filter)."""

    async def get_open_conflict_penalties(self, chunk_ids: list[str]) -> dict[str, float]:
        """`groundingPenalty` for any chunk on either side of an **open** `SourceConflict`."""
