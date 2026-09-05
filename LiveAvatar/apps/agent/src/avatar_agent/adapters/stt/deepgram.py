"""Deepgram vendor adapter — self-hosted (FR-STT-1, factory key `deepgram`).

Deepgram is explicitly **not** assumed cloud-only (FR-STT-1): `endpoint_url`
points at the tenant's self-hosted (or Deepgram-cloud) instance. Connects
over the SDK's async streaming websocket client.

Disclosed limitation (matching Phase 3's precedent for `livekit-server-sdk`):
this adapter is implemented against the installed `deepgram-sdk` 7.x
documented API surface and unit-tested against a fake socket, but has never
been run against a live Deepgram server in this sandbox — flagged for a
Docker/network-capable environment to smoke-test before production sign-off.
"""

from __future__ import annotations

import time
from collections.abc import AsyncIterable, AsyncIterator

from deepgram import AsyncDeepgramClient
from deepgram.environment import DeepgramClientEnvironment

from avatar_agent.ports.runtime import ProviderRuntime
from avatar_agent.ports.stt import SttError, SttEvent


def _extract_transcript(message: object) -> tuple[str, bool] | None:
    """Pulls `(transcript, is_final)` out of a Deepgram `Results` socket
    message, defensively — the SDK's message classes are internal/generated
    and not part of this project's stable surface (see module docstring).
    """
    msg_type = getattr(message, "type", None)
    if msg_type is not None and msg_type != "Results":
        return None
    channel = getattr(message, "channel", None)
    alternatives = getattr(channel, "alternatives", None) if channel else None
    if not alternatives:
        return None
    transcript = getattr(alternatives[0], "transcript", "") or ""
    is_final = bool(getattr(message, "is_final", False))
    return transcript, is_final


class DeepgramSttAdapter:
    """`ISTTProvider` implementation over the Deepgram streaming SDK."""

    key = "deepgram"

    def __init__(self, runtime: ProviderRuntime) -> None:
        if not runtime.endpoint_url:
            raise SttError("Speech recognition is unavailable.", code="STT_UNAVAILABLE")
        self._runtime = runtime
        # Deepgram is not assumed cloud-only (FR-STT-1) — the self-hosted
        # endpoint replaces every base URL the SDK would otherwise use
        # (`DeepgramClientEnvironment`, not a plain `base_url` kwarg, is the
        # 7.x SDK's actual "point somewhere else" mechanism).
        environment = DeepgramClientEnvironment(
            base=runtime.endpoint_url,
            production=runtime.endpoint_url,
            agent=runtime.endpoint_url,
            agent_rest=runtime.endpoint_url,
        )
        self._client = AsyncDeepgramClient(api_key=runtime.api_key, environment=environment)
        self._first_partial_ms: int | None = None

    async def transcribe_stream(self, audio_pcm: AsyncIterable[bytes]) -> AsyncIterator[SttEvent]:
        """@inheritdoc"""
        started = time.monotonic()
        self._first_partial_ms = None
        language = self._runtime.extra.get("language", "en-US")
        model = self._runtime.model or "nova-2"

        try:
            async with self._client.listen.v1.connect(
                model=model,
                language=language,
                interim_results=True,
                punctuate=True,
                encoding="linear16",
                sample_rate=16000,
            ) as socket:

                async def _pump_audio() -> None:
                    async for frame in audio_pcm:
                        await socket.send_media(frame)
                    await socket.send_close_stream()

                import asyncio

                pump_task = asyncio.ensure_future(_pump_audio())
                try:
                    async for message in socket:
                        extracted = _extract_transcript(message)
                        if extracted is None:
                            continue
                        transcript, is_final = extracted
                        if not transcript:
                            continue
                        if self._first_partial_ms is None:
                            self._first_partial_ms = int((time.monotonic() - started) * 1000)
                        yield SttEvent(kind="final" if is_final else "partial", text=transcript)
                finally:
                    if not pump_task.done():
                        pump_task.cancel()
        except SttError:
            raise
        except Exception as err:  # noqa: BLE001 - connect/stream failure -> spec error code
            raise SttError("Speech recognition is unavailable.", code="STT_UNAVAILABLE") from err

    @property
    def first_partial_ms(self) -> int | None:
        """@inheritdoc"""
        return self._first_partial_ms
