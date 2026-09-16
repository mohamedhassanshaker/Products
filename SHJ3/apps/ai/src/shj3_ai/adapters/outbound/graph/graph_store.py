"""The real `GraphStore` — wraps `TenantCypher` + `Neo4jStatementExecutor`.

This is where ADR-0009's fourth control lives: **the post-retrieval
re-filter**, applied inline in `search_seed_entities`/`detect_duplicates` (see
the comment ahead of them) and, for the citizen-facing retrieval path, one
layer up in `ports/knowledge_sql.py`. The label and the `tenant_id` predicate
already make an unscoped result implausible; re-checking anyway is cheap and
is the barrier a *defect in the builder itself* — not a hand-written query —
would otherwise slip past undetected (data-model.md §6.5: "a leak must
therefore defeat the label, the predicate and the post-filter").

**Connectivity failures become `GraphUnavailableError`, always.** Every
public method wraps its Neo4j calls so a raw driver exception (a dropped
socket, `ServiceUnavailable`, a session expiring mid-query) never reaches
`application/hybrid_retrieve.py` as anything else — that is the one exception
type the application layer is allowed to catch to decide vector-only
degradation (ADR-0009).
"""

from __future__ import annotations

import logging
from typing import Any, Literal

from neo4j.exceptions import ServiceUnavailable, SessionExpired

from shj3_ai.adapters.outbound.graph.cypher_builder import (
    CHUNK_LABEL,
    Query,
    TenantCypher,
)
from shj3_ai.adapters.outbound.graph.graph_provisioner import Neo4jStatementExecutor
from shj3_ai.domain.knowledge import EntityLabel
from shj3_ai.domain.tenancy import TenantSlug
from shj3_ai.ports.graph_store import (
    ChunkMention,
    DuplicateCandidateRef,
    GraphEdgeRef,
    GraphEntityRef,
    GraphUnavailableError,
    InvariantCounts,
    SubgraphResult,
)

logger = logging.getLogger(__name__)

#: Driver exceptions that mean "the graph could not be reached", as opposed to
#: a query-shape error (`CypherSyntaxError`, `ConstraintError`) which is a real
#: defect and must propagate, not be swallowed into a degradation path.
_UNAVAILABLE_EXCEPTIONS = (ServiceUnavailable, SessionExpired, OSError, TimeoutError)


class Neo4jGraphStore:
    """The real `GraphStore` (structural — matches the port by shape, per this
    codebase's existing convention of not subclassing its `Protocol` ports,
    e.g. `Neo4jStatementExecutor`/`GraphStatementExecutor`).
    """

    __slots__ = ("_cypher", "_executor", "_tenant")

    def __init__(self, executor: Neo4jStatementExecutor, tenant: TenantSlug) -> None:
        self._executor = executor
        self._tenant = tenant
        self._cypher = TenantCypher(tenant)

    async def _run(self, query: Query) -> list[dict[str, Any]]:
        # `Any`, matching `GraphStatementExecutor.run`'s own signature
        # (`graph_provisioner.py`) — a driver row is genuinely dynamic (its
        # shape depends on which `RETURN` clause produced it), and this is
        # the one, already-established boundary in this codebase where that
        # dynamism is accepted rather than fought with `object` and a wall of
        # `isinstance` narrowing. Every value this method's callers pull out
        # of a row is validated by use (a failed `.get()`/index is a real bug
        # surfacing immediately, not silently accepted).
        try:
            return await self._executor.run(query.cypher, query.params)
        except _UNAVAILABLE_EXCEPTIONS as exc:
            logger.warning("graph unavailable", extra={"tenant": self._tenant.value})
            raise GraphUnavailableError(
                f"Neo4j unreachable for tenant {self._tenant.value}"
            ) from exc

    # -- reads -----------------------------------------------------------
    #
    # The post-retrieval re-filter (ADR-0009 rule 4) is applied inline, two
    # different ways, in the methods below: `search_seed_entities` and
    # `detect_duplicates` re-check the returned node's own `tenant_id`
    # property against the bound tenant before trusting it (a row that failed
    # this check would mean the query itself — label and predicate both — was
    # wrong, not that the filter was merely missing). `mentioning_chunks` does
    # not re-check here because its real post-filter is one layer up, in
    # `ports/knowledge_sql.py`'s `get_chunks_by_ids`: chunk text is resolved
    # through the tenant's own SQL Server *schema*, which is physically
    # isolated (ADR-0002) — a foreign `chunk_id` is not a row in that schema
    # at all, so it is dropped by construction rather than by a check that
    # could itself be forgotten. That is the stronger of the two mechanisms
    # and is documented at its real location rather than duplicated here.

    async def search_seed_entities(self, text: str, limit: int = 25) -> list[GraphEntityRef]:
        rows = await self._run(self._cypher.search_entities(text, limit))
        results: list[GraphEntityRef] = []
        for row in rows:
            node = row.get("n") or {}
            if node.get("tenant_id") != self._tenant.value:
                logger.error("post-filter dropped a mis-scoped search hit", extra={"row": row})
                continue
            labels = [
                lbl for lbl in (row.get("labs") or []) if lbl != f"Tenant_{self._tenant.value}"
            ]
            results.append(
                GraphEntityRef(
                    label=labels[0] if labels else "",
                    canonical_key=node.get("canonicalKey", ""),
                    canonical_name=node.get("canonicalName") or node.get("name", ""),
                    properties=_json_safe_properties(node),
                )
            )
        return results

    async def expand_subgraph(self, canonical_keys: list[str], max_hops: int = 2) -> SubgraphResult:
        rows = await self._run(self._cypher.retrieval_subgraph(canonical_keys, max_hops))
        nodes: dict[str, GraphEntityRef] = {}
        rendered_pairs: set[tuple[str, str]] = set()
        rendered_parts: list[str] = []
        for row in rows:
            seed_key, seed_labels, seed_name = (
                row.get("seedKey"),
                row.get("seedLabels") or [],
                row.get("seedName"),
            )
            if seed_key and seed_key not in nodes:
                nodes[seed_key] = GraphEntityRef(
                    label=_entity_label(seed_labels, self._tenant),
                    canonical_key=seed_key,
                    canonical_name=seed_name or "",
                    properties={},
                )
            neighbour_key = row.get("neighbourKey")
            # `seed_key` is `n.canonicalKey` from the query's own `WHERE
            # n.canonicalKey IN $keys` — never actually null — but is typed
            # `Any` from the dynamic row, so it is narrowed explicitly here
            # rather than trusted, both for mypy and because a row that
            # somehow lacked it would otherwise silently poison
            # `rendered_pairs`'s `tuple[str, str]` contract.
            if neighbour_key and isinstance(seed_key, str):
                if neighbour_key not in nodes:
                    nodes[neighbour_key] = GraphEntityRef(
                        label=_entity_label(row.get("neighbourLabels") or [], self._tenant),
                        canonical_key=neighbour_key,
                        canonical_name=row.get("neighbourName") or "",
                        properties={},
                    )
                # `retrieval_subgraph`'s Cypher returns one row per matched
                # *path* (Neo4j's unbounded variable-length pattern), so the
                # same `(seed, neighbour)` pair can repeat many times over —
                # confirmed against real ingested data, where an unguarded
                # append produced dozens of duplicate segments in one
                # rendered path. Deduplicated here, at render time, rather
                # than trying to make the Cypher itself path-distinct (which
                # would need `DISTINCT` semantics Neo4j does not apply the
                # same way across `OPTIONAL MATCH` path expansions).
                pair = (seed_key, neighbour_key)
                if pair not in rendered_pairs:
                    rendered_pairs.add(pair)
                    rendered_parts.append(f"{seed_name} → {row.get('neighbourName')}")
        edges = await self._run(self._cypher.browse_edges(list(nodes.keys()))) if nodes else []
        edge_refs = [
            GraphEdgeRef(relationship_type=e["relType"], from_key=e["fromKey"], to_key=e["toKey"])
            for e in edges
        ]
        return SubgraphResult(
            nodes=list(nodes.values()),
            edges=edge_refs,
            rendered_path=" | ".join(rendered_parts) if rendered_parts else None,
        )

    async def mentioning_chunks(
        self, entity_keys: list[str], knowledge_collection_ids: list[str] | None, limit: int = 200
    ) -> list[ChunkMention]:
        if not entity_keys:
            return []
        rows = await self._run(
            self._cypher.mentioning_chunks(entity_keys, knowledge_collection_ids, limit)
        )
        return [
            ChunkMention(
                chunk_id=r["chunkId"], entity_key=r["entityKey"], salience=float(r["salience"])
            )
            for r in rows
        ]

    async def browse(
        self, root_key: str | None, depth: int, types: list[str] | None, limit: int
    ) -> SubgraphResult:
        if root_key:
            return await self.expand_subgraph([root_key], max_hops=depth)
        rows = await self._run(self._cypher.browse_nodes(tuple(types or ()), limit))
        nodes = [
            GraphEntityRef(
                label=_entity_label(r["nodeLabels"], self._tenant),
                canonical_key=r["key"],
                canonical_name=r["name"] or "",
                properties=_json_safe_properties(r["props"]),
            )
            for r in rows
            if r.get("key")
        ]
        keys = [n.canonical_key for n in nodes]
        edge_rows = await self._run(self._cypher.browse_edges(keys)) if keys else []
        edges = [
            GraphEdgeRef(relationship_type=e["relType"], from_key=e["fromKey"], to_key=e["toKey"])
            for e in edge_rows
        ]
        return SubgraphResult(
            nodes=nodes, edges=edges, rendered_path=None, truncated=len(nodes) >= limit
        )

    async def detect_duplicates(
        self, label: EntityLabel, limit: int = 50
    ) -> list[DuplicateCandidateRef]:
        rows = await self._run(self._cypher.detect_duplicates(label, limit))
        results: list[DuplicateCandidateRef] = []
        for row in rows:
            a, b = row.get("a") or {}, row.get("b") or {}
            if a.get("tenant_id") != self._tenant.value or b.get("tenant_id") != self._tenant.value:
                logger.error(
                    "post-filter dropped a mis-scoped duplicate candidate", extra={"row": row}
                )
                continue
            results.append(
                DuplicateCandidateRef(
                    left_canonical_key=a.get("canonicalKey", ""),
                    right_canonical_key=b.get("canonicalKey", ""),
                    left_name=a.get("canonicalName") or a.get("name", ""),
                    right_name=b.get("canonicalName") or b.get("name", ""),
                    similarity=1.0,
                )
            )
        return results

    async def assert_invariants(self) -> InvariantCounts:
        agreement = await self._run(self._cypher.assert_encoding_agreement())
        cross_edges = await self._run(self._cypher.assert_no_cross_tenant_edges())
        return InvariantCounts(
            labelled_but_wrong_prop=int(agreement[0]["labelled_but_wrong_prop"])
            if agreement
            else 0,
            prop_but_no_label=int(agreement[0]["prop_but_no_label"]) if agreement else 0,
            cross_tenant_edges=int(cross_edges[0]["cross_tenant_edges"]) if cross_edges else 0,
        )

    async def observed_chunk_ids(self, knowledge_source_id: str) -> list[str]:
        rows = await self._run(self._cypher.chunk_ids_for_source(knowledge_source_id))
        return [r["chunkId"] for r in rows]

    # -- writes ------------------------------------------------------------

    async def merge_entity(
        self,
        label: EntityLabel,
        canonical_key: str,
        canonical_name: str,
        properties: dict[str, object],
    ) -> None:
        # Both `name` and `canonicalName` are written: `search_entities` and
        # `detect_duplicates` (both already real, already isolation-tested
        # against live Neo4j before this wave) filter on `n.name`, while
        # data-model.md §6.1 documents `canonicalName` as the entity's real
        # display property. Renaming the older methods' filter to match the
        # newer convention was considered and rejected for this pass — it
        # would touch already-proven, already-passing isolation coverage for
        # no behavioural gain (this project's lessons.md: minimal-impact,
        # don't re-risk a working, tested path). Writing both keys is the
        # cheaper, zero-risk reconciliation.
        props = {
            **properties,
            "canonicalName": canonical_name,
            "name": canonical_name,
            "label": label,
        }
        await self._run(self._cypher.merge_entity(label, canonical_key, props))

    async def merge_relationship(
        self,
        relationship_type: str,
        from_key: str,
        to_key: str,
        properties: dict[str, object] | None = None,
    ) -> None:
        await self._run(self._cypher.merge_edge(relationship_type, from_key, to_key, properties))

    async def merge_chunk_ref(self, chunk_id: str, properties: dict[str, object]) -> None:
        await self._run(self._cypher.merge_chunk_ref(chunk_id, properties))

    async def merge_chunk_edge(
        self,
        relationship_type: Literal["MENTIONS", "FROM_DOCUMENT"],
        chunk_id: str,
        entity_label: EntityLabel,
        entity_key: str,
        properties: dict[str, object] | None = None,
    ) -> None:
        await self._run(
            self._cypher.merge_chunk_edge(
                relationship_type, chunk_id, entity_label, entity_key, properties
            )
        )

    async def delete_entity(self, canonical_key: str) -> None:
        await self._run(self._cypher.delete_entity(canonical_key))

    async def merge_duplicates(self, keep_key: str, absorb_key: str) -> None:
        await self._run(self._cypher.merge_duplicates(keep_key, absorb_key))

    async def ignore_duplicates(self, left_key: str, right_key: str, similarity: float) -> None:
        await self._run(self._cypher.ignore_duplicates(left_key, right_key, similarity))


def _entity_label(labels: list[str], tenant: TenantSlug) -> str:
    for label in labels:
        if label not in (tenant.graph_label, CHUNK_LABEL):
            return label
    return ""


def _json_safe_properties(properties: dict[str, object]) -> dict[str, object]:
    """Neo4j's driver returns native temporal types (`neo4j.time.DateTime`, ...) for
    any property written via Cypher's `datetime()` — real values this adapter's own
    `merge_entity`/`merge_chunk_ref` write on every node (`n.createdAt = datetime()`).
    Those are not JSON-serialisable by Pydantic's default encoder, which surfaced as a
    real `PydanticSerializationError` the first time `browse()`'s output was actually
    sent over HTTP (caught by exercising the endpoint against the real Neo4j container,
    not by reading the driver's docs) — so every property value is coerced to a plain
    JSON-safe type here, at the one boundary where a Neo4j-native type first appears,
    rather than trusting every future caller to remember to.
    """
    return {
        k: (v if isinstance(v, (str, int, float, bool)) or v is None else str(v))
        for k, v in properties.items()
    }
