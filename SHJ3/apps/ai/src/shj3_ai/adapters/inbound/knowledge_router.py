"""Graph RAG's tenant-scoped internal API (B6) — `POST /v1/knowledge/*`.

Every route depends on `TenantContextDep` (`tenant_auth.py`), so
`current_tenant()` is always bound before a handler runs — no route below
reads a tenant from its own request body, unlike `provisioning_router.py`'s
audited cross-tenant exception (see that module's docstring for why that one
case is different).

Ports are constructed per request from the environment, mirroring
`provisioning_router.py`'s `get_graph_provisioner()`/
`collection_admin_from_environment()` convention exactly (a fresh driver/
client per call) — an efficiency question for a later pass, not a
correctness one, and not worth diverging from this codebase's existing
pattern for.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from shj3_ai.adapters.inbound.tenant_auth import TenantContextDep
from shj3_ai.adapters.outbound.embedding.openai_embedder import embedder_from_environment
from shj3_ai.adapters.outbound.graph.graph_provisioner import Neo4jStatementExecutor
from shj3_ai.adapters.outbound.graph.graph_store import Neo4jGraphStore
from shj3_ai.adapters.outbound.rerank.cohere_reranker import reranker_from_environment
from shj3_ai.adapters.outbound.sql.knowledge_repository import SqlAlchemyKnowledgeReader
from shj3_ai.adapters.outbound.vector.qdrant_vector_store import (
    QdrantVectorStore,
    vector_client_from_environment,
)
from shj3_ai.application.embed_and_index import ChunkToIndex, EmbedAndIndexChunks
from shj3_ai.application.graph_admin import (
    ApplyGraphNode,
    AssertGraphInvariants,
    BrowseGraph,
    DeleteGraphNode,
    DetectDuplicates,
    IgnoreDuplicates,
    MergeDuplicates,
)
from shj3_ai.application.hybrid_retrieve import HybridRetrieve
from shj3_ai.application.reconcile_inspect import InspectObservedState
from shj3_ai.domain.knowledge import chunk_document

router = APIRouter(prefix="/v1/knowledge", tags=["knowledge"])


# ---------------------------------------------------------------------------
# Per-request port construction. See module docstring for why this mirrors
# `provisioning_router.py` rather than pooling connections across requests.
# ---------------------------------------------------------------------------


def _graph_store(context: TenantContextDep) -> Neo4jGraphStore:
    return Neo4jGraphStore(Neo4jStatementExecutor.from_environment(), context.tenant)


def _vector_store(context: TenantContextDep) -> QdrantVectorStore:
    return QdrantVectorStore(vector_client_from_environment(), context.tenant)


def _sql_reader(context: TenantContextDep) -> SqlAlchemyKnowledgeReader:
    return SqlAlchemyKnowledgeReader(context.tenant)


GraphDep = Annotated[Neo4jGraphStore, Depends(_graph_store)]
VectorDep = Annotated[QdrantVectorStore, Depends(_vector_store)]
SqlDep = Annotated[SqlAlchemyKnowledgeReader, Depends(_sql_reader)]


# ---------------------------------------------------------------------------
# 1. Chunking — pure compute, no ports, no tenant needed. Still behind
#    `TenantContextDep` for a consistent auth posture across the surface, even
#    though the chunker itself does not read the tenant.
# ---------------------------------------------------------------------------


class ChunkRequest(BaseModel):
    document_text: str = Field(alias="documentText")
    chunk_size_tokens: int = Field(alias="chunkSizeTokens", gt=0)
    chunk_overlap_tokens: int = Field(alias="chunkOverlapTokens", ge=0)
    locale_code: str = Field(alias="localeCode")


class ChunkSpanOut(BaseModel):
    ordinal: int
    text: str
    token_count: int = Field(serialization_alias="tokenCount")
    char_start: int = Field(serialization_alias="charStart")
    char_end: int = Field(serialization_alias="charEnd")
    content_hash: str = Field(serialization_alias="contentHash")


class ChunkResponse(BaseModel):
    chunks: list[ChunkSpanOut]


@router.post("/ingest/chunk", response_model=ChunkResponse)
async def ingest_chunk(request: ChunkRequest, _context: TenantContextDep) -> ChunkResponse:
    spans = chunk_document(
        request.document_text, request.chunk_size_tokens, request.chunk_overlap_tokens
    )
    return ChunkResponse(
        chunks=[
            ChunkSpanOut(
                ordinal=s.ordinal,
                text=s.text,
                token_count=s.token_count,
                char_start=s.char_start,
                char_end=s.char_end,
                content_hash=s.content_hash,
            )
            for s in spans
        ]
    )


# ---------------------------------------------------------------------------
# 2. Embed + index
# ---------------------------------------------------------------------------


class ChunkIn(BaseModel):
    chunk_id: str = Field(alias="chunkId")
    text: str
    ordinal: int
    section_path: str | None = Field(alias="sectionPath")
    page_number: int | None = Field(alias="pageNumber")
    locale_code: str = Field(alias="localeCode")


class EmbedAndIndexRequest(BaseModel):
    knowledge_collection_id: str = Field(alias="knowledgeCollectionId")
    knowledge_source_id: str = Field(alias="knowledgeSourceId")
    embedding_model: str = Field(alias="embeddingModel")
    embedding_dimension: int = Field(alias="embeddingDimension")
    chunks: list[ChunkIn]


class ChunkResultOut(BaseModel):
    chunk_id: str = Field(serialization_alias="chunkId")
    vector_state: str = Field(serialization_alias="vectorState")
    graph_state: str = Field(serialization_alias="graphState")
    error: str | None


class GraphNodeWriteOut(BaseModel):
    label: str
    canonical_key: str = Field(serialization_alias="canonicalKey")
    canonical_name: str = Field(serialization_alias="canonicalName")
    first_seen_chunk_id: str = Field(serialization_alias="firstSeenChunkId")


class GraphEdgeWriteOut(BaseModel):
    relationship_type: str = Field(serialization_alias="relationshipType")
    from_key: str = Field(serialization_alias="fromKey")
    to_key: str = Field(serialization_alias="toKey")
    evidence_chunk_id: str = Field(serialization_alias="evidenceChunkId")
    confidence: float


class EmbedAndIndexResponse(BaseModel):
    results: list[ChunkResultOut]
    graph_writes: list[GraphNodeWriteOut] = Field(serialization_alias="graphWrites")
    edge_writes: list[GraphEdgeWriteOut] = Field(serialization_alias="edgeWrites")


@router.post("/ingest/embed-and-index", response_model=EmbedAndIndexResponse)
async def embed_and_index(
    request: EmbedAndIndexRequest, graph: GraphDep, vector: VectorDep, _context: TenantContextDep
) -> EmbedAndIndexResponse:
    use_case = EmbedAndIndexChunks(
        embedder_from_environment(request.embedding_dimension), vector, graph
    )
    outcome = await use_case.execute(
        [
            ChunkToIndex(
                chunk_id=c.chunk_id,
                text=c.text,
                ordinal=c.ordinal,
                section_path=c.section_path,
                page_number=c.page_number,
                locale_code=c.locale_code,
            )
            for c in request.chunks
        ],
        request.knowledge_collection_id,
        request.knowledge_source_id,
        request.embedding_model,
        request.embedding_dimension,
    )
    return EmbedAndIndexResponse(
        results=[
            ChunkResultOut(
                chunk_id=r.chunk_id,
                vector_state=r.vector_state,
                graph_state=r.graph_state,
                error=r.error,
            )
            for r in outcome.results
        ],
        graph_writes=[
            GraphNodeWriteOut(
                label=g.label,
                canonical_key=g.canonical_key,
                canonical_name=g.canonical_name,
                first_seen_chunk_id=g.first_seen_chunk_id,
            )
            for g in outcome.graph_writes
        ],
        edge_writes=[
            GraphEdgeWriteOut(
                relationship_type=e.relationship_type,
                from_key=e.from_key,
                to_key=e.to_key,
                evidence_chunk_id=e.evidence_chunk_id,
                confidence=e.confidence,
            )
            for e in outcome.edge_writes
        ],
    )


# ---------------------------------------------------------------------------
# 3. Retrieval
# ---------------------------------------------------------------------------


class RetrievalQueryRequest(BaseModel):
    query: str
    knowledge_collection_ids: list[str] | None = Field(alias="knowledgeCollectionIds", default=None)


class ScoredPassageOut(BaseModel):
    chunk_id: str = Field(serialization_alias="chunkId")
    score: float
    graph_score: float = Field(serialization_alias="graphScore")
    vector_score: float = Field(serialization_alias="vectorScore")
    text: str
    section_path: str | None = Field(serialization_alias="sectionPath")
    page_number: int | None = Field(serialization_alias="pageNumber")
    knowledge_source_id: str = Field(serialization_alias="knowledgeSourceId")
    knowledge_source_name: str = Field(serialization_alias="knowledgeSourceName")
    retrieved_via: str = Field(serialization_alias="retrievedVia")


class MatchedSubgraphOut(BaseModel):
    nodes: list[dict[str, str]]
    edges: list[dict[str, str]]
    rendered_path: str | None = Field(serialization_alias="renderedPath")


class RetrievalQueryResponse(BaseModel):
    results: list[ScoredPassageOut]
    matched_subgraph: MatchedSubgraphOut = Field(serialization_alias="matchedSubgraph")
    degraded: bool
    degradation_reasons: list[str] = Field(serialization_alias="degradationReasons")
    rerank_applied: bool = Field(serialization_alias="rerankApplied")
    grounding_confidence: float = Field(serialization_alias="groundingConfidence")
    duration_ms: int = Field(serialization_alias="durationMs")


@router.post("/retrieval/query", response_model=RetrievalQueryResponse)
async def retrieval_query(
    request: RetrievalQueryRequest,
    graph: GraphDep,
    vector: VectorDep,
    sql: SqlDep,
    _context: TenantContextDep,
) -> RetrievalQueryResponse:
    config = await sql.get_retrieval_config(request.knowledge_collection_ids)
    use_case = HybridRetrieve(
        graph,
        vector,
        embedder_from_environment(config.embedding_dimension),
        reranker_from_environment(),
        sql,
    )
    outcome = await use_case.execute(request.query, request.knowledge_collection_ids)
    return RetrievalQueryResponse(
        results=[
            ScoredPassageOut(
                chunk_id=r.chunk_id,
                score=r.score,
                graph_score=r.graph_score,
                vector_score=r.vector_score,
                text=r.text,
                section_path=r.section_path,
                page_number=r.page_number,
                knowledge_source_id=r.knowledge_source_id,
                knowledge_source_name=r.knowledge_source_name,
                retrieved_via=r.retrieved_via,
            )
            for r in outcome.results
        ],
        matched_subgraph=MatchedSubgraphOut(
            nodes=[
                {"key": n.canonical_key, "label": n.label, "name": n.canonical_name}
                for n in outcome.matched_subgraph.nodes
            ],
            edges=[
                {"from": e.from_key, "to": e.to_key, "type": e.relationship_type}
                for e in outcome.matched_subgraph.edges
            ],
            rendered_path=outcome.matched_subgraph.rendered_path,
        ),
        degraded=outcome.degraded,
        degradation_reasons=outcome.degradation_reasons,
        rerank_applied=outcome.rerank_applied,
        grounding_confidence=outcome.grounding_confidence,
        duration_ms=outcome.duration_ms,
    )


# ---------------------------------------------------------------------------
# 4-6. Graph browse / manual node / delete node
# ---------------------------------------------------------------------------


class GraphBrowseRequest(BaseModel):
    root_key: str | None = Field(alias="rootKey", default=None)
    depth: int = 2
    types: list[str] | None = None
    limit: int = 250


class SubgraphResponse(BaseModel):
    nodes: list[dict[str, object]]
    edges: list[dict[str, str]]
    truncated: bool


@router.post("/graph/browse", response_model=SubgraphResponse)
async def graph_browse(
    request: GraphBrowseRequest, graph: GraphDep, _context: TenantContextDep
) -> SubgraphResponse:
    result = await BrowseGraph(graph).execute(
        request.root_key, request.depth, request.types, request.limit
    )
    return SubgraphResponse(
        nodes=[
            {
                "key": n.canonical_key,
                "label": n.label,
                "name": n.canonical_name,
                "properties": n.properties,
            }
            for n in result.nodes
        ],
        edges=[
            {"from": e.from_key, "to": e.to_key, "type": e.relationship_type} for e in result.edges
        ],
        truncated=result.truncated,
    )


class GraphNodeCreateRequest(BaseModel):
    label: str
    canonical_key: str = Field(alias="canonicalKey")
    canonical_name: str = Field(alias="canonicalName")
    properties: dict[str, object] = Field(default_factory=dict)
    parent_key: str | None = Field(alias="parentKey", default=None)
    relationship_type: str | None = Field(alias="relationshipType", default=None)


class OkResponse(BaseModel):
    ok: bool = True


@router.post("/graph/nodes", response_model=OkResponse)
async def graph_node_create(
    request: GraphNodeCreateRequest, graph: GraphDep, _context: TenantContextDep
) -> OkResponse:
    await ApplyGraphNode(graph).execute(
        request.label,  # type: ignore[arg-type]
        request.canonical_key,
        request.canonical_name,
        request.properties,
        request.parent_key,
        request.relationship_type,
    )
    return OkResponse()


class GraphNodeDeleteRequest(BaseModel):
    canonical_key: str = Field(alias="canonicalKey")


@router.post("/graph/nodes/delete", response_model=OkResponse)
async def graph_node_delete(
    request: GraphNodeDeleteRequest, graph: GraphDep, _context: TenantContextDep
) -> OkResponse:
    await DeleteGraphNode(graph).execute(request.canonical_key)
    return OkResponse()


# ---------------------------------------------------------------------------
# 7-9. Duplicates
# ---------------------------------------------------------------------------


class DuplicatesDetectRequest(BaseModel):
    label: str


class DuplicateCandidateOut(BaseModel):
    left_canonical_key: str = Field(serialization_alias="leftCanonicalKey")
    right_canonical_key: str = Field(serialization_alias="rightCanonicalKey")
    left_name: str = Field(serialization_alias="leftName")
    right_name: str = Field(serialization_alias="rightName")
    similarity: float
    detection_method: str = Field(
        serialization_alias="detectionMethod", default="FullTextSimilarity"
    )


class DuplicatesDetectResponse(BaseModel):
    candidates: list[DuplicateCandidateOut]


@router.post("/duplicates/detect", response_model=DuplicatesDetectResponse)
async def duplicates_detect(
    request: DuplicatesDetectRequest, graph: GraphDep, _context: TenantContextDep
) -> DuplicatesDetectResponse:
    candidates = await DetectDuplicates(graph).execute(request.label)  # type: ignore[arg-type]
    return DuplicatesDetectResponse(
        candidates=[
            DuplicateCandidateOut(
                left_canonical_key=c.left_canonical_key,
                right_canonical_key=c.right_canonical_key,
                left_name=c.left_name,
                right_name=c.right_name,
                similarity=c.similarity,
            )
            for c in candidates
        ]
    )


class DuplicatesDecisionRequest(BaseModel):
    keep_canonical_key: str = Field(alias="keepCanonicalKey")
    absorb_canonical_key: str = Field(alias="absorbCanonicalKey")


@router.post("/duplicates/merge", response_model=OkResponse)
async def duplicates_merge(
    request: DuplicatesDecisionRequest, graph: GraphDep, _context: TenantContextDep
) -> OkResponse:
    await MergeDuplicates(graph).execute(request.keep_canonical_key, request.absorb_canonical_key)
    return OkResponse()


@router.post("/duplicates/ignore", response_model=OkResponse)
async def duplicates_ignore(
    request: DuplicatesDecisionRequest, graph: GraphDep, _context: TenantContextDep
) -> OkResponse:
    await IgnoreDuplicates(graph).execute(
        request.keep_canonical_key, request.absorb_canonical_key, 1.0
    )
    return OkResponse()


# ---------------------------------------------------------------------------
# 10-11. Reconciliation
# ---------------------------------------------------------------------------


class ReconcileInspectRequest(BaseModel):
    knowledge_source_id: str = Field(alias="knowledgeSourceId")


class ReconcileInspectResponse(BaseModel):
    observed_vector_chunk_ids: list[str] = Field(serialization_alias="observedVectorChunkIds")
    observed_graph_chunk_ids: list[str] = Field(serialization_alias="observedGraphChunkIds")


@router.post("/reconcile/inspect", response_model=ReconcileInspectResponse)
async def reconcile_inspect(
    request: ReconcileInspectRequest, graph: GraphDep, vector: VectorDep, _context: TenantContextDep
) -> ReconcileInspectResponse:
    observed = await InspectObservedState(vector, graph).execute(request.knowledge_source_id)
    return ReconcileInspectResponse(
        observed_vector_chunk_ids=observed.vector, observed_graph_chunk_ids=observed.graph
    )


class GraphInvariantsResponse(BaseModel):
    labelled_but_wrong_prop: int = Field(serialization_alias="labelledButWrongProp")
    prop_but_no_label: int = Field(serialization_alias="propButNoLabel")
    cross_tenant_edges: int = Field(serialization_alias="crossTenantEdges")


@router.post("/reconcile/graph-invariants", response_model=GraphInvariantsResponse)
async def reconcile_graph_invariants(
    graph: GraphDep, _context: TenantContextDep
) -> GraphInvariantsResponse:
    counts = await AssertGraphInvariants(graph).execute()
    return GraphInvariantsResponse(
        labelled_but_wrong_prop=counts.labelled_but_wrong_prop,
        prop_but_no_label=counts.prop_but_no_label,
        cross_tenant_edges=counts.cross_tenant_edges,
    )
