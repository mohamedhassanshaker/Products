"""Real tests for the in-process readiness state backing ``/readyz``.

Covers deployment.md §7.4 rule 2's two implemented conditions: model-client
readiness and the active-turn ceiling. See ``runtime_state.py``'s own doc
comment for what is deliberately not implemented (the tenant-registry check).
"""

from __future__ import annotations

import threading

import pytest

from shj3_ai import runtime_state


@pytest.fixture(autouse=True)
def _reset_state() -> None:
    """Every test starts from the real boot default, not whatever a prior test left behind."""
    runtime_state.reset_for_testing()
    yield
    runtime_state.reset_for_testing()


def test_boots_not_ready_with_zero_active_turns() -> None:
    # The honest default: no init routine has ever run, and no turn has ever
    # started. See the module doc comment on why this is not fabricated.
    assert runtime_state.model_clients_ready() is False
    assert runtime_state.active_turn_count() == 0


def test_mark_model_clients_ready_flips_the_flag() -> None:
    runtime_state.mark_model_clients_ready()
    assert runtime_state.model_clients_ready() is True

    runtime_state.mark_model_clients_not_ready()
    assert runtime_state.model_clients_ready() is False


def test_turn_started_and_finished_move_a_real_counter() -> None:
    runtime_state.turn_started()
    runtime_state.turn_started()
    assert runtime_state.active_turn_count() == 2

    runtime_state.turn_finished()
    assert runtime_state.active_turn_count() == 1

    runtime_state.turn_finished()
    assert runtime_state.active_turn_count() == 0


def test_turn_finished_floors_at_zero_rather_than_going_negative() -> None:
    # A caller bug (finishing without a matching start) must not make a
    # readiness signal report a nonsensical negative count.
    runtime_state.turn_finished()
    assert runtime_state.active_turn_count() == 0


def test_track_turn_decrements_even_when_the_turn_raises() -> None:
    with pytest.raises(ValueError), runtime_state.track_turn():
        assert runtime_state.active_turn_count() == 1
        raise ValueError("simulated turn failure")

    assert runtime_state.active_turn_count() == 0


def test_track_turn_decrements_on_the_happy_path_too() -> None:
    with runtime_state.track_turn():
        assert runtime_state.active_turn_count() == 1
    assert runtime_state.active_turn_count() == 0


def test_counter_is_thread_safe_under_concurrent_increment() -> None:
    # FastAPI dispatches sync route handlers to a thread pool — this proves
    # the module-level counter is not relying on GIL-per-bytecode luck.
    iterations = 200
    threads = [threading.Thread(target=runtime_state.turn_started) for _ in range(iterations)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert runtime_state.active_turn_count() == iterations
