"""`ITransportProvider` implementation over `livekit`/`livekit-agents`.

The only file in `adapters/` wrapping the LiveKit SDKs — mirrors the
control-plane's own isolation rule (`livekit-server-sdk` confined to
`apps/api/src/modules/transport/infrastructure`), so the same vendor SDK is
never imported from two different "only one place" zones across the two
languages.
"""

from __future__ import annotations

import time

from livekit import rtc

from avatar_agent.ports.avatar import VideoFrame

# 24kHz mono 16-bit PCM — the sample rate every current TTS adapter
# (`fish_speech.py`/`elevenlabs.py`) streams at; `push_audio_frame` assumes
# it rather than re-deriving it per call, matching how `entrypoint.py`
# already hardcodes `_STT_SAMPLE_RATE_HZ` for the inbound direction.
_TTS_SAMPLE_RATE_HZ = 24000


class LiveKitTransportAdapter:
    """`ITransportProvider` implementation wrapping a joined `rtc.Room`."""

    key = "livekit"

    def __init__(self, room: rtc.Room) -> None:
        self._room = room
        self._audio_source: rtc.AudioSource | None = None
        self._audio_track: rtc.LocalAudioTrack | None = None
        self._video_source: rtc.VideoSource | None = None
        self._video_track: rtc.LocalVideoTrack | None = None

    async def publish_audio_track(self, track_id: str) -> None:
        """@inheritdoc — idempotent: a session publishes exactly one TTS
        audio track for its whole lifetime; a second call (e.g. from a
        later utterance) is a no-op rather than publishing a duplicate
        track.
        """
        if self._audio_track is not None:
            return
        self._audio_source = rtc.AudioSource(sample_rate=_TTS_SAMPLE_RATE_HZ, num_channels=1)
        self._audio_track = rtc.LocalAudioTrack.create_audio_track(track_id, self._audio_source)
        options = rtc.TrackPublishOptions(source=rtc.TrackSource.SOURCE_MICROPHONE)
        await self._room.local_participant.publish_track(self._audio_track, options)

    async def push_audio_frame(self, pcm: bytes) -> None:
        """@inheritdoc"""
        if self._audio_source is None:
            return
        frame = rtc.AudioFrame(
            data=pcm,
            sample_rate=_TTS_SAMPLE_RATE_HZ,
            num_channels=1,
            samples_per_channel=len(pcm) // 2,  # 16-bit samples -> 2 bytes each
        )
        await self._audio_source.capture_frame(frame)

    async def publish_video_track(self, track_id: str, *, width: int, height: int) -> None:
        """@inheritdoc — idempotent for the same reason as
        `publish_audio_track`.
        """
        if self._video_track is not None:
            return
        self._video_source = rtc.VideoSource(width, height)
        self._video_track = rtc.LocalVideoTrack.create_video_track(track_id, self._video_source)
        options = rtc.TrackPublishOptions(source=rtc.TrackSource.SOURCE_CAMERA)
        await self._room.local_participant.publish_track(self._video_track, options)

    async def push_video_frame(self, frame: VideoFrame) -> None:
        """@inheritdoc — `VideoFrame.data` is assumed RGB24 (see that
        dataclass's own docstring for why), matching `rtc.VideoBufferType.
        RGB24` directly with no conversion.
        """
        if self._video_source is None:
            return
        video_frame = rtc.VideoFrame(frame.width, frame.height, rtc.VideoBufferType.RGB24, frame.data)
        self._video_source.capture_frame(video_frame)

    async def unpublish_video_track(self) -> None:
        """@inheritdoc — FR-AVATAR-5's degrade-to-audio-only path: removes
        only the video track, never touches the audio track or the room
        membership itself.
        """
        if self._video_track is None:
            return
        await self._room.local_participant.unpublish_track(self._video_track.sid)
        self._video_track = None
        self._video_source = None

    async def publish_transcription(
        self,
        *,
        participant_identity: str,
        track_sid: str,
        segment_id: str,
        text: str,
        final: bool,
    ) -> None:
        """@inheritdoc — the fix for QA phase4-agent-python D-1 /
        phase4-conversation-captions D-1: this method never existed before,
        so `RoomEvent.TranscriptionReceived` (the frontend's caption source,
        `LiveKitRoomService`) could never fire in any real deployment.

        A single-segment timestamp (`start_time == end_time`, current wall
        clock) is used rather than word-level timing — none of the STT
        adapters (`deepgram.py`/`faster_whisper.py`) expose per-word
        timestamps today, only utterance-level partial/final text.
        """
        now_ms = int(time.time() * 1000)
        segment = rtc.TranscriptionSegment(
            id=segment_id,
            text=text,
            start_time=now_ms,
            end_time=now_ms,
            language="",
            final=final,
        )
        transcription = rtc.Transcription(
            participant_identity=participant_identity,
            track_sid=track_sid,
            segments=[segment],
        )
        await self._room.local_participant.publish_transcription(transcription)

    async def close(self) -> None:
        """Leaves the room."""
        await self._room.disconnect()
