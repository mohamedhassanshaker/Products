"""Unit tests for the bitHuman avatar adapter (FR-AVATAR-1/3/4).

Mocks the `bithuman.AsyncBithuman` vendor SDK boundary (same pattern the
other adapters' tests use for their own vendor SDK, e.g. `test_fish_speech.
py`'s `respx` HTTP mock) — the SDK class itself is compiled/native and
requires a real `.imx` model file and GPU-capable host to actually load a
model, neither of which exists in this sandbox (disclosed in the adapter's
own module docstring).
"""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock

import numpy as np
import pytest
from bithuman.exceptions import BithumanError, ModelNotFoundError

from avatar_agent.adapters.avatar import bithuman as bithuman_module
from avatar_agent.adapters.avatar.bithuman import BithumanAvatarAdapter
from avatar_agent.ports.avatar import AvatarError
from avatar_agent.ports.runtime import ProviderRuntime, Timeouts


def runtime(*, timeouts: Timeouts | None = None, **extra_overrides: object) -> ProviderRuntime:
    extra = {"avatar_id": "avatar-1"}
    extra.update(extra_overrides)
    return ProviderRuntime(
        logical_key="avatar.bithuman",
        endpoint_url="file:///models/acme",
        api_key="bh-secret",
        model=None,
        extra=extra,
        timeouts=timeouts or Timeouts(),
    )


class FakeVideoFrame:
    def __init__(self, *, has_image: bool = True, size: tuple[int, int] = (2, 2)) -> None:
        self.has_image = has_image
        height, width = size
        self.rgb_image = np.zeros((height, width, 3), dtype=np.uint8)


def make_fake_client(frames: list[FakeVideoFrame]) -> MagicMock:
    # `push_audio`/`flush`/`stop` are coroutines on the real installed SDK
    # (confirmed via `inspect.iscoroutinefunction` against `bithuman==1.10.7`)
    # -- `AsyncMock` here, not `MagicMock`, is what would have caught the
    # adapter calling them without `await` (a real bug found the first time
    # this adapter was ever exercised against a live model file).
    client = MagicMock()
    client.push_audio = AsyncMock()
    client.flush = AsyncMock()
    client.stop = AsyncMock()

    async def _run(*_a, **_k):
        for frame in frames:
            yield frame

    client.run = _run
    return client


def test_requires_a_credential() -> None:
    rt = ProviderRuntime(logical_key="avatar.bithuman", endpoint_url=None, api_key=None, model=None, extra={"avatar_id": "a"})
    with pytest.raises(AvatarError) as exc_info:
        BithumanAvatarAdapter(rt)
    assert exc_info.value.code == "AVATAR_UNAVAILABLE"


def test_requires_an_avatar_id() -> None:
    rt = ProviderRuntime(logical_key="avatar.bithuman", endpoint_url=None, api_key="bh-key", model=None, extra={})
    with pytest.raises(AvatarError) as exc_info:
        BithumanAvatarAdapter(rt)
    assert exc_info.value.code == "AVATAR_NOT_FOUND"


async def test_start_session_creates_the_bithuman_client_with_the_resolved_model_path(monkeypatch) -> None:
    create_mock = AsyncMock(return_value=make_fake_client([]))
    monkeypatch.setattr(bithuman_module.AsyncBithuman, "create", create_mock)

    adapter = BithumanAvatarAdapter(runtime())
    await adapter.start_session()

    create_mock.assert_awaited_once_with(model_path="/models/acme/avatar-1.imx", api_secret="bh-secret")


async def test_start_session_raises_avatar_not_found_for_an_unknown_model(monkeypatch) -> None:
    create_mock = AsyncMock(side_effect=ModelNotFoundError("no such model"))
    monkeypatch.setattr(bithuman_module.AsyncBithuman, "create", create_mock)

    adapter = BithumanAvatarAdapter(runtime())
    with pytest.raises(AvatarError) as exc_info:
        await adapter.start_session()
    assert exc_info.value.code == "AVATAR_NOT_FOUND"


async def test_start_session_raises_avatar_unavailable_for_any_other_sdk_error(monkeypatch) -> None:
    create_mock = AsyncMock(side_effect=BithumanError("connection refused"))
    monkeypatch.setattr(bithuman_module.AsyncBithuman, "create", create_mock)

    adapter = BithumanAvatarAdapter(runtime())
    with pytest.raises(AvatarError) as exc_info:
        await adapter.start_session()
    assert exc_info.value.code == "AVATAR_UNAVAILABLE"


async def test_start_session_raises_avatar_unavailable_when_the_sdk_call_hangs(monkeypatch) -> None:
    """`AsyncBithuman.create` has no timeout of its own — confirmed live
    against the real installed SDK that it can simply never resolve (no
    exception, no log line), evidently on a license/network check this
    sandbox has no visibility into. Bounding it is what turns "the caller
    waits forever" into a normal, `pipeline.start_avatar_session`-handled
    `AvatarError` (FR-AVATAR-5's retry-then-degrade path).
    """

    async def _hangs_forever(*_a, **_k):
        await asyncio.sleep(10)

    monkeypatch.setattr(bithuman_module.AsyncBithuman, "create", AsyncMock(side_effect=_hangs_forever))

    adapter = BithumanAvatarAdapter(runtime(timeouts=Timeouts(request_ms=50)))
    with pytest.raises(AvatarError) as exc_info:
        await adapter.start_session()
    assert exc_info.value.code == "AVATAR_UNAVAILABLE"


async def test_push_audio_frame_before_start_session_raises() -> None:
    adapter = BithumanAvatarAdapter(runtime())
    with pytest.raises(AvatarError) as exc_info:
        await adapter.push_audio_frame(b"\x00\x01")
    assert exc_info.value.code == "AVATAR_UNAVAILABLE"


async def test_push_audio_frame_forwards_pcm_to_the_client(monkeypatch) -> None:
    fake_client = make_fake_client([])
    monkeypatch.setattr(bithuman_module.AsyncBithuman, "create", AsyncMock(return_value=fake_client))

    adapter = BithumanAvatarAdapter(runtime())
    await adapter.start_session()
    await adapter.push_audio_frame(b"\x01\x02\x03\x04")

    fake_client.push_audio.assert_called_once_with(b"\x01\x02\x03\x04", sample_rate=24000, last_chunk=False)


async def test_push_audio_frame_wraps_sdk_errors_as_avatar_unavailable(monkeypatch) -> None:
    fake_client = make_fake_client([])
    fake_client.push_audio.side_effect = BithumanError("stream closed")
    monkeypatch.setattr(bithuman_module.AsyncBithuman, "create", AsyncMock(return_value=fake_client))

    adapter = BithumanAvatarAdapter(runtime())
    await adapter.start_session()
    with pytest.raises(AvatarError) as exc_info:
        await adapter.push_audio_frame(b"\x00\x00")
    assert exc_info.value.code == "AVATAR_UNAVAILABLE"


async def test_flush_is_a_no_op_before_start_session() -> None:
    adapter = BithumanAvatarAdapter(runtime())
    await adapter.flush()  # must not raise


async def test_flush_calls_the_client() -> None:
    fake_client = make_fake_client([])
    adapter = BithumanAvatarAdapter(runtime())
    adapter._client = fake_client  # already-started session, shortcut for this unit test
    await adapter.flush()
    fake_client.flush.assert_called_once()


async def test_frames_before_start_session_raises() -> None:
    adapter = BithumanAvatarAdapter(runtime())
    with pytest.raises(AvatarError):
        async for _ in adapter.frames():
            pass


async def test_frames_yields_video_frames_and_skips_imageless_frames(monkeypatch) -> None:
    fake_frames = [FakeVideoFrame(has_image=False), FakeVideoFrame(has_image=True, size=(4, 8))]
    fake_client = make_fake_client(fake_frames)
    monkeypatch.setattr(bithuman_module.AsyncBithuman, "create", AsyncMock(return_value=fake_client))

    adapter = BithumanAvatarAdapter(runtime())
    await adapter.start_session()
    yielded = [f async for f in adapter.frames()]

    assert len(yielded) == 1
    assert yielded[0].height == 4
    assert yielded[0].width == 8
    assert adapter.first_frame_ms is not None


async def test_frames_wraps_a_mid_stream_sdk_error_as_avatar_unavailable(monkeypatch) -> None:
    async def _failing_run(*_a, **_k):
        if False:
            yield  # pragma: no cover - makes this an async generator
        raise BithumanError("stream crashed")

    fake_client = make_fake_client([])
    fake_client.run = _failing_run
    monkeypatch.setattr(bithuman_module.AsyncBithuman, "create", AsyncMock(return_value=fake_client))

    adapter = BithumanAvatarAdapter(runtime())
    await adapter.start_session()
    with pytest.raises(AvatarError) as exc_info:
        async for _ in adapter.frames():
            pass
    assert exc_info.value.code == "AVATAR_UNAVAILABLE"


async def test_close_stops_the_client_and_is_idempotent(monkeypatch) -> None:
    fake_client = make_fake_client([])
    monkeypatch.setattr(bithuman_module.AsyncBithuman, "create", AsyncMock(return_value=fake_client))

    adapter = BithumanAvatarAdapter(runtime())
    await adapter.start_session()
    await adapter.close()
    await adapter.close()  # must not raise a second time

    fake_client.stop.assert_called_once()


def test_resolves_model_path_without_a_file_scheme() -> None:
    rt = ProviderRuntime(
        logical_key="avatar.bithuman", endpoint_url="/models/acme", api_key="bh-key", model=None, extra={"avatar_id": "a1"}
    )
    adapter = BithumanAvatarAdapter(rt)
    assert adapter._model_path == "/models/acme/a1.imx"


def test_rejects_a_path_traversal_avatar_id() -> None:
    """`avatar_id` is tenant-operator-controlled, not raw end-user input,
    but it still ends up in a filesystem path -- defense in depth against
    a compromised/misconfigured operator account escaping the model
    directory.
    """
    with pytest.raises(AvatarError) as exc_info:
        BithumanAvatarAdapter(runtime(avatar_id="../../etc/passwd"))
    assert exc_info.value.code == "AVATAR_NOT_FOUND"


def test_resolves_model_path_with_a_default_directory_when_endpoint_url_is_absent() -> None:
    rt = ProviderRuntime(
        logical_key="avatar.bithuman", endpoint_url=None, api_key="bh-key", model=None, extra={"avatar_id": "a1"}
    )
    adapter = BithumanAvatarAdapter(rt)
    assert adapter._model_path == "./avatars/a1.imx"
