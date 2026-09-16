"""Real-infrastructure vector isolation (docs/testing.md §5, case 4; ADR-0002).

Qdrant's isolation unit is the **collection**, one per tenant, derived from the validated
slug and never taken from input (`qdrant_provisioner.py`'s module comment,
`TenantSlug.vector_collection`). That is a genuine physical boundary — Qdrant has no
concept of a cross-collection query — which is why, unlike the graph (`ADR-0009`, no
database boundary left after the licence decision), this file needs only a handful of
cases rather than a per-path matrix: testing.md §5.1's "the weakest store carries the most
cases" inversion cuts the other way for Qdrant.

Marked ``@pytest.mark.isolation`` so it runs only as part of the release gate
(``pytest -m isolation``), never the default ``py:test`` stage of ``scripts/verify.mjs``.
No production code exposes a point-write/search endpoint yet (only
``adapters/inbound/provisioning_router.py`` exists on the AI service today), so this drives
the real ``qdrant-client`` directly — the same one ``collection_admin_from_environment()``
constructs — rather than inventing a new endpoint to test against, per this suite's
constraint to use what the codebase actually supports.
"""

from __future__ import annotations

import pytest
from qdrant_client.models import PointStruct

from shj3_ai.adapters.outbound.vector.qdrant_provisioner import (
    META_EMBEDDING_DIMENSIONS,
    META_EMBEDDING_MODEL,
    META_TENANT,
    EmbeddingContract,
    QdrantProvisioner,
    collection_admin_from_environment,
)
from shj3_ai.domain.tenancy import TenantSlug

# Unlike the graph isolation spec, no explicit loop_scope is needed here: QdrantProvisioner
# wraps a synchronous qdrant-client, so there is no long-lived socket bound to one event
# loop for a later, differently-scoped test to collide with. The one async fixture below
# (seeded_two_tenants) only needs `await provisioner.create()/.destroy()` to run to
# completion once per module, which plain module-scoped `asyncio_mode = "auto"` handles.
pytestmark = pytest.mark.isolation

SEWA = TenantSlug("sewa")
CUSTOMS = TenantSlug("customs")

SEWA_MARKER = "VECTOR-ISOLATION-SPEC-SEWA-MARKER"
CUSTOMS_MARKER = "VECTOR-ISOLATION-SPEC-CUSTOMS-MARKER"

# Both tenants embed the same chunk_id under the identical query vector — a genuine
# collision if the two ever shared a collection, and the reason a search hit is unambiguous
# evidence of which tenant it came from rather than an artefact of vector similarity.
CHUNK_ID = "isolation-spec-chunk-1"


def _contract() -> EmbeddingContract:
    """Read from the environment rather than hardcode — `CK_VectorCollectionRegistry_dimension`
    (prisma/sql/001_constraints.sql) only accepts 1536 or 3072, and the local stack's
    `.env` is the source of truth for which one this run provisions against.
    """
    import os

    model = os.environ.get("SHJ3_OPENAI_EMBEDDING_MODEL", "text-embedding-3-large")
    dimensions = int(os.environ.get("SHJ3_OPENAI_EMBEDDING_DIM", "3072"))
    return EmbeddingContract(model=model, dimensions=dimensions)


def _vector(dimensions: int, seed: float) -> list[float]:
    """A deterministic, distinguishable unit-ish vector — no real embedding call is needed
    to prove collection-level isolation, only two vectors both tenants can be queried with.
    """
    return [seed] * dimensions


@pytest.fixture(scope="module")
def contract() -> EmbeddingContract:
    return _contract()


@pytest.fixture(scope="module")
def provisioner(contract: EmbeddingContract) -> QdrantProvisioner:
    return QdrantProvisioner(collection_admin_from_environment(), contract)


@pytest.fixture(scope="module", autouse=True)
async def seeded_two_tenants(provisioner: QdrantProvisioner, contract: EmbeddingContract):
    # Tolerate residue from a previously crashed run: destroy() is a documented no-op for
    # an absent collection (qdrant_provisioner.py's own TestDestroy coverage).
    for tenant in (SEWA, CUSTOMS):
        await provisioner.destroy(tenant)
        await provisioner.create(tenant)

    admin = collection_admin_from_environment()
    query_vector = _vector(contract.dimensions, 0.42)

    admin.upsert(
        collection_name=SEWA.vector_collection,
        points=[
            PointStruct(
                id=1,
                vector=query_vector,
                payload={"chunk_id": CHUNK_ID, "source_id": "isolation-spec", "text": SEWA_MARKER},
            )
        ],
    )
    admin.upsert(
        collection_name=CUSTOMS.vector_collection,
        points=[
            PointStruct(
                id=1,
                vector=query_vector,
                payload={
                    "chunk_id": CHUNK_ID,
                    "source_id": "isolation-spec",
                    "text": CUSTOMS_MARKER,
                },
            )
        ],
    )

    yield

    for tenant in (SEWA, CUSTOMS):
        await provisioner.destroy(tenant)


class TestSearchNeverCrossesCollections:
    def test_a_search_in_sewas_collection_never_surfaces_customss_point(
        self, contract: EmbeddingContract
    ) -> None:
        admin = collection_admin_from_environment()
        query_vector = _vector(contract.dimensions, 0.42)

        response = admin.query_points(
            collection_name=SEWA.vector_collection,
            query=query_vector,
            limit=10,
            with_payload=True,
        )

        texts = [point.payload["text"] for point in response.points if point.payload]
        # Proves the search ran and found sewa's own point.
        assert SEWA_MARKER in texts
        # The isolation claim: the identical chunk_id, identical query vector, embedded
        # under customs, never appears in a search issued against sewa's collection —
        # Qdrant has no cross-collection query, so this is a physical guarantee, not a
        # filter that could be forgotten.
        assert CUSTOMS_MARKER not in texts

    def test_a_search_in_customss_collection_never_surfaces_sewas_point(
        self, contract: EmbeddingContract
    ) -> None:
        admin = collection_admin_from_environment()
        query_vector = _vector(contract.dimensions, 0.42)

        response = admin.query_points(
            collection_name=CUSTOMS.vector_collection,
            query=query_vector,
            limit=10,
            with_payload=True,
        )

        texts = [point.payload["text"] for point in response.points if point.payload]
        assert CUSTOMS_MARKER in texts
        assert SEWA_MARKER not in texts


class TestCollectionMetadataIsTenantSpecific:
    """The embedding model/dimension pair is recorded ON each tenant's own collection
    (RB-09 step 3, RISK-016) — verified per tenant, not read once and assumed shared.
    """

    @pytest.mark.parametrize("tenant", [SEWA, CUSTOMS])
    async def test_verify_confirms_the_recorded_contract_matches(
        self, provisioner: QdrantProvisioner, tenant: TenantSlug
    ) -> None:
        assert await provisioner.verify(tenant) is True

    def test_each_collections_metadata_names_its_own_tenant(self) -> None:
        admin = collection_admin_from_environment()
        sewa_info = admin.get_collection(SEWA.vector_collection)
        customs_info = admin.get_collection(CUSTOMS.vector_collection)

        sewa_meta = sewa_info.config.metadata or {}
        customs_meta = customs_info.config.metadata or {}

        assert sewa_meta.get(META_TENANT) == "sewa"
        assert customs_meta.get(META_TENANT) == "customs"
        # Same embedding pair in this environment (one model configured for the whole
        # local stack) — the isolation claim is that each collection carries *its own*
        # recorded pair rather than one shared globally, not that the values differ.
        assert sewa_meta.get(META_EMBEDDING_MODEL) == customs_meta.get(META_EMBEDDING_MODEL)
        assert sewa_meta.get(META_EMBEDDING_DIMENSIONS) == customs_meta.get(
            META_EMBEDDING_DIMENSIONS
        )


class TestNoCollectionNameCollision:
    def test_the_two_tenants_hold_distinct_physical_collections(self) -> None:
        assert SEWA.vector_collection != CUSTOMS.vector_collection
        admin = collection_admin_from_environment()
        assert admin.collection_exists(SEWA.vector_collection)
        assert admin.collection_exists(CUSTOMS.vector_collection)
