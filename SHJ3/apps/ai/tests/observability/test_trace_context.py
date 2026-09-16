"""Proves the requirement architecture.md §10 and deployment.md §13.1 exist for:
``TenantContext.trace_id`` is populated from the active OpenTelemetry span, and that
span's trace id is the one carried on an inbound ``traceparent`` — extracted by
``opentelemetry-instrumentation-fastapi``'s own context propagation, not by this codebase
parsing the header.

No inbound authentication dependency exists on this side yet to exercise directly (see
``adapters/inbound/trace_context.py``'s module docstring), so these tests build the
smallest possible stand-in: a FastAPI app with one route depending on ``TraceId`` and
calling ``bind_trace_context``, instrumented exactly as ``app.py`` instruments the real
one. That is the same shape a future authentication dependency will have to reproduce.
"""

from __future__ import annotations

from collections.abc import Iterator

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from shj3_ai.adapters.inbound.trace_context import TraceId, bind_trace_context
from shj3_ai.domain.tenancy import TenantSlug, try_get_context
from shj3_ai.observability.tracing import (
    configure_tracing,
    instrument_fastapi_app,
    reset_tracing_for_testing,
)

TRACE_ID = "4bf92f3577b34da6a3ce929d0e0e4736"
OTHER_TRACE_ID = "1234567890abcdef1234567890abcdef"


@pytest.fixture(autouse=True)
def _reset() -> Iterator[None]:
    reset_tracing_for_testing()
    yield
    reset_tracing_for_testing()


def _instrumented_app() -> FastAPI:
    # Mirrors app.py's own ordering: a real TracerProvider must be registered before
    # instrumenting, or the instrumentor's spans have nothing to thread the extracted
    # parent context through.
    configure_tracing()
    app = FastAPI()

    @app.get("/whoami")
    def whoami(trace_id: TraceId) -> dict[str, str]:
        with bind_trace_context(TenantSlug("sewa"), trace_id) as context:
            return {"trace_id": context.trace_id, "tenant": context.tenant.value}

    instrument_fastapi_app(app)
    return app


class TestTraceIdDependency:
    def test_sees_the_trace_id_from_an_inbound_traceparent(self) -> None:
        client = TestClient(_instrumented_app())

        response = client.get(
            "/whoami", headers={"traceparent": f"00-{TRACE_ID}-00f067aa0ba902b7-01"}
        )

        assert response.status_code == 200
        assert response.json()["trace_id"] == TRACE_ID

    def test_a_request_with_no_traceparent_still_gets_a_valid_root_trace_id(self) -> None:
        # deployment.md §13.1 rule 1's extract-or-generate behaviour, on the side that
        # starts the trace rather than continues one.
        client = TestClient(_instrumented_app())

        response = client.get("/whoami")

        trace_id = response.json()["trace_id"]
        assert len(trace_id) == 32
        assert all(char in "0123456789abcdef" for char in trace_id)
        assert trace_id != "0" * 32

    def test_two_requests_with_different_traceparents_see_different_trace_ids(self) -> None:
        # Proves the dependency reads the per-request span, not a cached process value.
        client = TestClient(_instrumented_app())

        first = client.get("/whoami", headers={"traceparent": f"00-{TRACE_ID}-00f067aa0ba902b7-01"})
        second = client.get(
            "/whoami", headers={"traceparent": f"00-{OTHER_TRACE_ID}-00f067aa0ba902b7-01"}
        )

        assert first.json()["trace_id"] == TRACE_ID
        assert second.json()["trace_id"] == OTHER_TRACE_ID


class TestBindTraceContext:
    def test_populates_tenant_context_trace_id_from_the_active_span(self) -> None:
        # The requirement this module exists for: TenantContext.trace_id sourced from
        # OpenTelemetry, not from a header this code parses by hand.
        client = TestClient(_instrumented_app())

        response = client.get(
            "/whoami", headers={"traceparent": f"00-{TRACE_ID}-00f067aa0ba902b7-01"}
        )

        assert response.json() == {"trace_id": TRACE_ID, "tenant": "sewa"}

    def test_unbinds_the_context_once_the_block_exits(self) -> None:
        # ADR-0002 rule 2: request-scoped, not left bound for the next request on the
        # same worker to inherit.
        configure_tracing()
        app = FastAPI()

        @app.get("/check")
        def check(trace_id: TraceId) -> dict[str, bool]:
            with bind_trace_context(TenantSlug("sewa"), trace_id):
                pass
            return {"leaked": try_get_context() is not None}

        instrument_fastapi_app(app)
        client = TestClient(app)

        response = client.get("/check")

        assert response.json() == {"leaked": False}
