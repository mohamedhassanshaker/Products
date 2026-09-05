"""Unit tests for FR-AGENT-3 session-scoped conversational memory."""

from __future__ import annotations

from avatar_agent.orchestration.memory import SessionMemory


def test_records_and_returns_turns_in_order() -> None:
    memory = SessionMemory(window_turns=16)
    memory.add_user_turn("hi")
    memory.add_assistant_turn("hello")
    assert memory.as_messages() == [
        {"role": "user", "content": "hi"},
        {"role": "assistant", "content": "hello"},
    ]


def test_window_turns_zero_disables_memory() -> None:
    memory = SessionMemory(window_turns=0)
    memory.add_user_turn("hi")
    memory.add_assistant_turn("hello")
    assert memory.as_messages() == []


def test_enabled_false_disables_memory_even_with_a_nonzero_window() -> None:
    memory = SessionMemory(window_turns=16, enabled=False)
    memory.add_user_turn("hi")
    assert memory.as_messages() == []


def test_bounded_to_the_last_window_turns_pairs() -> None:
    memory = SessionMemory(window_turns=1)  # 1 turn == 2 messages max
    memory.add_user_turn("first")
    memory.add_assistant_turn("first reply")
    memory.add_user_turn("second")
    memory.add_assistant_turn("second reply")
    assert memory.as_messages() == [
        {"role": "user", "content": "second"},
        {"role": "assistant", "content": "second reply"},
    ]
