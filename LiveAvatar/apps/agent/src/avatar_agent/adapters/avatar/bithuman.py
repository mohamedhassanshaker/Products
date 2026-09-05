"""bitHuman vendor adapter — self-hosted, production default (FR-AVATAR-1,
factory key `bithuman`).

Verified against the real, installed `bithuman==1.10.7` package (`pip show
bithuman` in this sandbox) — not guessed from documentation alone:
`AsyncBithuman.create(model_path=..., api_secret=...)` builds a streaming
session, `push_audio(data, sample_rate, last_chunk)` feeds PCM in,
`flush()` marks end-of-speech, `run()` is an async generator of
`VideoFrame`s (`.rgb_image`, `.has_image`), and `stop()` tears the session
down. Disclosed limitation (same class of gap already accepted for every
other vendor SDK in this project — Deepgram, `livekit-server-sdk`, etc.):
this adapter is implemented against that installed package's real,
introspected API surface, but has never run against a real `.imx` model
file or bitHuman's licensing backend in this sandbox (no GPU, no model
asset, no network egress to `api.bithuman.ai` here) — flagged for a
GPU-capable environment to smoke-test before production sign-off.
"""

from __future__ import annotations

import asyncio
import re
import time
from collections.abc import AsyncIterator

from bithuman import AsyncBithuman
from bithuman.exceptions import BithumanError, ModelNotFoundError

from avatar_agent.ports.avatar import AvatarError, VideoFrame
from avatar_agent.ports.runtime import ProviderRuntime

# `avatar_id` is tenant-operator-controlled (`AgentConfig.avatar.avatar_id`,
# Agent Builder Phase 2 — not raw end-user input), but it still ends up in a
# filesystem path (`_resolve_model_path`) — defense in depth against a
# compromised/misconfigured operator account escaping the model directory
# (e.g. `../../etc/passwd`) rather than trusting the control plane's own
# `min_length=1, max_length=128` bound to be the only guard.
_SAFE_AVATAR_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]+$")


def _resolve_model_path(runtime: ProviderRuntime, avatar_id: str) -> str:
    """Resolves the local `.imx` model file bitHuman's SDK loads for
    `avatar_id` (FR-AVATAR-1).

    Self-hosted per ADR-001, like Fish Speech/faster-whisper — but unlike
    those HTTP-based adapters, the installed `bithuman` SDK loads a model
    **file** directly (`AsyncBithuman.create(model_path=...)`), with no
    network call at render time. This dispatch's own reversible, locally
    scoped assumption (the catalog/LLD don't specify bitHuman's exact
    asset-addressing scheme, and there's no reference deployment to check
    against yet): the operator-configured `ProviderCredential.endpoint_url`
    is treated as the base directory the tenant's avatar model files live
    in (a bare filesystem path or a `file://` URL, both accepted), joined
    with `{avatar_id}.imx`.

    @raises AvatarError: `code="AVATAR_NOT_FOUND"` if `avatar_id` isn't a
        bare alphanumeric/`-`/`_` token — rejects path traversal
        (`../`, absolute paths, null bytes) before it ever reaches a
        filesystem call.
    """
    if not _SAFE_AVATAR_ID_PATTERN.match(avatar_id):
        raise AvatarError(f"Avatar '{avatar_id}' is not available on bitHuman.", code="AVATAR_NOT_FOUND")
    base = runtime.endpoint_url or "./avatars"
    if base.startswith("file://"):
        base = base[len("file://") :]
    return f"{base.rstrip('/')}/{avatar_id}.imx"


class BithumanAvatarAdapter:
    """`IAvatarProvider` implementation over the `bithuman` SDK's async
    streaming runtime (`AsyncBithuman`).
    """

    key = "bithuman"

    def __init__(self, runtime: ProviderRuntime) -> None:
        if not runtime.api_key:
            raise AvatarError("bitHuman credential is not configured.", code="AVATAR_UNAVAILABLE")
        avatar_id = runtime.extra.get("avatar_id")
        if not avatar_id:
            raise AvatarError("Avatar id is not configured.", code="AVATAR_NOT_FOUND")
        self._avatar_id = str(avatar_id)
        self._model_path = _resolve_model_path(runtime, self._avatar_id)
        self._api_secret = runtime.api_key
        # `AsyncBithuman.create` has no timeout of its own (confirmed live:
        # it can hang indefinitely — no exception, no log line — evidently
        # on a license/network check against `api.bithuman.ai`, this
        # module's own disclosed-but-until-now-never-exercised "no network
        # egress to api.bithuman.ai here" gap). Bounding it at the same
        # `request_ms` every other adapter already applies to its own
        # vendor call is what turns "the caller waits forever" into a
        # normal `AvatarError("AVATAR_UNAVAILABLE")` FR-AVATAR-5 already
        # knows how to degrade from.
        self._start_timeout_s = runtime.timeouts.request_ms / 1000
        self._client: AsyncBithuman | None = None
        self._session_started_at: float | None = None
        self._first_frame_ms: int | None = None

    async def start_session(self) -> None:
        """@inheritdoc"""
        self._first_frame_ms = None
        self._session_started_at = time.monotonic()
        try:
            self._client = await asyncio.wait_for(
                AsyncBithuman.create(model_path=self._model_path, api_secret=self._api_secret),
                timeout=self._start_timeout_s,
            )
        except ModelNotFoundError as err:
            raise AvatarError(f"Avatar '{self._avatar_id}' is not available on bitHuman.", code="AVATAR_NOT_FOUND") from err
        except BithumanError as err:
            raise AvatarError("bitHuman avatar runtime is unavailable.", code="AVATAR_UNAVAILABLE") from err
        except TimeoutError as err:
            raise AvatarError("bitHuman avatar runtime is unavailable.", code="AVATAR_UNAVAILABLE") from err

    async def push_audio_frame(self, pcm: bytes) -> None:
        """@inheritdoc — PCM16 mono @24kHz, the same TTS output shape
        `LiveKitTransportAdapter.push_audio_frame` publishes (FR-AVATAR-3:
        switching TTS provider must not require an avatar code change, so
        this makes no vendor-specific assumption beyond that shared shape).
        """
        if self._client is None:
            raise AvatarError("Avatar session was not started.", code="AVATAR_UNAVAILABLE")
        try:
            # `last_chunk=False`: this is one chunk of an in-progress
            # utterance, not its end — `flush()` (below) marks the
            # boundary explicitly, mirroring the SDK's own two-step
            # "stream chunks, then flush" contract rather than guessing an
            # end from chunk size/timing.
            await self._client.push_audio(pcm, sample_rate=24000, last_chunk=False)
        except BithumanError as err:
            raise AvatarError("bitHuman avatar runtime is unavailable.", code="AVATAR_UNAVAILABLE") from err

    async def flush(self) -> None:
        """@inheritdoc"""
        if self._client is None:
            return
        await self._client.flush()

    async def frames(self) -> AsyncIterator[VideoFrame]:
        """@inheritdoc"""
        if self._client is None:
            raise AvatarError("Avatar session was not started.", code="AVATAR_UNAVAILABLE")
        started = self._session_started_at or time.monotonic()
        try:
            async for frame in self._client.run():
                if not frame.has_image:
                    continue
                if self._first_frame_ms is None:
                    self._first_frame_ms = int((time.monotonic() - started) * 1000)
                image = frame.rgb_image
                height, width = image.shape[0], image.shape[1]
                yield VideoFrame(data=image.tobytes(), width=width, height=height)
        except BithumanError as err:
            raise AvatarError("bitHuman avatar stream failed.", code="AVATAR_UNAVAILABLE") from err

    async def close(self) -> None:
        """@inheritdoc"""
        if self._client is not None:
            await self._client.stop()
            self._client = None

    @property
    def first_frame_ms(self) -> int | None:
        """@inheritdoc"""
        return self._first_frame_ms
