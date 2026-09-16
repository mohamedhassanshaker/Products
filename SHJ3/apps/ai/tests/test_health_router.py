"""Real tests for ``/healthz`` and ``/readyz`` over the actual ASGI app.

Exercised through ``TestClient`` against the real, importable ``shj3_ai.app``
(mirroring ``test_app.py``'s own stated reasoning for doing the same) rather
than by calling the route functions directly, so this also proves the router
is actually mounted and reachable at the documented paths.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from shj3_ai import runtime_state
from shj3_ai.app import app

client = TestClient(app)


@pytest.fixture(autouse=True)
def _reset_state() -> None:
    runtime_state.reset_for_testing()
    yield
    runtime_state.reset_for_testing()


def test_healthz_reports_ok_regardless_of_readiness_state() -> None:
    # Liveness must never depend on the same dependency/concurrency signals
    # readiness does (deployment.md §7.4 rule 1) — proven, not just asserted
    # in a comment: readiness is left at its least-ready default here and
    # /healthz still reports ok.
    response = client.get("/healthz")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_readyz_is_not_ready_by_default(monkeypatch: pytest.MonkeyPatch) -> None:
    # The honest default this whole module exists to prove: with no model-client
    # init routine having ever run (nothing in this codebase calls
    # mark_model_clients_ready yet — that is B-5's job), a freshly started
    # process reports not-ready, not a fabricated "ok".
    monkeypatch.delenv("SHJ3_AI_MAX_CONCURRENT_TURNS", raising=False)

    response = client.get("/readyz")

    assert response.status_code == 503
    body = response.json()
    assert body["status"] == "not_ready"
    assert body["model_clients_ready"] is False
    assert body["active_turns"] == 0
    assert body["max_concurrent_turns"] == 24


def test_readyz_is_ready_once_model_clients_are_marked_ready_and_under_ceiling(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("SHJ3_AI_MAX_CONCURRENT_TURNS", raising=False)
    runtime_state.mark_model_clients_ready()

    response = client.get("/readyz")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["model_clients_ready"] is True
    assert body["active_turns"] == 0


def test_readyz_sheds_load_once_active_turns_reach_the_configured_ceiling(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # A small ceiling makes this a fast, deterministic test rather than one
    # that needs 24 real turns started to prove the same mechanism.
    monkeypatch.setenv("SHJ3_AI_MAX_CONCURRENT_TURNS", "2")
    runtime_state.mark_model_clients_ready()

    runtime_state.turn_started()
    runtime_state.turn_started()  # active_turns == 2 == ceiling

    response = client.get("/readyz")

    assert response.status_code == 503
    body = response.json()
    assert body["status"] == "not_ready"
    assert body["model_clients_ready"] is True
    assert body["active_turns"] == 2
    assert body["max_concurrent_turns"] == 2


def test_readyz_recovers_once_a_turn_finishes_and_drops_below_the_ceiling(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("SHJ3_AI_MAX_CONCURRENT_TURNS", "2")
    runtime_state.mark_model_clients_ready()
    runtime_state.turn_started()
    runtime_state.turn_started()
    assert client.get("/readyz").status_code == 503

    runtime_state.turn_finished()

    response = client.get("/readyz")
    assert response.status_code == 200
    assert response.json()["active_turns"] == 1
