"""The real `KnowledgeSqlReader` — SQL Server reads for Graph RAG (§3.6).

Every method opens its own `tenant_session` (`engine.py`) and closes it
before returning — short-lived, per-call sessions rather than one held open
across a request, matching the stateless-request shape every other adapter in
this package assumes.
"""

from __future__ import annotations

from sqlalchemy import select

from shj3_ai.adapters.outbound.sql._generated_models import (
    Chunk,
    KnowledgeSource,
    RetrievalConfig,
    SourceConflict,
)
from shj3_ai.adapters.outbound.sql.engine import tenant_session
from shj3_ai.domain.tenancy import TenantSlug
from shj3_ai.ports.knowledge_sql import ChunkTextRow, RetrievalConfigRow


class SqlAlchemyKnowledgeReader:
    """Structural `KnowledgeSqlReader` — see `Neo4jGraphStore`'s docstring for
    why this codebase's ports are matched structurally, not subclassed.
    """

    __slots__ = ("_tenant",)

    def __init__(self, tenant: TenantSlug) -> None:
        self._tenant = tenant

    async def get_retrieval_config(
        self, knowledge_collection_ids: list[str] | None
    ) -> RetrievalConfigRow:
        async with tenant_session(self._tenant.value) as session:
            row: RetrievalConfig | None = None
            # A collection-scoped override only applies when the request names
            # exactly one collection — retrieval across several collections
            # has no single collection to scope an override to, so it always
            # falls back to the tenant default (matches `UQ_RetrievalConfigs_
            # knowledgeCollectionId`'s at-most-one-per-collection shape).
            if knowledge_collection_ids and len(knowledge_collection_ids) == 1:
                result = await session.execute(
                    select(RetrievalConfig).where(
                        RetrievalConfig.scope == "Collection",
                        RetrievalConfig.knowledge_collection_id == knowledge_collection_ids[0],
                    )
                )
                row = result.scalar_one_or_none()
            if row is None:
                result = await session.execute(
                    select(RetrievalConfig).where(RetrievalConfig.scope == "Tenant")
                )
                row = result.scalar_one_or_none()
            if row is None:
                raise RuntimeError(
                    f"Tenant {self._tenant.value} has no tenant-scoped RetrievalConfig row. "
                    "Provisioning should seed one — this is a data-integrity gap, not a "
                    "degradable retrieval condition."
                )
            return RetrievalConfigRow(
                chunk_size_tokens=row.chunk_size_tokens,
                chunk_overlap_tokens=row.chunk_overlap_tokens,
                embedding_model=row.embedding_model,
                embedding_dimension=row.embedding_dimension,
                graph_weight=float(row.graph_weight),
                vector_weight=float(row.vector_weight),
                top_k=row.top_k,
                reranker_enabled=row.reranker_enabled,
                reranker_model=row.reranker_model,
                rerank_candidate_count=row.rerank_candidate_count,
                min_grounding_confidence=float(row.min_grounding_confidence),
                max_graph_hops=row.max_graph_hops,
            )

    async def get_chunks_by_ids(self, chunk_ids: list[str]) -> list[ChunkTextRow]:
        if not chunk_ids:
            return []
        async with tenant_session(self._tenant.value) as session:
            result = await session.execute(
                select(Chunk, KnowledgeSource.name)
                .join(KnowledgeSource, KnowledgeSource.id == Chunk.knowledge_source_id)
                .where(Chunk.id.in_(chunk_ids), Chunk.erased_at.is_(None))
            )
            # This `WHERE ... IN` runs against *this tenant's own schema*
            # (bound by `tenant_session`'s `schema_translate_map`) — a
            # `chunk_id` that belongs to another tenant is not a row here at
            # all, so it is silently absent from the result rather than
            # returned and filtered. That absence is G14's real mechanism for
            # the citizen-facing retrieval path (see `ports/knowledge_sql.py`'s
            # module docstring): physical schema-per-tenant isolation
            # (ADR-0002) doing work underneath ADR-0009's graph-side defences.
            return [
                ChunkTextRow(
                    chunk_id=chunk.id,
                    text=chunk.text,
                    section_path=chunk.section_path,
                    page_number=chunk.page_number,
                    knowledge_source_id=chunk.knowledge_source_id,
                    knowledge_source_name=source_name,
                )
                for chunk, source_name in result.all()
            ]

    async def get_open_conflict_penalties(self, chunk_ids: list[str]) -> dict[str, float]:
        if not chunk_ids:
            return {}
        async with tenant_session(self._tenant.value) as session:
            result = await session.execute(
                select(SourceConflict).where(
                    SourceConflict.status == "Open",
                    (
                        SourceConflict.side_a_chunk_id.in_(chunk_ids)
                        | SourceConflict.side_b_chunk_id.in_(chunk_ids)
                    ),
                )
            )
            penalties: dict[str, float] = {}
            for conflict in result.scalars():
                penalty = float(conflict.grounding_penalty)
                for chunk_id in (conflict.side_a_chunk_id, conflict.side_b_chunk_id):
                    if chunk_id in chunk_ids:
                        # Max, not overwrite: a chunk on the losing side of two
                        # open conflicts is at least as unreliable as one.
                        penalties[chunk_id] = max(penalties.get(chunk_id, 0.0), penalty)
            return penalties
