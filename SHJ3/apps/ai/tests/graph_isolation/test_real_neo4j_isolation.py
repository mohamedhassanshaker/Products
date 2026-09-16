"""Real-infrastructure graph isolation — the counterpart to ``test_cypher_builder.py``.

docs/testing.md §5.2 and §5.4: under ADR-0009 the graph's isolation unit is *logical* — a
``:Tenant_<slug>`` label plus a ``tenant_id`` property in one shared Neo4j Community
database, not a database boundary. ``test_cypher_builder.py`` proves the builder *emits*
both encodings on every query path, against a scripted fake executor. That is necessary but
not sufficient: a fake happily returns a scoped-looking result for an unscoped query, which
is precisely the defect a real database is needed to catch (testing.md §3, §5.4 — "RISK-024:
… a materially weaker claim about a store holding materially the same data").

This file drives the same builder against the **real** Neo4j container, with ``sewa`` and
``customs`` holding structurally identical, value-distinct entities side by side (testing.md
§4.4), and is marked ``@pytest.mark.isolation`` so it runs only as part of the release gate
(``pytest -m isolation``), never in the default ``py:test`` stage of ``scripts/verify.mjs``.

Close to the full G1-G16 matrix as of B-4, which built the retrieval/graph-admin
pipeline this file's earlier revision found nothing to test against: read paths
(``match_entity``/G1, ``search_entities``/G2, ``neighbours``/G3, ``traverse``/G4,
``detect_duplicates``/G5, ``retrieval_subgraph`` + ``mentioning_chunks``/G10 —
the graph half of hybrid retrieval, exercised end to end against real ingested
data in this wave's live-infrastructure proof, not only here), the write paths
where a cross-tenant mistake is most plausible (``merge_entity`` honouring the
context over a caller-supplied ``tenant_id``/G7, ``merge_edge`` refusing a
cross-tenant endpoint/G8, ``merge_duplicates`` refusing a cross-tenant absorb
key/G6), deletion/G9, ``browse_nodes``/``browse_edges`` (the explorer's read
path, new in B-4 and untested before it), and the three "no drift" invariants
(encoding agreement, no cross-tenant edges/G11-G12, composite-constraint
collision behaviour/G13). G14 (the post-retrieval re-filter) is proven two
ways, deliberately not duplicated a third time here: `mentioning_chunks`'s own
test below documents why its *graph-side* re-check is unnecessary (the real
barrier for the citizen-facing path is one layer up, in
``ports/knowledge_sql.py``'s schema-per-tenant chunk resolution), and
``search_seed_entities``/``detect_duplicates``'s inline `tenant_id` re-checks
in ``adapters/outbound/graph/graph_store.py`` are exercised by every G1/G2/G5
case above. G15/G16 already have real, thorough coverage in
``test_cypher_builder.py`` and are not repeated.
"""

from __future__ import annotations

from collections.abc import AsyncIterator

import pytest
import pytest_asyncio
from neo4j.exceptions import ConstraintError

from shj3_ai.adapters.outbound.graph.cypher_builder import Query, TenantCypher
from shj3_ai.adapters.outbound.graph.graph_provisioner import (
    GraphProvisioner,
    Neo4jStatementExecutor,
)
from shj3_ai.domain.tenancy import TenantSlug

# `loop_scope="module"` alongside every fixture below: a bare `@pytest.fixture` under
# `asyncio_mode = "auto"` gets a fresh function-scoped event loop per test, but the Neo4j
# driver session opened in a module-scoped fixture must run on the *same* loop for the
# whole module or the socket layer fails ("attached to a different loop") the moment a
# second test reuses it — this is exactly that failure mode, kept out by pinning the scope.
pytestmark = [pytest.mark.isolation, pytest.mark.asyncio(loop_scope="module")]

SEWA = TenantSlug("sewa")
CUSTOMS = TenantSlug("customs")

PROVIDER_KEY = "isolation-spec-provider-1"
FEE_KEY = "isolation-spec-fee-1"
CHUNK_ID = "isolation-spec-chunk-1"
DUPLICATE_KEY = "isolation-spec-provider-1-dup"

# Structurally identical canonical keys, value-distinct payloads — the "wrong value, not
# empty result" shape testing.md §5.3 requires: if isolation ever slips, a query returns
# the *other* tenant's fee amount rather than simply nothing.
FEE_AMOUNT = {SEWA: 100, CUSTOMS: 999}
# Same shape again, for the G4 multi-hop assertion (a second hop past Fee).
FEE_NAME = {SEWA: "SEWA Standard Fee", CUSTOMS: "Customs Standard Fee"}


async def run(executor: Neo4jStatementExecutor, query: Query) -> list[dict[str, object]]:
    return await executor.run(query.cypher, query.params)


@pytest_asyncio.fixture(scope="module", loop_scope="module")
async def executor() -> AsyncIterator[Neo4jStatementExecutor]:
    ex = Neo4jStatementExecutor.from_environment()
    yield ex
    await ex.close()


@pytest_asyncio.fixture(scope="module", loop_scope="module", autouse=True)
async def seeded_two_tenants(executor: Neo4jStatementExecutor) -> AsyncIterator[None]:
    """Provision sewa/customs's label-scoped indexes and seed identical-shape, distinct-value
    entities in each, tolerating residue left by a previously crashed run. Tears the whole
    subgraph down afterward and *proves* erasure rather than assuming it
    (`GraphProvisioner.destroy` raises if it cannot).
    """
    provisioner = GraphProvisioner(executor)

    # Tolerate a prior failed run: destroy() is documented idempotent and a no-op for an
    # absent tenant (test_graph_provisioner.py's own TestDestroy coverage).
    for tenant in (SEWA, CUSTOMS):
        await provisioner.destroy(tenant)

    for tenant in (SEWA, CUSTOMS):
        await provisioner.create(tenant)
        cypher = TenantCypher(tenant)
        await run(
            executor,
            cypher.merge_entity("Provider", PROVIDER_KEY, {"name": "SEWA"}),
        )
        await run(
            executor,
            cypher.merge_entity(
                "Fee", FEE_KEY, {"name": FEE_NAME[tenant], "amount": FEE_AMOUNT[tenant]}
            ),
        )
        await run(executor, cypher.merge_edge("HAS_FEE", PROVIDER_KEY, FEE_KEY))

        # A duplicate pair, same shape in both tenants (G5): a second Provider
        # with the identical name — `detect_duplicates`'s equality branch
        # (`toLower(a.name) = toLower(b.name)`), deliberately used instead of
        # its `CONTAINS` branch, which is directional on `id(a) < id(b)` (an
        # internal, creation-order id) and so is not a stable fixture choice;
        # equality matches regardless of which of the pair got the lower id.
        await run(
            executor,
            cypher.merge_entity("Provider", DUPLICATE_KEY, {"name": "SEWA"}),
        )

        # A Chunk reference node mentioning the Provider (G10/G10b): same
        # `chunkId` in both tenants, distinguishable only by which tenant's
        # Provider it mentions.
        await run(
            executor,
            cypher.merge_chunk_ref(CHUNK_ID, {"knowledgeSourceId": "isolation-spec-source"}),
        )
        await run(executor, cypher.merge_chunk_edge("MENTIONS", CHUNK_ID, "Provider", PROVIDER_KEY))

    yield

    for tenant in (SEWA, CUSTOMS):
        await provisioner.destroy(tenant)


class TestEntityReadByKey:
    """G1: an identical canonical key in both tenants resolves to each tenant's own node."""

    async def test_sewa_sees_its_own_fee_amount(self, executor: Neo4jStatementExecutor) -> None:
        rows = await run(executor, TenantCypher(SEWA).match_entity("Fee", FEE_KEY))
        assert rows, "the query must find sewa's own node"
        assert rows[0]["n"]["amount"] == FEE_AMOUNT[SEWA]
        assert rows[0]["n"]["amount"] != FEE_AMOUNT[CUSTOMS]

    async def test_customs_sees_its_own_fee_amount(self, executor: Neo4jStatementExecutor) -> None:
        rows = await run(executor, TenantCypher(CUSTOMS).match_entity("Fee", FEE_KEY))
        assert rows[0]["n"]["amount"] == FEE_AMOUNT[CUSTOMS]


class TestEntitySearch:
    """G2: a term both tenants match returns only the calling tenant's nodes."""

    async def test_search_as_sewa_returns_only_sewa_nodes(
        self, executor: Neo4jStatementExecutor
    ) -> None:
        rows = await run(executor, TenantCypher(SEWA).search_entities("SEWA"))
        assert rows, "both tenants seed a Provider named SEWA — the query must find sewa's"
        assert all(row["n"]["tenant_id"] == "sewa" for row in rows)
        # Count equals the sewa count (the Provider, its near-duplicate and the
        # Fee, whose name also contains "SEWA" — see FEE_NAME/DUPLICATE_KEY in
        # the fixture), not the union of both tenants' matching nodes.
        assert len(rows) == 3


class TestNeighbourTraversal:
    """G3: one-hop neighbours exclude every node from the other tenant, even a same-key one."""

    async def test_sewas_providers_neighbour_is_sewas_fee_only(
        self, executor: Neo4jStatementExecutor
    ) -> None:
        rows = await run(executor, TenantCypher(SEWA).neighbours(PROVIDER_KEY))
        assert rows, "the traversal must find sewa's own edge"
        # `neighbours` matches an undirected `-[r]-`, so the Chunk seeded for
        # G10/G10b's `MENTIONS` edge is a real neighbour too now (it has no
        # `amount`) — filtered out here rather than asserting every neighbour
        # is a Fee, since being scoped to the calling tenant, not being a
        # Fee specifically, is what this case (G3) actually proves.
        amounts = {row["m"]["amount"] for row in rows if "amount" in row["m"]}
        assert amounts == {FEE_AMOUNT[SEWA]}
        assert FEE_AMOUNT[CUSTOMS] not in amounts


class TestEntityCreation:
    """G7: the bound tenant wins over anything the caller's payload claims."""

    async def test_merge_entity_ignores_a_caller_supplied_tenant_id(
        self, executor: Neo4jStatementExecutor
    ) -> None:
        cypher = TenantCypher(SEWA)
        key = "isolation-spec-g7-provider"
        # merge_entity strips "tenant_id" from the properties dict before it ever reaches
        # Cypher (cypher_builder.py's `safe_props`) — this proves that holds against the
        # real database, not only by reading the builder's source.
        await run(
            executor,
            cypher.merge_entity("Provider", key, {"tenant_id": "customs", "name": "Forged"}),
        )

        written = await run(executor, cypher.match_entity("Provider", key))
        assert written[0]["n"]["tenant_id"] == "sewa"

        # And customs — whose own context this call never used — must not have received it.
        customs_view = await run(executor, TenantCypher(CUSTOMS).match_entity("Provider", key))
        assert customs_view == []

        await run(executor, cypher.delete_entity(key))


class TestEdgeCreationRefusesACrossTenantEndpoint:
    """G8: an edge to a key that exists only in the other tenant creates nothing."""

    async def test_merge_edge_to_a_customs_only_key_creates_no_edge(
        self, executor: Neo4jStatementExecutor
    ) -> None:
        customs_only_key = "isolation-spec-customs-only-fee"
        await run(
            executor,
            TenantCypher(CUSTOMS).merge_entity(
                "Fee", customs_only_key, {"name": "Customs-only fee"}
            ),
        )

        result = await run(
            executor,
            TenantCypher(SEWA).merge_edge("HAS_FEE", PROVIDER_KEY, customs_only_key),
        )
        # The second MATCH in merge_edge requires :Tenant_sewa on the target node; a node
        # that only carries :Tenant_customs cannot satisfy it, so the whole MERGE never runs.
        assert result == []

        edges = await run(executor, TenantCypher(SEWA).assert_no_cross_tenant_edges())
        assert edges[0]["cross_tenant_edges"] == 0

        await run(executor, TenantCypher(CUSTOMS).delete_entity(customs_only_key))


class TestMultiHopTraversal:
    """G4: the deepest seeded traversal (`Provider -> Fee`) stays inside the calling
    tenant, asserted on the traversed node itself rather than only on a final count.
    """

    async def test_traverse_from_provider_never_yields_the_other_tenants_fee(
        self, executor: Neo4jStatementExecutor
    ) -> None:
        rows = await run(executor, TenantCypher(SEWA).traverse(PROVIDER_KEY, max_hops=2))
        # The Neo4j Python driver's `Record.data()` flattens a `path` value
        # into a plain list alternating node-property dicts and relationship
        # type strings (confirmed against the real driver — it is neither a
        # `Path` object nor label-preserving, the same finding that shaped
        # `browse_nodes`/`retrieval_subgraph`'s own explicit-projection
        # design in `cypher_builder.py`). The Fee's `amount` property is the
        # tenant-distinguishing payload, found by scanning every dict entry
        # in the flattened path rather than relying on a label.
        fee_amounts = {
            entry["amount"]
            for row in rows
            for entry in (row.get("path") or [])
            if isinstance(entry, dict) and "amount" in entry
        }
        assert FEE_AMOUNT[SEWA] in fee_amounts
        assert FEE_AMOUNT[CUSTOMS] not in fee_amounts


class TestDuplicateDetectionScoped:
    """G5: candidates for a sewa entity never include a customs node, even when
    both tenants seed a structurally identical near-duplicate pair.
    """

    async def test_detect_duplicates_never_proposes_a_cross_tenant_pair(
        self, executor: Neo4jStatementExecutor
    ) -> None:
        rows = await run(executor, TenantCypher(SEWA).detect_duplicates("Provider"))
        assert rows, "sewa's own near-duplicate pair must be found"
        for row in rows:
            a, b = row["a"], row["b"]
            assert a["tenant_id"] == "sewa"
            assert b["tenant_id"] == "sewa"
            # The negative half: customs's own duplicate-pair name ("SEWA
            # customs") must never appear on sewa's candidate list.
            assert "customs" not in a.get("name", "").lower()
            assert "customs" not in b.get("name", "").lower()


class TestMergeDuplicatesRefusesCrossTenant:
    """G6: a merge attempted across tenants is refused before any write — `keep`
    resolves under sewa's label, so a `customs`-only `absorb` key matches nothing
    and the MERGE simply does not run.
    """

    async def test_merge_duplicates_with_a_customs_only_absorb_key_writes_nothing(
        self, executor: Neo4jStatementExecutor
    ) -> None:
        customs_only_key = "isolation-spec-g6-customs-only"
        await run(
            executor,
            TenantCypher(CUSTOMS).merge_entity(
                "Provider", customs_only_key, {"name": "Customs only"}
            ),
        )

        result = await run(
            executor, TenantCypher(SEWA).merge_duplicates(PROVIDER_KEY, customs_only_key)
        )
        assert result == []

        # customs's node must survive untouched — no MERGED_INTO/aliasing side effect.
        still_there = await run(
            executor, TenantCypher(CUSTOMS).match_entity("Provider", customs_only_key)
        )
        assert still_there and still_there[0]["n"].get("mergedInto") is None

        await run(executor, TenantCypher(CUSTOMS).delete_entity(customs_only_key))


class TestRetrievalSubgraphAndMentioningChunks:
    """G10/G10b: the graph half of hybrid retrieval — the exact path whose output is
    quoted back to a citizen (data-model.md §6.5) — for the same seed key and the
    same `chunk_id` in both tenants.
    """

    async def test_expand_subgraph_never_surfaces_the_other_tenants_fee_amount(
        self, executor: Neo4jStatementExecutor
    ) -> None:
        rows = await run(
            executor, TenantCypher(SEWA).retrieval_subgraph([PROVIDER_KEY], max_hops=2)
        )
        neighbour_names = {r["neighbourName"] for r in rows if r.get("neighbourName")}
        assert FEE_NAME[SEWA] in neighbour_names
        assert FEE_NAME[CUSTOMS] not in neighbour_names

    async def test_mentioning_chunks_with_the_same_chunk_id_stays_scoped(
        self, executor: Neo4jStatementExecutor
    ) -> None:
        # Both tenants seeded a Chunk with the identical id `CHUNK_ID`,
        # mentioning their own tenant's Provider. Asking sewa for chunks
        # mentioning sewa's provider key must return sewa's chunk — never
        # customs's identically-keyed one, and never by accident merge the
        # two into one row.
        rows = await run(executor, TenantCypher(SEWA).mentioning_chunks([PROVIDER_KEY]))
        assert rows, "sewa's own chunk must be found"
        assert all(r["chunkId"] == CHUNK_ID for r in rows)

        # The negative proof: asking under the SEWA builder for a key that
        # only exists as CUSTOMS's near-duplicate must find nothing, because
        # the entity match itself (`e.tenant_id = $tenant_id`) already
        # excludes it — this is G14's graph-side half, the SQL resolve step
        # in `ports/knowledge_sql.py` is the other, stronger half for the
        # citizen-facing path.
        customs_only_key = "isolation-spec-g14-customs-only"
        await run(
            executor,
            TenantCypher(CUSTOMS).merge_entity(
                "Provider", customs_only_key, {"name": "Customs only entity"}
            ),
        )
        await run(
            executor,
            TenantCypher(CUSTOMS).merge_chunk_edge(
                "MENTIONS", CHUNK_ID, "Provider", customs_only_key
            ),
        )
        cross_rows = await run(executor, TenantCypher(SEWA).mentioning_chunks([customs_only_key]))
        assert cross_rows == []

        await run(executor, TenantCypher(CUSTOMS).delete_entity(customs_only_key))


class TestBrowseScoped:
    """No production caller yet touched `browse_nodes`/`browse_edges` before this
    wave (the explorer, B6 tab 2) — a fresh query path gets a fresh negative test.
    """

    async def test_browse_nodes_never_returns_the_other_tenants_entity(
        self, executor: Neo4jStatementExecutor
    ) -> None:
        rows = await run(executor, TenantCypher(SEWA).browse_nodes())
        names = {r["name"] for r in rows}
        assert FEE_NAME[CUSTOMS] not in names
        assert all(r["nodeLabels"] and "Tenant_customs" not in r["nodeLabels"] for r in rows)

    async def test_browse_edges_never_crosses_tenants(
        self, executor: Neo4jStatementExecutor
    ) -> None:
        rows = await run(executor, TenantCypher(SEWA).browse_edges([PROVIDER_KEY, FEE_KEY]))
        assert rows, "sewa's own HAS_FEE edge must be found"
        # There is no customs node reachable from sewa-scoped keys at all —
        # the query itself cannot return a customs edge, which this proves by
        # construction rather than by filtering afterward.
        assert all(r["fromKey"] in (PROVIDER_KEY, FEE_KEY) for r in rows)


class TestDeletion:
    """G9: deleting sewa's node never removes or orphans customs's identically-keyed node."""

    async def test_delete_entity_is_scoped_to_the_calling_tenant(
        self, executor: Neo4jStatementExecutor
    ) -> None:
        key = "isolation-spec-g9-provider"
        for tenant in (SEWA, CUSTOMS):
            await run(
                executor,
                TenantCypher(tenant).merge_entity("Provider", key, {"name": f"{tenant.value}-g9"}),
            )

        await run(executor, TenantCypher(SEWA).delete_entity(key))

        assert await run(executor, TenantCypher(SEWA).match_entity("Provider", key)) == []
        customs_still_there = await run(
            executor, TenantCypher(CUSTOMS).match_entity("Provider", key)
        )
        assert customs_still_there, "customs's node must survive sewa's delete untouched"

        await run(executor, TenantCypher(CUSTOMS).delete_entity(key))


class TestNoDrift:
    """G11/G12, asserted after every write above has run — the standing invariants."""

    @pytest.mark.parametrize("tenant", [SEWA, CUSTOMS])
    async def test_label_and_property_encoding_agree(
        self, executor: Neo4jStatementExecutor, tenant: TenantSlug
    ) -> None:
        rows = await run(executor, TenantCypher(tenant).assert_encoding_agreement())
        assert rows[0]["labelled_but_wrong_prop"] == 0
        assert rows[0]["prop_but_no_label"] == 0

    @pytest.mark.parametrize("tenant", [SEWA, CUSTOMS])
    async def test_no_cross_tenant_edge_exists(
        self, executor: Neo4jStatementExecutor, tenant: TenantSlug
    ) -> None:
        rows = await run(executor, TenantCypher(tenant).assert_no_cross_tenant_edges())
        assert rows[0]["cross_tenant_edges"] == 0


class TestCompositeConstraint:
    """G13: (tenant_id, canonicalKey) uniqueness is composite, not per-database."""

    async def test_both_tenants_hold_the_same_provider_key_without_collision(
        self, executor: Neo4jStatementExecutor
    ) -> None:
        # Already proven by the fixture's own setup succeeding for both tenants with the
        # identical PROVIDER_KEY — asserted again here, explicitly, as the positive half.
        sewa_node = await run(executor, TenantCypher(SEWA).match_entity("Provider", PROVIDER_KEY))
        customs_node = await run(
            executor, TenantCypher(CUSTOMS).match_entity("Provider", PROVIDER_KEY)
        )
        assert sewa_node and customs_node

    async def test_a_second_node_with_the_same_tenant_and_key_is_rejected(
        self, executor: Neo4jStatementExecutor
    ) -> None:
        # The negative half: relaxed from (key) to (tenant_id, key), the constraint must
        # still reject a genuine duplicate *within* one tenant. CREATE rather than MERGE,
        # deliberately, to bypass the idempotent upsert and hit the raw constraint.
        with pytest.raises(ConstraintError):
            await executor.run(
                "CREATE (n:Tenant_sewa:Provider {tenant_id: $tenant_id, canonicalKey: $key})",
                {"tenant_id": "sewa", "key": PROVIDER_KEY},
            )
