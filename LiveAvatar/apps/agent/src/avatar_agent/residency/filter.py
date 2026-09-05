"""The residency filter (LLD §8.5, FR-LLM-3/FR-PRIV-2) — the **only** way to
build an `ResidencyPayload` for `ILLMProvider.complete_stream`/
`complete_structured`. There is no overload taking raw messages, so an
adapter physically cannot attach content this function stripped.

The mode comes from `Session.residency_snapshot` (taken once, at session
start — never a live policy read), so a mid-session policy change cannot
widen an in-flight session (FR-PRIV-2). Reaching this function with `none`
and a remote LLM is itself a defect (blocked at config-save time by the
control plane's `CONFIG_RESIDENCY_BLOCKS_LLM` rule) — `build_payload` raises
rather than silently degrading, so the caller can route to degraded mode.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

from avatar_agent.contracts.runtime_config import ResidencyMode
from avatar_agent.ports.llm import ChatMessage, ResidencyPayload


@dataclass(frozen=True)
class Turn:
    """The current user turn (this cycle's final STT text)."""

    text: str


@dataclass(frozen=True)
class MemoryWindow:
    """Session-scoped prior turns (FR-AGENT-3) — never cross-session in v1
    unless `prompt_and_transcript` and prior transcripts exist for this
    tenant (attached separately by the caller via `prior_transcript`).
    """

    turns: Sequence[ChatMessage] = ()


@dataclass(frozen=True)
class TextChunk:
    """One RAG-retrieved text chunk (FR-AGENT-4) — text only, never a file ref."""

    text: str


class ResidencyBlockedError(Exception):
    """Raised when `mode == "none"` reaches the runtime alongside a remote
    LLM — a defect (should have been blocked at config-save time), not a
    normal degraded-mode path.
    """


def build_payload(
    mode: ResidencyMode,
    turn: Turn,
    memory: MemoryWindow,
    system_prompt: str,
    retrieved: Sequence[TextChunk],
    *,
    prior_transcript: Sequence[ChatMessage] = (),
) -> ResidencyPayload:
    """Builds the exact payload an `ILLMProvider` is allowed to see.

    | Mode | Included | Excluded |
    |---|---|---|
    | prompt_text_only (default) | system prompt, memory text, this turn's text, RAG chunks | audio/recordings/prior transcript |
    | prompt_and_transcript | the above + `prior_transcript` | audio, recordings, attachments |
    | none | — (raises) | everything, for remote LLMs |
    """
    if mode == "none":
        raise ResidencyBlockedError("residency mode 'none' reached the runtime — this must be blocked at config-save time")

    messages: list[ChatMessage] = []
    if mode == "prompt_and_transcript":
        messages.extend(prior_transcript)
    messages.extend(memory.turns)
    messages.append(ChatMessage(role="user", content=turn.text))

    return ResidencyPayload(
        system_prompt=system_prompt,
        messages=tuple(messages),
        retrieved_chunks=tuple(chunk.text for chunk in retrieved),
    )
