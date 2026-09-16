"""Ingestion compute: embed each chunk, upsert to Qdrant, extract entities and
edges, merge them into Neo4j (`POST /v1/knowledge/ingest/embed-and-index`).

**No SQL writes happen here or anywhere in this module** — `shj3-ai` has no
`INSERT`/`UPDATE` grant on `Chunks`/`GraphNodeRecords`/`GraphEdgeRecords`
(data-model.md §3.6). This use case's whole output is a report of what it
wrote to Neo4j/Qdrant (its own stores); the caller (`shj3-web`, the only
writer of those SQL tables) applies that report to the authoritative ledger.
See `docs/architecture.md` §6's ownership table and this module's caller-side
counterpart in the Next.js `knowledge` module for the other half of this
split.

A per-chunk failure (embedding, vector upsert, or graph write) is caught and
reported in that chunk's own result rather than aborting the whole batch —
one bad chunk in a 200-chunk document should not fail the other 199.
"""

from __future__ import annotations

from dataclasses import dataclass

from shj3_ai.domain.knowledge import DEFAULT_GAZETTEER, extract_entities, infer_edges
from shj3_ai.ports.embedding import EmbeddingPort
from shj3_ai.ports.graph_store import GraphStore, GraphUnavailableError
from shj3_ai.ports.vector_store import VectorPoint, VectorStore


@dataclass(frozen=True, slots=True)
class ChunkToIndex:
    chunk_id: str
    text: str
    ordinal: int
    section_path: str | None
    page_number: int | None
    locale_code: str


@dataclass(frozen=True, slots=True)
class ChunkIndexResult:
    chunk_id: str
    vector_state: str  # "Indexed" | "Failed"
    graph_state: str  # "Indexed" | "Failed"
    error: str | None


@dataclass(frozen=True, slots=True)
class GraphNodeWrite:
    label: str
    canonical_key: str
    canonical_name: str
    first_seen_chunk_id: str


@dataclass(frozen=True, slots=True)
class GraphEdgeWrite:
    relationship_type: str
    from_key: str
    to_key: str
    evidence_chunk_id: str
    confidence: float


@dataclass(frozen=True, slots=True)
class EmbedAndIndexOutcome:
    results: list[ChunkIndexResult]
    graph_writes: list[GraphNodeWrite]
    edge_writes: list[GraphEdgeWrite]


class EmbedAndIndexChunks:
    def __init__(self, embedder: EmbeddingPort, vector: VectorStore, graph: GraphStore) -> None:
        self._embedder = embedder
        self._vector = vector
        self._graph = graph

    async def execute(
        self,
        chunks: list[ChunkToIndex],
        knowledge_collection_id: str,
        knowledge_source_id: str,
        embedding_model: str,
        embedding_dimension: int,
    ) -> EmbedAndIndexOutcome:
        results: list[ChunkIndexResult] = []
        node_writes: dict[tuple[str, str], GraphNodeWrite] = {}
        edge_writes: list[GraphEdgeWrite] = []

        if chunks:
            embeddings = await self._embedder.embed([c.text for c in chunks], embedding_model)
        else:
            embeddings = []

        for chunk, embedding in zip(chunks, embeddings, strict=True):
            vector_state = "Failed"
            graph_state = "Failed"
            error: str | None = None
            try:
                await self._vector.upsert(
                    [
                        VectorPoint(
                            chunk_id=chunk.chunk_id,
                            embedding=embedding,
                            knowledge_collection_id=knowledge_collection_id,
                            knowledge_source_id=knowledge_source_id,
                            source_document_id="",  # filled by the caller's own record; not needed for the point
                            locale_code=chunk.locale_code,
                            embedding_model=embedding_model,
                            embedding_dimension=embedding_dimension,
                            content_hash="",
                            chunk_ordinal=chunk.ordinal,
                        )
                    ]
                )
                vector_state = "Indexed"
            except Exception as exc:
                error = f"vector upsert failed: {exc}"

            try:
                entities = extract_entities(chunk.text, DEFAULT_GAZETTEER)
                await self._graph.merge_chunk_ref(
                    chunk.chunk_id,
                    {
                        "sourceDocumentId": "",
                        "knowledgeSourceId": knowledge_source_id,
                        "knowledgeCollectionId": knowledge_collection_id,
                        "ordinal": chunk.ordinal,
                    },
                )
                for entity in entities:
                    await self._graph.merge_entity(
                        entity.label, entity.canonical_key, entity.canonical_name, {}
                    )
                    await self._graph.merge_chunk_edge(
                        "MENTIONS",
                        chunk.chunk_id,
                        entity.label,
                        entity.canonical_key,
                        {"salience": 1.0},
                    )
                    key = (entity.label, entity.canonical_key)
                    if key not in node_writes:
                        node_writes[key] = GraphNodeWrite(
                            label=entity.label,
                            canonical_key=entity.canonical_key,
                            canonical_name=entity.canonical_name,
                            first_seen_chunk_id=chunk.chunk_id,
                        )
                for edge in infer_edges(entities):
                    await self._graph.merge_relationship(
                        edge.relationship_type,
                        edge.from_key,
                        edge.to_key,
                        {"confidence": edge.confidence},
                    )
                    edge_writes.append(
                        GraphEdgeWrite(
                            relationship_type=edge.relationship_type,
                            from_key=edge.from_key,
                            to_key=edge.to_key,
                            evidence_chunk_id=chunk.chunk_id,
                            confidence=edge.confidence,
                        )
                    )
                graph_state = "Indexed"
            except GraphUnavailableError as exc:
                # Ingestion-time graph failure is honestly reported per chunk
                # (`graphState='Failed'`, repairable by reconciliation/re-index)
                # rather than degraded — degradation is a *retrieval-time*
                # concept (ADR-0009: "retrieval degrades to vector-only");
                # ingestion has nothing to degrade to, since the whole point
                # of this call is to write the graph.
                error = f"{error + '; ' if error else ''}graph write failed: {exc}"
            except Exception as exc:
                error = f"{error + '; ' if error else ''}graph write failed: {exc}"

            results.append(
                ChunkIndexResult(
                    chunk_id=chunk.chunk_id,
                    vector_state=vector_state,
                    graph_state=graph_state,
                    error=error,
                )
            )

        return EmbedAndIndexOutcome(
            results=results, graph_writes=list(node_writes.values()), edge_writes=edge_writes
        )
