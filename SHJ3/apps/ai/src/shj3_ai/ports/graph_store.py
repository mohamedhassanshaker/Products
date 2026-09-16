"""The `GraphStore` port — Graph RAG's boundary onto Neo4j (ADR-0009).

A `Protocol`, not an ABC, matching this project's existing port style. The
real implementation (`adapters/outbound/graph/graph_store.py`) wraps
`TenantCypher` (the tenant-aware query builder) and a `Neo4jStatementExecutor`
— this port carries no Cypher and no tenant slug in its signatures, because
both are already bound by the time an implementation is constructed
(`domain/tenancy.py`'s `TenantContext`, one instance per request).

**`GraphUnavailableError` is the one exception every real query-issuing
method must raise on a connectivity failure**, never let a raw driver
exception escape — `application/hybrid_retrieve.py` catches exactly this type
to decide vector-only degradation (ADR-0009's "graph unavailable → retrieval
degrades to vector-only, never a failed conversation").
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, Protocol

from shj3_ai.domain.knowledge import EntityLabel


class GraphUnavailableError(RuntimeError):
    """The graph could not be reached or timed out.

    Distinguished from `UnsafeGraphIdentifierError`/`UnscopedQueryError`
    (`cypher_builder.py`), which are programming errors in the builder itself
    and must never be swallowed — this is the one exception that represents a
    legitimate, expected, recoverable operating state (ADR-0009: "Community is
    single-instance, so the graph has no HA story... accepted").
    """


@dataclass(frozen=True, slots=True)
class GraphEntityRef:
    label: str
    canonical_key: str
    canonical_name: str
    properties: dict[str, object]


@dataclass(frozen=True, slots=True)
class GraphEdgeRef:
    relationship_type: str
    from_key: str
    to_key: str


@dataclass(frozen=True, slots=True)
class SubgraphResult:
    nodes: list[GraphEntityRef]
    edges: list[GraphEdgeRef]
    rendered_path: str | None
    #: True when the result hit `limit` and more nodes exist — api.md §6's
    #: documented `meta.truncated` contract for `GET /v1/knowledge/graph`
    #: ("an unbounded graph read is a self-inflicted outage"). Always `False`
    #: for `expand_subgraph`, which is seed-bounded rather than count-bounded.
    truncated: bool = False


@dataclass(frozen=True, slots=True)
class ChunkMention:
    chunk_id: str
    entity_key: str
    salience: float


@dataclass(frozen=True, slots=True)
class DuplicateCandidateRef:
    left_canonical_key: str
    right_canonical_key: str
    left_name: str
    right_name: str
    similarity: float


@dataclass(frozen=True, slots=True)
class InvariantCounts:
    """G11/G12's standing-invariant sweep (ADR-0009 rule 5, data-model.md §9.3).

    All three must be zero on a healthy graph; a non-zero value is the early
    warning that precedes a leak, not a data-quality nit.
    """

    labelled_but_wrong_prop: int
    prop_but_no_label: int
    cross_tenant_edges: int

    @property
    def clean(self) -> bool:
        return (
            self.labelled_but_wrong_prop == 0
            and self.prop_but_no_label == 0
            and self.cross_tenant_edges == 0
        )


class GraphStore(Protocol):
    """Every graph operation Graph RAG needs, already tenant-bound.

    Method names deliberately do not repeat "tenant" or "scoped" — every
    method on this port is, by construction (the real adapter is built per
    request from the bound `TenantSlug`), and a name suggesting otherwise
    would be misleading rather than reassuring.
    """

    async def search_seed_entities(self, text: str, limit: int = 25) -> list[GraphEntityRef]:
        """Entity search by name (G2). The starting point for retrieval's graph half."""

    async def expand_subgraph(self, canonical_keys: list[str], max_hops: int = 2) -> SubgraphResult:
        """Neighbourhood of the given entities (G10) — the matched-subgraph render."""

    async def mentioning_chunks(
        self,
        entity_keys: list[str],
        knowledge_collection_ids: list[str] | None,
        limit: int = 200,
    ) -> list[ChunkMention]:
        """Chunks whose `MENTIONS` edge lands on any of `entity_keys` (graph half of §6.5)."""

    async def merge_entity(
        self,
        label: EntityLabel,
        canonical_key: str,
        canonical_name: str,
        properties: dict[str, object],
    ) -> None:
        """Idempotent upsert of one entity (G6/G7)."""

    async def merge_relationship(
        self,
        relationship_type: str,
        from_key: str,
        to_key: str,
        properties: dict[str, object] | None = None,
    ) -> None:
        """Idempotent upsert of one entity-to-entity edge (G7)."""

    async def merge_chunk_ref(self, chunk_id: str, properties: dict[str, object]) -> None:
        """Upsert the minimal `Chunk` reference node (data-model.md §6.1)."""

    async def merge_chunk_edge(
        self,
        relationship_type: Literal["MENTIONS", "FROM_DOCUMENT"],
        chunk_id: str,
        entity_label: EntityLabel,
        entity_key: str,
        properties: dict[str, object] | None = None,
    ) -> None:
        """Upsert a `Chunk → entity` edge."""

    async def delete_entity(self, canonical_key: str) -> None:
        """Delete one entity and its relationships (G9, G8 per testing.md's table)."""

    async def browse(
        self, root_key: str | None, depth: int, types: list[str] | None, limit: int
    ) -> SubgraphResult:
        """The explorer read (B6 tab 2) — `root_key=None` means "whole tenant graph"."""

    async def detect_duplicates(
        self, label: EntityLabel, limit: int = 50
    ) -> list[DuplicateCandidateRef]:
        """Candidate duplicate pairs within one label, within this tenant (G5)."""

    async def merge_duplicates(self, keep_key: str, absorb_key: str) -> None:
        """Apply a human merge decision onto the graph (G6 per testing.md's table)."""

    async def ignore_duplicates(self, left_key: str, right_key: str, similarity: float) -> None:
        """Record an ignored duplicate pair so it stops resurfacing."""

    async def assert_invariants(self) -> InvariantCounts:
        """The reconciliation sweep (G11/G12) — a backstop, not the primary guard."""

    async def observed_chunk_ids(self, knowledge_source_id: str) -> list[str]:
        """`Chunk` reference-node ids for one source — reconciliation's observed set (§9.3)."""
