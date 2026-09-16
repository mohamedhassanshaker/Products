"""Tenant-aware Cypher builder.

**This module is the single most security-critical file in SHJ3.**

ADR-0009 replaced Neo4j database-per-tenant with logical partitioning after the
Enterprise licence was declined. Community edition offers neither a database
boundary nor fine-grained RBAC, so unlike SQL Server — where ADR-0005's grant
makes a mistake fail *at the database* whatever the code did — the graph has no
infrastructure and no database-level fallback. Nothing below the application
catches a mistake above it. That standing exposure is RISK-024.

What defends isolation instead is four controls that must all be defeated for a
leak to occur:

1. **Dual encoding.** Every node carries a ``:Tenant_<slug>`` label *and* a
   ``tenant_id`` property, and every query filters on both. One alone would be a
   single point of failure.
2. **This builder.** Application code cannot write Cypher — the
   ``no-raw-cypher`` gate fails the build if a Cypher literal appears outside
   this package — so every query is emitted here, already scoped.
3. **Self-validation.** ``Query.__post_init__`` refuses to construct a query
   that does not carry both encodings. A builder method with a forgotten
   predicate raises at construction rather than returning something unscoped.
   This is the part that makes the guarantee structural rather than careful.
4. **A post-retrieval re-filter**, applied by the graph store after results
   leave here, so a leak must survive the label, the predicate *and* the filter.

Values are always bound as parameters. The **only** interpolated fragments are
the tenant label, node labels and relationship types — all three land in
identifier position where Cypher has no parameter binding, so each is checked
against a validated slug or a closed allowlist before it is used.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Literal

from shj3_ai.domain.tenancy import TenantSlug

# ---------------------------------------------------------------------------
# Closed vocabularies.
#
# Labels and relationship types cannot be bound parameters, so they are
# interpolated — which makes them an injection surface. Allowlists rather than
# escaping: the graph model from B6 tab 2 is small and closed, so there is no
# reason to accept anything outside it.
# ---------------------------------------------------------------------------

NodeLabel = Literal["Service", "Provider", "Fee", "Document", "Channel"]

ENTITY_LABELS: frozenset[str] = frozenset({"Service", "Provider", "Fee", "Document", "Channel"})

#: The reference-node label for a chunk (data-model.md §6.1) — deliberately not
#: in `ENTITY_LABELS`: a `Chunk` has no `canonicalKey`/`canonicalName` and is
#: never a duplicate-detection or manual-authoring target, so mixing it into the
#: entity-label allowlist would let a caller pass it somewhere the schema (a
#: closed, no-renderable-property node) does not support.
CHUNK_LABEL: Literal["Chunk"] = "Chunk"

#: Kept in sync with `CK_GraphEdgeRecords_relationshipType`
#: (prisma/sql/001_constraints.sql) and `TR_GraphEdgeRecords_typeMatchesLabels`'s
#: permitted label pairs — the SQL ledger and the graph builder must agree on
#: this vocabulary, or a decision recorded in `GraphEdgeRecords` (the
#: rebuild-from-SQL source of truth) could describe an edge this builder
#: refuses to ever write, silently breaking re-index.
RELATIONSHIP_TYPES: frozenset[str] = frozenset(
    {
        "PROVIDED_BY",  # Service -> Provider
        "HAS_FEE",  # Service -> Fee
        "DOCUMENTED_BY",  # Service -> Document
        "PAYABLE_VIA",  # Fee -> Channel
        "AVAILABLE_ON",  # Service|Fee -> Channel
        "MENTIONS",  # Chunk -> Service|Provider|Fee|Document|Channel
        "FROM_DOCUMENT",  # Chunk -> Document
        "MERGED_INTO",  # duplicate resolution (B6 tab 2 merge)
        "SAME_AS",  # duplicate resolution (B6 tab 2 ignore)
    }
)

#: Relationship types whose target may legitimately be a `Chunk` node rather
#: than an entity. `merge_chunk_edge` checks against this set instead of
#: `RELATIONSHIP_TYPES` at large, so a caller cannot request `MENTIONS` from
#: `merge_edge` (entity-to-entity) or `PROVIDED_BY` from `merge_chunk_edge`.
CHUNK_RELATIONSHIP_TYPES: frozenset[str] = frozenset({"MENTIONS", "FROM_DOCUMENT"})

_LABEL_SAFE = re.compile(r"^Tenant_[a-z][a-z0-9_]{1,29}$")

# The suffixes of the three label-scoped indexes created per tenant. Named here rather
# than repeated, because provisioning creates them, de-provisioning drops them and
# verification introspects them — three call sites that must agree on the names or a
# provisioned tenant fails its own verification.
_INDEX_SUFFIXES: tuple[str, ...] = ("tenant_id", "name", "key")


class UnsafeGraphIdentifierError(ValueError):
    """Raised when a label or relationship type is outside its allowlist."""


class UnscopedQueryError(RuntimeError):
    """Raised when a built query does not carry both tenant encodings.

    This is a programming error in this module, caught at construction. It
    should never reach a caller — that is the point.
    """


def _check_label(label: str) -> str:
    if label not in ENTITY_LABELS:
        raise UnsafeGraphIdentifierError(
            f"Node label not in the allowlist. Permitted: {sorted(ENTITY_LABELS)}"
        )
    return label


def _check_relationship(rel_type: str) -> str:
    if rel_type not in RELATIONSHIP_TYPES:
        raise UnsafeGraphIdentifierError(
            f"Relationship type not in the allowlist. Permitted: {sorted(RELATIONSHIP_TYPES)}"
        )
    return rel_type


def _check_tenant_label(label: str) -> str:
    # Belt and braces: the label already came from TenantSlug.graph_label, which
    # is derived from a validated slug. Re-checking here means a future caller
    # that constructs a label some other way still cannot inject.
    if not _LABEL_SAFE.match(label):
        raise UnsafeGraphIdentifierError("Tenant label is not a validated Tenant_<slug> form")
    return label


@dataclass(frozen=True, slots=True)
class Query:
    """A Cypher statement with its parameters, proven tenant-scoped.

    Construction fails unless the statement carries the tenant label *and* binds
    ``tenant_id``. A builder method that forgets one raises here instead of
    handing back a query that could read another government entity's graph.

    The invariant is absolute — there is no exemption flag. Schema DDL, which
    genuinely has no data to scope, is a separate type (:class:`SchemaStatement`)
    precisely so that this check never needs weakening. An escape hatch on the
    one control with no infrastructure beneath it would be the wrong trade.
    """

    cypher: str
    params: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if "Tenant_" not in self.cypher:
            raise UnscopedQueryError(
                "Built Cypher does not carry a tenant label. Every statement must be "
                "scoped by :Tenant_<slug> (ADR-0009). This is a bug in the builder."
            )
        if "$tenant_id" not in self.cypher:
            raise UnscopedQueryError(
                "Built Cypher does not filter on $tenant_id. The label alone is not "
                "sufficient — dual encoding means both, so that neither is a single "
                "point of failure (ADR-0009). This is a bug in the builder."
            )
        if "tenant_id" not in self.params:
            raise UnscopedQueryError(
                "Built Cypher references $tenant_id but does not bind it. This is a bug in the builder."
            )


@dataclass(frozen=True, slots=True)
class SchemaStatement:
    """Graph DDL — an index or constraint.

    Deliberately *not* a :class:`Query`: DDL reads and writes no rows, so it has
    nothing to scope, and forcing it through the tenant-scoping invariant would
    have required an exemption flag on the one control that has no
    infrastructure fallback. A separate type keeps that invariant unconditional.
    """

    cypher: str
    #: Why this object exists, surfaced in provisioning output so an operator
    #: reading RB-09 can see what each statement is for.
    purpose: str


def global_schema_statements() -> list[SchemaStatement]:
    """Graph DDL created **once** for the whole database, not per tenant.

    Composite uniqueness on ``(tenant_id, canonicalKey)`` is a single global
    constraint that covers every tenant simultaneously — creating it per tenant
    would produce N redundant constraints on the same property pair.

    Two points worth recording:

    * Uniqueness *must* be composite. Under database-per-tenant a single-property
      constraint on ``canonicalKey`` was scoped by the database it lived in. In
      one shared database it is not: SEWA and Sharjah Customs may each
      legitimately hold a ``Provider`` whose canonical key is ``sewa``, and a
      single-property constraint would make the second tenant's ingest fail with
      a spurious conflict — silently losing a node to another tenant's data. So
      the constraint has to be keyed by the same thing the partition is keyed by.
    * Property-**existence** constraints are Enterprise-only, so rules such as
      "a ``Service`` must have a name" cannot be declared here at all. They move
      into the builder plus the reconciliation assertions, which *detect* rather
      than *prevent*. That is a second concrete face of RISK-024: the licence
      decision cost integrity guarantees, not only isolation ones.
    """
    statements = [
        SchemaStatement(
            cypher=(
                f"CREATE CONSTRAINT shj3_{label.lower()}_tenant_key IF NOT EXISTS "
                f"FOR (n:{label}) REQUIRE (n.tenant_id, n.canonicalKey) IS UNIQUE"
            ),
            purpose=(
                f"{label}.canonicalKey unique within a tenant — composite so two "
                "government entities may hold the same key without collision"
            ),
        )
        for label in sorted(ENTITY_LABELS)
    ]
    statements.append(
        SchemaStatement(
            cypher="CREATE INDEX shj3_tenant_id IF NOT EXISTS FOR (n:Service) ON (n.tenant_id)",
            purpose="tenant_id lookup on the entity type most traversals start from",
        )
    )
    return statements


class TenantCypher:
    """Builds tenant-scoped Cypher for one tenant.

    Constructed per request from the bound tenant context; never cached across
    tenants, and never given a tenant by a caller.
    """

    __slots__ = ("_label", "_tenant")

    def __init__(self, tenant: TenantSlug) -> None:
        self._tenant = tenant
        self._label = _check_tenant_label(tenant.graph_label)

    @property
    def tenant(self) -> TenantSlug:
        return self._tenant

    def _base_params(self, **extra: Any) -> dict[str, Any]:
        return {"tenant_id": self._tenant.value, **extra}

    # -- reads ---------------------------------------------------------------

    def match_entity(self, label: NodeLabel, canonical_key: str) -> Query:
        """One entity by its canonical key. Query path G1."""
        node = _check_label(label)
        return Query(
            cypher=(
                f"MATCH (n:{self._label}:{node} {{tenant_id: $tenant_id, canonicalKey: $key}}) "
                "RETURN n LIMIT 1"
            ),
            params=self._base_params(key=canonical_key),
        )

    def search_entities(self, text: str, limit: int = 25) -> Query:
        """Entity search, powering B6 tab 2's live node dimming. Query path G2.

        Matches on a lowercase prefix rather than a full-text index: the
        full-text index is per-tenant-label (its *name* is tenant-derived), and
        keeping search on a plain property means one fewer tenant-derived
        identifier in the injection surface. Revisit if the graph grows enough
        for the scan to matter.
        """
        return Query(
            cypher=(
                f"MATCH (n:{self._label}) "
                "WHERE n.tenant_id = $tenant_id AND toLower(n.name) CONTAINS toLower($text) "
                # `labels(n)` is projected as its own column alongside the raw node,
                # additively — the Neo4j Python driver's `Record.data()` drops a
                # node's labels when it flattens `n` to a plain properties dict
                # (confirmed against the real driver), so a caller needing the
                # matched entity's label needs it as a scalar column, not read off
                # the node value itself.
                "RETURN n, labels(n) AS labs ORDER BY n.name LIMIT $limit"
            ),
            params=self._base_params(text=text, limit=int(limit)),
        )

    def neighbours(
        self,
        canonical_key: str,
        rel_types: tuple[str, ...] = (),
        limit: int = 100,
    ) -> Query:
        """Immediate neighbours of one entity. Query path G3.

        Note the predicate on **both** ends: ``m.tenant_id = $tenant_id`` as well
        as the label on ``m``. A cross-tenant edge should not exist at all — an
        invariant asserted separately — but if one ever did, this query still
        refuses to traverse it.
        """
        rels = "|".join(_check_relationship(r) for r in rel_types)
        rel_pattern = f"[r:{rels}]" if rels else "[r]"
        return Query(
            cypher=(
                f"MATCH (n:{self._label} {{tenant_id: $tenant_id, canonicalKey: $key}})"
                f"-{rel_pattern}-(m:{self._label}) "
                "WHERE m.tenant_id = $tenant_id "
                "RETURN n, r, m LIMIT $limit"
            ),
            params=self._base_params(key=canonical_key, limit=int(limit)),
        )

    def traverse(self, canonical_key: str, max_hops: int = 3, limit: int = 200) -> Query:
        """Bounded multi-hop traversal. Query path G4.

        ``max_hops`` is interpolated because Cypher cannot bind a variable-length
        path bound. It is coerced to an int and clamped, so the interpolated text
        is always a small integer literal and never caller-controlled text.
        """
        hops = max(1, min(int(max_hops), 6))
        return Query(
            cypher=(
                f"MATCH path = (n:{self._label} {{tenant_id: $tenant_id, canonicalKey: $key}})"
                f"-[*1..{hops}]-(m:{self._label}) "
                "WHERE m.tenant_id = $tenant_id "
                "RETURN path LIMIT $limit"
            ),
            params=self._base_params(key=canonical_key, limit=int(limit)),
        )

    def retrieval_subgraph(self, canonical_keys: list[str], max_hops: int = 2) -> Query:
        """The graph half of hybrid retrieval — B6 tab 3's matched subgraph.

        Query path G10, and the one whose output is quoted back to a citizen,
        which is why the post-retrieval re-filter exists on top of this.

        Returns one row per `(seed, neighbour)` pair with every field the
        neighbour's identity needs projected explicitly (`labels(m)`,
        `m.canonicalKey`, `m.canonicalName`) rather than the raw node `m` —
        the Neo4j Python driver's `Record.data()` drops a node's labels (and
        makes a raw `Path` value awkward to walk reliably) when it flattens a
        graph value to a plain dict, so every field the caller needs must be
        a projected scalar column, not a graph object. A seed with no
        neighbours still yields one row (`neighbourKey IS NULL`), via the
        `OPTIONAL MATCH`, so a caller can tell "matched but isolated" apart
        from "did not match at all".
        """
        hops = max(1, min(int(max_hops), 4))
        return Query(
            cypher=(
                f"MATCH (n:{self._label}) "
                "WHERE n.tenant_id = $tenant_id AND n.canonicalKey IN $keys "
                f"OPTIONAL MATCH (n)-[*1..{hops}]-(m:{self._label}) "
                "WHERE m.tenant_id = $tenant_id "
                # `coalesce(canonicalName, name)`, not a bare `canonicalName`:
                # entities written through the raw builder (this class's own
                # `merge_entity`, e.g. every isolation-suite fixture) carry
                # whatever property key the caller's `properties` dict used —
                # `canonicalName` is data-model.md §6.1's documented name, but
                # `name` is what `search_entities`/`detect_duplicates` have
                # always filtered on (both already real, already tested
                # against live Neo4j before this method existed). Reading
                # both here, rather than picking one and requiring every
                # caller to supply it, is what makes this method work
                # correctly regardless of which convention wrote the node —
                # found by running this exact query against real seeded data,
                # not assumed from the property list.
                "RETURN n.canonicalKey AS seedKey, labels(n) AS seedLabels, "
                "       coalesce(n.canonicalName, n.name) AS seedName, "
                "       m.canonicalKey AS neighbourKey, labels(m) AS neighbourLabels, "
                "       coalesce(m.canonicalName, m.name) AS neighbourName"
            ),
            params=self._base_params(keys=list(canonical_keys)),
        )

    def mentioning_chunks(
        self,
        entity_keys: list[str],
        knowledge_collection_ids: list[str] | None = None,
        limit: int = 200,
    ) -> Query:
        """Chunks whose `MENTIONS` edge lands on any of `entity_keys`.

        Query path G10b — the second half of the graph half of hybrid
        retrieval (data-model.md §6.5): `search_entities`/`retrieval_subgraph`
        find and expand the matched entities, this resolves them to the
        `chunk_id`s that actually cite them. Kept as its own query rather than
        folded into `retrieval_subgraph` so each step stays independently
        testable and the Cypher stays reviewable — the alternative (one
        `apoc.path.subgraphNodes` mega-query per data-model.md §6.5's sketch)
        assumes the APOC plugin is installed, which is unconfirmed for this
        deployment's `neo4j:5.26-community` image; this builder does not
        depend on it.
        """
        return Query(
            cypher=(
                f"MATCH (c:{self._label}:{CHUNK_LABEL})-[m:MENTIONS]->(e:{self._label}) "
                "WHERE c.tenant_id = $tenant_id AND e.tenant_id = $tenant_id "
                "  AND e.canonicalKey IN $keys "
                "  AND ($collectionIds IS NULL OR c.knowledgeCollectionId IN $collectionIds) "
                "RETURN c.chunkId AS chunkId, e.canonicalKey AS entityKey, "
                "       coalesce(m.salience, 1.0) AS salience "
                "LIMIT $limit"
            ),
            params=self._base_params(
                keys=list(entity_keys),
                collectionIds=list(knowledge_collection_ids) if knowledge_collection_ids else None,
                limit=int(limit),
            ),
        )

    def browse_nodes(self, types: tuple[str, ...] = (), limit: int = 250) -> Query:
        """A bounded snapshot of entity nodes — the explorer's default view (B6 tab 2)
        when no node is selected yet. `types` narrows to a subset of entity labels;
        empty means every entity label (never `Chunk`, which is never rendered).

        Returns one row per node with its labels and properties spelled out
        explicitly (`labels(n)`, `properties(n)`) rather than the raw node `n` —
        the Neo4j Python driver's `Record.data()` drops a node's labels when it
        flattens a `Node` object to a plain dict, so the label has to be
        projected as its own column or it is lost before this method's caller
        ever sees it.
        """
        labels = tuple(_check_label(t) for t in types) if types else tuple(sorted(ENTITY_LABELS))
        label_predicate = " OR ".join(f"n:{lbl}" for lbl in labels)
        return Query(
            cypher=(
                f"MATCH (n:{self._label}) WHERE n.tenant_id = $tenant_id AND ({label_predicate}) "
                # `coalesce(canonicalName, name)` — see `retrieval_subgraph`'s
                # comment on the identical choice.
                "RETURN labels(n) AS nodeLabels, n.canonicalKey AS key, "
                "       coalesce(n.canonicalName, n.name) AS name, properties(n) AS props "
                "LIMIT $limit"
            ),
            params=self._base_params(limit=int(limit)),
        )

    def browse_edges(self, canonical_keys: list[str], limit: int = 500) -> Query:
        """Edges directly connecting any two nodes in `canonical_keys` — paired with
        :meth:`browse_nodes` by the caller to build one explorer snapshot (avoids a
        `collect()`-of-nodes query, for the same "labels survive `Record.data()`"
        reason `browse_nodes` documents).
        """
        return Query(
            cypher=(
                f"MATCH (a:{self._label})-[r]->(b:{self._label}) "
                "WHERE a.tenant_id = $tenant_id AND b.tenant_id = $tenant_id "
                "  AND a.canonicalKey IN $keys AND b.canonicalKey IN $keys "
                "RETURN a.canonicalKey AS fromKey, b.canonicalKey AS toKey, type(r) AS relType "
                "LIMIT $limit"
            ),
            params=self._base_params(keys=list(canonical_keys), limit=int(limit)),
        )

    def chunk_ids_for_source(self, knowledge_source_id: str, limit: int = 10_000) -> Query:
        """`Chunk` reference-node ids for one source — reconciliation's observed set
        (data-model.md §9.3), and `GraphStore.observed_chunk_ids`'s only caller.
        """
        return Query(
            cypher=(
                f"MATCH (c:{self._label}:{CHUNK_LABEL}) "
                "WHERE c.tenant_id = $tenant_id AND c.knowledgeSourceId = $sourceId "
                "RETURN c.chunkId AS chunkId LIMIT $limit"
            ),
            params=self._base_params(sourceId=knowledge_source_id, limit=int(limit)),
        )

    def detect_duplicates(self, label: NodeLabel, limit: int = 50) -> Query:
        """Candidate duplicate pairs. Query path G5.

        Scoped to one tenant deliberately, and this is a correctness point
        rather than only an isolation one: under database-per-tenant a
        ``Provider`` named ``SEWA`` was unique by construction. In one shared
        database SEWA and Sharjah Customs may each legitimately hold one, so an
        unscoped duplicate detector would offer to *merge two government
        entities' nodes* — data corruption dressed as a housekeeping suggestion.
        """
        node = _check_label(label)
        return Query(
            cypher=(
                f"MATCH (a:{self._label}:{node}), (b:{self._label}:{node}) "
                "WHERE a.tenant_id = $tenant_id AND b.tenant_id = $tenant_id "
                "  AND id(a) < id(b) "
                "  AND (toLower(a.name) = toLower(b.name) "
                "       OR toLower(a.name) CONTAINS toLower(b.name)) "
                "RETURN a, b LIMIT $limit"
            ),
            params=self._base_params(limit=int(limit)),
        )

    # -- writes --------------------------------------------------------------

    def merge_entity(
        self, label: NodeLabel, canonical_key: str, properties: dict[str, Any]
    ) -> Query:
        """Idempotent upsert of one entity. Query path G6.

        The ``MERGE`` key is ``(tenant_id, canonicalKey)`` — matching the
        composite uniqueness constraint. Merging on ``canonicalKey`` alone would
        attach this tenant's write to another tenant's node, which is the single
        worst thing this file could get wrong.

        Both encodings are written together, satisfying ADR-0009 rule 5's
        write-path invariant.
        """
        node = _check_label(label)
        safe_props = {k: v for k, v in properties.items() if k not in {"tenant_id", "canonicalKey"}}
        return Query(
            cypher=(
                f"MERGE (n:{self._label}:{node} {{tenant_id: $tenant_id, canonicalKey: $key}}) "
                "ON CREATE SET n += $props, n.createdAt = datetime() "
                "ON MATCH SET n += $props, n.updatedAt = datetime() "
                "RETURN n"
            ),
            params=self._base_params(key=canonical_key, props=safe_props),
        )

    def merge_edge(
        self,
        rel_type: str,
        from_key: str,
        to_key: str,
        properties: dict[str, Any] | None = None,
    ) -> Query:
        """Idempotent upsert of one relationship. Query path G7.

        Both endpoints are matched with the tenant label *and* predicate, so a
        cross-tenant edge cannot be created here even by a caller passing a key
        that exists in another tenant — the match simply finds nothing.
        """
        rel = _check_relationship(rel_type)
        return Query(
            cypher=(
                f"MATCH (a:{self._label} {{tenant_id: $tenant_id, canonicalKey: $from_key}}) "
                f"MATCH (b:{self._label} {{tenant_id: $tenant_id, canonicalKey: $to_key}}) "
                f"MERGE (a)-[r:{rel}]->(b) "
                "ON CREATE SET r += $props, r.createdAt = datetime() "
                "ON MATCH SET r += $props "
                "RETURN r"
            ),
            params=self._base_params(from_key=from_key, to_key=to_key, props=properties or {}),
        )

    def delete_entity(self, canonical_key: str) -> Query:
        """Delete one entity and its relationships. Query path G8."""
        return Query(
            cypher=(
                f"MATCH (n:{self._label} {{tenant_id: $tenant_id, canonicalKey: $key}}) "
                "DETACH DELETE n"
            ),
            params=self._base_params(key=canonical_key),
        )

    def merge_duplicates(self, keep_key: str, absorb_key: str) -> Query:
        """Resolve a duplicate pair (B6 tab 2). Query path G9.

        Records the resolution as a ``SAME_AS`` edge rather than discarding the
        absorbed node's identity, because ``GraphMergeDecisions`` must survive a
        rebuild-by-re-index — a human merge decision is not derivable from the
        source documents, so losing it would silently undo curation work.
        """
        return Query(
            cypher=(
                f"MATCH (keep:{self._label} {{tenant_id: $tenant_id, canonicalKey: $keep_key}}) "
                f"MATCH (absorb:{self._label} {{tenant_id: $tenant_id, canonicalKey: $absorb_key}}) "
                "MERGE (absorb)-[:SAME_AS]->(keep) "
                "SET absorb.mergedInto = $keep_key, absorb.mergedAt = datetime() "
                "RETURN keep, absorb"
            ),
            params=self._base_params(keep_key=keep_key, absorb_key=absorb_key),
        )

    def merge_chunk_ref(self, chunk_id: str, properties: dict[str, Any]) -> Query:
        """Upsert the minimal `Chunk` reference node (data-model.md §6.1).

        No `text`, no `embedding`, no title — enforced by the caller
        (`GraphStore.merge_chunk_ref`'s real adapter passes only the closed
        property set), not by this method, since the builder's job is safe
        Cypher construction, not schema policing of its caller's dict.
        """
        safe_props = {k: v for k, v in properties.items() if k not in {"tenant_id", "chunkId"}}
        return Query(
            cypher=(
                f"MERGE (n:{self._label}:{CHUNK_LABEL} {{tenant_id: $tenant_id, chunkId: $chunk_id}}) "
                "ON CREATE SET n += $props, n.createdAt = datetime() "
                "ON MATCH SET n += $props, n.updatedAt = datetime() "
                "RETURN n"
            ),
            params=self._base_params(chunk_id=chunk_id, props=safe_props),
        )

    def merge_chunk_edge(
        self,
        rel_type: str,
        chunk_id: str,
        entity_label: NodeLabel,
        entity_key: str,
        properties: dict[str, Any] | None = None,
    ) -> Query:
        """Upsert a `Chunk -> entity` edge (`MENTIONS`/`FROM_DOCUMENT`).

        A separate allowlist (`CHUNK_RELATIONSHIP_TYPES`) from `merge_edge`'s
        entity-to-entity one, and a separate method entirely rather than a
        flag on `merge_edge` — the two sides have genuinely different node
        shapes (`Chunk` has no `canonicalKey`), so a shared method would need
        a branch on every line anyway.
        """
        if rel_type not in CHUNK_RELATIONSHIP_TYPES:
            raise UnsafeGraphIdentifierError(
                f"Chunk relationship type not in the allowlist. Permitted: {sorted(CHUNK_RELATIONSHIP_TYPES)}"
            )
        node = _check_label(entity_label)
        return Query(
            cypher=(
                f"MATCH (c:{self._label}:{CHUNK_LABEL} {{tenant_id: $tenant_id, chunkId: $chunk_id}}) "
                f"MATCH (e:{self._label}:{node} {{tenant_id: $tenant_id, canonicalKey: $entity_key}}) "
                f"MERGE (c)-[r:{rel_type}]->(e) "
                "ON CREATE SET r += $props, r.createdAt = datetime() "
                "ON MATCH SET r += $props "
                "RETURN r"
            ),
            params=self._base_params(
                chunk_id=chunk_id, entity_key=entity_key, props=properties or {}
            ),
        )

    def ignore_duplicates(self, left_key: str, right_key: str, similarity: float) -> Query:
        """Record an ignored duplicate pair (B6 tab 2 **Ignore**) — data-model.md §6.4.

        Distinct from `merge_duplicates`: nothing is absorbed, and the
        `SAME_AS` edge is marked `state: 'Ignored'` so the pair stops
        resurfacing in `detect_duplicates` without pretending they were
        merged.
        """
        return Query(
            cypher=(
                f"MATCH (a:{self._label} {{tenant_id: $tenant_id, canonicalKey: $left_key}}) "
                f"MATCH (b:{self._label} {{tenant_id: $tenant_id, canonicalKey: $right_key}}) "
                "MERGE (a)-[s:SAME_AS]->(b) "
                "SET s.state = 'Ignored', s.similarity = $similarity, s.decidedAt = datetime() "
                "RETURN a, b"
            ),
            params=self._base_params(
                left_key=left_key, right_key=right_key, similarity=float(similarity)
            ),
        )

    # -- erasure -------------------------------------------------------------

    def delete_all(self, batch_size: int = 10_000) -> Query:
        """Batched erasure of every node for this tenant.

        Under ADR-0002 this was ``DROP DATABASE`` and needed no proof of
        completeness. It is now a filtered delete, so completeness must be
        *demonstrated* — see :meth:`assert_erased`, which the de-provisioning
        runbook (RB-10) and the right-to-be-forgotten path both require.
        """
        size = max(100, min(int(batch_size), 50_000))
        return Query(
            cypher=(
                f"MATCH (n:{self._label}) WHERE n.tenant_id = $tenant_id "
                f"CALL {{ WITH n DETACH DELETE n }} IN TRANSACTIONS OF {size} ROWS"
            ),
            params=self._base_params(),
        )

    def assert_erased(self) -> Query:
        """Prove erasure against **both** encodings.

        Checking only the label would miss a node whose label was removed but
        whose ``tenant_id`` survived, and vice versa. Both counts must be zero.
        """
        return Query(
            cypher=(
                f"OPTIONAL MATCH (byLabel:{self._label}) "
                "WITH count(byLabel) AS labelled "
                "OPTIONAL MATCH (byProp) WHERE byProp.tenant_id = $tenant_id "
                "RETURN labelled, count(byProp) AS propertied"
            ),
            params=self._base_params(),
        )

    # -- invariants ----------------------------------------------------------
    #
    # ADR-0009 rule 5 requires the encoding invariant on the write path, with
    # these as a periodic backstop for drift introduced from outside the
    # application — a migration, a manual cypher-shell session, a restore.
    # Drift here is the only leading indicator that precedes a leak.

    def assert_encoding_agreement(self) -> Query:
        """Find nodes whose label and ``tenant_id`` disagree.

        Two failure shapes: labelled for this tenant but carrying a different
        ``tenant_id``, or carrying this ``tenant_id`` without the label. Both
        must be zero.
        """
        return Query(
            cypher=(
                f"OPTIONAL MATCH (a:{self._label}) "
                "WHERE a.tenant_id IS NULL OR a.tenant_id <> $tenant_id "
                "WITH collect(a) AS labelledButWrongProp "
                "OPTIONAL MATCH (b) "
                f"WHERE b.tenant_id = $tenant_id AND NOT b:{self._label} "
                "RETURN size(labelledButWrongProp) AS labelled_but_wrong_prop, "
                "       count(b) AS prop_but_no_label"
            ),
            params=self._base_params(),
        )

    def assert_no_cross_tenant_edges(self) -> Query:
        """Find relationships that leave this tenant.

        A cross-tenant edge is invalid by definition (ADR-0009). If one exists,
        every traversal predicate becomes the only thing stopping a leak — so
        this must be zero, and an alert fires if it is not.
        """
        return Query(
            cypher=(
                f"MATCH (a:{self._label})-[r]-(b) "
                "WHERE a.tenant_id = $tenant_id "
                "  AND (b.tenant_id IS NULL OR b.tenant_id <> $tenant_id) "
                "RETURN count(r) AS cross_tenant_edges"
            ),
            params=self._base_params(),
        )

    # -- provisioning DDL ----------------------------------------------------

    def schema_statements(self) -> list[SchemaStatement]:
        """Indexes scoped to this tenant's label, created at provisioning.

        Replaces ``CREATE DATABASE`` in RB-09 step 2. Only *indexes* are
        per-tenant; the uniqueness constraints are global and composite, so they
        live in :func:`global_schema_statements` and are created once at
        bootstrap rather than N times.

        A per-tenant-label index is worth having because every query in this
        builder leads with ``:Tenant_<slug>``, so the label is the access path
        and scoping the index to it keeps one tenant's lookups from scanning
        another's nodes.
        """
        return [
            SchemaStatement(
                cypher=(
                    f"CREATE INDEX shj3_{self._tenant.value}_tenant_id IF NOT EXISTS "
                    f"FOR (n:{self._label}) ON (n.tenant_id)"
                ),
                purpose=f"tenant_id lookup within {self._label}",
            ),
            SchemaStatement(
                cypher=(
                    f"CREATE INDEX shj3_{self._tenant.value}_name IF NOT EXISTS "
                    f"FOR (n:{self._label}) ON (n.name)"
                ),
                purpose=f"entity search (B6 tab 2) within {self._label}",
            ),
            SchemaStatement(
                cypher=(
                    f"CREATE INDEX shj3_{self._tenant.value}_key IF NOT EXISTS "
                    f"FOR (n:{self._label}) ON (n.canonicalKey)"
                ),
                purpose=f"canonical-key lookup within {self._label}",
            ),
        ]

    def schema_object_names(self) -> tuple[str, ...]:
        """The names of this tenant's label-scoped indexes.

        Pure derivation, no Cypher: provisioning verification needs to ask the
        database *which* objects exist, and it must ask about the same names
        :meth:`schema_statements` created. Deriving them here keeps that
        agreement in one module rather than duplicating a naming convention into
        the provisioner — where a divergence would make a correctly provisioned
        tenant fail its own verification.
        """
        return tuple(f"shj3_{self._tenant.value}_{suffix}" for suffix in _INDEX_SUFFIXES)

    def drop_schema_statements(self) -> list[SchemaStatement]:
        """Drop this tenant's label-scoped indexes.

        Used by de-provisioning (RB-10) after the batched delete, so a removed
        tenant leaves no schema objects behind. The global constraints stay —
        they belong to every tenant, not this one.
        """
        return [
            SchemaStatement(
                cypher=f"DROP INDEX shj3_{self._tenant.value}_{suffix} IF EXISTS",
                purpose=f"remove {self._label} {suffix} index",
            )
            for suffix in _INDEX_SUFFIXES
        ]
