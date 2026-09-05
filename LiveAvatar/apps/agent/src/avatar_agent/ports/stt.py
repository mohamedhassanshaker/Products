"""`ISTTProvider` — streaming speech-to-text port (FR-STT-1..4)."""

from __future__ import annotations

from collections.abc import AsyncIterable, AsyncIterator
from typing import Literal, Protocol, TypedDict


class SttEvent(TypedDict):
    """One partial or final transcription event (FR-STT-3, FR-CALL-3 captions)."""

    kind: Literal["partial", "final"]
    text: str


class SttError(Exception):
    """Raised on connect/stream failure (`STT_UNAVAILABLE`, FR-STT-1)."""

    def __init__(self, message: str, *, code: str = "STT_UNAVAILABLE") -> None:
        super().__init__(message)
        self.code = code


class ISTTProvider(Protocol):
    """Streaming transcription port (FR-STT-1/2)."""

    key: str

    def transcribe_stream(self, audio_pcm: AsyncIterable[bytes]) -> AsyncIterator[SttEvent]:
        """Yields partial events as speech is recognized, then one final event
        on silence/endpoint detection (FR-STT-3). Zero-length finals must be
        dropped by the caller (`pipeline.py`), never passed to the LLM.

        Declared as a plain (not `async`) method returning `AsyncIterator` —
        implementations are async generators (`async def ... yield ...`),
        which mypy expects the Protocol signature itself to match exactly
        (an `async def` here would type-check as a coroutine *returning* an
        iterator, not an async generator).
        """
        ...

    @property
    def first_partial_ms(self) -> int | None:
        """Latency of the most recent utterance's first partial, if measured (FR-STT-4)."""
        ...
