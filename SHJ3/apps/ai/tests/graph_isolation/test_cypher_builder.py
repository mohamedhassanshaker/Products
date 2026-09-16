"""Unit tests for the tenant-aware Cypher builder.

The builder is the load-bearing control for graph tenant isolation. Neo4j
Community has no database boundary and no RBAC (ADR-0009), so nothing beneath
the application catches a mistake above it — RISK-024. That makes these tests
the closest thing the graph has to an infrastructure guarantee, and it is why
they assert the builder's *output shape* rather than only its behaviour against
a live database.

Corresponds to testing.md's graph isolation set. G1-G10 are one negative test
per query path; G11-G16 cover the encoding invariants, composite constraints,
the post-filter, label injection and the builder itself.

The per-path coverage test at the bottom is the structural part: it enumerates
the builder's public query methods and fails if one is added without a test, so
a new query path cannot ship untested. Per-path testing bounds the risk rather
than removing it, and that enumeration is what keeps the bound honest.
"""

from __future__ import annotations

import inspect

import pytest

from shj3_ai.adapters.outbound.graph.cypher_builder import (
    ENTITY_LABELS,
    RELATIONSHIP_TYPES,
    Query,
    TenantCypher,
    UnsafeGraphIdentifierError,
    UnscopedQueryError,
    global_schema_statements,
)
from shj3_ai.domain.tenancy import InvalidTenantSlugError, TenantSlug

SEWA = TenantSlug("sewa")
CUSTOMS = TenantSlug("customs")


@pytest.fixture
def sewa() -> TenantCypher:
    return TenantCypher(SEWA)


@pytest.fixture
def customs() -> TenantCypher:
    return TenantCypher(CUSTOMS)


# ---------------------------------------------------------------------------
# The Query invariant — G16, and the reason the rest of this file can be brief.
# ---------------------------------------------------------------------------


class TestQueryInvariant:
    def test_rejects_cypher_with_no_tenant_label(self) -> None:
        with pytest.raises(UnscopedQueryError, match="tenant label"):
            Query(
                cypher="MATCH (n:Service) WHERE n.tenant_id = $tenant_id RETURN n",
                params={"tenant_id": "sewa"},
            )

    def test_rejects_cypher_with_no_tenant_predicate(self) -> None:
        # The label alone is not sufficient. Dual encoding means both, so that
        # neither is a single point of failure.
        with pytest.raises(UnscopedQueryError, match=r"\$tenant_id"):
            Query(cypher="MATCH (n:Tenant_sewa:Service) RETURN n", params={"tenant_id": "sewa"})

    def test_rejects_referenced_but_unbound_parameter(self) -> None:
        with pytest.raises(UnscopedQueryError, match="does not bind"):
            Query(cypher="MATCH (n:Tenant_sewa) WHERE n.tenant_id = $tenant_id RETURN n", params={})

    def test_accepts_a_correctly_scoped_query(self) -> None:
        query = Query(
            cypher="MATCH (n:Tenant_sewa) WHERE n.tenant_id = $tenant_id RETURN n",
            params={"tenant_id": "sewa"},
        )
        assert query.params["tenant_id"] == "sewa"

    def test_has_no_exemption_flag(self) -> None:
        # An escape hatch on the one control with no infrastructure beneath it
        # would be the wrong trade. Schema DDL is a separate type instead.
        assert "schema_only" not in set(Query.__slots__)


# ---------------------------------------------------------------------------
# G1-G10 — one per query path. Every built query must carry both encodings and
# must name this tenant, never another.
# ---------------------------------------------------------------------------

QUERY_PATHS = {
    "G1_match_entity": lambda b: b.match_entity("Service", "pay-utilities-bill"),
    "G2_search_entities": lambda b: b.search_entities("SEWA"),
    "G3_neighbours": lambda b: b.neighbours("pay-utilities-bill", ("PROVIDED_BY",)),
    "G4_traverse": lambda b: b.traverse("pay-utilities-bill", max_hops=3),
    "G5_detect_duplicates": lambda b: b.detect_duplicates("Provider"),
    "G6_merge_entity": lambda b: b.merge_entity("Provider", "sewa", {"name": "SEWA"}),
    "G7_merge_edge": lambda b: b.merge_edge("PROVIDED_BY", "pay-utilities-bill", "sewa"),
    "G8_delete_entity": lambda b: b.delete_entity("sewa"),
    "G9_merge_duplicates": lambda b: b.merge_duplicates("sewa", "sharjah-electricity-water"),
    "G10_retrieval_subgraph": lambda b: b.retrieval_subgraph(["pay-utilities-bill"]),
    "G10b_mentioning_chunks": lambda b: b.mentioning_chunks(["pay-utilities-bill"]),
    "G_browse_nodes": lambda b: b.browse_nodes(),
    "G_browse_edges": lambda b: b.browse_edges(["pay-utilities-bill", "sewa"]),
    "G_merge_chunk_ref": lambda b: b.merge_chunk_ref("chunk-1", {"knowledgeSourceId": "ks-1"}),
    "G_merge_chunk_edge": lambda b: b.merge_chunk_edge("MENTIONS", "chunk-1", "Provider", "sewa"),
    "G_ignore_duplicates": lambda b: b.ignore_duplicates("sewa", "sharjah-electricity-water", 0.9),
    "G_chunk_ids_for_source": lambda b: b.chunk_ids_for_source("ks-1"),
}


@pytest.mark.parametrize("path", sorted(QUERY_PATHS))
class TestEveryQueryPathIsScoped:
    def test_carries_the_tenant_label(self, path: str, sewa: TenantCypher) -> None:
        query = QUERY_PATHS[path](sewa)
        assert ":Tenant_sewa" in query.cypher

    def test_filters_on_the_tenant_property(self, path: str, sewa: TenantCypher) -> None:
        assert "$tenant_id" in QUERY_PATHS[path](sewa).cypher

    def test_binds_this_tenant_and_not_another(self, path: str, sewa: TenantCypher) -> None:
        assert QUERY_PATHS[path](sewa).params["tenant_id"] == "sewa"

    def test_never_names_another_tenant(self, path: str, sewa: TenantCypher) -> None:
        # The negative half: a query built for SEWA must contain no trace of any
        # other government entity's label.
        query = QUERY_PATHS[path](sewa)
        assert "Tenant_customs" not in query.cypher
        assert "customs" not in str(query.params.get("tenant_id"))

    def test_two_tenants_produce_disjoint_queries(
        self, path: str, sewa: TenantCypher, customs: TenantCypher
    ) -> None:
        a = QUERY_PATHS[path](sewa)
        b = QUERY_PATHS[path](customs)
        assert a.cypher != b.cypher
        assert a.params["tenant_id"] != b.params["tenant_id"]


class TestBothTraversalEndpointsAreScoped:
    """A cross-tenant edge should not exist — but if one did, traversal must
    still refuse it. So the predicate is on both ends, not just the start node.
    """

    def test_neighbours_scopes_the_far_node(self, sewa: TenantCypher) -> None:
        cypher = sewa.neighbours("pay-utilities-bill").cypher
        assert cypher.count(":Tenant_sewa") >= 2
        assert "m.tenant_id = $tenant_id" in cypher

    def test_traverse_scopes_the_far_node(self, sewa: TenantCypher) -> None:
        cypher = sewa.traverse("pay-utilities-bill").cypher
        assert "m.tenant_id = $tenant_id" in cypher

    def test_retrieval_subgraph_scopes_the_far_node(self, sewa: TenantCypher) -> None:
        # This is the one whose output is quoted back to a citizen.
        assert "m.tenant_id = $tenant_id" in sewa.retrieval_subgraph(["x"]).cypher

    def test_merge_edge_matches_both_endpoints_within_the_tenant(self, sewa: TenantCypher) -> None:
        # So a caller passing a key that exists only in another tenant simply
        # finds nothing, rather than creating a cross-tenant edge.
        cypher = sewa.merge_edge("PROVIDED_BY", "a", "b").cypher
        assert cypher.count("tenant_id: $tenant_id") == 2


# ---------------------------------------------------------------------------
# G11-G15 — invariants, constraints, injection.
# ---------------------------------------------------------------------------


class TestMergeKeyIsComposite:
    def test_merge_entity_keys_on_tenant_and_canonical_key(self, sewa: TenantCypher) -> None:
        # The worst thing this file could get wrong: merging on canonicalKey
        # alone would attach this tenant's write to another tenant's node.
        cypher = sewa.merge_entity("Provider", "sewa", {"name": "SEWA"}).cypher
        assert (
            "MERGE (n:Tenant_sewa:Provider {tenant_id: $tenant_id, canonicalKey: $key})" in cypher
        )

    def test_merge_entity_cannot_be_tricked_into_overwriting_the_tenant(
        self, sewa: TenantCypher
    ) -> None:
        # A caller passing tenant_id in the property bag must not be able to
        # relabel the node into another tenant.
        query = sewa.merge_entity(
            "Provider", "sewa", {"name": "SEWA", "tenant_id": "customs", "canonicalKey": "evil"}
        )
        assert query.params["props"] == {"name": "SEWA"}
        assert query.params["tenant_id"] == "sewa"


class TestGlobalConstraintsAreComposite:
    def test_uniqueness_is_keyed_by_tenant_and_canonical_key(self) -> None:
        # In one shared database, single-property uniqueness on canonicalKey
        # would make a second tenant's ingest fail with a spurious conflict.
        for statement in global_schema_statements():
            if "CONSTRAINT" in statement.cypher:
                assert "(n.tenant_id, n.canonicalKey) IS UNIQUE" in statement.cypher

    def test_one_constraint_per_entity_label_not_per_tenant(self) -> None:
        constraints = [s for s in global_schema_statements() if "CONSTRAINT" in s.cypher]
        assert len(constraints) == len(ENTITY_LABELS)
        # No tenant slug appears: these are global by design, so creating them
        # per tenant would produce N redundant constraints on the same pair.
        for statement in constraints:
            assert "sewa" not in statement.cypher
            assert "Tenant_" not in statement.cypher

    def test_per_tenant_statements_are_indexes_only(self, sewa: TenantCypher) -> None:
        for statement in sewa.schema_statements():
            assert "CREATE INDEX" in statement.cypher
            assert "Tenant_sewa" in statement.cypher


class TestLabelAndRelationshipInjection:
    @pytest.mark.parametrize(
        "label",
        [
            "Service) DETACH DELETE (n",
            "Tenant_customs",
            "Service:Tenant_customs",
            "`Service`",
            "Anything",
            "",
        ],
    )
    def test_rejects_labels_outside_the_allowlist(self, sewa: TenantCypher, label: str) -> None:
        # Labels cannot be bound parameters, so they are interpolated — an
        # allowlist is the only sound defence.
        with pytest.raises(UnsafeGraphIdentifierError):
            sewa.match_entity(label, "x")  # type: ignore[arg-type]

    @pytest.mark.parametrize(
        "rel",
        ["PROVIDED_BY|*", "*", "]-()-[", "SAME_AS|HAS_FEE", "ANYTHING"],
    )
    def test_rejects_relationship_types_outside_the_allowlist(
        self, sewa: TenantCypher, rel: str
    ) -> None:
        with pytest.raises(UnsafeGraphIdentifierError):
            sewa.merge_edge(rel, "a", "b")

    def test_accepts_every_allowlisted_label(self, sewa: TenantCypher) -> None:
        for label in ENTITY_LABELS:
            assert sewa.match_entity(label, "x").cypher  # type: ignore[arg-type]

    def test_accepts_every_allowlisted_relationship(self, sewa: TenantCypher) -> None:
        for rel in RELATIONSHIP_TYPES:
            assert sewa.merge_edge(rel, "a", "b").cypher

    def test_a_malformed_tenant_label_cannot_construct_a_builder(self) -> None:
        # TenantSlug already validates, so this proves the second line: a future
        # caller building a label some other way still cannot inject.
        with pytest.raises(InvalidTenantSlugError):
            TenantSlug("customs`) MATCH (n) DETACH DELETE n //")


#: Distinctive sentinel values for the "nothing is interpolated" check.
#:
#: The realistic fixtures in QUERY_PATHS cannot be reused here: they use "sewa"
#: as a canonical key, which is also a substring of the tenant label
#: ``Tenant_sewa``, so a substring assertion would fail on coincidence rather
#: than on a real interpolation. Sentinels that cannot appear in any label or
#: keyword make the assertion mean what it says.
SENTINEL = "zzsentinelvaluezz"

SENTINEL_PATHS = {
    "G1_match_entity": lambda b: b.match_entity("Service", SENTINEL),
    "G2_search_entities": lambda b: b.search_entities(SENTINEL),
    "G3_neighbours": lambda b: b.neighbours(SENTINEL, ("PROVIDED_BY",)),
    "G4_traverse": lambda b: b.traverse(SENTINEL, max_hops=3),
    "G6_merge_entity": lambda b: b.merge_entity("Provider", SENTINEL, {"name": SENTINEL + "n"}),
    "G7_merge_edge": lambda b: b.merge_edge("PROVIDED_BY", SENTINEL, SENTINEL + "b"),
    "G8_delete_entity": lambda b: b.delete_entity(SENTINEL),
    "G9_merge_duplicates": lambda b: b.merge_duplicates(SENTINEL, SENTINEL + "b"),
    "G10_retrieval_subgraph": lambda b: b.retrieval_subgraph([SENTINEL]),
    "G10b_mentioning_chunks": lambda b: b.mentioning_chunks([SENTINEL]),
    "G_browse_edges": lambda b: b.browse_edges([SENTINEL]),
    "G_merge_chunk_ref": lambda b: b.merge_chunk_ref(
        SENTINEL, {"knowledgeSourceId": SENTINEL + "n"}
    ),
    "G_merge_chunk_edge": lambda b: b.merge_chunk_edge(
        "MENTIONS", SENTINEL, "Provider", SENTINEL + "e"
    ),
    "G_ignore_duplicates": lambda b: b.ignore_duplicates(SENTINEL, SENTINEL + "b", 0.9),
    "G_chunk_ids_for_source": lambda b: b.chunk_ids_for_source(SENTINEL),
}


class TestValuesAreAlwaysParameters:
    @pytest.mark.parametrize("path", sorted(SENTINEL_PATHS))
    def test_caller_values_never_appear_inline(self, path: str, sewa: TenantCypher) -> None:
        query = SENTINEL_PATHS[path](sewa)
        # Every caller-supplied value is bound. The only interpolated fragments
        # are the tenant label, node labels, relationship types and a clamped
        # integer hop bound — all checked against allowlists.
        assert SENTINEL not in query.cypher, "a caller value was interpolated instead of bound"
        # And it really did reach the statement, so the test is not vacuous.
        assert any(SENTINEL in str(v) for v in query.params.values())

    def test_nested_property_values_are_bound_not_interpolated(self, sewa: TenantCypher) -> None:
        # Property bags are the easiest place to accidentally build a string.
        query = sewa.merge_entity("Provider", "k", {"name": SENTINEL, "note": SENTINEL})
        assert SENTINEL not in query.cypher
        assert query.params["props"]["name"] == SENTINEL

    def test_hop_bound_is_clamped_to_a_small_integer(self, sewa: TenantCypher) -> None:
        # max_hops must be interpolated (Cypher cannot bind a path bound), so it
        # is coerced and clamped — the interpolated text is never caller text.
        assert "[*1..6]" in sewa.traverse("x", max_hops=999).cypher
        assert "[*1..1]" in sewa.traverse("x", max_hops=-5).cypher


class TestInvariantAssertions:
    def test_encoding_agreement_checks_both_directions(self, sewa: TenantCypher) -> None:
        # Labelled for this tenant but carrying a different tenant_id, AND
        # carrying this tenant_id without the label. Either alone would miss half
        # the drift.
        cypher = sewa.assert_encoding_agreement().cypher
        assert "labelled_but_wrong_prop" in cypher
        assert "prop_but_no_label" in cypher

    def test_cross_tenant_edge_check_exists(self, sewa: TenantCypher) -> None:
        assert "cross_tenant_edges" in sewa.assert_no_cross_tenant_edges().cypher

    def test_erasure_proof_counts_both_encodings(self, sewa: TenantCypher) -> None:
        # Under ADR-0002 this was DROP DATABASE and needed no proof. It is now a
        # filtered delete, so completeness must be demonstrated.
        cypher = sewa.assert_erased().cypher
        assert "labelled" in cypher
        assert "propertied" in cypher

    def test_delete_all_is_batched(self, sewa: TenantCypher) -> None:
        assert "IN TRANSACTIONS OF" in sewa.delete_all().cypher


# ---------------------------------------------------------------------------
# The structural guarantee: a new query path cannot ship untested.
# ---------------------------------------------------------------------------


def test_every_public_query_method_has_a_negative_test() -> None:
    """Enumerate the builder's query methods and require per-path coverage.

    testing.md's honest verdict on per-path testing is that it *bounds* the risk
    rather than removing it, because correctness depends on the path list staying
    complete. This test is what keeps it complete: add a query method without
    adding it to QUERY_PATHS and the isolation suite fails.
    """
    covered = {
        "match_entity",
        "search_entities",
        "neighbours",
        "traverse",
        "detect_duplicates",
        "merge_entity",
        "merge_edge",
        "delete_entity",
        "merge_duplicates",
        "retrieval_subgraph",
        "mentioning_chunks",
        "browse_nodes",
        "browse_edges",
        "merge_chunk_ref",
        "merge_chunk_edge",
        "ignore_duplicates",
        "chunk_ids_for_source",
    }
    # Assertions and erasure are covered by TestInvariantAssertions; DDL is not a
    # Query and is covered by TestGlobalConstraintsAreComposite.
    exempt = {
        "assert_encoding_agreement",
        "assert_no_cross_tenant_edges",
        "assert_erased",
        "delete_all",
        "schema_statements",
        "drop_schema_statements",
        # Pure name derivation — no Cypher at all, so there is no query path to leak
        # through. Its agreement with the two DDL methods is asserted in
        # tests/provisioning/test_graph_provisioner.py, which is the failure that
        # actually matters for it.
        "schema_object_names",
    }

    public = {
        name
        for name, member in inspect.getmembers(TenantCypher, predicate=inspect.isfunction)
        if not name.startswith("_")
    }

    uncovered = public - covered - exempt
    assert not uncovered, (
        f"Graph query paths with no negative isolation test: {sorted(uncovered)}. "
        "Add each to QUERY_PATHS. An untested query path is an untested leak (RISK-024)."
    )

    stale = covered - public
    assert not stale, f"QUERY_PATHS names methods that no longer exist: {sorted(stale)}"
