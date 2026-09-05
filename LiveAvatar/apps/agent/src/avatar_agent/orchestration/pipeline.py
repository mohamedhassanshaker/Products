"""STT -> LLM (+tools) -> TTS -> avatar wiring for one session (FR-AGENT-1,
LLD §9.2's `SessionState`). One in-flight LLM call per session; further
finals queue at depth 3 (FR-LLM-2): on overflow the **oldest pending** is
dropped with `LLM_QUEUE_OVERFLOW` logged and no extra speech emitted.

Avatar wiring (Phase 5/BL-018 bitHuman, Phase 6/BL-019 Alibaba LiveAvatar):
every TTS frame is pushed both onto the room's published audio track and
into the avatar adapter (FR-AVATAR-3 — "drive rendering from TTS audio",
never a second vendor TTS). The avatar's own produced frames are pumped onto
a published video track by a background task started once per session
(`start_avatar_session`) — this wiring is identical regardless of which
`IAvatarProvider` implementer was resolved (FR-AVATAR-2's whole point).
`avatar=None` (a session whose avatar-adapter construction failed, e.g. a
missing credential or malformed `avatar_id` — see `entrypoint.build_pipeline`)
is treated as "no avatar for this session" — audio-only continues, matching
Phase 4's stub behavior exactly.
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterable, AsyncIterator, Sequence
from uuid import UUID

import structlog

from avatar_agent.contracts.internal_api import (
    AlertRequest,
    HopItem,
    SessionEventRequest,
    UtteranceItem,
)
from avatar_agent.contracts.runtime_config import ReasoningBlock, RetrievalPipelineConfig
from avatar_agent.orchestration.degraded import DegradedModeThrottle
from avatar_agent.orchestration.failover import LlmUnavailableError
from avatar_agent.orchestration.memory import SessionMemory
from avatar_agent.orchestration.tools import ToolDefinition, ToolExecutor
from avatar_agent.ports.avatar import AvatarError, IAvatarProvider, VideoFrame
from avatar_agent.ports.embedding import IEmbeddingProvider
from avatar_agent.ports.llm import ILLMProvider, ResidencyPayload, ToolSpec
from avatar_agent.ports.orchestration import (
    IAlertPort,
    IHitlDecisionPort,
    IKnowledgeGapPort,
    IKnowledgeSearchPort,
    IOrchestrator,
    ISkillBodyPort,
    ISubAgentPersonaPort,
    ResolvedLlmNode,
    SkillBody,
    SubAgentPersona,
    TurnContext,
)
from avatar_agent.ports.secrets import SecretStorePort
from avatar_agent.ports.stt import ISTTProvider
from avatar_agent.ports.transport import ITransportProvider
from avatar_agent.ports.tts import ITTSProvider, TtsError
from avatar_agent.residency.filter import MemoryWindow, ResidencyBlockedError, Turn, build_payload
from avatar_agent.telemetry.control_plane import ControlPlaneClient, now_ms
from avatar_agent.telemetry.hops import HopRecorder

logger = structlog.get_logger(__name__)

_QUEUE_MAX_DEPTH = 3
# FR-AGENT-2 tool round-trip is bounded to a single follow-up LLM turn — a
# model that keeps requesting tools after its results are fed back gets one
# more chance, then whatever text it produced (even empty) is treated as
# final, so a misbehaving/looping model can never keep an utterance cycle
# in-flight forever.
_MAX_TOOL_ROUNDS = 1
# FR-AVATAR-5: "retry start once (2s delay)" — a single retry, not a
# backoff ladder, since a second consecutive failure is defined as the
# degrade trigger, not another retry.
_AVATAR_RETRY_DELAY_S = 2.0
# `hop=avatar` rows are session-level (one rendering session is started
# once per call, not once per utterance) — `utterance_seq=0` is used as the
# "not utterance-scoped" sentinel; `HopItem.utterance_seq` is a required,
# non-null field (control-plane schema) so a sentinel is needed regardless
# of which value is chosen.
_SESSION_LEVEL_UTTERANCE_SEQ = 0
_AVATAR_VIDEO_TRACK_ID = "avatar-video"


class ConversationPipeline:
    """Owns one session's utterance loop end to end.

    Every hop this pipeline runs is instrumented via `HopRecorder`
    (NFR-1) even on failure (`error_code` set) — a completed cycle missing
    a hop metric is a quality defect.
    """

    def __init__(
        self,
        *,
        session_id: UUID,
        tenant_id: UUID,
        stt: ISTTProvider,
        reasoning: ReasoningBlock,
        llm_by_node: dict[str, ResolvedLlmNode],
        summary_llm: ILLMProvider,
        tts: ITTSProvider,
        voice_id: str,
        system_prompt: str,
        residency_mode: str,
        memory: SessionMemory,
        tool_executor: ToolExecutor,
        tools: Sequence[ToolDefinition],
        tool_specs: Sequence[ToolSpec],
        orchestrator: IOrchestrator,
        control_plane: ControlPlaneClient,
        degraded_message: str,
        default_llm: ResolvedLlmNode | None,
        knowledge_pipeline: RetrievalPipelineConfig,
        knowledge_search: IKnowledgeSearchPort,
        knowledge_gap: IKnowledgeGapPort,
        embedding_provider: IEmbeddingProvider | None = None,
        skill_body_port: ISkillBodyPort | None = None,
        secrets: SecretStorePort | None = None,
        hitl_decision_port: IHitlDecisionPort | None = None,
        subagent_persona_port: ISubAgentPersonaPort | None = None,
        alert_port: IAlertPort | None = None,
        transport: ITransportProvider | None = None,
        avatar: IAvatarProvider | None = None,
    ) -> None:
        self._session_id = session_id
        self._tenant_id = tenant_id
        self._stt = stt
        # Phase 9 (BL-036): `reasoning`/`llm_by_node` replace the old
        # `llm_primary`/`llm_fallback`/`retry_policy` triple — the
        # interpreter walks `reasoning.graph`, resolving each `llm`-type
        # node's provider(s) from `llm_by_node[node.id]`.
        self._reasoning = reasoning
        self._llm_by_node = llm_by_node
        # Kept separate from `llm_by_node` for `generate_summary` (FR-CALL-4),
        # which has no graph node of its own — the *first* `llm`-type node's
        # primary provider, resolved once by `entrypoint.build_pipeline`
        # (same "first LLM node = primary" convention the control plane's
        # denormalized `DeploymentConfig.llmProvider` column uses).
        self._summary_llm = summary_llm
        self._tts = tts
        self._voice_id = voice_id
        self._system_prompt = system_prompt
        self._residency_mode = residency_mode
        self._memory = memory
        self._tool_executor = tool_executor
        self._tools = list(tools)
        # Keyed by tool *name* (not `api_ref`) because that's the identifier
        # the LLM's `ToolSpec`/tool-call payload carries (FR-AGENT-2) — the
        # model never sees `api_ref`, only `name`/`description`/`parameters`.
        # Used by the LLM node executor for model-requested tool calls.
        self._tools_by_name: dict[str, ToolDefinition] = {t.name: t for t in tools}
        # Keyed by `api_ref` — used by the Tool node executor (Phase 9,
        # BL-036), a deterministic graph step, distinct from the
        # LLM-requested tool-calling round trip above.
        self._tools_by_api_ref: dict[str, ToolDefinition] = {t.api_ref: t for t in tools}
        self._tool_specs = list(tool_specs)
        self._orchestrator = orchestrator
        self._control_plane = control_plane
        self._degraded_message = degraded_message
        self._degraded_throttle = DegradedModeThrottle()
        # Phase 12b (BL-045/047) — threaded into every turn's `TurnContext`
        # unchanged for the Retrieve node executor; see that class's own
        # docstring / `ports/orchestration.py`'s `TurnContext` fields.
        self._default_llm = default_llm
        self._knowledge_pipeline = knowledge_pipeline
        self._knowledge_search = knowledge_search
        self._knowledge_gap = knowledge_gap
        self._embedding_provider = embedding_provider
        # Phase 13 (BL-049/050/051) — `secrets` is only ever needed by the
        # Skill node executor (lazily resolving a skill's own tool
        # credentials on first trigger); `skill_body_cache` is created ONCE
        # here, per session, and threaded **by reference** into every
        # turn's fresh `TurnContext` below — this is what makes "cached
        # in-process for that session once triggered" true across multiple
        # turns, and what makes a cache collision across sessions/tenants
        # structurally impossible (each session owns its own dict
        # instance; see `TurnContext.skill_body_cache`'s own docstring for
        # the additional tenant-id-prefixed key as defense-in-depth).
        self._skill_body_port = skill_body_port
        self._secrets = secrets
        self._skill_body_cache: dict[str, SkillBody] = {}
        # Phase 14 (BL-052..057) — the Hitl node's create/poll port; `None`
        # for sessions/tests that never exercise a Hitl node, same
        # "structurally impossible to need a real implementation elsewhere"
        # posture `skill_body_port` already documents above.
        self._hitl_decision_port = hitl_decision_port
        # Phase 15 (BL-058) — the Sub-agent node's lazy persona fetch + its
        # own in-process per-session cache, created ONCE here (same
        # "structurally impossible to leak across sessions" reasoning
        # `_skill_body_cache` above already documents) and threaded by
        # reference into every turn's fresh `TurnContext` below.
        self._subagent_persona_port = subagent_persona_port
        self._subagent_persona_cache: dict[str, SubAgentPersona] = {}
        # Phase 15 (BL-059) — the Handoff node's alert-firing port; `None`
        # for sessions/tests that never exercise a Handoff node, same
        # posture `skill_body_port`/`hitl_decision_port` already document.
        self._alert_port = alert_port
        # Phase 15 (BL-060) — the State node's session-scoped, cross-turn
        # variable store. Created ONCE here, per session (never per turn),
        # and threaded **by reference** into every turn's fresh
        # `TurnContext` below — the same "created once, threaded by
        # reference" convention `_skill_body_cache` already establishes,
        # repurposed here as a plain key/value store rather than a fetch
        # cache. This is what makes a State write in turn N visible to a
        # State read in turn N+1 within the same session, while staying
        # in-memory-only (BACKLOG BL-060, deliberate — no Postgres write
        # path).
        self._session_state: dict[str, object] = {}
        # Optional: absent in the many pre-existing unit tests that only
        # exercise STT/LLM/TTS in isolation and never touch the room —
        # `run_stt_loop` no-ops the caption publish when this is `None`.
        self._transport = transport
        # Optional: `None` when no avatar adapter resolved for this session
        # (`FactoryLoadError`/`AvatarError` swallowed by
        # `entrypoint.build_pipeline` — e.g. a missing credential or
        # malformed `avatar_id`) — every avatar-wiring method below no-ops
        # when this is `None`, so audio-only continues exactly as it did
        # before Phase 5 (FR-AVATAR-5's degrade target). Which concrete
        # `IAvatarProvider` this is (bitHuman or LiveAvatar) is irrelevant
        # below — that's the abstraction FR-AVATAR-2 exists to prove.
        self._avatar = avatar
        self._avatar_pump_task: asyncio.Task | None = None
        self._hop_recorder = HopRecorder(control_plane, session_id)

        self._queue: asyncio.Queue[tuple[int, str]] = asyncio.Queue(maxsize=_QUEUE_MAX_DEPTH)
        self._utterance_seq = 0
        self._inflight = False

    async def on_final_utterance(self, text: str) -> int | None:
        """Called by the STT loop on each final transcript (FR-STT-3).

        Zero-length finals are dropped here, never enqueued (FR-STT-3's
        "boundary: zero-length finals are dropped — no LLM invoke").

        @returns the assigned utterance `seq`, or `None` if the final was
            dropped (zero-length) — callers use the returned `seq` to
            correlate this utterance's `hop="stt"` metric (FR-STT-4) with
            the same row `_process_utterance` later records `hop="llm"`/
            `hop="tts"` against.
        """
        if not text.strip():
            return None
        self._utterance_seq += 1
        seq = self._utterance_seq
        if self._queue.full():
            # FR-LLM-2 overflow: drop the OLDEST pending entry, log it, and
            # emit no extra speech for the drop itself.
            dropped_seq, _dropped_text = self._queue.get_nowait()
            logger.warning("LLM_QUEUE_OVERFLOW", session_id=str(self._session_id), dropped_seq=dropped_seq)
        await self._queue.put((seq, text))
        return seq

    async def run_stt_loop(
        self,
        audio_pcm: AsyncIterable[bytes],
        *,
        participant_identity: str,
        track_sid: str,
    ) -> None:
        """Streams `audio_pcm` through STT (FR-STT-1..4), the half of the
        conversation loop `handle_job` never wired before this fix (QA
        phase4-agent-python D-1 — the root cause of the parallel captions
        QA failure, phase4-conversation-captions D-1, since nothing ever
        called `on_final_utterance` or published a transcription).

        Every partial/final is published onto the room's transcription
        channel for live captions (FR-CALL-3) *and*, for finals only,
        forwarded into `on_final_utterance` to drive the LLM/TTS half —
        these are two independent consumers of the same STT event, not a
        request/response pair.

        The `hop="stt"` metric (FR-STT-4) is recorded (and flushed) via
        `HopRecorder` for every final — the requirement this pipeline
        previously satisfied for `llm`/`tts` but never for `stt`.
        """
        segment_id = 0
        cycle_started_ms = now_ms()
        async for event in self._stt.transcribe_stream(audio_pcm):
            segment_id += 1
            if self._transport is not None:
                await self._transport.publish_transcription(
                    participant_identity=participant_identity,
                    track_sid=track_sid,
                    segment_id=f"{self._session_id}-{segment_id}",
                    text=event["text"],
                    final=event["kind"] == "final",
                )
            if event["kind"] != "final":
                continue
            seq = await self.on_final_utterance(event["text"])
            if seq is not None:
                self._hop_recorder.record(
                    HopItem(
                        utterance_seq=seq,
                        hop="stt",
                        first_partial_ms=self._stt.first_partial_ms,
                        total_ms=now_ms() - cycle_started_ms,
                    )
                )
                await self._hop_recorder.flush()
            cycle_started_ms = now_ms()

    async def run_consumer_loop(self) -> None:
        """Long-running task: processes queued utterances one at a time
        (single in-flight LLM call per session, FR-LLM-2).
        """
        while True:
            seq, text = await self._queue.get()
            try:
                await self._process_utterance(seq, text)
            except Exception:  # noqa: BLE001 - a turn failure must never kill the job
                logger.exception("utterance_processing_failed", session_id=str(self._session_id), seq=seq)

    async def _process_utterance(self, seq: int, text: str) -> None:
        self._inflight = True
        try:
            await self._control_plane.send_utterances(
                self._session_id,
                [UtteranceItem(seq=seq, role="user", text=text, started_at=_now())],
            )

            # Phase 12b (BL-045/047): RAG retrieval no longer happens here.
            # It runs entirely as a `retrieve`-type graph-node step, executed
            # by the interpreter below (after `residency` is built, and able
            # to mutate `ctx.residency` via `apply_retrieved_chunks`) —
            # replacing this pre-Phase-9-era RAG-retriever call — that
            # standalone retrieval module is deleted this phase.
            # `build_payload` is therefore always called with an empty
            # `retrieved` list here.
            try:
                residency = build_payload(
                    self._residency_mode,  # type: ignore[arg-type]
                    Turn(text=text),
                    MemoryWindow(turns=tuple(self._memory.as_messages())),
                    self._system_prompt,
                    [],
                )
            except ResidencyBlockedError:
                # QA D-4 (phase4-agent-python): this must never be reached in
                # practice — the control plane blocks `none` + a remote LLM
                # at config-save time (`CONFIG_RESIDENCY_BLOCKS_LLM`) — but if
                # it ever is (e.g. a future on-prem LLM catalog entry), the
                # turn must degrade visibly rather than vanish into
                # `run_consumer_loop`'s blanket `except Exception` with only
                # a log line and no user-facing signal.
                logger.error("RESIDENCY_BLOCKED", session_id=str(self._session_id), seq=seq)
                await self._enter_degraded_mode(seq)
                return

            # Phase 9 (BL-036): the interpreter walks `self._reasoning`,
            # speaking internally (via `ctx.speak`, wired to `self._speak`
            # below) instead of returning text for this method to speak
            # itself — see `TurnContext`'s docstring and the plan doc's
            # "pipeline.py surgery (contained)" note. `ctx.turn_state` seeds
            # `utterance` for the Router condition grammar.
            ctx = TurnContext(
                session_id=self._session_id,
                tenant_id=self._tenant_id,
                utterance_seq=seq,
                llm_by_node=self._llm_by_node,
                tool_definitions_by_api_ref=self._tools_by_api_ref,
                tools_by_name=self._tools_by_name,
                tool_specs=self._tool_specs,
                tool_executor=self._tool_executor,
                residency=residency,
                turn_state={"utterance": text},
                speak=lambda spoken_text: self._speak(seq, spoken_text),
                hop_recorder=self._hop_recorder,
                default_llm=self._default_llm,
                knowledge_pipeline=self._knowledge_pipeline,
                knowledge_search=self._knowledge_search,
                knowledge_gap=self._knowledge_gap,
                embedding_provider=self._embedding_provider,
                skill_body_port=self._skill_body_port,
                secrets=self._secrets,
                # By reference, not a copy — see `__init__`'s comment on why
                # this is what makes the skill-body cache genuinely
                # per-session rather than per-turn.
                skill_body_cache=self._skill_body_cache,
                hitl_decision_port=self._hitl_decision_port,
                subagent_persona_port=self._subagent_persona_port,
                # By reference, not a copy — same reasoning as
                # `skill_body_cache` above.
                subagent_persona_cache=self._subagent_persona_cache,
                alert_port=self._alert_port,
                # By reference, not a copy — see `__init__`'s comment on why
                # this is what makes a State write genuinely persist across
                # turns within the same session.
                session_state=self._session_state,
            )
            try:
                result = await self._orchestrator.run_turn(self._reasoning, ctx)
            except LlmUnavailableError:
                await self._enter_degraded_mode(seq)
                return

            if result.used_fallback:
                await self._control_plane.send_alert(
                    AlertRequest(tenant_id=self._tenant_id, type="llm_failover", message=f"Failover to {result.provider_key}.")
                )

            if result.provider_key is not None:
                # Only meaningful when at least one `llm`-type node actually
                # ran on the foreground path — a static-text Router-to-Speak
                # branch never touches an LLM, so no `hop="llm"` row is
                # produced for it (matches R-G9: only executed nodes are
                # recorded; `hop="node"` rows for every node still exist,
                # recorded by the interpreter itself via `ctx.hop_recorder`).
                await self._control_plane.send_hops(
                    self._session_id,
                    [
                        HopItem(
                            utterance_seq=seq,
                            hop="llm",
                            first_token_ms=result.first_token_ms,
                            provider_key=result.provider_key,
                            used_fallback=result.used_fallback,
                        )
                    ],
                )
            await self._hop_recorder.flush()

            self._memory.add_user_turn(text)
            if result.reply_text:
                self._memory.add_assistant_turn(result.reply_text)
                await self._control_plane.send_utterances(
                    self._session_id,
                    [UtteranceItem(seq=seq, role="assistant", text=result.reply_text, started_at=_now())],
                )
            if not result.spoken:
                # FR-TTS-3: nothing was spoken this turn (empty/no LLM
                # output and no explicit Speak node reached) -> no TTS hop
                # row required.
                logger.info("TTS_SKIPPED_EMPTY", session_id=str(self._session_id), seq=seq)
        finally:
            self._inflight = False

    async def _speak(self, seq: int, text: str) -> None:
        tts_started = now_ms()
        first_audio_ms: int | None = None
        if self._transport is not None:
            # Idempotent (adapter-side no-op after the first call) — every
            # utterance calls this rather than only the first, so the
            # audio track exists even if this is the very first thing the
            # session ever speaks.
            await self._transport.publish_audio_track("tts-audio")
        try:
            async for frame in self._tts.synthesize_stream(text, self._voice_id):
                if frame and first_audio_ms is None:
                    first_audio_ms = now_ms() - tts_started
                # FR-AVATAR-3: every TTS frame is pushed onto the room's
                # audio track *and* fed to the avatar adapter as its
                # lip-sync drive signal — two independent consumers of the
                # same synthesized audio, not a request/response pair
                # (mirrors `run_stt_loop`'s caption-publish/LLM-drive split
                # on the STT side).
                if self._transport is not None:
                    await self._transport.push_audio_frame(frame)
                if self._avatar is not None:
                    await self._drive_avatar_audio(frame)
            if self._avatar is not None:
                await self._safe_avatar_call(self._avatar.flush())
            await self._control_plane.send_hops(
                self._session_id,
                [
                    HopItem(
                        utterance_seq=seq,
                        hop="tts",
                        first_audio_ms=first_audio_ms,
                        total_ms=now_ms() - tts_started,
                        provider_key=self._tts.key,
                    )
                ],
            )
        except TtsError as err:
            await self._control_plane.send_hops(
                self._session_id,
                [HopItem(utterance_seq=seq, hop="tts", error_code=err.code, provider_key=self._tts.key)],
            )

    async def _drive_avatar_audio(self, frame: bytes) -> None:
        """Feeds one TTS frame into the avatar's lip-sync input
        (FR-AVATAR-3), degrading (not raising into `_speak`'s caller) on
        failure — a lip-sync push failure mid-utterance is exactly the
        FR-AVATAR-5 "avatar worker dies mid-session" case, not a reason to
        drop the utterance's audio too.
        """
        assert self._avatar is not None
        try:
            await self._avatar.push_audio_frame(frame)
        except AvatarError:
            logger.warning("avatar_push_audio_failed", session_id=str(self._session_id))
            await self._attempt_avatar_recovery()

    async def _safe_avatar_call(self, coro) -> None:  # noqa: ANN001 - thin fire-and-forget wrapper
        """Awaits a best-effort avatar SDK call (e.g. `flush()`), degrading
        rather than propagating on failure — mirrors `_drive_avatar_audio`'s
        treatment of an avatar failure as FR-AVATAR-5, not a turn failure.
        """
        try:
            await coro
        except AvatarError:
            logger.warning("avatar_call_failed", session_id=str(self._session_id))
            await self._attempt_avatar_recovery()

    async def start_avatar_session(self) -> None:
        """FR-AVATAR-1/3: opens the avatar's rendering session and starts
        the background task that pumps its produced video frames onto the
        room's video track.

        A no-op if this session has no avatar adapter or transport (audio-
        only sessions, or a unit test exercising STT/LLM/TTS alone).

        @raises AvatarError: only ever `code="AVATAR_NOT_FOUND"` — an
            unknown `avatar_id` (FR-AVATAR-1's "Session failed (no video)"),
            which `entrypoint.handle_job` treats as fatal to job start, the
            same way `STT_UNAVAILABLE` already is. Any other start failure
            is swallowed here and handled via the same retry-then-degrade
            path a later runtime crash takes (FR-AVATAR-5) — a bare "avatar
            didn't come up" infra hiccup isn't distinguishable from a
            config error the way a `404 AVATAR_NOT_FOUND` is, so it gets
            the more forgiving treatment.
        """
        if self._avatar is None or self._transport is None:
            return
        try:
            await self._avatar.start_session()
        except AvatarError as err:
            if err.code == "AVATAR_NOT_FOUND":
                raise
            logger.warning("avatar_start_failed_retrying", session_id=str(self._session_id))
            await self._attempt_avatar_recovery()
            return
        await self._publish_avatar_video()

    async def _attempt_avatar_recovery(self) -> None:
        """FR-AVATAR-5: "retry start once (2s delay); second failure -> keep
        audio-only ... session `degraded`, not `failed`."

        Cancels any still-running frame-pump task first — a crashed
        session that's retried must not end up with two pump tasks racing
        to push frames onto the same video track.
        """
        if self._avatar is None:
            return
        self._cancel_avatar_pump()
        await asyncio.sleep(_AVATAR_RETRY_DELAY_S)
        try:
            await self._avatar.start_session()
        except AvatarError:
            logger.error("avatar_unavailable_degraded", session_id=str(self._session_id))
            await self._control_plane.send_event(self._session_id, SessionEventRequest(type="degraded", at=_now()))
            await self._control_plane.send_alert(
                AlertRequest(
                    tenant_id=self._tenant_id,
                    type="provider_unreachable",
                    message="Avatar video interrupted. Audio continues.",
                )
            )
            await self._control_plane.send_hops(
                self._session_id,
                [
                    HopItem(
                        utterance_seq=_SESSION_LEVEL_UTTERANCE_SEQ,
                        hop="avatar",
                        error_code="AVATAR_UNAVAILABLE",
                        provider_key=self._avatar.key,
                    )
                ],
            )
            if self._transport is not None:
                # This is what makes the client's existing "no avatar
                # track" banner (Phase 3) reappear — no new frontend
                # behavior needed, per FR-AVATAR-5.
                await self._transport.unpublish_video_track()
            return
        await self._publish_avatar_video()

    async def _publish_avatar_video(self) -> None:
        """Publishes the avatar's first rendered frame (establishing the
        video track at its real dimensions) and starts the background task
        that pumps every subsequent frame. Records the `hop="avatar"`
        `first_frame_ms` metric (FR-AVATAR-4) once that first frame is
        actually on the wire.
        """
        assert self._avatar is not None and self._transport is not None
        started_ms = now_ms()
        frame_iter = self._avatar.frames()
        try:
            first_frame = await frame_iter.__anext__()
        except StopAsyncIteration:
            return
        except AvatarError:
            await self._attempt_avatar_recovery()
            return
        await self._transport.publish_video_track(_AVATAR_VIDEO_TRACK_ID, width=first_frame.width, height=first_frame.height)
        await self._transport.push_video_frame(first_frame)
        await self._control_plane.send_hops(
            self._session_id,
            [
                HopItem(
                    utterance_seq=_SESSION_LEVEL_UTTERANCE_SEQ,
                    hop="avatar",
                    first_frame_ms=self._avatar.first_frame_ms,
                    total_ms=now_ms() - started_ms,
                    provider_key=self._avatar.key,
                )
            ],
        )
        self._avatar_pump_task = asyncio.ensure_future(self._pump_avatar_frames(frame_iter))

    async def _pump_avatar_frames(self, frame_iter: AsyncIterator[VideoFrame]) -> None:
        """Long-running task: forwards every subsequent avatar frame onto
        the published video track until the stream ends or crashes.
        """
        assert self._transport is not None
        try:
            async for frame in frame_iter:
                await self._transport.push_video_frame(frame)
        except asyncio.CancelledError:
            raise
        except AvatarError:
            logger.exception("avatar_stream_crashed", session_id=str(self._session_id))
            await self._attempt_avatar_recovery()

    def _cancel_avatar_pump(self) -> None:
        """Cancels the frame-pump task if one is still running, then clears
        the reference either way.

        QA D-1 (phase5-agent-bithuman): when `_pump_avatar_frames` itself
        crashes and calls `_attempt_avatar_recovery` from within its own
        `except AvatarError` clause, `self._avatar_pump_task` **is** the
        currently-executing task — calling `.cancel()` on it self-inflicts a
        `CancelledError` that's delivered at the very next `await`
        (`asyncio.sleep` in `_attempt_avatar_recovery`), silently killing
        recovery before it ever retries, degrades, or unpublishes the video
        track. Comparing against `asyncio.current_task()` lets this method
        stay the single place every recovery path calls (start-time failure,
        a live push-audio failure while the pump is still racing along, and
        the pump's own crash) without special-casing each caller: a task
        never needs to (and must not) cancel itself — once its own coroutine
        raises/returns it is already finishing, so clearing the reference is
        all that's needed in that case.
        """
        task = self._avatar_pump_task
        if task is not None and not task.done() and task is not asyncio.current_task():
            task.cancel()
        self._avatar_pump_task = None

    async def generate_summary(self) -> None:
        """FR-CALL-4: generates the post-call summary (if the primary LLM is
        reachable) and posts it via `control_plane.send_summary`.

        QA fix (phase7-conversation-summary D-1): `summary.post_call
        .generate_and_send_summary` existed and was fully unit-tested in
        isolation, but nothing in the running agent ever called it —
        `entrypoint.handle_job`'s teardown only ever sent the `"ended"`
        session event. This method is the missing link: it is invoked from
        `handle_job`'s `finally` block (alongside that same event) so a
        real call's end genuinely reaches the LLM and posts a real summary,
        not merely a unit test calling the function directly.

        Builds the `ResidencyPayload` directly from this session's own
        memory window (unlike `_process_utterance`, there is no "current
        turn" for a summary call — only prior history — so `build_payload`'s
        `Turn` requirement doesn't fit; this mirrors `_apply_tool_results`'s
        existing precedent of constructing `ResidencyPayload` directly for
        a shape `build_payload` wasn't designed for). Memory itself only
        ever holds this session's own turns (FR-AGENT-3), so this still
        respects the residency snapshot taken at session start.

        A `residency_mode == "none"` session must never reach a remote LLM
        at all (blocked at config-save time, FR-PRIV-2) — defensively
        skipped here exactly like `_process_utterance`'s own
        `ResidencyBlockedError` handling, rather than ever attempting the
        call.

        Never raises: `generate_and_send_summary` swallows `LlmError` into a
        `summary_status="unavailable"` write *and* (QA D-5,
        phase7-agent-summary-wiring retry 1) catches any other exception at
        that same boundary, and `ControlPlaneClient.send_summary` is itself
        best-effort (never raises to its caller, LLD §10.8) — so a summary
        failure can never block or delay the rest of session teardown.

        That property is no longer load-bearing on its own, either:
        `entrypoint.handle_job` wraps this call in `_guarded_teardown_step`,
        so even a regression here cannot cost the session its terminal
        `"ended"` event. The three layers (adapter classification, this
        function's caller, the teardown guard) are independent by design —
        D-5 was caused by exactly one of them being assumed rather than
        enforced.
        """
        if self._residency_mode == "none":
            logger.error("RESIDENCY_BLOCKED", session_id=str(self._session_id), context="summary")
            return

        # Local import: `summary.post_call` depends on `orchestration`'s own
        # ports (`ILLMProvider`, `ResidencyPayload`) — importing it at module
        # scope here would create a cycle with `summary` importing back into
        # `orchestration` in a future change; a local import keeps the
        # dependency one-directional without restructuring either package.
        from avatar_agent.summary.post_call import generate_and_send_summary

        residency = ResidencyPayload(
            system_prompt=self._system_prompt,
            messages=tuple(self._memory.as_messages()),
        )
        await generate_and_send_summary(self._summary_llm, self._session_id, residency, self._control_plane)  # type: ignore[arg-type]

    async def aclose(self) -> None:
        """Session teardown: cancels the frame-pump task and releases the
        avatar adapter's own resources. Safe to call even if
        `start_avatar_session` was never called (no-op avatar/transport).
        A close failure is logged, never raised — teardown must always
        complete so the rest of `entrypoint.handle_job`'s own teardown
        (control-plane "ended" event) still runs.
        """
        self._cancel_avatar_pump()
        if self._avatar is not None:
            try:
                await self._avatar.close()
            except AvatarError:
                logger.warning("avatar_close_failed", session_id=str(self._session_id))

    async def _enter_degraded_mode(self, seq: int) -> None:
        """FR-LLM-2/FR-ALERT-3 — session stays `active`; speaks the
        degraded message at most once per 30s per session.
        """
        await self._control_plane.send_event(self._session_id, SessionEventRequest(type="degraded", at=_now()))
        await self._control_plane.send_alert(
            AlertRequest(tenant_id=self._tenant_id, type="llm_failover", message="Both LLM legs exhausted; degraded mode.")
        )
        await self._control_plane.send_hops(
            self._session_id,
            [HopItem(utterance_seq=seq, hop="llm", error_code="LLM_UNAVAILABLE")],
        )
        if self._degraded_throttle.should_speak():
            await self._speak(seq, self._degraded_message)


def _now():
    from datetime import UTC, datetime

    return datetime.now(UTC)
