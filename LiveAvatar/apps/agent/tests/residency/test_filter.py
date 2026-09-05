"""Unit tests for the residency filter (LLD §8.5, FR-LLM-3/FR-PRIV-2)."""

from __future__ import annotations

import pytest

from avatar_agent.residency.filter import (
    MemoryWindow,
    ResidencyBlockedError,
    TextChunk,
    Turn,
    build_payload,
)


def test_prompt_text_only_includes_system_memory_turn_and_rag() -> None:
    payload = build_payload(
        "prompt_text_only",
        Turn(text="what's the weather"),
        MemoryWindow(turns=({"role": "user", "content": "hi"}, {"role": "assistant", "content": "hello"})),
        "You are helpful.",
        [TextChunk(text="chunk one"), TextChunk(text="chunk two")],
    )
    assert payload.system_prompt == "You are helpful."
    assert payload.retrieved_chunks == ("chunk one", "chunk two")
    assert payload.messages[-1] == {"role": "user", "content": "what's the weather"}
    assert payload.messages[0] == {"role": "user", "content": "hi"}


def test_prompt_text_only_excludes_prior_transcript_even_if_supplied() -> None:
    payload = build_payload(
        "prompt_text_only",
        Turn(text="hi"),
        MemoryWindow(),
        "sys",
        [],
        prior_transcript=({"role": "user", "content": "old message"},),
    )
    assert {"role": "user", "content": "old message"} not in payload.messages


def test_prompt_and_transcript_includes_prior_transcript() -> None:
    payload = build_payload(
        "prompt_and_transcript",
        Turn(text="hi"),
        MemoryWindow(),
        "sys",
        [],
        prior_transcript=({"role": "user", "content": "old message"},),
    )
    assert payload.messages[0] == {"role": "user", "content": "old message"}
    assert payload.messages[-1] == {"role": "user", "content": "hi"}


def test_none_mode_raises_residency_blocked_error() -> None:
    with pytest.raises(ResidencyBlockedError):
        build_payload("none", Turn(text="hi"), MemoryWindow(), "sys", [])


def test_empty_memory_and_rag_produce_only_the_current_turn() -> None:
    payload = build_payload("prompt_text_only", Turn(text="hi"), MemoryWindow(), "sys", [])
    assert payload.messages == ({"role": "user", "content": "hi"},)
    assert payload.retrieved_chunks == ()
