"""The observed-side half of reconciliation (data-model.md §9.3).

`shj3-ai` has no write grant on `Chunks`/`IngestionRuns`' expected-set tables
(§3.6), so the *expected* set (from SQL) and the *repair* (resetting
`vectorState`/`graphState`, writing a fresh `OutboxEvent`) both live in the
caller (`shj3-web`). This use case supplies only what only `shj3-ai` can
see: what Qdrant and Neo4j actually hold for one source, right now.
"""

from __future__ import annotations

from dataclasses import dataclass

from shj3_ai.ports.graph_store import GraphStore
from shj3_ai.ports.vector_store import VectorStore


@dataclass(frozen=True, slots=True)
class ObservedChunkIds:
    vector: list[str]
    graph: list[str]


class InspectObservedState:
    def __init__(self, vector: VectorStore, graph: GraphStore) -> None:
        self._vector = vector
        self._graph = graph

    async def execute(self, knowledge_source_id: str) -> ObservedChunkIds:
        return ObservedChunkIds(
            vector=await self._vector.scroll_chunk_ids(knowledge_source_id),
            graph=await self._graph.observed_chunk_ids(knowledge_source_id),
        )
