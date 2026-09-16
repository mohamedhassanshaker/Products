"""Smoke test for the FastAPI application object.

Not a redundant copy of ``tests/provisioning/test_provisioning_router.py`` (which
exercises the router in isolation, with its provisioners replaced via
``dependency_overrides``) — this instead proves the real, importable app actually mounts
that router and boots without raising, which is what a future ``shj3_ai.entrypoint``
(app.py's module docstring) will depend on.
"""

from __future__ import annotations

import importlib

import pytest
from fastapi.testclient import TestClient


def test_the_app_mounts_the_provisioning_router(monkeypatch: pytest.MonkeyPatch) -> None:
    # Exercised over ASGI rather than by inspecting `app.routes` directly: FastAPI's
    # newer router-inclusion internals (`_IncludedRouter`) do not eagerly flatten an
    # included router's routes into that list, so introspecting it is version-fragile in
    # a way that actually calling the endpoint is not.
    monkeypatch.delenv("SHJ3_AI_PLATFORM_TOKEN", raising=False)
    from shj3_ai.app import app

    client = TestClient(app)
    response = client.post("/v1/internal/provisioning/graph/verify", json={"tenantSlug": "sewa"})

    # No platform-scope credential configured: the endpoint closes (503), not 404 — proof
    # the route exists and the router's own dependency ran, not merely that *some*
    # response came back (provisioning_router.py's require_platform_scope).
    assert response.status_code == 503


def test_importing_the_app_does_not_raise_even_with_no_otlp_endpoint(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Belt and braces on top of observability/test_tracing.py: importing app.py is what
    # actually calls configure_tracing() in a real process, so this is the path that
    # matters, not just the function in isolation.
    monkeypatch.delenv("SHJ3_OTEL_EXPORTER_OTLP_ENDPOINT", raising=False)

    import shj3_ai.app

    importlib.reload(shj3_ai.app)
