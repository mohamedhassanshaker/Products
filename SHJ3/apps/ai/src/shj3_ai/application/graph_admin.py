"""Thin graph-administration use cases (B6 tab 2): browse, manual add/delete,
duplicate detection, merge/ignore, and the standing-invariant sweep.

Grouped in one file rather than nine near-identical one-line wrapper files —
each of these is a direct pass-through to one `GraphStore` method with no
extra orchestration, the same "identical CRUD shape, avoids near-identical
tiny files" call the `agents` module's `AgentBindingsRepository` precedent
already made for this codebase. `EmbedAndIndexChunks`/`HybridRetrieve` get
their own files because they hold real orchestration (multiple ports,
degradation branching); these do not.
"""

from __future__ import annotations

from shj3_ai.domain.knowledge import EntityLabel
from shj3_ai.ports.graph_store import (
    DuplicateCandidateRef,
    GraphStore,
    InvariantCounts,
    SubgraphResult,
)


class BrowseGraph:
    def __init__(self, graph: GraphStore) -> None:
        self._graph = graph

    async def execute(
        self, root_key: str | None, depth: int, types: list[str] | None, limit: int
    ) -> SubgraphResult:
        return await self._graph.browse(root_key, depth, types, limit)


class ApplyGraphNode:
    """Mirrors a `GraphNodeRecord`/`GraphEdgeRecord` the caller already wrote to
    SQL (`origin='Authored'`, FR-KNOW-10) onto Neo4j.
    """

    def __init__(self, graph: GraphStore) -> None:
        self._graph = graph

    async def execute(
        self,
        label: EntityLabel,
        canonical_key: str,
        canonical_name: str,
        properties: dict[str, object],
        parent_key: str | None,
        relationship_type: str | None,
    ) -> None:
        await self._graph.merge_entity(label, canonical_key, canonical_name, properties)
        if parent_key and relationship_type:
            await self._graph.merge_relationship(relationship_type, canonical_key, parent_key)


class DeleteGraphNode:
    def __init__(self, graph: GraphStore) -> None:
        self._graph = graph

    async def execute(self, canonical_key: str) -> None:
        await self._graph.delete_entity(canonical_key)


class DetectDuplicates:
    def __init__(self, graph: GraphStore) -> None:
        self._graph = graph

    async def execute(self, label: EntityLabel) -> list[DuplicateCandidateRef]:
        return await self._graph.detect_duplicates(label)


class MergeDuplicates:
    def __init__(self, graph: GraphStore) -> None:
        self._graph = graph

    async def execute(self, keep_key: str, absorb_key: str) -> None:
        await self._graph.merge_duplicates(keep_key, absorb_key)


class IgnoreDuplicates:
    def __init__(self, graph: GraphStore) -> None:
        self._graph = graph

    async def execute(self, left_key: str, right_key: str, similarity: float) -> None:
        await self._graph.ignore_duplicates(left_key, right_key, similarity)


class AssertGraphInvariants:
    """The G11/G12 reconciliation sweep (ADR-0009 rule 5) — a backstop, not the
    primary guard, which is the write-path invariant already enforced inside
    `GraphStore.merge_entity`/`merge_relationship` themselves.
    """

    def __init__(self, graph: GraphStore) -> None:
        self._graph = graph

    async def execute(self) -> InvariantCounts:
        return await self._graph.assert_invariants()
