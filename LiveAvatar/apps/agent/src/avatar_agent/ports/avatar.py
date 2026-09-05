"""`IAvatarProvider` — avatar rendering port (FR-AVATAR-1..5).

Phase 4 (BL-013..017) shipped this port as a stub — `resolve_avatar` always
raised `FactoryLoadError` so the STT->LLM->TTS loop could be proven
end-to-end without inventing an avatar implementation ahead of its own
backlog phase. Phase 5 (BL-018) is this port's first real implementer
(`adapters/avatar/bithuman.py`) and, in doing so, settles the exact method
shape the Phase 4 stub left provisional (its own docstring said as much) —
BL-019's Alibaba LiveAvatar adapter (Phase 6) implements this same contract,
so getting the shape right here matters.

Design note (this phase's own reversible decision, not an LLD mandate): the
adapter never touches LiveKit directly — it only ever sees raw PCM audio in
and raw video frames out, mirroring how `ITTSProvider`/`ISTTProvider` stay
vendor-agnostic of the transport. `ITransportProvider` (the one file allowed
to import the LiveKit SDK) owns turning `VideoFrame`s into a published
LiveKit video track. This keeps the vendor-SDK-isolation contract intact
even though two different vendor SDKs (`livekit`, `bithuman`) are both
involved in getting one utterance's video onto the wire.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Protocol


class AvatarError(Exception):
    """Raised on avatar start/stream failure.

    `code="AVATAR_NOT_FOUND"` (FR-AVATAR-1) means the configured
    `avatar_id` is unknown to the provider — a config error, not a runtime
    hiccup, so callers treat it as fatal to job start (mirroring
    `STT_UNAVAILABLE`'s "required, no session without it" treatment) rather
    than the retry-then-degrade path FR-AVATAR-5 defines for every other
    avatar failure (`code="AVATAR_UNAVAILABLE"`, the default).
    """

    def __init__(self, message: str, *, code: str = "AVATAR_UNAVAILABLE") -> None:
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class VideoFrame:
    """One rendered avatar video frame (FR-AVATAR-3).

    Raw RGB24 pixel bytes at a fixed size — `ITransportProvider.
    publish_video_track`/`push_video_frame` wrap this into an
    `rtc.VideoFrame(..., rtc.VideoBufferType.RGB24, ...)` without any
    adapter-specific pixel-format branching in the transport layer. RGB24
    is what the installed `bithuman==1.10.7` SDK's `VideoFrame.rgb_image`
    already produces and is also a `livekit.rtc.VideoBufferType` member
    directly — chosen to avoid a per-frame color-space conversion on the
    hot path.
    """

    data: bytes
    width: int
    height: int


class IAvatarProvider(Protocol):
    """Avatar rendering port, driven by TTS audio (FR-AVATAR-3)."""

    key: str

    async def start_session(self) -> None:
        """Opens the rendering session for this instance's configured
        `avatar_id` (resolved by the registry at construction time, not
        passed here — mirrors how every other adapter receives its
        identity via `ProviderRuntime` at construction, not per-call).

        @raises AvatarError: `code="AVATAR_NOT_FOUND"` if `avatar_id` is
            unknown to the provider (FR-AVATAR-1); any other code for an
            infra-level start failure (FR-AVATAR-5's retry-then-degrade
            path, decided by the caller, not this method).
        """
        ...

    async def push_audio_frame(self, pcm: bytes) -> None:
        """Feeds one chunk of TTS PCM audio driving lip-sync (FR-AVATAR-3).
        Must only be called after `start_session()` has succeeded.
        """
        ...

    async def flush(self) -> None:
        """Marks end-of-speech for the current utterance so the avatar can
        return to its idle motion between turns (FR-AGENT-1's "no user
        utterance -> idle avatar", mirrored on the avatar's own speaking/
        idle boundary).
        """
        ...

    def frames(self) -> AsyncIterator[VideoFrame]:
        """Yields rendered video frames as they become available. Declared
        as a plain (not `async`) method returning `AsyncIterator` — see
        `ISTTProvider.transcribe_stream`'s docstring for why (an async
        generator function satisfies this without ever being awaited
        itself, only iterated).
        """
        ...

    async def close(self) -> None:
        """Stops rendering and releases the runtime session's resources."""
        ...

    @property
    def first_frame_ms(self) -> int | None:
        """Latency of the most recent session's first video frame, if measured (FR-AVATAR-4)."""
        ...
