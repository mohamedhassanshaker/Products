"""`ITTSProvider` — streaming text-to-speech port (FR-TTS-1..4)."""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Protocol


class TtsError(Exception):
    """Raised on synth failure (e.g. `TTS_VOICE_NOT_FOUND`, FR-TTS-1)."""

    def __init__(self, message: str, *, code: str = "TTS_UNAVAILABLE") -> None:
        super().__init__(message)
        self.code = code


class ITTSProvider(Protocol):
    """Streaming speech-synthesis port (FR-TTS-1/2)."""

    key: str

    def synthesize_stream(self, text: str, voice_id: str) -> AsyncIterator[bytes]:
        """Yields PCM audio frames as they become available. Raises `TtsError`
        on failure (e.g. unknown `voice_id` -> `TTS_VOICE_NOT_FOUND`).
        Empty/whitespace-only `text` must be short-circuited by the caller
        before this is invoked (FR-TTS-3, `TTS_SKIPPED_EMPTY`).

        Declared as a plain (not `async`) method returning `AsyncIterator` —
        see `ISTTProvider.transcribe_stream`'s docstring for why.
        """
        ...

    @property
    def first_audio_ms(self) -> int | None:
        """Latency of the most recent call's first audio frame, if measured (FR-TTS-4)."""
        ...
