"""`faster-whisper` vendor adapter — self-hosted on NVIDIA GPU (FR-STT-2,
factory key `faster-whisper`). Same `ISTTProvider` contract as Deepgram.

`faster-whisper`'s `WhisperModel.transcribe` is a batch (not natively
streaming) call, so partials are produced by re-transcribing an
accumulating audio buffer every `_CHUNK_BYTES` of new audio (~1.5s at
16 kHz mono 16-bit PCM) and treating the running result as the current
partial (FR-STT-3); the final transcription runs once against the whole
buffer when the caller's `audio_pcm` iterable is exhausted (silence/
endpoint detected upstream by the LiveKit VAD). This is a deliberate,
disclosed approximation of "streaming" for a batch-oriented local model —
noted in the phase plan doc as an assumption, not silently invented.
"""

from __future__ import annotations

import asyncio
import time
from collections.abc import AsyncIterable, AsyncIterator

import numpy as np
from faster_whisper import WhisperModel

from avatar_agent.ports.runtime import ProviderRuntime
from avatar_agent.ports.stt import SttError, SttEvent

# ~1.5s of 16kHz mono 16-bit PCM audio between re-transcription passes.
_CHUNK_BYTES = 16000 * 2 * 3 // 2


def _pcm16_to_float32(buf: bytes) -> np.ndarray:
    """Converts little-endian int16 PCM bytes to the normalized float32 array
    `faster_whisper.WhisperModel.transcribe` expects.
    """
    if not buf:
        return np.zeros(0, dtype=np.float32)
    ints = np.frombuffer(buf, dtype="<i2")
    return (ints.astype(np.float32) / 32768.0).copy()


class FasterWhisperSttAdapter:
    """`ISTTProvider` implementation over a local `faster-whisper` model."""

    key = "faster-whisper"

    def __init__(self, runtime: ProviderRuntime) -> None:
        self._runtime = runtime
        self._first_partial_ms: int | None = None
        model_size = runtime.model or "base"
        device = str(runtime.extra.get("device", "auto"))
        try:
            self._model = WhisperModel(model_size, device=device)
        except Exception as err:  # noqa: BLE001
            raise SttError("Speech recognition is unavailable.", code="STT_UNAVAILABLE") from err

    def _transcribe_sync(self, audio: np.ndarray, language: str) -> str:
        segments, _info = self._model.transcribe(audio, language=language.split("-")[0])
        return "".join(segment.text for segment in segments).strip()

    async def transcribe_stream(self, audio_pcm: AsyncIterable[bytes]) -> AsyncIterator[SttEvent]:
        """@inheritdoc"""
        started = time.monotonic()
        self._first_partial_ms = None
        language = str(self._runtime.extra.get("language", "en-US"))
        buffer = bytearray()
        bytes_since_pass = 0

        try:
            async for frame in audio_pcm:
                buffer.extend(frame)
                bytes_since_pass += len(frame)
                if bytes_since_pass < _CHUNK_BYTES:
                    continue
                bytes_since_pass = 0
                text = await asyncio.to_thread(self._transcribe_sync, _pcm16_to_float32(bytes(buffer)), language)
                if text:
                    if self._first_partial_ms is None:
                        self._first_partial_ms = int((time.monotonic() - started) * 1000)
                    yield SttEvent(kind="partial", text=text)

            # Endpoint reached (source exhausted) — one final pass over the
            # full buffer. A zero-length final (no speech at all) is dropped
            # by the caller (`pipeline.py`), per FR-STT-3.
            final_text = await asyncio.to_thread(self._transcribe_sync, _pcm16_to_float32(bytes(buffer)), language)
            if final_text and self._first_partial_ms is None:
                self._first_partial_ms = int((time.monotonic() - started) * 1000)
            yield SttEvent(kind="final", text=final_text)
        except SttError:
            raise
        except Exception as err:  # noqa: BLE001
            raise SttError("Speech recognition is unavailable.", code="STT_UNAVAILABLE") from err

    @property
    def first_partial_ms(self) -> int | None:
        """@inheritdoc"""
        return self._first_partial_ms
