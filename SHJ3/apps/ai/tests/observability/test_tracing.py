"""``configure_tracing`` is called on process boot (``app.py``) and is safe to call again
from any test that imports it. It backs a request-path dependency
(``adapters/inbound/trace_context.py``'s ``current_trace_id``), so it is held to the
module docstring's promise directly: it must never raise, regardless of what
``SHJ3_OTEL_EXPORTER_OTLP_ENDPOINT`` is set to. A tracing bug must degrade
observability, never a request.
"""

from __future__ import annotations

import pytest

from shj3_ai.observability.tracing import (
    configure_tracing,
    current_trace_id,
    reset_tracing_for_testing,
)

ENDPOINT_VAR = "SHJ3_OTEL_EXPORTER_OTLP_ENDPOINT"


@pytest.fixture(autouse=True)
def _reset(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv(ENDPOINT_VAR, raising=False)
    reset_tracing_for_testing()
    yield
    reset_tracing_for_testing()


class TestConfigureTracing:
    def test_does_not_raise_when_the_otlp_endpoint_is_unset(self) -> None:
        # The .env.example default — no collector running in local development.
        configure_tracing()

    def test_does_not_raise_with_an_unreachable_endpoint(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # No collector is listening here. Export failures happen asynchronously on
        # flush, never at configuration time, but this pins the contract regardless of
        # exporter internals.
        monkeypatch.setenv(ENDPOINT_VAR, "http://127.0.0.1:1")
        configure_tracing()

    def test_does_not_raise_with_a_malformed_endpoint(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv(ENDPOINT_VAR, "not a url at all")
        configure_tracing()

    def test_is_idempotent(self) -> None:
        configure_tracing()
        configure_tracing()


class TestCurrentTraceId:
    def test_never_raises_and_returns_a_valid_32_hex_id_with_no_active_span(self) -> None:
        # Called outside any request/instrumented context — the fallback path.
        trace_id = current_trace_id()
        assert len(trace_id) == 32
        assert all(c in "0123456789abcdef" for c in trace_id)
        assert trace_id != "0" * 32

    def test_does_not_require_configure_tracing_to_have_run_first(self) -> None:
        # A tracing bug must not become a 500 on the one dependency that reads this.
        trace_id = current_trace_id()
        assert len(trace_id) == 32
