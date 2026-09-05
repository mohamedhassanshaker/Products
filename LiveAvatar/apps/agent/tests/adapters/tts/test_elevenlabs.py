"""Unit tests for the ElevenLabs TTS adapter, mocking the SDK client boundary."""

from __future__ import annotations

import elevenlabs
import pytest

from avatar_agent.adapters.tts.elevenlabs import ElevenLabsTtsAdapter
from avatar_agent.ports.runtime import ProviderRuntime
from avatar_agent.ports.tts import TtsError


def runtime() -> ProviderRuntime:
    return ProviderRuntime(logical_key="tts.elevenlabs", endpoint_url=None, api_key="el-key", model=None)


async def test_streams_audio_frames() -> None:
    adapter = ElevenLabsTtsAdapter(runtime())

    async def _gen(**kwargs):
        yield b"frame-one"
        yield b"frame-two"

    adapter._client.text_to_speech.stream = lambda **kwargs: _gen(**kwargs)

    frames = [f async for f in adapter.synthesize_stream("hello", "voice-1")]
    assert frames == [b"frame-one", b"frame-two"]
    assert adapter.first_audio_ms is not None


async def test_unknown_voice_raises_tts_voice_not_found() -> None:
    adapter = ElevenLabsTtsAdapter(runtime())

    async def _gen(**kwargs):
        raise elevenlabs.NotFoundError(body=None)
        yield b""  # pragma: no cover - unreachable, keeps this an async generator

    adapter._client.text_to_speech.stream = lambda **kwargs: _gen(**kwargs)

    with pytest.raises(TtsError) as exc_info:
        async for _ in adapter.synthesize_stream("hello", "unknown-voice"):
            pass
    assert exc_info.value.code == "TTS_VOICE_NOT_FOUND"


async def test_generic_failure_raises_tts_unavailable() -> None:
    adapter = ElevenLabsTtsAdapter(runtime())

    async def _gen(**kwargs):
        raise RuntimeError("boom")
        yield b""  # pragma: no cover - unreachable

    adapter._client.text_to_speech.stream = lambda **kwargs: _gen(**kwargs)

    with pytest.raises(TtsError) as exc_info:
        async for _ in adapter.synthesize_stream("hello", "voice-1"):
            pass
    assert exc_info.value.code == "TTS_UNAVAILABLE"
