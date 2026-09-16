"""Unit tests for the tenant vector provisioner.

Most of this file exercises one guardrail: the embedding model and dimension recorded on
the collection at creation, and the comparison in ``verify`` that reads them back
(ADR-0004 rule 3, RISK-016).

That is the assertion worth having, because of the asymmetry in the two failure modes. A
*dimension* mismatch is rejected by Qdrant, so it announces itself. A *model* mismatch at
the same dimension is accepted silently and simply returns worse neighbours — retrieval is
poisoned rather than broken, no error is logged, and the only way to notice is to compare
against something recorded at creation. Hence the metadata, and hence the test that
``verify`` refuses a collection whose recorded model has drifted rather than reporting it
as a field for somebody to check.

No containers: the admin surface is a protocol for exactly this reason.
"""

from __future__ import annotations

from typing import Any

import pytest
from qdrant_client import models

from shj3_ai.adapters.outbound.vector.qdrant_provisioner import (
    DISTANCE,
    HNSW_EF_CONSTRUCT,
    HNSW_M,
    META_EMBEDDING_DIMENSIONS,
    META_EMBEDDING_MODEL,
    PAYLOAD_INDEXES,
    EmbeddingContract,
    QdrantProvisioner,
)
from shj3_ai.domain.tenancy import TenantSlug

SEWA = TenantSlug("sewa")
CONTRACT = EmbeddingContract(model="text-embedding-3-large", dimensions=3072)


class FakeCollectionAdmin:
    """An in-memory Qdrant admin surface."""

    def __init__(self) -> None:
        self.collections: dict[str, dict[str, Any]] = {}
        self.payload_indexes: dict[str, list[str]] = {}
        self.status: models.CollectionStatus = models.CollectionStatus.GREEN
        self.create_calls = 0
        self.delete_calls = 0

    def collection_exists(self, collection_name: str) -> bool:
        return collection_name in self.collections

    def create_collection(
        self,
        *,
        collection_name: str,
        vectors_config: models.VectorParams,
        hnsw_config: models.HnswConfigDiff,
        optimizers_config: models.OptimizersConfigDiff,
        metadata: dict[str, Any],
    ) -> bool:
        if collection_name in self.collections:
            raise RuntimeError("collection already exists")
        self.create_calls += 1
        self.collections[collection_name] = {
            "vectors": vectors_config,
            "hnsw": hnsw_config,
            "optimizers": optimizers_config,
            "metadata": metadata,
        }
        return True

    def create_payload_index(
        self, *, collection_name: str, field_name: str, field_schema: Any
    ) -> None:
        self.payload_indexes.setdefault(collection_name, []).append(field_name)

    def delete_collection(self, collection_name: str) -> bool:
        self.delete_calls += 1
        self.collections.pop(collection_name, None)
        return True

    def get_collection(self, collection_name: str) -> models.CollectionInfo:
        stored = self.collections[collection_name]
        return models.CollectionInfo(
            status=self.status,
            optimizer_status=models.OptimizersStatusOneOf.OK,
            segments_count=1,
            payload_schema={},
            config=models.CollectionConfig(
                params=models.CollectionParams(vectors=stored["vectors"]),
                hnsw_config=models.HnswConfig(
                    m=HNSW_M,
                    ef_construct=HNSW_EF_CONSTRUCT,
                    full_scan_threshold=10_000,
                ),
                optimizer_config=models.OptimizersConfig(
                    deleted_threshold=0.2,
                    vacuum_min_vector_number=1000,
                    default_segment_number=2,
                    flush_interval_sec=5,
                ),
                wal_config=models.WalConfig(wal_capacity_mb=32, wal_segments_ahead=0),
                metadata=stored["metadata"],
            ),
        )


@pytest.fixture
def admin() -> FakeCollectionAdmin:
    return FakeCollectionAdmin()


@pytest.fixture
def provisioner(admin: FakeCollectionAdmin) -> QdrantProvisioner:
    return QdrantProvisioner(admin, CONTRACT)


class TestEmbeddingContract:
    def test_rejects_a_missing_model(self) -> None:
        with pytest.raises(ValueError, match="silently"):
            EmbeddingContract(model="  ", dimensions=3072)

    def test_rejects_a_nonsensical_dimension(self) -> None:
        with pytest.raises(ValueError, match="positive"):
            EmbeddingContract(model="text-embedding-3-large", dimensions=0)


class TestCreate:
    async def test_derives_the_collection_name_from_the_slug(
        self, provisioner: QdrantProvisioner
    ) -> None:
        assert await provisioner.create(SEWA) == "sewa_knowledge"

    async def test_records_the_embedding_model_and_dimension(
        self, provisioner: QdrantProvisioner, admin: FakeCollectionAdmin
    ) -> None:
        collection = await provisioner.create(SEWA)
        metadata = admin.collections[collection]["metadata"]

        assert metadata[META_EMBEDDING_MODEL] == CONTRACT.model
        assert metadata[META_EMBEDDING_DIMENSIONS] == CONTRACT.dimensions

    async def test_uses_the_configured_size_and_distance(
        self, provisioner: QdrantProvisioner, admin: FakeCollectionAdmin
    ) -> None:
        collection = await provisioner.create(SEWA)
        vectors = admin.collections[collection]["vectors"]

        assert vectors.size == 3072
        assert vectors.distance == models.Distance(DISTANCE)

    async def test_creates_the_payload_indexes_that_resolve_citations(
        self, provisioner: QdrantProvisioner, admin: FakeCollectionAdmin
    ) -> None:
        collection = await provisioner.create(SEWA)
        assert admin.payload_indexes[collection] == list(PAYLOAD_INDEXES)

    async def test_is_idempotent(
        self, provisioner: QdrantProvisioner, admin: FakeCollectionAdmin
    ) -> None:
        # RB-09 is resumable, and `create_collection` fails on an existing collection.
        await provisioner.create(SEWA)
        await provisioner.create(SEWA)
        assert admin.create_calls == 1

    async def test_does_not_rewrite_recorded_metadata_on_a_rerun(
        self, admin: FakeCollectionAdmin
    ) -> None:
        # Rewriting the recorded model to match the currently configured one would erase
        # the only evidence that the vectors inside came from something else. A model
        # change is a full re-index, never a metadata edit.
        await QdrantProvisioner(admin, CONTRACT).create(SEWA)

        other = EmbeddingContract(model="bge-m3", dimensions=3072)
        await QdrantProvisioner(admin, other).create(SEWA)

        stored = admin.collections["sewa_knowledge"]["metadata"]
        assert stored[META_EMBEDDING_MODEL] == CONTRACT.model


class TestDestroy:
    async def test_deletes_the_collection(
        self, provisioner: QdrantProvisioner, admin: FakeCollectionAdmin
    ) -> None:
        await provisioner.create(SEWA)
        await provisioner.destroy(SEWA)
        assert not admin.collection_exists("sewa_knowledge")

    async def test_absent_collection_is_success(
        self, provisioner: QdrantProvisioner, admin: FakeCollectionAdmin
    ) -> None:
        # Rollback cannot know what was created, so a 404 is success (RB-10).
        await provisioner.destroy(SEWA)
        assert admin.delete_calls == 0


class TestNoContract:
    """A provisioner built with `contract=None` is valid only for `destroy()`.

    Found running the real `/vector/destroy` endpoint end to end: it has no reason
    to know what a collection was built for, so a provisioner constructed for
    destroy alone must not need a contract just to satisfy the constructor — and a
    caller that mistakenly calls `create()`/`verify()` on one should fail loudly
    rather than on an attribute error deep in Qdrant client code.
    """

    async def test_create_refuses_without_a_contract(self, admin: FakeCollectionAdmin) -> None:
        provisioner = QdrantProvisioner(admin, None)
        with pytest.raises(RuntimeError, match="create requires an embedding contract"):
            await provisioner.create(SEWA)

    async def test_verify_refuses_without_a_contract(self, admin: FakeCollectionAdmin) -> None:
        provisioner = QdrantProvisioner(admin, None)
        with pytest.raises(RuntimeError, match="verify requires an embedding contract"):
            await provisioner.verify(SEWA)

    async def test_destroy_does_not_require_one(self, admin: FakeCollectionAdmin) -> None:
        provisioner = QdrantProvisioner(admin, None)
        await provisioner.destroy(SEWA)  # must not raise


class TestVerify:
    async def test_true_for_a_green_collection_matching_the_contract(
        self, provisioner: QdrantProvisioner
    ) -> None:
        await provisioner.create(SEWA)
        assert await provisioner.verify(SEWA) is True

    async def test_false_when_the_collection_is_absent(
        self, provisioner: QdrantProvisioner
    ) -> None:
        assert await provisioner.verify(SEWA) is False

    async def test_false_while_the_collection_is_not_serving(
        self, provisioner: QdrantProvisioner, admin: FakeCollectionAdmin
    ) -> None:
        await provisioner.create(SEWA)
        admin.status = models.CollectionStatus.YELLOW
        assert await provisioner.verify(SEWA) is False

    async def test_false_when_the_dimension_disagrees(self, admin: FakeCollectionAdmin) -> None:
        await QdrantProvisioner(admin, CONTRACT).create(SEWA)

        smaller = EmbeddingContract(model=CONTRACT.model, dimensions=1536)
        assert await QdrantProvisioner(admin, smaller).verify(SEWA) is False

    async def test_false_when_the_model_disagrees_at_the_same_dimension(
        self, admin: FakeCollectionAdmin
    ) -> None:
        # THE test in this file. Qdrant accepts this silently, so nothing below the
        # application would catch it, and retrieval degrades instead of failing (RISK-016).
        await QdrantProvisioner(admin, CONTRACT).create(SEWA)

        swapped = EmbeddingContract(model="bge-m3", dimensions=CONTRACT.dimensions)
        assert await QdrantProvisioner(admin, swapped).verify(SEWA) is False

    async def test_false_when_no_model_was_ever_recorded(
        self, provisioner: QdrantProvisioner, admin: FakeCollectionAdmin
    ) -> None:
        # A collection predating the contract cannot be assumed to agree about the one
        # fact that is not recoverable by inspection.
        await provisioner.create(SEWA)
        admin.collections["sewa_knowledge"]["metadata"] = {}
        assert await provisioner.verify(SEWA) is False
