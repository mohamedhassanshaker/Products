"""Unit tests for the faster-whisper STT adapter, mocking `WhisperModel`."""

from __future__ import annotations

from unittest.mock import patch

import pytest

from avatar_agent.ports.runtime import ProviderRuntime
from avatar_agent.ports.stt import SttError


def runtime() -> ProviderRuntime:
    return ProviderRuntime(
        logical_key="stt.faster-whisper", endpoint_url=None, api_key=None, model="base", extra={"language": "en-US"}
    )


class FakeSegment:
    def __init__(self, text: str) -> None:
        self.text = text


async def audio_frames(frames: list[bytes]):
    for f in frames:
        yield f


def test_constructor_wraps_a_model_load_failure_as_stt_unavailable() -> None:
    with patch("avatar_agent.adapters.stt.faster_whisper.WhisperModel", side_effect=RuntimeError("model not found")):
        from avatar_agent.adapters.stt.faster_whisper import FasterWhisperSttAdapter

        with pytest.raises(SttError) as exc_info:
            FasterWhisperSttAdapter(runtime())
        assert exc_info.value.code == "STT_UNAVAILABLE"


async def test_emits_a_partial_after_enough_audio_then_a_final_at_endpoint() -> None:
    with patch("avatar_agent.adapters.stt.faster_whisper.WhisperModel") as MockModel:
        instance = MockModel.return_value
        instance.transcribe.return_value = ([FakeSegment("hello ")], object())
        from avatar_agent.adapters.stt.faster_whisper import _CHUNK_BYTES, FasterWhisperSttAdapter

        adapter = FasterWhisperSttAdapter(runtime())
        big_chunk = b"\x00\x00" * (_CHUNK_BYTES // 2)  # exactly one chunk boundary worth of int16 samples

        events = [e async for e in adapter.transcribe_stream(audio_frames([big_chunk]))]

        kinds = [e["kind"] for e in events]
        assert "partial" in kinds
        assert kinds[-1] == "final"
        assert adapter.first_partial_ms is not None


async def test_zero_length_final_is_still_yielded_for_the_caller_to_drop() -> None:
    with patch("avatar_agent.adapters.stt.faster_whisper.WhisperModel") as MockModel:
        instance = MockModel.return_value
        instance.transcribe.return_value = ([], object())
        from avatar_agent.adapters.stt.faster_whisper import FasterWhisperSttAdapter

        adapter = FasterWhisperSttAdapter(runtime())
        events = [e async for e in adapter.transcribe_stream(audio_frames([]))]
        assert events == [{"kind": "final", "text": ""}]
