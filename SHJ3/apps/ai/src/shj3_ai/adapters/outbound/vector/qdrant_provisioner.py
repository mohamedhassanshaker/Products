"""Tenant vector provisioning — RB-09 step 3, RB-10 reverse step 3, RB-11 check 6.

``shj3-ai`` is Qdrant's sole writer (ADR-0003) and the NetworkPolicy admits Qdrant ingress
from this service and the worker only, so the collection is created here. ``shj3-web``
reaches this through the internal API rather than through a client of its own.

The collection name is **derived** from a validated slug (ADR-0002 enforcement rule 4) and
never taken from input. api.md §5 states the consequence: *"the collection name is derived,
never taken from input — that is the whole defence against a crafted collection
reference."* Unlike SQL Server, Qdrant has no schema boundary to fall back on, so the name
is the isolation unit.

Why the embedding model and dimension are recorded on the collection
--------------------------------------------------------------------
This is the part of the file that exists because of a failure mode rather than a feature.
A collection is built for one embedding model at one dimension, and:

* a **dimension** change is rejected by Qdrant — loud, and therefore safe;
* a **model** change at the same dimension is accepted silently. Vectors from two models
  share a space they do not agree on, so nearest neighbours are subtly wrong. Retrieval is
  *poisoned rather than broken*: no error, no alert, worse answers to citizens
  (ADR-0004 rule 3, RISK-016).

RB-09 records both because *"they are not recoverable later by inspection"* — you cannot
look at 3072 floats and tell which model produced them. They are written into the
collection's own metadata at creation, so the fact travels with the collection rather than
only with the registry row, and :meth:`QdrantProvisioner.verify` compares rather than
reports.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any, Protocol

from qdrant_client import QdrantClient, models

from shj3_ai.domain.tenancy import TenantSlug

#: Cosine distance, per ADR-0004's retrieval design: the embedding models in use emit
#: normalised vectors, for which cosine is the metric they were trained against.
DISTANCE = "Cosine"

#: HNSW parameters from RB-09 step 3. Recorded here so a rebuilt collection is
#: parameterised identically to the one it replaces — a rebuild that quietly changes recall
#: characteristics would look like a model regression.
HNSW_M = 16
HNSW_EF_CONSTRUCT = 128
DEFAULT_SEGMENT_NUMBER = 2

#: Payload indexes. ``chunk_id`` is the join key across all three stores (ADR-0003 rule 3),
#: which is how a citation resolves back to authoritative text in SQL Server instead of
#: being reconstructed from a vector payload.
PAYLOAD_INDEXES: tuple[str, ...] = ("chunk_id", "source_id")

#: Metadata keys written on the collection at creation.
META_EMBEDDING_MODEL = "shj3_embedding_model"
META_EMBEDDING_DIMENSIONS = "shj3_embedding_dimensions"
META_TENANT = "shj3_tenant"


@dataclass(frozen=True, slots=True)
class EmbeddingContract:
    """The model and dimension a collection is built for.

    A value object rather than two parameters, because the two are only ever meaningful
    together: a dimension without its model is exactly the unrecoverable state RB-09 warns
    about.
    """

    model: str
    dimensions: int

    def __post_init__(self) -> None:
        if not self.model.strip():
            raise ValueError(
                "An embedding model name is required. Without it a same-dimension model "
                "change is undetectable, and it degrades retrieval silently (RISK-016)."
            )
        if self.dimensions <= 0:
            raise ValueError("Embedding dimensions must be positive.")

    def as_metadata(self, tenant: TenantSlug) -> dict[str, Any]:
        return {
            META_TENANT: tenant.value,
            META_EMBEDDING_MODEL: self.model,
            META_EMBEDDING_DIMENSIONS: self.dimensions,
        }


class CollectionAdmin(Protocol):
    """The narrow slice of Qdrant's admin surface this module needs.

    A protocol rather than a direct client dependency so the comparison logic in
    :meth:`QdrantProvisioner.verify` — which is the whole of the RISK-016 guardrail — is
    unit-testable without a container.
    """

    def collection_exists(self, collection_name: str) -> bool: ...

    # Keyword-only, so structural compatibility with the real client depends on the
    # parameter *names* rather than on their position among its two dozen options.
    def create_collection(
        self,
        *,
        collection_name: str,
        vectors_config: models.VectorParams,
        hnsw_config: models.HnswConfigDiff,
        optimizers_config: models.OptimizersConfigDiff,
        metadata: dict[str, Any],
    ) -> bool: ...

    def create_payload_index(
        self, *, collection_name: str, field_name: str, field_schema: Any
    ) -> Any: ...

    def delete_collection(self, collection_name: str) -> bool: ...

    def get_collection(self, collection_name: str) -> models.CollectionInfo: ...


class VectorProvisioningError(RuntimeError):
    """A tenant's collection is absent, unhealthy, or built for the wrong model."""


class QdrantProvisioner:
    """Create, drop and verify one tenant's Qdrant collection."""

    __slots__ = ("_admin", "_contract")

    def __init__(self, admin: CollectionAdmin, contract: EmbeddingContract | None) -> None:
        """``contract`` is optional because ``destroy()`` never reads it — deletion does not
        depend on what a collection was built for. Callers building a provisioner only to
        destroy (the `/vector/destroy` route) pass ``None`` rather than a value that would
        have to satisfy :class:`EmbeddingContract`'s own validation for no real reason.
        ``create()`` and ``verify()`` guard for it explicitly below, so a caller that omits
        the contract and then calls one of those fails loudly rather than on an attribute
        error deep in Qdrant client code.
        """
        self._admin = admin
        self._contract = contract

    def _require_contract(self, operation: str) -> EmbeddingContract:
        if self._contract is None:
            raise RuntimeError(
                f"{operation} requires an embedding contract, but this provisioner was "
                "constructed without one (valid only for destroy())."
            )
        return self._contract

    @classmethod
    def from_environment(cls, admin: CollectionAdmin | None = None) -> QdrantProvisioner:
        """Build from the environment contract in ``.env.example``.

        The dimension is read from configuration rather than defaulted, because the whole
        value of recording it is that the two sides can be compared — a hardcoded default
        would make every comparison trivially agree.
        """
        model = os.environ.get("SHJ3_OPENAI_EMBEDDING_MODEL")
        raw_dimensions = os.environ.get("SHJ3_OPENAI_EMBEDDING_DIM")
        if not model or not raw_dimensions:
            raise RuntimeError(
                "SHJ3_OPENAI_EMBEDDING_MODEL and SHJ3_OPENAI_EMBEDDING_DIM must both be set "
                "before a vector collection can be provisioned: they are recorded on the "
                "collection and are not recoverable by inspection afterwards (RB-09 step 3)."
            )
        return cls(
            admin if admin is not None else collection_admin_from_environment(),
            EmbeddingContract(model=model, dimensions=int(raw_dimensions)),
        )

    async def create(self, tenant: TenantSlug) -> str:
        """Create the tenant's collection, its payload indexes and its metadata.

        Idempotent by an existence check rather than by a Qdrant flag: ``create_collection``
        fails on a collection that already exists, and RB-09 is resumable. Note what the
        existence branch deliberately does **not** do — it does not reconcile an existing
        collection's metadata with the contract. Rewriting the recorded model to match the
        one now configured would erase the only evidence that the vectors inside were
        produced by something else. :meth:`verify` reports that disagreement instead, and a
        model change is a full re-index (ADR-0004 rule 3), never a metadata edit.
        """
        collection = tenant.vector_collection
        contract = self._require_contract("create")

        if not self._admin.collection_exists(collection):
            self._admin.create_collection(
                collection_name=collection,
                vectors_config=models.VectorParams(
                    size=contract.dimensions,
                    distance=models.Distance(DISTANCE),
                ),
                hnsw_config=models.HnswConfigDiff(m=HNSW_M, ef_construct=HNSW_EF_CONSTRUCT),
                optimizers_config=models.OptimizersConfigDiff(
                    default_segment_number=DEFAULT_SEGMENT_NUMBER
                ),
                metadata=contract.as_metadata(tenant),
            )

        # Creating an existing payload index is a no-op in Qdrant, so this runs
        # unconditionally and repairs a collection created before an index was added.
        for field in PAYLOAD_INDEXES:
            self._admin.create_payload_index(
                collection_name=collection, field_name=field, field_schema="keyword"
            )

        return collection

    async def destroy(self, tenant: TenantSlug) -> None:
        """Delete the tenant's collection.

        This limb keeps the structural guarantee the graph lost: the collection *is* the
        isolation unit, so dropping it removes every vector by construction rather than by
        filter. An absent collection is success — RB-10 treats a 404 as success for exactly
        this reason, since rollback cannot know what was created.
        """
        if self._admin.collection_exists(tenant.vector_collection):
            self._admin.delete_collection(tenant.vector_collection)

    async def verify(self, tenant: TenantSlug) -> bool:
        """Prove the collection exists, is serving, and matches the embedding contract.

        Four assertions, and the last is the one that earns the metadata:

        1. the collection exists;
        2. its status is green — a collection stuck optimising cannot serve retrieval;
        3. its vector size equals the configured dimension;
        4. its recorded model equals the configured model.

        Assertion 4 is what turns RISK-016 from a silent degradation into a failed
        provisioning step. A collection whose metadata predates this contract has no
        recorded model; that is reported as a failure rather than accepted, because the
        alternative is to assume agreement about the one fact that cannot be inferred.

        Also the post-``destroy`` check: an absent collection returns ``False``, which is
        what confirms the rollback.
        """
        collection = tenant.vector_collection
        contract = self._require_contract("verify")
        if not self._admin.collection_exists(collection):
            return False

        info = self._admin.get_collection(collection)
        if str(info.status) != str(models.CollectionStatus.GREEN):
            return False

        vectors = info.config.params.vectors
        if not isinstance(vectors, models.VectorParams):
            # A named-vector configuration would mean this collection was not created by
            # this provisioner, and its layout is not the one retrieval expects.
            return False
        if vectors.size != contract.dimensions:
            return False

        metadata = info.config.metadata or {}
        return metadata.get(META_EMBEDDING_MODEL) == contract.model


def collection_admin_from_environment() -> CollectionAdmin:
    """Construct the Qdrant client.

    Kept in a function of its own, returning the narrow :class:`CollectionAdmin` protocol
    rather than the client type, so no caller outside this package can reach the rest of
    Qdrant's surface — the same reason ``tenant-cache.ts`` keeps its Redis client private
    (ADR-0002 rule 3). It is also the single construction site
    ``no-unscoped-store-clients`` has to allow.
    """
    url = os.environ.get("SHJ3_QDRANT_URL")
    if not url:
        raise RuntimeError(
            "SHJ3_QDRANT_URL is not set. The process should have refused to start — check "
            "the boot-time config validation."
        )
    api_key = os.environ.get("SHJ3_QDRANT_API_KEY") or None
    return QdrantClient(url=url, api_key=api_key)
