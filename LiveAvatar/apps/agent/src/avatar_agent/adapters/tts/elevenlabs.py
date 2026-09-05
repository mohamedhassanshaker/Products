"""ElevenLabs vendor adapter — remote (FR-TTS-2, factory key `elevenlabs`).

Subject to residency disclosure, not the residency *filter* itself (LLD §6
data-locality table): the assistant reply text sent to ElevenLabs is
prompt-sized (the already-generated TTS input), never raw audio or a
recording upload.
"""

from __future__ import annotations

import time
from collections.abc import AsyncIterator

import elevenlabs
from elevenlabs.client import AsyncElevenLabs

from avatar_agent.ports.runtime import ProviderRuntime
from avatar_agent.ports.tts import ITTSProvider, TtsError


class ElevenLabsTtsAdapter(ITTSProvider):
    """`ITTSProvider` implementation over the ElevenLabs SDK."""

    key = "elevenlabs"

    def __init__(self, runtime: ProviderRuntime) -> None:
        self._client = AsyncElevenLabs(api_key=runtime.api_key, base_url=runtime.endpoint_url)
        self._first_audio_ms: int | None = None

    async def synthesize_stream(self, text: str, voice_id: str) -> AsyncIterator[bytes]:
        """@inheritdoc"""
        started = time.monotonic()
        self._first_audio_ms = None
        try:
            stream = self._client.text_to_speech.stream(voice_id=voice_id, text=text, output_format="pcm_16000")
            async for chunk in stream:
                if not chunk:
                    continue
                if self._first_audio_ms is None:
                    self._first_audio_ms = int((time.monotonic() - started) * 1000)
                yield chunk
        except elevenlabs.NotFoundError as err:
            raise TtsError(f"Voice '{voice_id}' is not available on ElevenLabs.", code="TTS_VOICE_NOT_FOUND") from err
        except Exception as err:  # noqa: BLE001
            raise TtsError("ElevenLabs is unavailable.", code="TTS_UNAVAILABLE") from err

    @property
    def first_audio_ms(self) -> int | None:
        """@inheritdoc"""
        return self._first_audio_ms
