"""Unit tests for `ConversationPipeline` (FR-AGENT-1, LLD §9.2)."""

from __future__ import annotations

import asyncio
from uuid import UUID

from avatar_agent.contracts.runtime_config import InjectStage, ReasoningBlock, RetrievalPipelineConfig
from avatar_agent.contracts.structured import PostCallSummary
from avatar_agent.orchestration.failover import LlmUnavailableError
from avatar_agent.orchestration.memory import SessionMemory
from avatar_agent.orchestration.pipeline import ConversationPipeline
from avatar_agent.orchestration.tools import ToolDefinition, ToolExecutor
from avatar_agent.ports.avatar import AvatarError, VideoFrame
from avatar_agent.ports.llm import LlmError
from avatar_agent.ports.orchestration import GraphRunResult, ResolvedLlmNode
from avatar_agent.ports.stt import SttEvent
from avatar_agent.ports.tts import TtsError

SESSION_ID = UUID("11111111-1111-1111-1111-111111111111")
TENANT_ID = UUID("22222222-2222-2222-2222-222222222222")


class FakeKnowledgeSearchPort:
    async def search(self, request):  # noqa: ANN001
        raise NotImplementedError  # not exercised by these pipeline-level tests


class FakeKnowledgeGapPort:
    async def record_gap(self, **kwargs):  # noqa: ANN003
        raise NotImplementedError  # not exercised by these pipeline-level tests


def _default_knowledge_pipeline() -> RetrievalPipelineConfig:
    """A valid, retrieval-inert six-stage config for tests that never
    exercise a Retrieve node (`InjectStage.citation_format` has no schema
    default, mirroring the TS contract exactly, so a bare
    `RetrievalPipelineConfig()` is not constructible)."""
    return RetrievalPipelineConfig(inject=InjectStage(citation_format="none"))


class FakeControlPlane:
    def __init__(self) -> None:
        self.events: list[tuple] = []
        self.utterances: list[tuple] = []
        self.hops: list[tuple] = []
        self.alerts: list = []
        self.summaries: list[tuple] = []

    async def send_event(self, session_id, event):  # noqa: ANN001
        self.events.append((session_id, event))

    async def send_utterances(self, session_id, items):  # noqa: ANN001
        self.utterances.append((session_id, items))

    async def send_hops(self, session_id, items):  # noqa: ANN001
        self.hops.append((session_id, items))

    async def send_alert(self, request):  # noqa: ANN001
        self.alerts.append(request)

    async def send_summary(self, session_id, request):  # noqa: ANN001
        self.summaries.append((session_id, request))


class FakeOrchestrator:
    """`IOrchestrator` double (Phase 9, BL-036) — `run_turn(graph, ctx)`
    stands in for the real `GraphInterpreter`. It calls `ctx.speak(...)`
    itself for a non-empty reply, exactly like a real single-LLM-node graph's
    implicit "speak the last LLM output, then end" walk (`interpreter.py`) —
    this is what lets `_speak`/TTS-hop assertions below keep working even
    though `pipeline.py` itself no longer calls `_speak` directly. Tool-call
    round-trip behavior now lives entirely inside `nodes/llm.py` and is
    tested there (`tests/orchestration/graph/nodes/test_llm.py`), not here.
    """

    def __init__(
        self,
        stream_texts: list[str] | None = None,
        provider_key: str = "openai",
        used_fallback: bool = False,
        raises: bool = False,
        first_token_ms: int | None = 10,
    ) -> None:
        self._stream_texts = stream_texts if stream_texts is not None else ["hello"]
        self._provider_key = provider_key
        self._used_fallback = used_fallback
        self._raises = raises
        self._first_token_ms = first_token_ms
        self.calls = 0

    async def run_turn(self, graph, ctx) -> GraphRunResult:  # noqa: ANN001
        self.calls += 1
        if self._raises:
            raise LlmUnavailableError("both legs exhausted")

        reply_text = "".join(self._stream_texts).strip()
        spoken = False
        if reply_text:
            await ctx.speak(reply_text)
            spoken = True
        return GraphRunResult(
            reply_text=reply_text,
            provider_key=self._provider_key,
            used_fallback=self._used_fallback,
            first_token_ms=self._first_token_ms,
            spoken=spoken,
        )


class FakeStt:
    key = "deepgram"

    def __init__(self, events: list[SttEvent]) -> None:
        self._events = events
        self.first_partial_ms = 42

    async def transcribe_stream(self, audio_pcm):  # noqa: ANN001
        for event in self._events:
            yield event


class FakeTransport:
    def __init__(self) -> None:
        self.published: list[dict] = []
        self.audio_track_published = False
        self.pushed_audio_frames: list[bytes] = []
        self.video_track_published: tuple[str, int, int] | None = None
        self.pushed_video_frames: list[VideoFrame] = []
        self.video_unpublished = False

    async def publish_transcription(self, *, participant_identity, track_sid, segment_id, text, final):  # noqa: ANN001
        self.published.append(
            {
                "participant_identity": participant_identity,
                "track_sid": track_sid,
                "segment_id": segment_id,
                "text": text,
                "final": final,
            }
        )

    async def publish_audio_track(self, track_id):  # noqa: ANN001
        self.audio_track_published = True

    async def push_audio_frame(self, pcm):  # noqa: ANN001
        self.pushed_audio_frames.append(pcm)

    async def publish_video_track(self, track_id, *, width, height):  # noqa: ANN001
        self.video_track_published = (track_id, width, height)

    async def push_video_frame(self, frame):  # noqa: ANN001
        self.pushed_video_frames.append(frame)

    async def unpublish_video_track(self):
        self.video_unpublished = True
        self.video_track_published = None


class FakeTts:
    key = "fish-speech"

    def __init__(self, frames: list[bytes] | None = None, raises: TtsError | None = None) -> None:
        self._frames = frames if frames is not None else [b"frame"]
        self._raises = raises

    async def synthesize_stream(self, text, voice_id):  # noqa: ANN001
        if self._raises:
            raise self._raises
        for f in self._frames:
            yield f

    @property
    def first_audio_ms(self):
        return 50


class FakeAvatar:
    """Duck-typed `IAvatarProvider` double (BL-018)."""

    key = "bithuman"

    def __init__(
        self,
        *,
        frames: list[VideoFrame] | None = None,
        start_raises: AvatarError | None = None,
        start_raises_sequence: list[AvatarError | None] | None = None,
    ) -> None:
        self._frames = frames if frames is not None else [VideoFrame(data=b"\x00" * 12, width=2, height=2)]
        self._start_raises = start_raises
        # Lets a test script "fails once, succeeds on retry" or "fails twice"
        # for the FR-AVATAR-5 retry-then-degrade path.
        self._start_raises_sequence = list(start_raises_sequence) if start_raises_sequence is not None else None
        self.started = 0
        self.pushed_audio: list[bytes] = []
        self.flushed = 0
        self.closed = False
        self._first_frame_ms = 30

    async def start_session(self) -> None:
        self.started += 1
        if self._start_raises_sequence is not None:
            outcome = self._start_raises_sequence.pop(0) if self._start_raises_sequence else None
            if outcome is not None:
                raise outcome
            return
        if self._start_raises is not None:
            raise self._start_raises

    async def push_audio_frame(self, pcm: bytes) -> None:
        self.pushed_audio.append(pcm)

    async def flush(self) -> None:
        self.flushed += 1

    async def frames(self):
        for frame in self._frames:
            yield frame

    async def close(self) -> None:
        self.closed = True

    @property
    def first_frame_ms(self) -> int | None:
        return self._first_frame_ms


def _make_reasoning_block() -> ReasoningBlock:
    """A minimal, valid single-LLM-node `reasoning` block — `pipeline.py`
    only ever reads it to hand to `IOrchestrator.run_turn` (the fake double
    above never actually inspects it), so its exact shape doesn't matter
    beyond being a real `ReasoningBlock`.
    """
    return ReasoningBlock.model_validate(
        {
            "entry_node_id": "llm-1",
            "background_entry_node_ids": [],
            "turn_budget_ms": 3000,
            "graph": [
                {
                    "id": "llm-1",
                    "type": "llm",
                    "name": "Answer",
                    "lane": "foreground",
                    "on_error": {"action": "degrade"},
                    "on_deadline": {"action": "degrade"},
                    "provider": "openai",
                    "model": "gpt-4o",
                    "retry": {"max_attempts": 3, "backoff_ms": [200, 400, 800]},
                    "next_node_id": None,
                }
            ],
        }
    )


def make_pipeline(
    *,
    orchestrator: FakeOrchestrator | None = None,
    tts: FakeTts | None = None,
    control_plane: FakeControlPlane | None = None,
    residency_mode: str = "prompt_text_only",
    stt: object | None = None,
    transport: FakeTransport | None = None,
    tools: list[ToolDefinition] | None = None,
    tool_executor: ToolExecutor | None = None,
    avatar: FakeAvatar | None = None,
    summary_llm: object | None = None,
) -> tuple[ConversationPipeline, FakeControlPlane, FakeOrchestrator, FakeTts]:
    cp = control_plane or FakeControlPlane()
    orch = orchestrator or FakeOrchestrator()
    tts_impl = tts or FakeTts()
    reasoning = _make_reasoning_block()
    llm_node = reasoning.graph[0]
    llm_by_node = {llm_node.id: ResolvedLlmNode(primary=object(), fallback=None, retry=llm_node.retry)}  # type: ignore[union-attr,arg-type]
    pipeline = ConversationPipeline(
        session_id=SESSION_ID,
        tenant_id=TENANT_ID,
        stt=stt if stt is not None else object(),  # not used directly by most pipeline methods under test
        reasoning=reasoning,
        llm_by_node=llm_by_node,
        summary_llm=summary_llm if summary_llm is not None else object(),
        tts=tts_impl,
        voice_id="v1",
        system_prompt="You are helpful.",
        residency_mode=residency_mode,
        memory=SessionMemory(window_turns=16),
        default_llm=None,
        embedding_provider=None,
        knowledge_pipeline=_default_knowledge_pipeline(),
        knowledge_search=FakeKnowledgeSearchPort(),
        knowledge_gap=FakeKnowledgeGapPort(),
        tool_executor=tool_executor or ToolExecutor(),
        tools=tools or [],
        tool_specs=[],
        orchestrator=orch,
        control_plane=cp,
        degraded_message="Please hold.",
        transport=transport,
        avatar=avatar,
    )
    return pipeline, cp, orch, tts_impl


async def test_zero_length_final_is_dropped_never_enqueued() -> None:
    pipeline, *_ = make_pipeline()
    await pipeline.on_final_utterance("   ")
    assert pipeline._queue.empty()


async def test_final_utterance_is_enqueued_with_an_incrementing_seq() -> None:
    pipeline, *_ = make_pipeline()
    await pipeline.on_final_utterance("hi")
    await pipeline.on_final_utterance("there")
    assert pipeline._queue.qsize() == 2
    first = pipeline._queue.get_nowait()
    assert first == (1, "hi")


async def test_queue_overflow_drops_the_oldest_pending_entry() -> None:
    pipeline, *_ = make_pipeline()
    await pipeline.on_final_utterance("one")
    await pipeline.on_final_utterance("two")
    await pipeline.on_final_utterance("three")
    await pipeline.on_final_utterance("four")  # queue depth 3 -> drops "one"
    remaining = []
    while not pipeline._queue.empty():
        remaining.append(pipeline._queue.get_nowait())
    assert remaining == [(2, "two"), (3, "three"), (4, "four")]


async def test_process_utterance_success_records_llm_and_tts_hops_and_speaks() -> None:
    pipeline, cp, orch, tts = make_pipeline()
    await pipeline._process_utterance(1, "hello")

    assert orch.calls == 1
    llm_hops = [item for _sid, items in cp.hops for item in items if item.hop == "llm"]
    tts_hops = [item for _sid, items in cp.hops for item in items if item.hop == "tts"]
    assert len(llm_hops) == 1
    assert len(tts_hops) == 1
    assert tts_hops[0].first_audio_ms is not None

    # Both the user's utterance and the assistant's reply are recorded.
    all_items = [item for _sid, items in cp.utterances for item in items]
    assert any(i.role == "user" and i.text == "hello" for i in all_items)
    assert any(i.role == "assistant" and i.text == "hello" for i in all_items)


async def test_process_utterance_with_empty_llm_reply_skips_tts_entirely() -> None:
    pipeline, cp, _orch, _tts = make_pipeline(orchestrator=FakeOrchestrator(stream_texts=["   "]))
    await pipeline._process_utterance(1, "hello")
    tts_hops = [item for _sid, items in cp.hops for item in items if item.hop == "tts"]
    assert tts_hops == []


async def test_process_utterance_records_alert_on_fallback_usage() -> None:
    pipeline, cp, _orch, _tts = make_pipeline(orchestrator=FakeOrchestrator(used_fallback=True, provider_key="anthropic"))
    await pipeline._process_utterance(1, "hello")
    assert len(cp.alerts) == 1
    assert cp.alerts[0].type == "llm_failover"


async def test_llm_unavailable_enters_degraded_mode_and_speaks_the_degraded_message() -> None:
    pipeline, cp, _orch, tts = make_pipeline(orchestrator=FakeOrchestrator(raises=True))
    await pipeline._process_utterance(1, "hello")

    assert cp.events[0][1].type == "degraded"
    assert any(a.type == "llm_failover" for a in cp.alerts)
    llm_hops = [item for _sid, items in cp.hops for item in items if item.hop == "llm"]
    assert llm_hops[0].error_code == "LLM_UNAVAILABLE"
    tts_hops = [item for _sid, items in cp.hops for item in items if item.hop == "tts"]
    assert len(tts_hops) == 1  # the degraded message was spoken


async def test_degraded_mode_throttle_suppresses_a_second_speak_within_30s() -> None:
    pipeline, cp, _orch, _tts = make_pipeline(orchestrator=FakeOrchestrator(raises=True))
    await pipeline._process_utterance(1, "hello")
    tts_hops_after_first = [item for _sid, items in cp.hops for item in items if item.hop == "tts"]
    await pipeline._process_utterance(2, "hello again")
    tts_hops_after_second = [item for _sid, items in cp.hops for item in items if item.hop == "tts"]
    assert len(tts_hops_after_first) == 1
    assert len(tts_hops_after_second) == 1  # unchanged - throttled


async def test_tts_failure_records_an_error_hop_instead_of_raising() -> None:
    pipeline, cp, _orch, _tts = make_pipeline(tts=FakeTts(raises=TtsError("no voice", code="TTS_VOICE_NOT_FOUND")))
    await pipeline._process_utterance(1, "hello")
    tts_hops = [item for _sid, items in cp.hops for item in items if item.hop == "tts"]
    assert tts_hops[0].error_code == "TTS_VOICE_NOT_FOUND"


async def test_run_consumer_loop_processes_queued_utterances_one_at_a_time() -> None:
    pipeline, cp, orch, _tts = make_pipeline()
    await pipeline.on_final_utterance("hi")
    task = __import__("asyncio").ensure_future(pipeline.run_consumer_loop())
    # Give the loop a moment to drain the one queued item.
    import asyncio as _asyncio

    for _ in range(50):
        await _asyncio.sleep(0)
        if orch.calls >= 1:
            break
    task.cancel()
    assert orch.calls == 1


async def test_run_stt_loop_publishes_every_event_and_forwards_finals_to_on_final_utterance() -> None:
    stt = FakeStt(
        [
            SttEvent(kind="partial", text="hel"),
            SttEvent(kind="final", text="hello"),
        ]
    )
    transport = FakeTransport()
    pipeline, cp, _orch, _tts = make_pipeline(stt=stt, transport=transport)

    async def _audio():
        yield b""

    await pipeline.run_stt_loop(_audio(), participant_identity="caller-1", track_sid="TR_1")

    # Both the partial and the final were published for live captions.
    assert [p["text"] for p in transport.published] == ["hel", "hello"]
    assert transport.published[0]["final"] is False
    assert transport.published[1]["final"] is True
    assert all(p["participant_identity"] == "caller-1" and p["track_sid"] == "TR_1" for p in transport.published)

    # The final was forwarded into the LLM/TTS queue.
    assert pipeline._queue.qsize() == 1
    assert pipeline._queue.get_nowait() == (1, "hello")

    # FR-STT-4: the stt hop was genuinely recorded via HopRecorder, not skipped.
    stt_hops = [item for _sid, items in cp.hops for item in items if item.hop == "stt"]
    assert len(stt_hops) == 1
    assert stt_hops[0].first_partial_ms == 42


async def test_run_stt_loop_does_not_forward_a_zero_length_final_but_still_publishes_it() -> None:
    stt = FakeStt([SttEvent(kind="final", text="   ")])
    transport = FakeTransport()
    pipeline, cp, _orch, _tts = make_pipeline(stt=stt, transport=transport)

    async def _audio():
        yield b""

    await pipeline.run_stt_loop(_audio(), participant_identity="caller-1", track_sid="TR_1")

    assert transport.published == [
        {
            "participant_identity": "caller-1",
            "track_sid": "TR_1",
            "segment_id": f"{SESSION_ID}-1",
            "text": "   ",
            "final": True,
        }
    ]
    assert pipeline._queue.empty()
    stt_hops = [item for _sid, items in cp.hops for item in items if item.hop == "stt"]
    assert stt_hops == []  # nothing was actually finalized, so no hop is recorded


async def test_full_conversation_loop_audio_in_to_caption_and_speech_out() -> None:
    """End-to-end trace (QA D-1 ask): simulated audio -> STT -> transcription
    published toward LiveKit (captions) -> queued final -> consumer loop ->
    LLM -> TTS -> spoken reply, all through the real, wired
    `ConversationPipeline`, not individual methods in isolation.
    """
    stt = FakeStt([SttEvent(kind="partial", text="hel"), SttEvent(kind="final", text="hello there")])
    transport = FakeTransport()
    orch = FakeOrchestrator(stream_texts=["General Kenobi"])
    tts = FakeTts()
    pipeline, cp, _orch, _tts = make_pipeline(stt=stt, transport=transport, orchestrator=orch, tts=tts)

    async def _audio():
        yield b""

    # 1. Audio -> STT -> captions published + final queued.
    await pipeline.run_stt_loop(_audio(), participant_identity="caller-1", track_sid="TR_1")
    assert transport.published[-1] == {
        "participant_identity": "caller-1",
        "track_sid": "TR_1",
        "segment_id": f"{SESSION_ID}-2",
        "text": "hello there",
        "final": True,
    }

    # 2. Consumer loop drains the queued final -> LLM -> TTS.
    consumer_task = __import__("asyncio").ensure_future(pipeline.run_consumer_loop())
    import asyncio as _asyncio

    for _ in range(50):
        await _asyncio.sleep(0)
        if orch.calls >= 1:
            break
    consumer_task.cancel()

    assert orch.calls == 1
    llm_hops = [item for _sid, items in cp.hops for item in items if item.hop == "llm"]
    tts_hops = [item for _sid, items in cp.hops for item in items if item.hop == "tts"]
    stt_hops = [item for _sid, items in cp.hops for item in items if item.hop == "stt"]
    assert len(llm_hops) == 1 and len(tts_hops) == 1 and len(stt_hops) == 1
    all_items = [item for _sid, items in cp.utterances for item in items]
    assert any(i.role == "assistant" and i.text == "General Kenobi" for i in all_items)


async def test_run_stt_loop_works_without_a_transport_configured() -> None:
    stt = FakeStt([SttEvent(kind="final", text="hi")])
    pipeline, cp, _orch, _tts = make_pipeline(stt=stt, transport=None)

    async def _audio():
        yield b""

    await pipeline.run_stt_loop(_audio(), participant_identity="caller-1", track_sid="TR_1")
    assert pipeline._queue.qsize() == 1


# --- BL-018: avatar wiring (FR-AVATAR-1/3/4/5) -------------------------------


async def test_speak_publishes_tts_audio_onto_the_room_and_drives_the_avatar() -> None:
    """FR-AVATAR-3: every TTS frame reaches both the room's audio track and
    the avatar's lip-sync input; end-of-utterance flushes the avatar.
    """
    transport = FakeTransport()
    avatar = FakeAvatar()
    tts = FakeTts(frames=[b"f1", b"f2"])
    pipeline, cp, _orch, _tts = make_pipeline(tts=tts, transport=transport, avatar=avatar)

    await pipeline._speak(1, "hello")

    assert transport.audio_track_published is True
    assert transport.pushed_audio_frames == [b"f1", b"f2"]
    assert avatar.pushed_audio == [b"f1", b"f2"]
    assert avatar.flushed == 1


async def test_speak_works_without_an_avatar_configured() -> None:
    """Audio-only sessions (no avatar factory resolved) must not be
    affected by any of this phase's wiring.
    """
    transport = FakeTransport()
    tts = FakeTts(frames=[b"f1"])
    pipeline, cp, _orch, _tts = make_pipeline(tts=tts, transport=transport, avatar=None)

    await pipeline._speak(1, "hello")

    assert transport.pushed_audio_frames == [b"f1"]


async def test_start_avatar_session_is_a_no_op_without_an_avatar_or_transport() -> None:
    pipeline, *_ = make_pipeline(avatar=None, transport=None)
    await pipeline.start_avatar_session()  # must not raise


async def test_start_avatar_session_publishes_the_first_frame_and_records_the_avatar_hop() -> None:
    """FR-AVATAR-4: `hop="avatar"` with `first_frame_ms` recorded once the
    first frame is actually published.
    """
    transport = FakeTransport()
    avatar = FakeAvatar(frames=[VideoFrame(data=b"\x00" * 12, width=2, height=2)])
    pipeline, cp, _orch, _tts = make_pipeline(transport=transport, avatar=avatar)

    await pipeline.start_avatar_session()
    await asyncio_yield()

    assert avatar.started == 1
    assert transport.video_track_published == ("avatar-video", 2, 2)
    assert len(transport.pushed_video_frames) == 1
    avatar_hops = [item for _sid, items in cp.hops for item in items if item.hop == "avatar"]
    assert avatar_hops[0].first_frame_ms == 30
    pipeline._cancel_avatar_pump()


async def test_start_avatar_session_reraises_avatar_not_found() -> None:
    """FR-AVATAR-1: an unknown `avatar_id` is fatal to job start, not a
    retry/degrade candidate.
    """
    avatar = FakeAvatar(start_raises=AvatarError("no such avatar", code="AVATAR_NOT_FOUND"))
    pipeline, *_ = make_pipeline(transport=FakeTransport(), avatar=avatar)

    try:
        await pipeline.start_avatar_session()
        raised = False
    except AvatarError as err:
        raised = True
        assert err.code == "AVATAR_NOT_FOUND"
    assert raised


async def test_start_avatar_session_retries_once_then_recovers() -> None:
    """FR-AVATAR-5: "retry start once (2s delay)" — a transient start
    failure that succeeds on retry must still end up with video published.
    """
    transport = FakeTransport()
    avatar = FakeAvatar(
        start_raises_sequence=[AvatarError("connection refused", code="AVATAR_UNAVAILABLE"), None],
    )
    pipeline, cp, _orch, _tts = make_pipeline(transport=transport, avatar=avatar)

    await pipeline.start_avatar_session()
    await asyncio_yield()

    assert avatar.started == 2
    assert transport.video_track_published is not None
    assert transport.video_unpublished is False
    pipeline._cancel_avatar_pump()


async def test_start_avatar_session_degrades_to_audio_only_after_a_second_failure() -> None:
    """FR-AVATAR-5: "second failure -> keep audio-only ... session
    `degraded`, not `failed`." No video track is published/left published,
    and the session is marked degraded rather than failed.
    """
    transport = FakeTransport()
    avatar = FakeAvatar(start_raises=AvatarError("connection refused", code="AVATAR_UNAVAILABLE"))
    pipeline, cp, _orch, _tts = make_pipeline(transport=transport, avatar=avatar)

    await pipeline.start_avatar_session()

    assert avatar.started == 2  # the initial attempt + exactly one retry
    assert transport.video_track_published is None
    assert cp.events[0][1].type == "degraded"
    avatar_hops = [item for _sid, items in cp.hops for item in items if item.hop == "avatar"]
    assert avatar_hops[0].error_code == "AVATAR_UNAVAILABLE"


async def test_a_mid_stream_avatar_crash_triggers_recovery_and_unpublishes_video() -> None:
    """FR-AVATAR-5: "if the avatar worker dies mid-session" -- a crash
    while pumping frames (not just at start) must also degrade the call,
    ending with the video track removed (the trigger for the client's
    existing "no avatar track" banner).
    """

    class CrashingAvatar(FakeAvatar):
        async def frames(self):
            yield VideoFrame(data=b"\x00" * 12, width=2, height=2)
            raise AvatarError("stream crashed", code="AVATAR_UNAVAILABLE")

    transport = FakeTransport()
    avatar = CrashingAvatar(start_raises=AvatarError("connection refused", code="AVATAR_UNAVAILABLE"))
    pipeline, cp, _orch, _tts = make_pipeline(transport=transport, avatar=avatar)

    await pipeline.start_avatar_session()
    for _ in range(20):
        await asyncio_yield()
        if transport.video_track_published is not None:
            break

    # First frame published, then the stream crashes -> recovery -> second
    # start also fails (the fixture's `start_raises` is still set) -> degrade.
    for _ in range(20):
        await asyncio_yield()
        if transport.video_unpublished:
            break

    assert transport.video_unpublished is True
    assert any(_sid_events[1].type == "degraded" for _sid_events in cp.events)


async def test_aclose_cancels_the_pump_task_and_closes_the_avatar() -> None:
    transport = FakeTransport()
    avatar = FakeAvatar()
    pipeline, *_ = make_pipeline(transport=transport, avatar=avatar)

    await pipeline.start_avatar_session()
    await asyncio_yield()
    await pipeline.aclose()

    assert avatar.closed is True
    assert pipeline._avatar_pump_task is None


async def test_aclose_is_safe_when_avatar_session_was_never_started() -> None:
    pipeline, *_ = make_pipeline(avatar=None, transport=None)
    await pipeline.aclose()  # must not raise


async def asyncio_yield() -> None:
    import asyncio

    await asyncio.sleep(0)


async def test_drive_avatar_audio_failure_triggers_recovery() -> None:
    class FailingPushAvatar(FakeAvatar):
        async def push_audio_frame(self, pcm: bytes) -> None:
            raise AvatarError("push failed", code="AVATAR_UNAVAILABLE")

    transport = FakeTransport()
    avatar = FailingPushAvatar(start_raises=AvatarError("still down", code="AVATAR_UNAVAILABLE"))
    pipeline, cp, _orch, _tts = make_pipeline(transport=transport, avatar=avatar)

    await pipeline._drive_avatar_audio(b"frame")

    # Recovery was attempted (retry once, per FR-AVATAR-5) and degraded since
    # `start_raises` is always set on this fixture.
    assert avatar.started == 1
    assert cp.events[0][1].type == "degraded"


async def test_safe_avatar_call_failure_triggers_recovery() -> None:
    avatar = FakeAvatar(start_raises=AvatarError("still down", code="AVATAR_UNAVAILABLE"))
    pipeline, cp, _orch, _tts = make_pipeline(transport=FakeTransport(), avatar=avatar)

    async def _failing() -> None:
        raise AvatarError("flush failed", code="AVATAR_UNAVAILABLE")

    await pipeline._safe_avatar_call(_failing())

    assert avatar.started == 1
    assert cp.events[0][1].type == "degraded"


async def test_attempt_avatar_recovery_is_a_no_op_without_an_avatar() -> None:
    pipeline, *_ = make_pipeline(avatar=None, transport=FakeTransport())
    await pipeline._attempt_avatar_recovery()  # must not raise


async def test_publish_avatar_video_is_a_no_op_when_the_avatar_yields_no_frames() -> None:
    transport = FakeTransport()
    avatar = FakeAvatar(frames=[])
    pipeline, *_ = make_pipeline(transport=transport, avatar=avatar)

    await pipeline._publish_avatar_video()

    assert transport.video_track_published is None
    assert pipeline._avatar_pump_task is None


async def test_publish_avatar_video_recovers_when_the_first_frame_raises() -> None:
    class FailingFirstFrameAvatar(FakeAvatar):
        async def frames(self):
            raise AvatarError("first frame failed", code="AVATAR_UNAVAILABLE")
            yield  # pragma: no cover - makes this an async generator

    transport = FakeTransport()
    avatar = FailingFirstFrameAvatar(start_raises=AvatarError("still down", code="AVATAR_UNAVAILABLE"))
    pipeline, cp, _orch, _tts = make_pipeline(transport=transport, avatar=avatar)

    await pipeline._publish_avatar_video()

    assert avatar.started == 1  # recovery's own retry attempt (no earlier start_session call in this test)
    assert cp.events[0][1].type == "degraded"


async def test_pump_avatar_frames_recovers_on_a_mid_stream_crash() -> None:
    """Direct unit test of the pump loop's crash branch (not relying on
    task-scheduling timing, unlike the end-to-end variant above)."""

    async def _frames():
        yield VideoFrame(data=b"\x00" * 12, width=2, height=2)
        raise AvatarError("stream crashed", code="AVATAR_UNAVAILABLE")

    transport = FakeTransport()
    avatar = FakeAvatar(start_raises=AvatarError("still down", code="AVATAR_UNAVAILABLE"))
    pipeline, cp, _orch, _tts = make_pipeline(transport=transport, avatar=avatar)

    await pipeline._pump_avatar_frames(_frames())

    assert transport.pushed_video_frames == [VideoFrame(data=b"\x00" * 12, width=2, height=2)]
    assert avatar.started == 1  # recovery's own retry attempt (no earlier start_session call in this test)
    assert cp.events[0][1].type == "degraded"


async def test_cancel_avatar_pump_is_idempotent_after_the_task_finishes() -> None:
    async def _frames():
        yield VideoFrame(data=b"\x00" * 12, width=2, height=2)

    transport = FakeTransport()
    avatar = FakeAvatar()
    pipeline, *_ = make_pipeline(transport=transport, avatar=avatar)

    pipeline._avatar_pump_task = asyncio.ensure_future(pipeline._pump_avatar_frames(_frames()))
    await asyncio_yield()
    await asyncio_yield()

    pipeline._cancel_avatar_pump()  # task already finished naturally
    pipeline._cancel_avatar_pump()  # calling twice must not raise

    assert pipeline._avatar_pump_task is None


async def test_aclose_logs_but_does_not_raise_when_avatar_close_fails() -> None:
    class FailingCloseAvatar(FakeAvatar):
        async def close(self) -> None:
            raise AvatarError("close failed", code="AVATAR_UNAVAILABLE")

    pipeline, *_ = make_pipeline(transport=FakeTransport(), avatar=FailingCloseAvatar())
    await pipeline.aclose()  # must not raise


async def test_mid_stream_avatar_crash_as_a_real_background_task_completes_recovery_and_audio_keeps_flowing(
    monkeypatch,
) -> None:
    """QA phase5-agent-bithuman D-1 regression test.

    Both pre-existing "mid-stream crash" tests were structurally unable to
    exercise the real production shape: one degrades the avatar before
    `_publish_avatar_video` ever creates the background pump task (`start_raises`
    unconditional -> the very first `start_avatar_session()` call fails inline),
    and the other calls `_pump_avatar_frames` directly rather than scheduling it
    via `asyncio.ensure_future` -- so `self._avatar_pump_task` is never the
    currently-executing task in either case, and the self-cancellation bug
    (`_attempt_avatar_recovery` cancelling the very task it's running inside of)
    can never trigger.

    This test instead: (1) lets `start_avatar_session()` succeed once for real,
    so `_publish_avatar_video` schedules `_pump_avatar_frames` as a genuine
    background task via `asyncio.ensure_future` -- exactly what production does;
    (2) lets that task's own `frames()` iterator crash while it is actually
    running (not called inline); (3) asserts the full retry-once-after-a-delay,
    then-degrade-and-unpublish sequence completes for real, rather than dying
    silently to an uncaught self-inflicted `CancelledError`; and (4) proves TTS
    audio keeps reaching the room after the avatar dies, not just that no
    exception propagated.
    """
    import avatar_agent.orchestration.pipeline as pipeline_module

    # The retry delay is a real `asyncio.sleep` the pump task's own recovery
    # awaits from inside itself -- shrink it so this test doesn't need to wait
    # the real 2s FR-AVATAR-5 specifies, without changing production behavior.
    monkeypatch.setattr(pipeline_module, "_AVATAR_RETRY_DELAY_S", 0.05)

    class CrashingAvatar(FakeAvatar):
        """Starts successfully once (so a real background pump task is
        created), then its `frames()` stream crashes after one frame --
        the actual "avatar worker dies mid-session" shape."""

        async def frames(self):
            yield VideoFrame(data=b"\x00" * 12, width=2, height=2)
            raise AvatarError("stream crashed", code="AVATAR_UNAVAILABLE")

    transport = FakeTransport()
    avatar = CrashingAvatar(
        start_raises_sequence=[None, AvatarError("still down", code="AVATAR_UNAVAILABLE")],
    )
    pipeline, cp, _orch, _tts = make_pipeline(transport=transport, avatar=avatar)

    await pipeline.start_avatar_session()

    # The first start genuinely succeeded and a REAL background task is now
    # pumping frames -- not something this test drives directly.
    assert avatar.started == 1
    assert transport.video_track_published is not None
    assert pipeline._avatar_pump_task is not None
    assert not pipeline._avatar_pump_task.done()

    # Wait for the crash -> retry (after the shrunk delay) -> retry-fails ->
    # degrade sequence to complete for real, the same way QA's repro waited on
    # real elapsed time rather than a fixed number of zero-delay yields.
    for _ in range(200):
        await asyncio.sleep(0.01)
        if transport.video_unpublished:
            break

    assert transport.video_unpublished is True, (
        "avatar recovery must genuinely complete and unpublish the video track, "
        "not die to a self-inflicted CancelledError at the retry-delay sleep"
    )
    assert avatar.started == 2  # the original start + exactly one retry, no more
    assert any(event.type == "degraded" for _sid, event in cp.events)
    assert any(alert.type == "provider_unreachable" for alert in cp.alerts)
    avatar_hops = [item for _sid, items in cp.hops for item in items if item.hop == "avatar"]
    assert any(h.error_code == "AVATAR_UNAVAILABLE" for h in avatar_hops)

    # The pump task itself must have finished cleanly, not be left dangling as
    # a cancelled task with a stale `_avatar_pump_task` reference.
    assert pipeline._avatar_pump_task is None

    # Audio keeps flowing after the avatar died: a subsequent utterance's TTS
    # frames still reach the room's audio track even though the avatar is
    # degraded (FR-AVATAR-5's "keep audio-only").
    await pipeline._speak(2, "still here")
    assert transport.pushed_audio_frames, "TTS audio must keep reaching the room after the avatar failure"


class FakeLlm:
    """Duck-typed `ILLMProvider` double for summary generation only —
    `complete_stream` is never exercised by these tests.
    """

    key = "openai"

    def __init__(self, result: PostCallSummary | None = None, error: LlmError | None = None) -> None:
        self._result = result
        self._error = error

    async def complete_stream(self, *a, **k):  # noqa: ANN002, ANN003
        raise NotImplementedError

    async def complete_structured(self, messages, schema, residency):  # noqa: ANN001
        if self._error:
            raise self._error
        return self._result

    @property
    def first_token_ms(self):
        return None


async def test_generate_summary_posts_a_ready_summary_using_the_session_memory() -> None:
    """FR-CALL-4 / QA D-1 (phase7-conversation-summary): `ConversationPipeline
    .generate_summary` is the method `entrypoint.handle_job`'s teardown now
    calls — this proves it genuinely builds a residency payload from this
    session's own memory window and posts a `ready` summary.
    """
    llm = FakeLlm(result=PostCallSummary(summary_text="A great call."))
    pipeline, cp, *_ = make_pipeline(summary_llm=llm)
    pipeline._memory.add_user_turn("hello")
    pipeline._memory.add_assistant_turn("hi there")

    await pipeline.generate_summary()

    assert len(cp.summaries) == 1
    session_id, request = cp.summaries[0]
    assert session_id == SESSION_ID
    assert request.summary_status == "ready"
    assert request.summary_text == "A great call."


async def test_generate_summary_posts_unavailable_on_llm_failure_and_never_raises() -> None:
    llm = FakeLlm(error=LlmError("down", retryable=False))
    pipeline, cp, *_ = make_pipeline(summary_llm=llm)

    await pipeline.generate_summary()

    assert len(cp.summaries) == 1
    _session_id, request = cp.summaries[0]
    assert request.summary_status == "unavailable"
    assert request.summary_text is None


async def test_generate_summary_is_skipped_when_residency_mode_is_none() -> None:
    """Defensive guard mirroring `_process_utterance`'s own
    `ResidencyBlockedError` handling — `residency_mode == "none"` reaching
    the runtime at all is itself a pre-existing defect (should be blocked at
    config-save time), so no summary attempt (and definitely no remote LLM
    call) should ever be made in that state.
    """
    llm = FakeLlm(result=PostCallSummary(summary_text="should never be reached"))
    pipeline, cp, *_ = make_pipeline(summary_llm=llm, residency_mode="none")

    await pipeline.generate_summary()

    assert cp.summaries == []
