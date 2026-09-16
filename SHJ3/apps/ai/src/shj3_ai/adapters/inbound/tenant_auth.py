"""The tenant-scoped request-authentication dependency.

`trace_context.py`'s module docstring names exactly this gap — "no FastAPI
dependency on this side opens `tenant_scope()` yet" — and sketches the shape
it should take. This is that dependency, built for Graph RAG's real,
tenant-scoped endpoints (`knowledge_router.py`).

**Trust model.** `shj3-web`'s `createTenantScopedAiClient()`
(`apps/web/.../platform/adapters/outbound/ai-client.ts`) sends
`X-SHJ3-Tenant-Id`/`X-SHJ3-Principal-Id`/`X-SHJ3-Permissions`, resolved
web-side from an already-authenticated staff or citizen session. This
dependency does not re-authenticate that principal (`shj3-ai` has no session
store, no password, no OIDC client of its own — ADR-0006 rule 1 keeps
authentication mechanics out of every feature module including this one) —
it trusts the headers **because** the Kubernetes NetworkPolicy
(deployment.md §7.7) admits this service's inbound traffic from `shj3-web`
pods only, the same network-boundary trust `provisioning_router.py`'s
platform-scope credential layers *mTLS plus a shared secret* on top of for
its own, cross-tenant, higher-stakes surface. A tenant-scoped call has no
comparable shared secret today, which is a real, narrower gap than
provisioning's — flagged here rather than silently assumed equivalent, and a
reasonable candidate for the same mTLS-plus-credential treatment if this
surface is ever exposed beyond the cluster-internal boundary it currently
has.

`X-SHJ3-Tenant-Id`'s value still passes through `TenantSlug` before it can
become a label or a schema name (ADR-0009 rule 3) — trusting the network
boundary as the source of a *claim* does not exempt the claim's value from
validation before it reaches an identifier position.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import Depends, Header, HTTPException, status

from shj3_ai.adapters.inbound.trace_context import TraceId, bind_trace_context
from shj3_ai.domain.tenancy import InvalidTenantSlugError, Principal, TenantContext, TenantSlug


async def authenticate(
    trace_id: TraceId,
    x_shj3_tenant_id: Annotated[str | None, Header()] = None,
    x_shj3_principal_id: Annotated[str | None, Header()] = None,
    x_shj3_permissions: Annotated[str | None, Header()] = None,
) -> AsyncIterator[TenantContext]:
    if not x_shj3_tenant_id or not x_shj3_principal_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "authn.missing_principal"},
        )
    try:
        tenant = TenantSlug(x_shj3_tenant_id)
    except InvalidTenantSlugError as error:
        # Untrusted claim value, invalid shape — a 422, not a 500, and the
        # value itself is not echoed (api.md §2.2; same posture as
        # `provisioning_router._validated_slug`).
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail={"code": "validation.failed", "reason": error.reason},
        ) from error

    permissions = frozenset(x_shj3_permissions.split()) if x_shj3_permissions else frozenset()
    principal = Principal(
        id=x_shj3_principal_id, tenant=tenant, display_name="", permissions=permissions
    )

    with bind_trace_context(tenant, trace_id, principal=principal) as context:
        yield context


TenantContextDep = Annotated[TenantContext, Depends(authenticate)]
