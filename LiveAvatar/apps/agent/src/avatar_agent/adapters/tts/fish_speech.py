"""Fish Speech vendor adapter — self-hosted, production default (FR-TTS-1,
factory key `fish-speech`). No official Python SDK is published for the
self-hosted Fish Speech server; it exposes a plain HTTP streaming synthesis
endpoint, addressed by the tenant's `ProviderCredential.endpoint_url` (the
same "self-hosted GPU worker, addressed by endpoint_url" pattern Deepgram
self-hosted and faster-whisper use — ADR-001 §4).
"""

from __future__ import annotations

import time
from collections.abc import AsyncIterator

import httpx

from avatar_agent.ports.runtime import ProviderRuntime
from avatar_agent.ports.tts import ITTSProvider, TtsError


class FishSpeechTtsAdapter(ITTSProvider):
    """`ITTSProvider` implementation over a self-hosted Fish Speech server's
    HTTP streaming synthesis endpoint (`POST {endpoint_url}/v1/tts`).
    """

    key = "fish-speech"

    def __init__(self, runtime: ProviderRuntime) -> None:
        if not runtime.endpoint_url:
            raise TtsError("Fish Speech endpoint is not configured.", code="TTS_UNAVAILABLE")
        self._runtime = runtime
        self._client = httpx.AsyncClient(
            base_url=runtime.endpoint_url,
            timeout=runtime.timeouts.request_ms / 1000,
            headers={"Authorization": f"Bearer {runtime.api_key}"} if runtime.api_key else {},
        )
        self._first_audio_ms: int | None = None

    async def synthesize_stream(self, text: str, voice_id: str) -> AsyncIterator[bytes]:
        """@inheritdoc"""
        started = time.monotonic()
        self._first_audio_ms = None
        try:
            async with self._client.stream(
                "POST",
                "/v1/tts",
                json={"text": text, "reference_id": voice_id, "format": "pcm"},
            ) as response:
                if response.status_code == 404:
                    raise TtsError(f"Voice '{voice_id}' is not available on Fish Speech.", code="TTS_VOICE_NOT_FOUND")
                response.raise_for_status()
                async for chunk in response.aiter_bytes():
                    if not chunk:
                        continue
                    if self._first_audio_ms is None:
                        self._first_audio_ms = int((time.monotonic() - started) * 1000)
                    yield chunk
        except TtsError:
            raise
        except httpx.HTTPError as err:
            raise TtsError("Fish Speech is unavailable.", code="TTS_UNAVAILABLE") from err

    @property
    def first_audio_ms(self) -> int | None:
        """@inheritdoc"""
        return self._first_audio_ms
