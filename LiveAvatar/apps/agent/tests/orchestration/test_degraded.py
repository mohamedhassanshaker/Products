"""Unit tests for the FR-ALERT-3 degraded-mode speech throttle."""

from __future__ import annotations

from avatar_agent.orchestration.degraded import DegradedModeThrottle


def test_first_call_always_speaks() -> None:
    throttle = DegradedModeThrottle(clock=lambda: 0.0)
    assert throttle.should_speak() is True


def test_second_call_within_cooldown_does_not_speak() -> None:
    times = iter([0.0, 5.0])
    throttle = DegradedModeThrottle(cooldown_seconds=30.0, clock=lambda: next(times))
    assert throttle.should_speak() is True
    assert throttle.should_speak() is False


def test_speaks_again_once_cooldown_elapses() -> None:
    times = iter([0.0, 31.0])
    throttle = DegradedModeThrottle(cooldown_seconds=30.0, clock=lambda: next(times))
    assert throttle.should_speak() is True
    assert throttle.should_speak() is True


def test_boundary_exactly_at_cooldown_speaks_again() -> None:
    times = iter([0.0, 30.0])
    throttle = DegradedModeThrottle(cooldown_seconds=30.0, clock=lambda: next(times))
    assert throttle.should_speak() is True
    assert throttle.should_speak() is True
