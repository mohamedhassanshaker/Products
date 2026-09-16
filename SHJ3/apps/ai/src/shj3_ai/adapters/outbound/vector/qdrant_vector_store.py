"""The real `VectorStore` — point lifecycle over one tenant's Qdrant collection.

`qdrant_provisioner.py` owns collection *lifecycle* (create/destroy/verify)
behind a deliberately narrow `CollectionAdmin` protocol. This module needs the
point-level surface (`upsert`/`query_points`/`scroll`/`delete`) that protocol
does not expose, so it constructs its own client — a second construction site
in this same allowed directory (`no-unscoped-store-clients` scopes by
directory, not by call-site count), kept private the same way, never
re-exported.
"""

from __future__ import annotations

import os
import uuid

from qdrant_client import QdrantClient, models

from shj3_ai.domain.tenancy import TenantSlug
from shj3_ai.ports.vector_store import VectorHit, VectorPoint

#: Fixed per deployment (data-model.md §7.4) so a point's id is a pure,
#: reproducible function of `(tenant, chunk_id)` — re-ingesting the same chunk
#: always resolves to the same point, which is what makes `upsert` idempotent
#: rather than accumulating duplicates on every re-crawl.
_POINT_NAMESPACE = uuid.UUID("6f1b2b7a-6c9e-4f2e-9b8a-9e6b5b1a7a10")

#: data-model.md §7.2 sketches a *named* vector (`"text"`), so a second vector
#: could be added later without a collection rebuild. The collections this
#: deployment's provisioning path actually creates
#: (`qdrant_provisioner.QdrantProvisioner.create`, already real, already
#: tested, already run against every seeded tenant before this wave) use the
#: **unnamed default vector** instead — confirmed directly against the real
#: running `sewa_knowledge` collection (`GET /collections/sewa_knowledge`
#: returns `vectors: {size, distance}` with no name key) before writing this
#: adapter, not assumed from the doc. Per this project's own lessons.md
#: ("a doc's worked example can be stale relative to an already-tested
#: sibling in the same repo"), the real, already-provisioned collection wins:
#: this adapter targets the unnamed default vector, matching what
#: provisioning actually built. Revisit together if a second vector is ever
#: needed — that would mean changing the provisioner too, not just this file.
#:
#: §7.3's payload schema, narrowed for this pass: the join key, the three
#: cascade-scoping ids, locale, the embedding-model pair (RISK-016), the
#: content hash and the ordinal. `is_stale`/`embedded_at`/`effective_from`/
#: `effective_to` are real, useful payload fields the full spec names but are
#: not written by this pass's ingestion path (nothing here needs freshness- or
#: time-bounded filtering yet) — deferred, not silently dropped: adding them
#: is an additive payload change, not a rebuild.
_KEYWORD_PAYLOAD_FIELDS = (
    "chunk_id",
    "collection_id",
    "source_id",
    "document_id",
    "locale",
    "embedding_model",
    "source_owner_tenant",
)


def point_id(tenant_slug: str, chunk_id: str) -> str:
    """Deterministic UUIDv5 from the tenant slug and the chunk_id ULID (§7.4).

    Qdrant point ids must be an unsigned 64-bit integer or a UUID — a ULID is
    neither, so this is the join between `Chunks.id` and a legal point id.
    """
    return str(uuid.uuid5(_POINT_NAMESPACE, f"{tenant_slug}:{chunk_id}"))


class QdrantVectorStore:
    """The real `VectorStore` (structural — see `Neo4jGraphStore`'s docstring
    for why this codebase's ports are matched structurally, not subclassed).
    """

    __slots__ = ("_client", "_collection", "_tenant")

    def __init__(self, client: QdrantClient, tenant: TenantSlug) -> None:
        self._client = client
        self._tenant = tenant
        self._collection = tenant.vector_collection

    async def upsert(self, points: list[VectorPoint]) -> None:
        if not points:
            return
        self._client.upsert(
            collection_name=self._collection,
            points=[
                models.PointStruct(
                    id=point_id(self._tenant.value, p.chunk_id),
                    vector=p.embedding,
                    payload={
                        "chunk_id": p.chunk_id,
                        "collection_id": p.knowledge_collection_id,
                        "source_id": p.knowledge_source_id,
                        "document_id": p.source_document_id,
                        "locale": p.locale_code,
                        "embedding_model": p.embedding_model,
                        "embedding_dimension": p.embedding_dimension,
                        "content_hash": p.content_hash,
                        "chunk_ordinal": p.chunk_ordinal,
                        # Defence in depth, redundant with the collection
                        # already being per-tenant — data-model.md §7.3
                        # explains why the redundancy is worth one indexed
                        # keyword anyway, and ADR-0009 borrows the same
                        # pattern for the graph, where it stops being
                        # insurance and becomes load-bearing.
                        "source_owner_tenant": self._tenant.value,
                    },
                )
                for p in points
            ],
        )

    async def search(
        self, embedding: list[float], limit: int, knowledge_collection_ids: list[str] | None
    ) -> list[VectorHit]:
        must: list[models.FieldCondition] = [
            models.FieldCondition(
                key="source_owner_tenant", match=models.MatchValue(value=self._tenant.value)
            )
        ]
        if knowledge_collection_ids:
            must.append(
                models.FieldCondition(
                    key="collection_id", match=models.MatchAny(any=list(knowledge_collection_ids))
                )
            )
        result = self._client.query_points(
            collection_name=self._collection,
            query=embedding,
            limit=limit,
            query_filter=models.Filter(must=must),
            # Both fields the loop below reads must be requested, or the
            # post-filter check silently sees `None` for whichever was left
            # out and drops every hit — found exactly that way, empirically,
            # against the real collection (`with_payload=["chunk_id"]` alone
            # made every result vanish because `source_owner_tenant` was
            # never in the returned payload to check).
            with_payload=["chunk_id", "source_owner_tenant"],
        )
        hits: list[VectorHit] = []
        for point in result.points:
            payload = point.payload or {}
            # The post-filter, applied here too (belt-and-braces, ADR-0009's
            # pattern borrowed for the store that does not strictly need it —
            # the collection is already per-tenant): a hit whose own payload
            # disagrees with the tenant that queried it is dropped rather
            # than trusted, however implausible that should be.
            if payload.get("source_owner_tenant") != self._tenant.value:
                continue
            chunk_id = payload.get("chunk_id")
            if not chunk_id:
                continue
            hits.append(VectorHit(chunk_id=chunk_id, score=float(point.score)))
        return hits

    async def delete_by_source(self, knowledge_source_id: str) -> None:
        self._client.delete(
            collection_name=self._collection,
            points_selector=models.FilterSelector(
                filter=models.Filter(
                    must=[
                        models.FieldCondition(
                            key="source_id", match=models.MatchValue(value=knowledge_source_id)
                        ),
                        models.FieldCondition(
                            key="source_owner_tenant",
                            match=models.MatchValue(value=self._tenant.value),
                        ),
                    ]
                )
            ),
        )

    async def scroll_chunk_ids(self, knowledge_source_id: str) -> list[str]:
        chunk_ids: list[str] = []
        offset = None
        while True:
            points, offset = self._client.scroll(
                collection_name=self._collection,
                scroll_filter=models.Filter(
                    must=[
                        models.FieldCondition(
                            key="source_id", match=models.MatchValue(value=knowledge_source_id)
                        ),
                        models.FieldCondition(
                            key="source_owner_tenant",
                            match=models.MatchValue(value=self._tenant.value),
                        ),
                    ]
                ),
                with_payload=["chunk_id"],
                limit=1000,
                offset=offset,
            )
            chunk_ids.extend(
                p.payload["chunk_id"] for p in points if p.payload and p.payload.get("chunk_id")
            )
            if offset is None:
                break
        return chunk_ids


def vector_client_from_environment() -> QdrantClient:
    """Construct the point-level Qdrant client. Private to this package — see the
    module docstring. Mirrors `qdrant_provisioner.collection_admin_from_environment`'s
    env-var contract exactly, deliberately not shared, so the two modules' client
    lifecycles stay independent (this one is per-request-ish, the provisioner's is
    provisioning-flow-scoped).
    """
    url = os.environ.get("SHJ3_QDRANT_URL")
    if not url:
        raise RuntimeError(
            "SHJ3_QDRANT_URL is not set. The process should have refused to start — check "
            "the boot-time config validation."
        )
    api_key = os.environ.get("SHJ3_QDRANT_API_KEY") or None
    return QdrantClient(url=url, api_key=api_key)
