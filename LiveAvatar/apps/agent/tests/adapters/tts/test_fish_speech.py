"""Unit tests for the Fish Speech TTS adapter (self-hosted HTTP streaming)."""

from __future__ import annotations

import httpx
import pytest
import respx

from avatar_agent.adapters.tts.fish_speech import FishSpeechTtsAdapter
from avatar_agent.ports.runtime import ProviderRuntime
from avatar_agent.ports.tts import TtsError


def runtime() -> ProviderRuntime:
    return ProviderRuntime(
        logical_key="tts.fish-speech", endpoint_url="https://fish.internal.example.com", api_key="fs-key", model=None
    )


def test_requires_an_endpoint_url() -> None:
    rt = ProviderRuntime(logical_key="tts.fish-speech", endpoint_url=None, api_key=None, model=None)
    with pytest.raises(TtsError):
        FishSpeechTtsAdapter(rt)


@respx.mock
async def test_streams_audio_frames() -> None:
    respx.post("https://fish.internal.example.com/v1/tts").mock(return_value=httpx.Response(200, content=b"frame-one-frame-two"))
    adapter = FishSpeechTtsAdapter(runtime())
    frames = [f async for f in adapter.synthesize_stream("hello", "v1")]
    assert b"".join(frames) == b"frame-one-frame-two"
    assert adapter.first_audio_ms is not None


@respx.mock
async def test_unknown_voice_raises_tts_voice_not_found() -> None:
    respx.post("https://fish.internal.example.com/v1/tts").mock(return_value=httpx.Response(404))
    adapter = FishSpeechTtsAdapter(runtime())
    with pytest.raises(TtsError) as exc_info:
        async for _ in adapter.synthesize_stream("hello", "unknown-voice"):
            pass
    assert exc_info.value.code == "TTS_VOICE_NOT_FOUND"


@respx.mock
async def test_server_error_raises_tts_unavailable() -> None:
    respx.post("https://fish.internal.example.com/v1/tts").mock(return_value=httpx.Response(500))
    adapter = FishSpeechTtsAdapter(runtime())
    with pytest.raises(TtsError) as exc_info:
        async for _ in adapter.synthesize_stream("hello", "v1"):
            pass
    assert exc_info.value.code == "TTS_UNAVAILABLE"


@respx.mock
async def test_sends_bearer_auth_header() -> None:
    route = respx.post("https://fish.internal.example.com/v1/tts").mock(return_value=httpx.Response(200, content=b"x"))
    adapter = FishSpeechTtsAdapter(runtime())
    async for _ in adapter.synthesize_stream("hello", "v1"):
        pass
    assert route.calls.last.request.headers["authorization"] == "Bearer fs-key"
