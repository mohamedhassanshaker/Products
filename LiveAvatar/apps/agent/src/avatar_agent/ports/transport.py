"""`ITransportProvider` — the agent-side transport port.

The control plane (`apps/api/src/modules/transport`) owns room creation and
token issuance (LLD §8.3); the agent only ever *joins* a room LiveKit
Agents' own worker protocol already connected it to. This Protocol exists
for symmetry with the other four ports and to keep `orchestration` free of
a direct `livekit`/`livekit-agents` import — the room/session object is
handed to `entrypoint.py` by the worker framework itself.
"""

from __future__ import annotations

from typing import Protocol

from avatar_agent.ports.avatar import VideoFrame


class ITransportProvider(Protocol):
    """Agent-side room membership port."""

    key: str

    async def publish_audio_track(self, track_id: str) -> None:
        """Publishes a synthesized-audio (TTS) source track to the room.

        Idempotent for the lifetime of one adapter instance — a session
        publishes exactly one TTS audio track; repeated calls (one per
        utterance) are no-ops after the first so `push_audio_frame` always
        has a single, stable destination (FR-AVATAR-3's shared audio
        source between the caller's ears and the avatar's lip-sync input).
        """
        ...

    async def push_audio_frame(self, pcm: bytes) -> None:
        """Pushes one chunk of PCM16 mono @24kHz synthesized audio onto the
        track `publish_audio_track` already published. A no-op if
        `publish_audio_track` was never called (defensive — every real
        caller calls it first).
        """
        ...

    async def publish_video_track(self, track_id: str, *, width: int, height: int) -> None:
        """Publishes an avatar-rendered video source track (FR-AVATAR-1/3)
        at a fixed `width`/`height`. Idempotent for the same reason as
        `publish_audio_track` — a session publishes at most one avatar
        video track for its lifetime.
        """
        ...

    async def push_video_frame(self, frame: VideoFrame) -> None:
        """Pushes one rendered avatar video frame onto the track
        `publish_video_track` already published. A no-op if
        `publish_video_track` was never called.
        """
        ...

    async def unpublish_video_track(self) -> None:
        """Removes the avatar video track from the room without touching
        the audio track or leaving the room (FR-AVATAR-5's "degrade to
        audio-only" path) — the client's existing "no avatar track" banner
        (Phase 3) is exactly what this makes reappear, with no new
        frontend behavior required. A no-op if no video track is
        currently published.
        """
        ...

    async def publish_transcription(
        self,
        *,
        participant_identity: str,
        track_sid: str,
        segment_id: str,
        text: str,
        final: bool,
    ) -> None:
        """Publishes one STT partial/final onto the room's transcription
        channel (FR-CALL-3) — the JS SDK's `RoomEvent.TranscriptionReceived`
        listener decodes exactly this shape, live-captioning Screen 10.

        @param participant_identity: identity of the participant whose
            speech was transcribed (the human caller, not the agent).
        @param track_sid: sid of the subscribed audio track this segment
            transcribes.
        @param segment_id: stable id for this utterance's segment — the
            same id republished with `final=True` replaces the interim text
            client-side rather than appending a duplicate line.
        @param text: the partial or final transcript text.
        @param final: `True` once STT has endpointed this utterance.
        """
        ...

    async def close(self) -> None:
        """Leaves the room, releasing any held resources."""
        ...
