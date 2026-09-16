"""The `VectorStore` port — Graph RAG's boundary onto Qdrant (ADR-0003, data-model.md §7).

No degradation exception is defined here, deliberately: the vector half is
the retrieval baseline (ADR-0009 — the graph degrades to it, not the other
way around), so a Qdrant outage has no documented fallback and this port does
not pretend one exists. A caller that needs to distinguish "Qdrant is down"
from any other failure can still catch a generic exception; there is no
`VectorStoreUnavailableError` to catch specifically, because nothing in this
wave's brief asks retrieval to survive Qdrant being down — only the graph.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True, slots=True)
class VectorPoint:
    chunk_id: str
    embedding: list[float]
    knowledge_collection_id: str
    knowledge_source_id: str
    source_document_id: str
    locale_code: str
    embedding_model: str
    embedding_dimension: int
    content_hash: str
    chunk_ordinal: int


@dataclass(frozen=True, slots=True)
class VectorHit:
    chunk_id: str
    score: float


class VectorStore(Protocol):
    """Point lifecycle for one tenant's collection, already resolved (§7.1)."""

    async def upsert(self, points: list[VectorPoint]) -> None:
        """Insert or replace points, keyed by the deterministic `chunk_id`-derived id (§7.4)."""

    async def search(
        self,
        embedding: list[float],
        limit: int,
        knowledge_collection_ids: list[str] | None,
    ) -> list[VectorHit]:
        """Nearest neighbours, payload-filtered to the requested collections and this tenant."""

    async def delete_by_source(self, knowledge_source_id: str) -> None:
        """Remove every point for one source (FR-KNOW-04's source-removal cascade)."""

    async def scroll_chunk_ids(self, knowledge_source_id: str) -> list[str]:
        """Every `chunk_id` payload value for one source — reconciliation's observed set (§9.3)."""
