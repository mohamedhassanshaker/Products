"""INDEPENDENT QA verification test (qa-results/phase4-agent-python retry #1).

Not part of the shipped test suite - written by nexus-qa to independently
re-verify D-1 (STT wiring) end-to-end through the REAL handle_job entrypoint
(not just ConversationPipeline in isolation, and not with run_stt_loop
itself mocked out the way the dev's own test_handle_job_... test does).

Chain actually exercised: handle_job -> track_subscribed handler ->
_pump_track_audio -> ConversationPipeline.run_stt_loop -> STT partial/final ->
publish_transcription -> on_final_utterance -> queue -> run_consumer_loop ->
_process_utterance -> residency.build_payload -> orchestrator.run_turn ->
LLM stream -> TTS synth -> hops sent for stt/llm/tts.
"""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock

import pytest

import avatar_agent.entrypoint as entrypoint_module
from avatar_agent.entrypoint import handle_job
from avatar_agent.contracts.runtime_config import AgentRuntimeConfig
from avatar_agent.orchestration.failover import FailoverResult
from avatar_agent.ports.stt import SttEvent
from avatar_agent.settings import Settings

QA_SESSION_ID = "99999999-9999-9999-9999-999999999999"
QA_TENANT_ID = "88888888-8888-8888-8888-888888888888"


def _qa_cfg(**overrides):
    base = {
        "version": 1,
        "deployment": {"tenant_id": QA_TENANT_ID, "name": "qa-retry1-tenant"},
        "transport": {"provider": "livekit", "room_namespace": "qa-retry1"},
        "stt": {"provider": "deepgram", "credential_ref": "secrets/deepgram", "language": "en-US"},
        "llm": {
            "primary": {"provider": "openai", "credential_ref": "secrets/openai", "model": "gpt-4o"},
            "retry": {"max_attempts": 3, "backoff_ms": [200, 400, 800]},
        },
        "tts": {"provider": "fish-speech", "credential_ref": "secrets/fish-speech", "voice_id": "qa-voice"},
        "avatar": {"provider": "bithuman", "credential_ref": "secrets/bithuman", "avatar_id": "a1"},
        "agent": {
            "runtime": "langgraph",
            "system_prompt": "You are a QA fixture assistant.",
            "tools": [],
            "memory": {"enabled": True, "window_turns": 8},
            "rag": {"enabled": False},
        },
        "privacy": {"send_to_remote_llm": "prompt_text_only", "retain_transcripts_days": 30, "recordings_enabled": False},
        "alerts": {"degraded_mode_message": "QA degraded fixture message."},
        "session_id": QA_SESSION_ID,
        "room_name": "qa-retry1_s1",
        "endpoints": {
            "deepgram": "https://stt.qa-fixture.example.com",
            "openai": "https://api.qa-fixture.example.com",
            "fish-speech": "https://tts.qa-fixture.example.com",
        },
    }
    base.update(overrides)
    return AgentRuntimeConfig.model_validate(base)


def _qa_settings(tmp_path):
    (tmp_path / "secrets").mkdir()
    for name, value in [
        ("secrets/deepgram", "qa-dg-key"),
        ("secrets/openai", "qa-sk-key"),
        ("secrets/fish-speech", "qa-fs-key"),
    ]:
        (tmp_path / name).write_text(value, encoding="utf-8")
    return Settings(secrets_dir=str(tmp_path))


class QaFakeStt:
    key = "deepgram"

    def __init__(self):
        self.first_partial_ms = 77

    async def transcribe_stream(self, audio_pcm):
        chunks_seen = 0
        async for _chunk in audio_pcm:
            chunks_seen += 1
        assert chunks_seen == 3, "expected _pump_track_audio to forward all 3 fake frames"
        yield SttEvent(kind="partial", text="testing one two")
        yield SttEvent(kind="final", text="testing one two three")


class QaFakeLlm:
    key = "openai"


class QaFakeOrchestrator:
    def __init__(self):
        self.calls = 0

    async def run_turn(self, primary, fallback, retry, tools, residency):
        self.calls += 1
        assert any("testing one two three" in m["content"] for m in residency.messages)

        async def _gen():
            yield {"delta": "QA reply chunk one. ", "done": False}
            yield {"delta": "QA reply chunk two.", "done": False}
            yield {"delta": "", "done": True, "tool_calls": []}

        return FailoverResult(stream=_gen(), provider_key="openai", used_fallback=False)


class QaFakeTts:
    key = "fish-speech"

    def __init__(self):
        self._first_audio_ms = 33

    async def synthesize_stream(self, text, voice_id):
        assert text == "QA reply chunk one. QA reply chunk two."
        assert voice_id == "qa-voice"
        yield b"qa-audio-frame-1"
        yield b"qa-audio-frame-2"

    @property
    def first_audio_ms(self):
        return self._first_audio_ms


class QaFakeControlPlane:
    def __init__(self):
        self.events = []
        self.utterances = []
        self.hops = []
        self.alerts = []

    async def get_runtime_config(self, session_id):
        raise AssertionError("should be monkeypatched away in handle_job before this could be called")

    async def send_event(self, session_id, event):
        self.events.append((session_id, event))

    async def send_utterances(self, session_id, items):
        self.utterances.append((session_id, items))

    async def send_hops(self, session_id, items):
        self.hops.append((session_id, items))

    async def send_alert(self, request):
        self.alerts.append(request)


class QaFakeAudioStream:
    def __init__(self, track, sample_rate=None, num_channels=None):
        self._frames = [b"\x00\x01" * 8, b"\x02\x03" * 8, b"\x04\x05" * 8]

    def __aiter__(self):
        return self._gen()

    async def _gen(self):
        for raw in self._frames:
            frame = type("Frame", (), {"data": raw})()
            yield type("Event", (), {"frame": frame})()


class QaFakeRoom:
    def __init__(self):
        self._handlers = {}
        self.loop = MagicMock()
        # A real LiveKit JobContext.room.loop is the actual running asyncio
        # event loop - create_task genuinely schedules run_consumer_loop as
        # a live task. asyncio.ensure_future here (not a no-op stand-in)
        # is what lets this test prove the consumer loop really drains the
        # queue and reaches the LLM/TTS half, not just that it was called.
        self.loop.create_task = lambda coro: asyncio.ensure_future(coro)
        self.local_participant = MagicMock()
        self.local_participant.publish_transcription = AsyncMock()
        self.local_participant.publish_track = AsyncMock()
        # A real JobContext.room stays connected until the call ends - give
        # handle_job a genuine pending future to await (instead of the
        # "no disconnected attribute -> None" short-circuit path the dev's
        # own FakeRoom relies on), so its background stt/consumer tasks get
        # real turns of the event loop to actually process before handle_job
        # tears them down in its finally block.
        self.disconnected = asyncio.get_event_loop().create_future()

    def on(self, event, callback=None):
        self._handlers[event] = callback
        return callback

    def fire_track_subscribed(self, track, publication, participant):
        self._handlers["track_subscribed"](track, publication, participant)


class _QaNoopTask:
    def __init__(self, coro):
        coro.close()

    def cancel(self):
        pass


class QaFakeJobContext:
    def __init__(self, room, session_id):
        self.room = room
        self.job = type("Job", (), {"metadata": "{\"session_id\": \"%s\"}" % session_id})()
        self.connect = AsyncMock()


async def test_qa_independent_real_pipeline_full_audio_to_speech_trace(tmp_path, monkeypatch):
    cfg = _qa_cfg()
    settings = _qa_settings(tmp_path)
    control_plane = QaFakeControlPlane()

    monkeypatch.setattr(entrypoint_module, "resolve_stt", lambda cfg, secrets: QaFakeStt())
    monkeypatch.setattr(entrypoint_module, "resolve_llm", lambda cfg, role, secrets: QaFakeLlm())
    monkeypatch.setattr(entrypoint_module, "resolve_tts", lambda cfg, secrets: QaFakeTts())
    qa_orchestrator = QaFakeOrchestrator()
    monkeypatch.setattr(entrypoint_module, "LangGraphOrchestrator", lambda: qa_orchestrator)

    monkeypatch.setattr(entrypoint_module, "ControlPlaneClient", lambda *a, **k: control_plane)
    monkeypatch.setattr(entrypoint_module, "load_settings", lambda: settings)
    control_plane.get_runtime_config = AsyncMock(return_value=cfg)

    monkeypatch.setattr(entrypoint_module.rtc, "AudioStream", QaFakeAudioStream)

    room = QaFakeRoom()
    ctx = QaFakeJobContext(room, QA_SESSION_ID)

    from livekit import rtc as real_rtc

    audio_track = type("Track", (), {"kind": real_rtc.TrackKind.KIND_AUDIO})()
    publication = type("Pub", (), {"sid": "QA_TRACK_1"})()
    participant = type("Participant", (), {"identity": "qa-caller"})()

    job_task = asyncio.ensure_future(handle_job(ctx))
    await asyncio.sleep(0)
    room.fire_track_subscribed(audio_track, publication, participant)

    for _ in range(200):
        await asyncio.sleep(0)
        hop_names = {item.hop for _sid, items in control_plane.hops for item in items}
        if {"stt", "llm", "tts"} <= hop_names:
            break
    job_task.cancel()
    try:
        await job_task
    except asyncio.CancelledError:
        pass

    assert qa_orchestrator.calls == 1, "the real orchestrator was invoked exactly once via the real pipeline"

    hop_by_name = {item.hop: item for _sid, items in control_plane.hops for item in items}
    assert hop_by_name["stt"].first_partial_ms == 77
    assert hop_by_name["llm"].provider_key == "openai"
    assert hop_by_name["tts"].provider_key == "fish-speech"
    assert hop_by_name["tts"].first_audio_ms is not None  # measured wall-clock latency, not a fixed fixture value

    utterances = [item for _sid, items in control_plane.utterances for item in items]
    assert any(u.role == "user" and u.text == "testing one two three" for u in utterances)
    assert any(u.role == "assistant" and u.text == "QA reply chunk one. QA reply chunk two." for u in utterances)


async def test_qa_d4_residency_blocked_error_genuinely_degrades_the_session(monkeypatch) -> None:
    """Independent QA check for D-4: confirms `ResidencyBlockedError` (raised
    by `residency.filter.build_payload` when `residency_mode == "none"`) is
    genuinely caught by `ConversationPipeline._process_utterance`'s new
    handler and degrades the session visibly - not merely present in code
    with zero test coverage (pytest --cov confirms lines 224-234 of
    pipeline.py, the except-block itself, are NOT covered by any test the
    dev shipped).
    """
    import sys

    sys.path.insert(0, str((__file__.rsplit("qa_retry1", 1)[0] + "orchestration")))
    from test_pipeline import make_pipeline  # dev's own fixture factory, reused deliberately here

    pipeline, cp, orch, tts = make_pipeline(residency_mode="none")
    await pipeline._process_utterance(1, "hello")

    # The turn must degrade visibly, not silently vanish.
    assert any(e.type == "degraded" for _sid, e in cp.events)
    assert any(a.type == "llm_failover" for a in cp.alerts)
    llm_hops = [item for _sid, items in cp.hops for item in items if item.hop == "llm"]
    assert llm_hops and llm_hops[0].error_code == "LLM_UNAVAILABLE"
    # Confirms the orchestrator/LLM was never reached at all (the block
    # returns before `run_turn` is called) - this is a residency-policy
    # short-circuit, not a downstream LLM failure being misreported as one.
    assert orch.calls == 0
