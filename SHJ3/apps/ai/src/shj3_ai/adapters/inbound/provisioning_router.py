"""Internal provisioning API — the endpoints ``shj3-web`` calls for Neo4j and Qdrant.

Why this router exists at all
-----------------------------
ADR-0003 makes ``shj3-ai`` the sole writer of Neo4j and Qdrant, and deployment.md §7.7
turns that into infrastructure: only ``shj3-ai`` and ``shj3-worker`` pods may reach those
two stores. But tenant provisioning is orchestrated by ``shj3-web``, which owns the tenant
registry and the single commit point (ADR-0002 rule 6). So two of the four provisioning
steps have to cross the service boundary, and this router is that crossing.

It is the reason the web tier's graph and vector provisioners hold no driver. A future
reader tempted to "simplify" by giving them one should read those files' headers first.

Trust model
-----------
Three controls, each answering a different question, and none of them sufficient alone:

* **The NetworkPolicy** answers *can anything else even reach this?* — no Ingress, no
  public DNS, ingress from ``app=shj3-web`` pods only.
* **mTLS** answers *which service is calling?* — api.md §5: the client certificate's SAN
  must be ``shj3-web.shj3-{env}.svc.cluster.local``. Terminated in front of the app.
* **The platform-scope credential below** answers *is this a sanctioned platform
  operation?* — which the first two cannot, because ``shj3-web`` is also the caller for
  every ordinary tenant-scoped request. Provisioning acts across tenants, so it carries its
  own credential and this router requires it.

Why the tenant is in the body here
----------------------------------
Every other endpoint on this surface takes the tenant from ``X-SHJ3-Tenant-Id``, resolved
by ``shj3-web`` from the authenticated principal (ADR-0002 rule 1). These endpoints cannot:
a tenant being provisioned has no principal, and one being de-provisioned must be
addressable after its principals are gone. Provisioning acts *on* a tenant rather than *as*
one — it is one of ADR-0002 rule 5's two audited cross-tenant paths — so the slug is a
request parameter here.

That makes the slug untrusted input, which is exactly the case ADR-0009 rule 3 is about: it
becomes a ``:Tenant_<slug>`` label and a Qdrant collection name, both identifier positions
with no parameter binding. So it is validated through ``TenantSlug`` before it reaches
anything, and a rejection is a 422 rather than a 500 — see :func:`_validated_slug`.
"""

from __future__ import annotations

import os
import secrets
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Header, HTTPException, status
from pydantic import BaseModel, Field

from shj3_ai.adapters.outbound.graph.graph_provisioner import (
    GraphErasureIncompleteError,
    GraphProvisioner,
    Neo4jStatementExecutor,
)
from shj3_ai.adapters.outbound.vector.qdrant_provisioner import (
    EmbeddingContract,
    QdrantProvisioner,
    collection_admin_from_environment,
)
from shj3_ai.domain.tenancy import InvalidTenantSlugError, TenantSlug

# ---------------------------------------------------------------------------
# Authorisation
# ---------------------------------------------------------------------------


def require_platform_scope(
    x_shj3_platform_token: Annotated[str | None, Header()] = None,
    x_shj3_platform_scope: Annotated[str | None, Header()] = None,
) -> None:
    """Require a platform-scope credential.

    Compared with :func:`secrets.compare_digest` rather than ``==``: this is a shared
    secret checked on every provisioning call, and a short-circuiting comparison leaks its
    prefix through timing. Cheap to do correctly, and the kind of thing that is never
    retrofitted.

    A missing or wrong credential is a flat 403 with no distinction between the two —
    telling a caller *which* it was is enumeration (api.md §2.2).
    """
    expected = os.environ.get("SHJ3_AI_PLATFORM_TOKEN")
    if not expected:
        # Refusing is the only safe behaviour: an unconfigured secret must not make the
        # endpoint open. It is also caught at boot; this is the second line.
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"code": "service.draining"},
        )

    presented = x_shj3_platform_token or ""
    if not secrets.compare_digest(presented, expected) or x_shj3_platform_scope != "provisioning":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"code": "authz.permission_denied"},
        )


#: Declared on the router rather than per endpoint, so a credential check cannot be
#: forgotten on an endpoint added later. Every route below is gated.
router = APIRouter(
    prefix="/v1/internal/provisioning",
    tags=["provisioning"],
    dependencies=[Depends(require_platform_scope)],
)


# ---------------------------------------------------------------------------
# Request and response bodies
# ---------------------------------------------------------------------------


class TenantRequest(BaseModel):
    """Names the tenant to act on. See the module docstring for why it is in the body."""

    tenant_slug: str = Field(alias="tenantSlug", max_length=64)


class VectorRequest(TenantRequest):
    """A vector operation, with the embedding contract the collection is built for.

    The pair travels with the request rather than being read from this service's own
    configuration, so the collection records what the *orchestrator* registered. Reading it
    locally would let the two disagree and would make the boot-time dimension assertion
    compare a value against itself.
    """

    embedding_model: str = Field(alias="embeddingModel", min_length=1, max_length=128)
    embedding_dimensions: int = Field(alias="embeddingDimensions", gt=0, le=8192)


class GraphCreateResponse(BaseModel):
    indexes_created: int = Field(serialization_alias="indexesCreated")


class GraphDestroyResponse(BaseModel):
    """The erasure proof, quoted back so RB-12's attestation can carry the numbers."""

    nodes_by_label: int = Field(serialization_alias="nodesByLabel")
    nodes_by_property: int = Field(serialization_alias="nodesByProperty")


class VerifyResponse(BaseModel):
    verified: bool


class VectorCreateResponse(BaseModel):
    collection: str


def _validated_slug(request: TenantRequest) -> TenantSlug:
    """Validate the slug before it can reach a label or a collection name.

    A 422 rather than a 500: a malformed slug is a bad request, and the distinction matters
    operationally because a 500 would send an operator looking for a broken store. The
    offending value is not echoed — this is untrusted input and the response reaches logs
    (api.md §2.2).
    """
    try:
        return TenantSlug(request.tenant_slug)
    except InvalidTenantSlugError as error:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail={"code": "validation.failed", "reason": error.reason},
        ) from error


# ---------------------------------------------------------------------------
# Dependencies
#
# Built per request from the environment, and overridden wholesale in tests via FastAPI's
# dependency_overrides — which is what lets the router be tested without containers.
# ---------------------------------------------------------------------------


def get_graph_provisioner() -> GraphProvisioner:
    return GraphProvisioner(Neo4jStatementExecutor.from_environment())


def get_vector_provisioner(request: VectorRequest) -> QdrantProvisioner:
    return QdrantProvisioner(
        collection_admin_from_environment(),
        EmbeddingContract(
            model=request.embedding_model,
            dimensions=request.embedding_dimensions,
        ),
    )


def get_vector_destroyer() -> QdrantProvisioner:
    """A `QdrantProvisioner` for `/vector/destroy` alone.

    `destroy()` never reads the embedding contract — deletion does not depend on
    what a collection was built for — so this depends on nothing from the request
    body. `contract=None` is the provisioner's own documented shape for exactly
    this case (`EmbeddingContract | None`); a caller that mistakenly invoked
    `create()` or `verify()` on a provisioner built this way gets a clear
    `RuntimeError` from `_require_contract` rather than a value silently standing
    in for a real one.
    """
    return QdrantProvisioner(collection_admin_from_environment(), None)


GraphDep = Annotated[GraphProvisioner, Depends(get_graph_provisioner)]
VectorDep = Annotated[QdrantProvisioner, Depends(get_vector_provisioner)]
VectorDestroyDep = Annotated[QdrantProvisioner, Depends(get_vector_destroyer)]


# ---------------------------------------------------------------------------
# Neo4j — RB-09 step 2, RB-10 reverse step 2, RB-11 check 5
# ---------------------------------------------------------------------------


@router.post("/graph/create", response_model=GraphCreateResponse)
async def create_graph(request: TenantRequest, provisioner: GraphDep) -> GraphCreateResponse:
    created = await provisioner.create(_validated_slug(request))
    return GraphCreateResponse(indexes_created=created)


@router.post("/graph/destroy", response_model=GraphDestroyResponse)
async def destroy_graph(request: TenantRequest, provisioner: GraphDep) -> GraphDestroyResponse:
    """Erase the tenant's subgraph and return the proof.

    An unproven erasure is a 409, not a 500: nothing failed, the operation simply cannot
    claim completeness, and the residual counts are the actionable information. Returning
    them lets the caller distinguish label residue (retry) from property-only residue
    (encoding drift — do not retry, find the writer).
    """
    try:
        proof = await provisioner.destroy(_validated_slug(request))
    except GraphErasureIncompleteError as error:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "knowledge.graph_erasure_incomplete",
                "nodesByLabel": error.proof.nodes_by_label,
                "nodesByProperty": error.proof.nodes_by_property,
            },
        ) from error

    return GraphDestroyResponse(
        nodes_by_label=proof.nodes_by_label,
        nodes_by_property=proof.nodes_by_property,
    )


@router.post("/graph/verify", response_model=VerifyResponse)
async def verify_graph(request: TenantRequest, provisioner: GraphDep) -> VerifyResponse:
    return VerifyResponse(verified=await provisioner.verify(_validated_slug(request)))


# ---------------------------------------------------------------------------
# Qdrant — RB-09 step 3, RB-10 reverse step 3, RB-11 check 6
# ---------------------------------------------------------------------------


@router.post("/vector/create", response_model=VectorCreateResponse)
async def create_vector(request: VectorRequest, provisioner: VectorDep) -> VectorCreateResponse:
    collection = await provisioner.create(_validated_slug(request))
    return VectorCreateResponse(collection=collection)


@router.post("/vector/destroy", status_code=status.HTTP_200_OK)
async def destroy_vector(request: TenantRequest, provisioner: VectorDestroyDep) -> dict[str, Any]:
    # TenantRequest, not VectorRequest: deletion does not depend on what a
    # collection was built for, so requiring the embedding pair here would
    # force every caller to resend a fact irrelevant to the operation. Found
    # by running the real client against this endpoint — its destroy() sends
    # only the slug, which is the correct shape for what destroy actually does.
    await provisioner.destroy(_validated_slug(request))
    return {}


@router.post("/vector/verify", response_model=VerifyResponse)
async def verify_vector(request: VectorRequest, provisioner: VectorDep) -> VerifyResponse:
    return VerifyResponse(verified=await provisioner.verify(_validated_slug(request)))
