"""Unit tests for the Alibaba LiveAvatar avatar adapter (FR-AVATAR-2/3/4).

Mocks the `websockets.connect` boundary the same way `test_bithuman.py` mocks
`AsyncBithuman.create` — no real Alibaba LiveAvatar endpoint is reachable
from this sandbox (disclosed in the adapter's own module docstring), so the
fake connection below stands in for the real vendor's WebSocket wire
protocol this dispatch's own reversible assumption defines.
"""

from __future__ import annotations

import json
from unittest.mock import AsyncMock

import pytest
from websockets.exceptions import ConnectionClosedError, WebSocketException

from avatar_agent.adapters.avatar import alibaba_liveavatar as liveavatar_module
from avatar_agent.adapters.avatar.alibaba_liveavatar import AlibabaLiveAvatarAdapter
from avatar_agent.ports.avatar import AvatarError
from avatar_agent.ports.runtime import ProviderRuntime


def runtime(**extra_overrides: object) -> ProviderRuntime:
    extra = {"avatar_id": "avatar-1"}
    extra.update(extra_overrides)
    return ProviderRuntime(
        logical_key="avatar.alibaba-liveavatar",
        endpoint_url="https://liveavatar.acme-corp.example",
        api_key="la-secret",
        model=None,
        extra=extra,
    )


class FakeWebSocket:
    """Stands in for `websockets.asyncio.client.ClientConnection`.

    `incoming` is consumed in order: by `recv()` (one message at a time) and
    by `__aiter__` (the rest of the queue, in the same order) — mirroring how
    the adapter itself only ever calls `recv()` once (the `session.start`
    reply) before switching to iteration for the rest of the session.
    """

    def __init__(self, incoming: list[object] | None = None) -> None:
        self.sent: list[object] = []
        self._incoming = list(incoming or [])
        self.closed = False
        self.close_calls = 0

    async def send(self, data: object) -> None:
        if getattr(self, "send_raises", None):
            raise self.send_raises
        self.sent.append(data)

    async def recv(self) -> object:
        if getattr(self, "recv_raises", None):
            raise self.recv_raises
        return self._incoming.pop(0)

    def __aiter__(self):
        return self

    async def __anext__(self):
        if getattr(self, "iter_raises", None):
            raise self.iter_raises
        if not self._incoming:
            raise StopAsyncIteration
        return self._incoming.pop(0)

    async def close(self) -> None:
        self.closed = True
        self.close_calls += 1


def ready_ws(rest: list[object] | None = None) -> FakeWebSocket:
    return FakeWebSocket([json.dumps({"type": "session.ready"}), *(rest or [])])


def test_requires_a_credential() -> None:
    rt = ProviderRuntime(
        logical_key="avatar.alibaba-liveavatar", endpoint_url="https://x", api_key=None, model=None, extra={"avatar_id": "a"}
    )
    with pytest.raises(AvatarError) as exc_info:
        AlibabaLiveAvatarAdapter(rt)
    assert exc_info.value.code == "AVATAR_UNAVAILABLE"


def test_requires_an_avatar_id() -> None:
    rt = ProviderRuntime(logical_key="avatar.alibaba-liveavatar", endpoint_url="https://x", api_key="k", model=None, extra={})
    with pytest.raises(AvatarError) as exc_info:
        AlibabaLiveAvatarAdapter(rt)
    assert exc_info.value.code == "AVATAR_NOT_FOUND"


def test_translates_https_endpoint_to_wss_stream_url() -> None:
    adapter = AlibabaLiveAvatarAdapter(runtime())
    assert adapter._url == "wss://liveavatar.acme-corp.example/v1/render/stream"


def test_translates_http_endpoint_to_ws_stream_url() -> None:
    rt = ProviderRuntime(
        logical_key="avatar.alibaba-liveavatar",
        endpoint_url="http://liveavatar.internal:8090",
        api_key="k",
        model=None,
        extra={"avatar_id": "a"},
    )
    adapter = AlibabaLiveAvatarAdapter(rt)
    assert adapter._url == "ws://liveavatar.internal:8090/v1/render/stream"


def test_leaves_an_already_ws_endpoint_untouched() -> None:
    rt = ProviderRuntime(
        logical_key="avatar.alibaba-liveavatar",
        endpoint_url="wss://liveavatar.internal",
        api_key="k",
        model=None,
        extra={"avatar_id": "a"},
    )
    adapter = AlibabaLiveAvatarAdapter(rt)
    assert adapter._url == "wss://liveavatar.internal/v1/render/stream"


def test_defaults_a_bare_host_endpoint_to_wss() -> None:
    rt = ProviderRuntime(
        logical_key="avatar.alibaba-liveavatar",
        endpoint_url="liveavatar.internal",
        api_key="k",
        model=None,
        extra={"avatar_id": "a"},
    )
    adapter = AlibabaLiveAvatarAdapter(rt)
    assert adapter._url == "wss://liveavatar.internal/v1/render/stream"


def test_missing_endpoint_is_avatar_unavailable() -> None:
    rt = ProviderRuntime(
        logical_key="avatar.alibaba-liveavatar", endpoint_url=None, api_key="k", model=None, extra={"avatar_id": "a"}
    )
    with pytest.raises(AvatarError) as exc_info:
        AlibabaLiveAvatarAdapter(rt)
    assert exc_info.value.code == "AVATAR_UNAVAILABLE"


async def test_start_session_connects_and_sends_the_start_message(monkeypatch) -> None:
    fake_ws = ready_ws()
    connect_mock = AsyncMock(return_value=fake_ws)
    monkeypatch.setattr(liveavatar_module.websockets, "connect", connect_mock)

    adapter = AlibabaLiveAvatarAdapter(runtime())
    await adapter.start_session()

    connect_mock.assert_awaited_once_with(
        "wss://liveavatar.acme-corp.example/v1/render/stream",
        additional_headers={"Authorization": "Bearer la-secret"},
    )
    assert json.loads(fake_ws.sent[0]) == {"type": "session.start", "avatar_id": "avatar-1"}


async def test_start_session_raises_avatar_not_found_for_an_unknown_avatar(monkeypatch) -> None:
    fake_ws = FakeWebSocket([json.dumps({"type": "error", "code": "avatar_not_found", "avatar_id": "avatar-1"})])
    monkeypatch.setattr(liveavatar_module.websockets, "connect", AsyncMock(return_value=fake_ws))

    adapter = AlibabaLiveAvatarAdapter(runtime())
    with pytest.raises(AvatarError) as exc_info:
        await adapter.start_session()
    assert exc_info.value.code == "AVATAR_NOT_FOUND"


async def test_start_session_raises_avatar_unavailable_for_any_other_vendor_error(monkeypatch) -> None:
    fake_ws = FakeWebSocket([json.dumps({"type": "error", "code": "render_capacity_exceeded", "message": "no capacity"})])
    monkeypatch.setattr(liveavatar_module.websockets, "connect", AsyncMock(return_value=fake_ws))

    adapter = AlibabaLiveAvatarAdapter(runtime())
    with pytest.raises(AvatarError) as exc_info:
        await adapter.start_session()
    assert exc_info.value.code == "AVATAR_UNAVAILABLE"


async def test_start_session_wraps_a_connection_failure_as_avatar_unavailable(monkeypatch) -> None:
    monkeypatch.setattr(liveavatar_module.websockets, "connect", AsyncMock(side_effect=WebSocketException("handshake failed")))

    adapter = AlibabaLiveAvatarAdapter(runtime())
    with pytest.raises(AvatarError) as exc_info:
        await adapter.start_session()
    assert exc_info.value.code == "AVATAR_UNAVAILABLE"


async def test_start_session_wraps_an_os_error_as_avatar_unavailable(monkeypatch) -> None:
    monkeypatch.setattr(liveavatar_module.websockets, "connect", AsyncMock(side_effect=OSError("connection refused")))

    adapter = AlibabaLiveAvatarAdapter(runtime())
    with pytest.raises(AvatarError) as exc_info:
        await adapter.start_session()
    assert exc_info.value.code == "AVATAR_UNAVAILABLE"


async def test_start_session_raises_on_a_malformed_control_reply(monkeypatch) -> None:
    fake_ws = FakeWebSocket(["not json"])
    monkeypatch.setattr(liveavatar_module.websockets, "connect", AsyncMock(return_value=fake_ws))

    adapter = AlibabaLiveAvatarAdapter(runtime())
    with pytest.raises(AvatarError) as exc_info:
        await adapter.start_session()
    assert exc_info.value.code == "AVATAR_UNAVAILABLE"


async def test_start_session_raises_on_a_non_object_control_reply(monkeypatch) -> None:
    fake_ws = FakeWebSocket(["[1, 2, 3]"])
    monkeypatch.setattr(liveavatar_module.websockets, "connect", AsyncMock(return_value=fake_ws))

    adapter = AlibabaLiveAvatarAdapter(runtime())
    with pytest.raises(AvatarError) as exc_info:
        await adapter.start_session()
    assert exc_info.value.code == "AVATAR_UNAVAILABLE"


async def test_push_audio_frame_before_start_session_raises() -> None:
    adapter = AlibabaLiveAvatarAdapter(runtime())
    with pytest.raises(AvatarError) as exc_info:
        await adapter.push_audio_frame(b"\x00\x01")
    assert exc_info.value.code == "AVATAR_UNAVAILABLE"


async def test_push_audio_frame_sends_a_raw_binary_frame(monkeypatch) -> None:
    fake_ws = ready_ws()
    monkeypatch.setattr(liveavatar_module.websockets, "connect", AsyncMock(return_value=fake_ws))

    adapter = AlibabaLiveAvatarAdapter(runtime())
    await adapter.start_session()
    await adapter.push_audio_frame(b"\x01\x02\x03\x04")

    assert fake_ws.sent[-1] == b"\x01\x02\x03\x04"


async def test_push_audio_frame_wraps_send_errors_as_avatar_unavailable(monkeypatch) -> None:
    fake_ws = ready_ws()
    monkeypatch.setattr(liveavatar_module.websockets, "connect", AsyncMock(return_value=fake_ws))

    adapter = AlibabaLiveAvatarAdapter(runtime())
    await adapter.start_session()
    fake_ws.send_raises = ConnectionClosedError(None, None)

    with pytest.raises(AvatarError) as exc_info:
        await adapter.push_audio_frame(b"\x00\x00")
    assert exc_info.value.code == "AVATAR_UNAVAILABLE"


async def test_flush_is_a_no_op_before_start_session() -> None:
    adapter = AlibabaLiveAvatarAdapter(runtime())
    await adapter.flush()  # must not raise


async def test_flush_sends_the_flush_control_message(monkeypatch) -> None:
    fake_ws = ready_ws()
    monkeypatch.setattr(liveavatar_module.websockets, "connect", AsyncMock(return_value=fake_ws))

    adapter = AlibabaLiveAvatarAdapter(runtime())
    await adapter.start_session()
    await adapter.flush()

    assert json.loads(fake_ws.sent[-1]) == {"type": "session.flush"}


async def test_flush_swallows_a_send_error_on_an_already_torn_down_connection(monkeypatch) -> None:
    fake_ws = ready_ws()
    monkeypatch.setattr(liveavatar_module.websockets, "connect", AsyncMock(return_value=fake_ws))

    adapter = AlibabaLiveAvatarAdapter(runtime())
    await adapter.start_session()
    fake_ws.send_raises = ConnectionClosedError(None, None)

    await adapter.flush()  # must not raise


async def test_frames_before_start_session_raises() -> None:
    adapter = AlibabaLiveAvatarAdapter(runtime())
    with pytest.raises(AvatarError):
        async for _ in adapter.frames():
            pass


async def test_frames_yields_video_frames_from_meta_plus_binary_pairs(monkeypatch) -> None:
    fake_ws = ready_ws(
        [
            json.dumps({"type": "frame.meta", "width": 8, "height": 4}),
            b"\x00" * (8 * 4 * 3),
            json.dumps({"type": "session.end"}),
        ]
    )
    monkeypatch.setattr(liveavatar_module.websockets, "connect", AsyncMock(return_value=fake_ws))

    adapter = AlibabaLiveAvatarAdapter(runtime())
    await adapter.start_session()
    yielded = [f async for f in adapter.frames()]

    assert len(yielded) == 1
    assert yielded[0].width == 8
    assert yielded[0].height == 4
    assert adapter.first_frame_ms is not None


async def test_frames_skips_a_binary_message_with_no_preceding_meta(monkeypatch) -> None:
    fake_ws = ready_ws([b"\x00\x00\x00", json.dumps({"type": "session.end"})])
    monkeypatch.setattr(liveavatar_module.websockets, "connect", AsyncMock(return_value=fake_ws))

    adapter = AlibabaLiveAvatarAdapter(runtime())
    await adapter.start_session()
    yielded = [f async for f in adapter.frames()]

    assert yielded == []


async def test_frames_raises_avatar_unavailable_on_a_mid_stream_error_message(monkeypatch) -> None:
    fake_ws = ready_ws([json.dumps({"type": "error", "code": "render_crashed", "message": "renderer died"})])
    monkeypatch.setattr(liveavatar_module.websockets, "connect", AsyncMock(return_value=fake_ws))

    adapter = AlibabaLiveAvatarAdapter(runtime())
    await adapter.start_session()
    with pytest.raises(AvatarError) as exc_info:
        async for _ in adapter.frames():
            pass
    assert exc_info.value.code == "AVATAR_UNAVAILABLE"


async def test_frames_wraps_a_dropped_connection_as_avatar_unavailable(monkeypatch) -> None:
    fake_ws = ready_ws()
    monkeypatch.setattr(liveavatar_module.websockets, "connect", AsyncMock(return_value=fake_ws))

    adapter = AlibabaLiveAvatarAdapter(runtime())
    await adapter.start_session()
    fake_ws.iter_raises = ConnectionClosedError(None, None)

    with pytest.raises(AvatarError) as exc_info:
        async for _ in adapter.frames():
            pass
    assert exc_info.value.code == "AVATAR_UNAVAILABLE"


async def test_close_sends_session_end_and_closes_the_socket_and_is_idempotent(monkeypatch) -> None:
    fake_ws = ready_ws()
    monkeypatch.setattr(liveavatar_module.websockets, "connect", AsyncMock(return_value=fake_ws))

    adapter = AlibabaLiveAvatarAdapter(runtime())
    await adapter.start_session()
    await adapter.close()
    await adapter.close()  # must not raise or close twice

    assert json.loads(fake_ws.sent[-1]) == {"type": "session.end"}
    assert fake_ws.close_calls == 1


async def test_close_still_closes_the_socket_even_if_the_end_notice_fails(monkeypatch) -> None:
    fake_ws = ready_ws()
    monkeypatch.setattr(liveavatar_module.websockets, "connect", AsyncMock(return_value=fake_ws))

    adapter = AlibabaLiveAvatarAdapter(runtime())
    await adapter.start_session()
    fake_ws.send_raises = ConnectionClosedError(None, None)

    await adapter.close()
    assert fake_ws.close_calls == 1
