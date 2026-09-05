"""Unit tests for `LiveKitTransportAdapter`, mocking the `livekit.rtc` SDK boundary.

QA regression (phase4-agent-python D-1 / phase4-conversation-captions D-1):
`publish_transcription` did not exist before this fix, so
`RoomEvent.TranscriptionReceived` could never fire client-side. These tests
prove the adapter builds and publishes the exact `rtc.Transcription` shape
the frontend's listener depends on.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

from avatar_agent.adapters.transport.livekit import LiveKitTransportAdapter
from avatar_agent.ports.avatar import VideoFrame


def make_room() -> MagicMock:
    room = MagicMock()
    room.local_participant.publish_transcription = AsyncMock()
    room.local_participant.publish_track = AsyncMock()
    room.local_participant.unpublish_track = AsyncMock()
    room.disconnect = AsyncMock()
    return room


async def test_publish_transcription_builds_and_publishes_a_single_segment_transcription() -> None:
    room = make_room()
    adapter = LiveKitTransportAdapter(room)

    await adapter.publish_transcription(
        participant_identity="caller-1",
        track_sid="TR_abc",
        segment_id="seg-1",
        text="hello there",
        final=False,
    )

    room.local_participant.publish_transcription.assert_awaited_once()
    (transcription,), _kwargs = room.local_participant.publish_transcription.call_args
    assert transcription.participant_identity == "caller-1"
    assert transcription.track_sid == "TR_abc"
    assert len(transcription.segments) == 1
    segment = transcription.segments[0]
    assert segment.id == "seg-1"
    assert segment.text == "hello there"
    assert segment.final is False


async def test_publish_transcription_marks_the_final_segment() -> None:
    room = make_room()
    adapter = LiveKitTransportAdapter(room)

    await adapter.publish_transcription(
        participant_identity="caller-1",
        track_sid="TR_abc",
        segment_id="seg-1",
        text="hello there",
        final=True,
    )

    (transcription,), _kwargs = room.local_participant.publish_transcription.call_args
    assert transcription.segments[0].final is True


async def test_close_disconnects_the_room() -> None:
    room = make_room()
    adapter = LiveKitTransportAdapter(room)
    await adapter.close()
    room.disconnect.assert_awaited_once()


async def test_publish_audio_track_is_idempotent() -> None:
    """A session publishes exactly one TTS audio track (BL-018) — a second
    call (e.g. a later utterance) must not publish a duplicate track.
    """
    room = make_room()
    adapter = LiveKitTransportAdapter(room)
    await adapter.publish_audio_track("tts-audio")
    await adapter.publish_audio_track("tts-audio")
    room.local_participant.publish_track.assert_awaited_once()


async def test_push_audio_frame_is_a_no_op_before_publish_audio_track() -> None:
    room = make_room()
    adapter = LiveKitTransportAdapter(room)
    await adapter.push_audio_frame(b"\x00\x00" * 10)  # must not raise


async def test_push_audio_frame_captures_a_frame_on_the_published_source(monkeypatch) -> None:
    room = make_room()
    adapter = LiveKitTransportAdapter(room)
    await adapter.publish_audio_track("tts-audio")

    captured: list[object] = []
    adapter._audio_source.capture_frame = AsyncMock(side_effect=lambda f: captured.append(f))

    await adapter.push_audio_frame(b"\x00\x01" * 5)

    assert len(captured) == 1
    assert captured[0].samples_per_channel == 5
    assert captured[0].sample_rate == 24000


async def test_publish_video_track_is_idempotent() -> None:
    room = make_room()
    adapter = LiveKitTransportAdapter(room)
    await adapter.publish_video_track("avatar-video", width=4, height=8)
    await adapter.publish_video_track("avatar-video", width=4, height=8)
    room.local_participant.publish_track.assert_awaited_once()


async def test_push_video_frame_is_a_no_op_before_publish_video_track() -> None:
    room = make_room()
    adapter = LiveKitTransportAdapter(room)
    await adapter.push_video_frame(VideoFrame(data=b"\x00" * (4 * 8 * 3), width=4, height=8))  # must not raise


async def test_push_video_frame_captures_a_frame_on_the_published_source() -> None:
    room = make_room()
    adapter = LiveKitTransportAdapter(room)
    await adapter.publish_video_track("avatar-video", width=4, height=8)

    captured: list[object] = []
    adapter._video_source.capture_frame = MagicMock(side_effect=lambda f: captured.append(f))

    await adapter.push_video_frame(VideoFrame(data=b"\x00" * (4 * 8 * 3), width=4, height=8))

    assert len(captured) == 1
    assert captured[0].width == 4
    assert captured[0].height == 8


async def test_unpublish_video_track_is_a_no_op_when_none_published() -> None:
    room = make_room()
    adapter = LiveKitTransportAdapter(room)
    await adapter.unpublish_video_track()  # must not raise
    room.local_participant.unpublish_track.assert_not_awaited()


async def test_unpublish_video_track_removes_the_published_track() -> None:
    room = make_room()
    adapter = LiveKitTransportAdapter(room)
    await adapter.publish_video_track("avatar-video", width=2, height=2)

    await adapter.unpublish_video_track()

    room.local_participant.unpublish_track.assert_awaited_once()
    assert adapter._video_track is None
    assert adapter._video_source is None
