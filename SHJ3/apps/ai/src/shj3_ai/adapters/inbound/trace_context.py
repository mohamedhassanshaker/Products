"""FastAPI dependency wiring the active trace id into ``TenantContext``.

architecture.md §10 and deployment.md §13.1: one trace id spans web -> ai ->
tool call, and ``TenantContext.trace_id`` (``domain/tenancy.py``) is where
this runtime carries it. This module supplies that value from the active
OpenTelemetry span rather than a request header a caller could forge, and it
never imports ``opentelemetry`` into ``domain`` itself: ``TenantContext``
keeps taking ``trace_id`` as a plain string constructor argument, which is
what the swap test (architecture.md §4, ``pyproject.toml``'s import-linter
"forbidden" contract) requires of it.

Mounting note — read before adding a real inbound adapter here
----------------------------------------------------------------
No FastAPI dependency on this side opens ``tenant_scope()`` yet.
``provisioning_router.py`` is platform-scoped: it validates a
``TenantSlug`` from the request body and passes it to a provisioner
explicitly (ADR-0002 rule 5's audited cross-tenant path), rather than binding
an ambient ``TenantContext`` — there is no per-tenant *authentication*
dependency on this side, unlike the web tier's ``AuthMiddleware``
(``apps/web/src/modules/iam/adapters/inbound/auth-middleware.ts``).

When one is built, it should depend on :data:`TraceId` exactly as
``AuthMiddleware.handle`` reads the inbound header on the web side, and open
:func:`bind_trace_context` around the handler:

    async def authenticate(
        trace_id: TraceId,
        principal: Principal = Depends(resolve_principal),
    ) -> AsyncIterator[TenantContext]:
        with bind_trace_context(principal.tenant, trace_id, principal=principal) as ctx:
            yield ctx

:func:`bind_trace_context` is that same wiring, usable today by any endpoint
that already knows its tenant slug — which is what the tests in
``tests/observability/test_trace_context.py`` exercise, standing in for the
authentication dependency that does not exist yet.
"""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from typing import Annotated

from fastapi import Depends

from shj3_ai.domain.tenancy import PlatformScope, Principal, TenantContext, TenantSlug, tenant_scope
from shj3_ai.observability.tracing import current_trace_id

#: Inject with ``trace_id: TraceId`` in any route. By the time a handler runs,
#: :func:`shj3_ai.observability.tracing.instrument_fastapi_app` has already started a
#: server span — extracted from an inbound ``traceparent`` if one was valid, or freshly
#: generated if this is where the trace starts — so this dependency's own fallback path
#: is not expected to fire on a real request; it exists so the dependency is still safe to
#: use in a handler under test, where no instrumentation has run.
TraceId = Annotated[str, Depends(current_trace_id)]


@contextmanager
def bind_trace_context(
    tenant: TenantSlug,
    trace_id: str,
    principal: Principal | None = None,
    platform_scope: PlatformScope | None = None,
) -> Iterator[TenantContext]:
    """Bind a :class:`TenantContext` for the current request, trace id first.

    A thin wrapper over :func:`shj3_ai.domain.tenancy.tenant_scope` that
    exists so every future caller sources ``trace_id`` the same way — from
    the active span, via :data:`TraceId` — rather than each one reinventing
    where the value comes from. See the module docstring for where this is
    meant to be mounted.
    """
    with tenant_scope(
        TenantContext(
            tenant=tenant,
            trace_id=trace_id,
            principal=principal,
            platform_scope=platform_scope,
        )
    ) as context:
        yield context
