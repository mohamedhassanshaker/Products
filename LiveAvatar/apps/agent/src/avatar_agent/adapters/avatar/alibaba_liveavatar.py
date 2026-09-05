"""Alibaba LiveAvatar vendor adapter — remote/customer-hosted second avatar
adapter (FR-AVATAR-2, factory key `alibaba-liveavatar`). Example B's avatar
path; exists in v1 specifically to *prove* `IAvatarProvider` generalizes to a
genuinely different vendor, not to reach capability parity with bitHuman.

**Protocol assumption, disclosed (this dispatch's own reversible, locally
scoped choice — no publicly reachable Alibaba LiveAvatar SDK/API reference
could be verified from this sandbox, unlike bitHuman where the real installed
package was introspected directly):** ADR-001/LLD classify this vendor as
"remote / customer-hosted per vendor contract" with a "TTS audio + rendered
video round-trip" — the natural shape for that is a bidirectional streaming
session, so this adapter speaks a single WebSocket connection per session
(`ProviderCredential.endpoint_url` + `/v1/render/stream`, bearer-token auth
from the credential's secret), JSON text frames for control messages and raw
binary frames for audio-in/video-out, mirroring the "one connection per
avatar session, JSON control + binary media" shape essentially every
real-time rendering vendor (including bitHuman's own local streaming API)
converges on. If the real vendor contract turns out to differ, only this one
file needs to change — no other module depends on LiveAvatar's wire shape.
`websockets` (already an installed transitive dependency of `livekit-agents`)
is used directly here and nowhere else, keeping the vendor-SDK-isolation
boundary intact.

**Documented feature gap (FR-AVATAR-2, honest, not silently assumed away):**
this adapter implements exactly the same `IAvatarProvider` contract bitHuman
does — lip-sync-from-audio and a LiveKit-publishable video stream, both of
which FR-AVATAR-2 calls a **blocker**, not an accepted gap, so both are fully
implemented here. What genuinely differs and is *not* modeled in code at all
(there is no port hook for it, on either adapter) is idle-motion behavior,
camera-relative gaze, and custom avatar upload — those are cosmetic/product
capabilities outside `IAvatarProvider`'s scope, so this adapter has nothing
to fake or degrade for them; the gap is documented to the operator via the
`ProviderDefinition.feature_gaps` catalog field surfaced in the Agent Builder
UI (see `apps/api/prisma/seed.ts`), not invented as runtime behavior here.
"""

from __future__ import annotations

import json
import time
from collections.abc import AsyncIterator
from typing import Any

import websockets
from websockets.asyncio.client import ClientConnection
from websockets.exceptions import WebSocketException

from avatar_agent.ports.avatar import AvatarError, VideoFrame
from avatar_agent.ports.runtime import ProviderRuntime

# Same PCM16 mono 24kHz shape every other adapter shares (FR-AVATAR-3: no
# avatar-adapter-specific TTS format requirement).
_SAMPLE_RATE_HZ = 24000
_RENDER_STREAM_PATH = "/v1/render/stream"


def _stream_url(endpoint_url: str | None) -> str:
    """Resolves the WebSocket render-stream URL for the configured,
    customer-hosted LiveAvatar endpoint.

    @raises AvatarError: `code="AVATAR_UNAVAILABLE"` if no endpoint is
        configured at all — unlike bitHuman's local-file default, a remote
        vendor has no sensible built-in fallback host.
    """
    if not endpoint_url:
        raise AvatarError("LiveAvatar endpoint is not configured.", code="AVATAR_UNAVAILABLE")
    base = endpoint_url.rstrip("/")
    # `ws(s)://` is the only sensible scheme for a streaming session; accept
    # an operator-entered `http(s)://` base (the same field other providers'
    # `endpoint_url` uses) and translate it rather than rejecting it outright.
    if base.startswith("https://"):
        base = "wss://" + base[len("https://") :]
    elif base.startswith("http://"):
        base = "ws://" + base[len("http://") :]
    elif not (base.startswith("wss://") or base.startswith("ws://")):
        base = "wss://" + base
    return base + _RENDER_STREAM_PATH


class AlibabaLiveAvatarAdapter:
    """`IAvatarProvider` implementation over a WebSocket connection to a
    remote/customer-hosted Alibaba LiveAvatar render endpoint.
    """

    key = "alibaba-liveavatar"

    def __init__(self, runtime: ProviderRuntime) -> None:
        if not runtime.api_key:
            raise AvatarError("LiveAvatar credential is not configured.", code="AVATAR_UNAVAILABLE")
        avatar_id = runtime.extra.get("avatar_id")
        if not avatar_id:
            raise AvatarError("Avatar id is not configured.", code="AVATAR_NOT_FOUND")
        self._avatar_id = str(avatar_id)
        self._url = _stream_url(runtime.endpoint_url)
        self._api_key = runtime.api_key
        self._ws: ClientConnection | None = None
        self._session_started_at: float | None = None
        self._first_frame_ms: int | None = None

    async def start_session(self) -> None:
        """@inheritdoc

        Opens the WebSocket connection, sends the `session.start` control
        message identifying `avatar_id`, and awaits the vendor's first
        response before returning — mirrors bitHuman's `create()` being the
        single point where an unknown avatar surfaces as fatal
        (`AVATAR_NOT_FOUND`, FR-AVATAR-1) rather than only failing later on
        first audio push.
        """
        self._first_frame_ms = None
        self._session_started_at = time.monotonic()
        try:
            self._ws = await websockets.connect(self._url, additional_headers={"Authorization": f"Bearer {self._api_key}"})
            await self._ws.send(json.dumps({"type": "session.start", "avatar_id": self._avatar_id}))
            raw = await self._ws.recv()
        except WebSocketException as err:
            raise AvatarError("LiveAvatar render endpoint is unavailable.", code="AVATAR_UNAVAILABLE") from err
        except OSError as err:
            # Connection-level failure (DNS/refused/timeout) — same
            # "infra-level start failure" bucket bitHuman's `BithumanError`
            # branch maps to.
            raise AvatarError("LiveAvatar render endpoint is unreachable.", code="AVATAR_UNAVAILABLE") from err

        message = self._parse_control_message(raw)
        if message.get("type") == "error":
            self._raise_for_error_message(message)

    async def push_audio_frame(self, pcm: bytes) -> None:
        """@inheritdoc — sends one binary frame of raw PCM per chunk; the
        vendor session distinguishes audio-in binary frames from JSON
        control frames by websocket opcode alone (no envelope needed), the
        simplest framing that lets control and media share one connection.
        """
        if self._ws is None:
            raise AvatarError("Avatar session was not started.", code="AVATAR_UNAVAILABLE")
        try:
            await self._ws.send(pcm)
        except WebSocketException as err:
            raise AvatarError("LiveAvatar render endpoint is unavailable.", code="AVATAR_UNAVAILABLE") from err

    async def flush(self) -> None:
        """@inheritdoc"""
        if self._ws is None:
            return
        try:
            await self._ws.send(json.dumps({"type": "session.flush"}))
        except WebSocketException:
            # Flush is a best-effort end-of-utterance marker; a connection
            # that's already gone will surface on the next push/frames call
            # instead of here, mirroring bitHuman's own flush()-is-a-no-op-
            # once-torn-down behavior.
            pass

    async def frames(self) -> AsyncIterator[VideoFrame]:
        """@inheritdoc

        Consumes the same connection's incoming messages: a `frame.meta`
        JSON control message (`width`/`height`) immediately followed by one
        binary message carrying that frame's raw RGB24 pixel bytes. A
        `session.end` control message ends iteration cleanly; a mid-stream
        `error` control message or a dropped connection raises
        `AVATAR_UNAVAILABLE`, the same as bitHuman's mid-stream SDK-error
        mapping.
        """
        if self._ws is None:
            raise AvatarError("Avatar session was not started.", code="AVATAR_UNAVAILABLE")
        started = self._session_started_at or time.monotonic()
        pending_dims: tuple[int, int] | None = None
        try:
            async for raw in self._ws:
                if isinstance(raw, (bytes, bytearray)):
                    if pending_dims is None:
                        # A binary frame with no preceding `frame.meta` is a
                        # protocol violation, not a user-facing scenario —
                        # skip it rather than crash the whole stream over one
                        # malformed message.
                        continue
                    width, height = pending_dims
                    pending_dims = None
                    if self._first_frame_ms is None:
                        self._first_frame_ms = int((time.monotonic() - started) * 1000)
                    yield VideoFrame(data=bytes(raw), width=width, height=height)
                    continue
                message = self._parse_control_message(raw)
                msg_type = message.get("type")
                if msg_type == "frame.meta":
                    pending_dims = (int(message["width"]), int(message["height"]))
                elif msg_type == "session.end":
                    return
                elif msg_type == "error":
                    self._raise_for_error_message(message)
        except WebSocketException as err:
            raise AvatarError("LiveAvatar render stream failed.", code="AVATAR_UNAVAILABLE") from err

    async def close(self) -> None:
        """@inheritdoc — idempotent; best-effort `session.end` notice before
        closing the socket, since the vendor may want to free render
        resources promptly rather than waiting for a TCP-level timeout.
        """
        if self._ws is None:
            return
        ws, self._ws = self._ws, None
        try:
            await ws.send(json.dumps({"type": "session.end"}))
        except WebSocketException:
            pass
        finally:
            await ws.close()

    @property
    def first_frame_ms(self) -> int | None:
        """@inheritdoc"""
        return self._first_frame_ms

    @staticmethod
    def _parse_control_message(raw: Any) -> dict[str, Any]:
        """Parses a JSON control message; a non-JSON/non-dict text message is
        treated as an infra-level failure (`AVATAR_UNAVAILABLE`) rather than
        crashing on a `KeyError`/`JSONDecodeError` further down the call
        stack.
        """
        try:
            parsed = json.loads(raw)
        except (TypeError, ValueError) as err:
            raise AvatarError("LiveAvatar sent a malformed control message.", code="AVATAR_UNAVAILABLE") from err
        if not isinstance(parsed, dict):
            raise AvatarError("LiveAvatar sent a malformed control message.", code="AVATAR_UNAVAILABLE")
        return parsed

    @staticmethod
    def _raise_for_error_message(message: dict[str, Any]) -> None:
        """Maps a vendor `error` control message to `AvatarError` (FR-AVATAR-1).

        `code == "avatar_not_found"` is the one vendor error code treated as
        fatal-to-job-start (unknown `avatar_id`, discovered only by asking
        the vendor, exactly like bitHuman's `ModelNotFoundError`) — every
        other vendor error code collapses to the generic
        `AVATAR_UNAVAILABLE` FR-AVATAR-5 retry-then-degrade path.
        """
        vendor_code = str(message.get("code") or "")
        text = str(message.get("message") or "LiveAvatar render endpoint returned an error.")
        if vendor_code == "avatar_not_found":
            avatar_ref = message.get("avatar_id") or text
            raise AvatarError(f"Avatar '{avatar_ref}' is not available on LiveAvatar.", code="AVATAR_NOT_FOUND")
        raise AvatarError(text, code="AVATAR_UNAVAILABLE")
