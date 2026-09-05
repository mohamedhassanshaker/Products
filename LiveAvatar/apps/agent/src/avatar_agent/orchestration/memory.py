"""FR-AGENT-3 conversational memory — session-scoped, bounded window."""

from __future__ import annotations

from collections import deque

from avatar_agent.ports.llm import ChatMessage


class SessionMemory:
    """Holds the last `window_turns` user+assistant text turns for this
    session only (v1: never cross-session unless residency is
    `prompt_and_transcript` and prior transcripts exist — that path is
    supplied separately by the caller as `prior_transcript`, not by this
    class). `window_turns == 0` is treated as disabled (FR-AGENT-3).
    """

    def __init__(self, window_turns: int, enabled: bool = True) -> None:
        self._enabled = enabled and window_turns > 0
        # One turn = one user message + one assistant reply.
        self._window: deque[ChatMessage] = deque(maxlen=window_turns * 2 if self._enabled else 0)

    def add_user_turn(self, text: str) -> None:
        """Records the user's final utterance text, if memory is enabled."""
        if self._enabled:
            self._window.append(ChatMessage(role="user", content=text))

    def add_assistant_turn(self, text: str) -> None:
        """Records the assistant's reply text, if memory is enabled."""
        if self._enabled:
            self._window.append(ChatMessage(role="assistant", content=text))

    def as_messages(self) -> list[ChatMessage]:
        """@returns: the current window as an ordered message list (oldest first)."""
        return list(self._window)
