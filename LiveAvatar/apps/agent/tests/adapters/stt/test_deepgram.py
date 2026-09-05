"""Unit tests for the Deepgram STT adapter, mocking the SDK socket boundary."""

from __future__ import annotations

import asyncio

import pytest

from avatar_agent.adapters.stt.deepgram import DeepgramSttAdapter
from avatar_agent.ports.runtime import ProviderRuntime
from avatar_agent.ports.stt import SttError


def runtime(**extra: object) -> ProviderRuntime:
    return ProviderRuntime(
        logical_key="stt.deepgram",
        endpoint_url="https://deepgram.internal.example.com",
        api_key="dg-key",
        model="nova-2",
        extra=extra or {"language": "en-US"},
    )


class FakeMessage:
    def __init__(self, transcript: str, is_final: bool) -> None:
        self.type = "Results"
        self.is_final = is_final
        alt = type("Alt", (), {"transcript": transcript})
        self.channel = type("Channel", (), {"alternatives": [alt]})


class FakeSocket:
    def __init__(self, messages: list[FakeMessage]) -> None:
        self._messages = messages
        self.sent_media: list[bytes] = []
        self.closed = False

    async def send_media(self, frame: bytes) -> None:
        self.sent_media.append(frame)

    async def send_close_stream(self) -> None:
        self.closed = True

    async def __aiter__(self):
        # Yields control back to the event loop between messages so the
        # concurrently-running audio-pump task (a real `asyncio.ensure_future`
        # task, not awaited inline) gets a chance to run before this fake
        # socket's message stream ends — mirrors a real connection, where
        # results and outbound audio genuinely interleave over time.
        for m in self._messages:
            await asyncio.sleep(0)
            yield m
        await asyncio.sleep(0)


class FakeConnectCm:
    def __init__(self, socket: FakeSocket) -> None:
        self._socket = socket

    async def __aenter__(self):
        return self._socket

    async def __aexit__(self, *exc):
        return False


async def audio_frames(frames: list[bytes]):
    for f in frames:
        yield f


def test_requires_an_endpoint_url() -> None:
    rt = ProviderRuntime(logical_key="stt.deepgram", endpoint_url=None, api_key="k", model=None)
    with pytest.raises(SttError):
        DeepgramSttAdapter(rt)


async def test_yields_partial_then_final_events() -> None:
    adapter = DeepgramSttAdapter(runtime())
    socket = FakeSocket([FakeMessage("hel", is_final=False), FakeMessage("hello", is_final=True)])
    adapter._client.listen.v1.connect = lambda **kwargs: FakeConnectCm(socket)

    events = [e async for e in adapter.transcribe_stream(audio_frames([b"abc"]))]

    assert events[0] == {"kind": "partial", "text": "hel"}
    assert events[1] == {"kind": "final", "text": "hello"}
    assert adapter.first_partial_ms is not None
    assert socket.sent_media == [b"abc"]
    assert socket.closed is True


async def test_empty_transcripts_are_not_yielded() -> None:
    adapter = DeepgramSttAdapter(runtime())
    socket = FakeSocket([FakeMessage("", is_final=False)])
    adapter._client.listen.v1.connect = lambda **kwargs: FakeConnectCm(socket)

    events = [e async for e in adapter.transcribe_stream(audio_frames([]))]

    assert events == []


async def test_connect_failure_raises_stt_unavailable() -> None:
    adapter = DeepgramSttAdapter(runtime())

    class RaisingCm:
        async def __aenter__(self):
            raise RuntimeError("connection refused")

        async def __aexit__(self, *exc):
            return False

    adapter._client.listen.v1.connect = lambda **kwargs: RaisingCm()

    with pytest.raises(SttError) as exc_info:
        async for _ in adapter.transcribe_stream(audio_frames([])):
            pass
    assert exc_info.value.code == "STT_UNAVAILABLE"
