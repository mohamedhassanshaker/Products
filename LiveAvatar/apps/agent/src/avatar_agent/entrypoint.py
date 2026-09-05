"""Per-job handler (LLD §3.3): parses room/job metadata -> fetches the
session's `AgentRuntimeConfig` -> builds the pipeline -> runs it until the
room ends.

QA fix (phase4-agent-python D-1 / phase4-conversation-captions D-1):
`handle_job` previously never subscribed to the caller's audio track or fed
it through STT at all — this module's own docstring claimed the wiring
"lives here" while the function body only awaited `ctx.room.disconnected`.
It now subscribes to every remote audio track via LiveKit's `track_subscribed`
room event and runs each one through `ConversationPipeline.run_stt_loop`,
genuinely reaching `on_final_utterance`/`HopRecorder`/`publish_transcription`
in production, not merely in a unit test.

Disclosed limitation (same class of gap Phase 3 accepted for
`livekit-server-sdk`): this wiring is implemented against the installed
`livekit-agents`/`livekit` 1.x documented API surface (`rtc.AudioStream`,
`Room.on("track_subscribed", ...)`, `LocalParticipant.publish_transcription`)
but has never run against a live LiveKit server in this sandbox (no
Docker/network LiveKit instance reachable here) — unlike before this fix,
though, the composition itself now exists and is unit-tested (`ConversationPipeline.run_stt_loop`,
`LiveKitTransportAdapter.publish_transcription`), not merely asserted in a
comment.
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator, Awaitable
from uuid import UUID

import structlog
from livekit import rtc
from livekit.agents import JobContext

from avatar_agent.adapters.transport.livekit import LiveKitTransportAdapter
from avatar_agent.contracts.internal_api import SessionEventRequest
from avatar_agent.contracts.runtime_config import AgentRuntimeConfig, LlmLeg, LlmNode, ToolDefinitionDto
from avatar_agent.orchestration.graph_langgraph import LangGraphOrchestrator
from avatar_agent.orchestration.graph_pydantic_ai import PydanticAiOrchestrator
from avatar_agent.orchestration.memory import SessionMemory
from avatar_agent.orchestration.pipeline import ConversationPipeline
from avatar_agent.orchestration.tools import ToolDefinition, ToolExecutor
from avatar_agent.ports.avatar import AvatarError
from avatar_agent.ports.embedding import IEmbeddingProvider
from avatar_agent.ports.llm import ILLMProvider, ToolSpec
from avatar_agent.ports.orchestration import ResolvedLlmNode
from avatar_agent.ports.secrets import SecretNotFoundError, SecretStorePort
from avatar_agent.ports.transport import ITransportProvider
from avatar_agent.registry.errors import FactoryLoadError
from avatar_agent.registry.registry import (
    EmbeddingRequestConfig,
    resolve_avatar,
    resolve_embedding,
    resolve_llm,
    resolve_stt,
    resolve_tts,
)
from avatar_agent.secrets.directory_store import DirectorySecretStore
from avatar_agent.settings import Settings, load_settings
from avatar_agent.telemetry.control_plane import (
    ControlPlaneAlertAdapter,
    ControlPlaneClient,
    ControlPlaneHitlDecisionAdapter,
    ControlPlaneKnowledgeGapAdapter,
    ControlPlaneKnowledgeSearchAdapter,
    ControlPlaneSkillBodyAdapter,
    ControlPlaneSubAgentPersonaAdapter,
)

logger = structlog.get_logger(__name__)

# 16kHz mono 16-bit PCM — what both `deepgram.py` (`sample_rate=16000`,
# `encoding="linear16"`) and `faster_whisper.py` (`16000 * 2` bytes/sec
# assumption baked into `_CHUNK_BYTES`) expect from `audio_pcm`.
_STT_SAMPLE_RATE_HZ = 16000

# Phase 12a's platform-wide single-embedding-model constraint (see the plan
# doc's Phase 12a "Decisions made this phase" #1 — pgvector's ANN index
# column width is fixed, so only this one model/dimension is selectable this
# phase). `credential_ref=None` falls back to the platform default
# `AI_API_KEY`/`AI_BASE_URL` env vars the registry already resolves for an
# absent ref, exactly like 12a's ingestion path does. A future phase can
# thread a real per-source embedding credential through if multiple
# embedding models/credentials ever need to coexist.
_EMBEDDING_PROVIDER = "openai"
_EMBEDDING_MODEL = "text-embedding-3-small"


def _resolve_tools(cfg: AgentRuntimeConfig, secrets: SecretStorePort) -> tuple[list[ToolDefinition], list[ToolSpec]]:
    """Builds real `ToolDefinition`/`ToolSpec` lists from
    `cfg.tool_definitions` (FR-AGENT-2, QA phase4-agent-python D-2) — the
    control plane's `GET /internal/sessions/{id}/runtime-config` response
    already filters this to only the tenant's *enabled* tools whose
    `api_ref` resolved against a real row, so no further enable/disable
    filtering happens here.

    A tool whose `credential_ref` fails to resolve is not fatal to job
    start (unlike STT/LLM/TTS) — FR-AGENT-2/5 require a tool call to
    degrade to a fed-back error, never abort the conversation, so this
    tool is still registered (its calls will simply fail with no
    `Authorization` header, which `ToolExecutor`/the pipeline already
    handle as a non-fatal `ToolError`).
    """
    definitions: list[ToolDefinition] = []
    specs: list[ToolSpec] = []
    dto: ToolDefinitionDto
    for dto in cfg.tool_definitions:
        api_key: str | None = None
        if dto.credential_ref is not None:
            try:
                api_key = secrets.resolve(dto.credential_ref)
            except SecretNotFoundError:
                logger.warning("tool_credential_unresolvable", api_ref=dto.api_ref, session_id=str(cfg.session_id))
        definitions.append(
            ToolDefinition(api_ref=dto.api_ref, name=dto.name, method=dto.method, url=str(dto.url), api_key=api_key)
        )
        specs.append(ToolSpec(name=dto.name, description=dto.description or "", parameters=dto.args_schema))
    return definitions, specs


def _resolve_llm_nodes(cfg: AgentRuntimeConfig, secrets: SecretStorePort) -> dict[str, ResolvedLlmNode]:
    """Resolves every `llm`-type `reasoning.graph[]` node's provider(s)
    (Phase 9, BL-036) — replaces the pre-Phase-9 single primary/fallback
    pair resolved once per session. A node's **primary** leg failing to
    resolve is fatal to job start (`FactoryLoadError` propagates, same as
    the old `llm_primary` resolution); its **fallback** failing is not
    (logged, that node simply runs without one — same as before).
    """
    resolved: dict[str, ResolvedLlmNode] = {}
    for node in cfg.reasoning.graph:
        if not isinstance(node, LlmNode):
            continue
        primary = resolve_llm(cfg, LlmLeg(provider=node.provider, credential_ref=node.credential_ref, model=node.model), secrets)
        fallback = None
        if node.fallback is not None:
            try:
                fallback = resolve_llm(cfg, node.fallback, secrets)
            except FactoryLoadError:
                logger.warning("llm_fallback_unresolvable", session_id=str(cfg.session_id), node_id=node.id)
        resolved[node.id] = ResolvedLlmNode(primary=primary, fallback=fallback, retry=node.retry)
    return resolved


def _resolve_default_llm(cfg: AgentRuntimeConfig, llm_by_node: dict[str, ResolvedLlmNode]) -> ResolvedLlmNode | None:
    """Phase 12b (BL-045/047): the Retrieve node's rewrite stage has no LLM
    node of its own — uses the *first* `llm`-type node's resolved
    primary/fallback/retry, the same "first LLM node = primary" convention
    `_resolve_summary_llm` below already uses for FR-CALL-4's summary call.
    `None` when the graph has no LLM node at all (an edge case) — the
    rewrite stage then silently no-ops (see `nodes/retrieve.py`) rather than
    failing the node over a missing LLM leg.
    """
    for node in cfg.reasoning.graph:
        if isinstance(node, LlmNode):
            return llm_by_node[node.id]
    return None


def _resolve_embedding_provider(secrets: SecretStorePort) -> IEmbeddingProvider | None:
    """Phase 12b (BL-045/047): resolves the Retrieve node's embedding
    adapter ONCE per session, here in `entrypoint` (not inside
    `orchestration`) — `.importlinter`'s `orchestration-uses-ports` contract
    forbids `avatar_agent.orchestration` from reaching
    `avatar_agent.adapters` even indirectly, and `registry.resolve_embedding`
    transitively imports vendor adapter modules. Mirrors the exact
    "pre-resolved once per session" convention `_resolve_llm_nodes` already
    follows for `llm_by_node`. Non-fatal to job start on failure (unlike
    STT) — a session with no working embedding adapter simply has retrieval
    unavailable (the hybrid search stage then reports zero candidates,
    R-R3), never a reason to abort the whole call.

    Catches a broad `Exception`, not just `FactoryLoadError`: this call
    deliberately always passes `credential_ref=None` (the platform-default
    convention, see the plan doc's Phase 12a "only one model is selectable"
    decision) rather than a per-tenant credential the way `resolve_llm`/
    `resolve_stt`/`resolve_tts`/`resolve_avatar` above always have one
    supplied — so, unlike those calls, there is no tenant-config-level
    guarantee a real API key is available. When the platform-wide
    `AI_API_KEY`/`OPENAI_API_KEY` env var is unset, the vendor SDK itself
    raises directly out of the adapter's own constructor (a real
    `openai.OpenAIError`, not a `FactoryLoadError` the registry classifies)
    — a legitimate, expected "no platform key configured" outcome for any
    tenant that has never used retrieval, not a reason to fail job start.
    """
    try:
        return resolve_embedding(EmbeddingRequestConfig(provider=_EMBEDDING_PROVIDER, model=_EMBEDDING_MODEL), secrets)
    except Exception as err:  # noqa: BLE001 - see docstring: a missing platform API key must never fail job start
        logger.info("embedding_unavailable_retrieval_disabled", reason=str(err))
        return None


def _build_effective_system_prompt(cfg: AgentRuntimeConfig) -> str:
    """R-S1 (Phase 13, BL-049/050/051; `ARCHITECTURE_NOTES.md` §5.3) —
    appends only the attached skills' name+description blurbs onto the
    base system prompt. This is the **one** place the effective base
    prompt is assembled — never a second prompt-building path — and it
    never touches `cfg.skills` (the raw, unresolved `{id, version}` refs);
    only the already-resolved `cfg.skill_summaries` (see
    `GetRuntimeConfigUseCase`) ever reaches this function, which is what
    keeps a skill's full `instructions` out of the base prompt entirely —
    those are fetched lazily, only once a `skill`-type node's trigger
    fires (`orchestration/graph/nodes/skill.py`), never here.
    """
    if not cfg.skill_summaries:
        return cfg.agent.system_prompt
    lines = "\n".join(f"- {s.name}: {s.description}" for s in cfg.skill_summaries)
    return f"{cfg.agent.system_prompt}\n\nAvailable skills:\n{lines}"


def _resolve_summary_llm(cfg: AgentRuntimeConfig, llm_by_node: dict[str, ResolvedLlmNode]) -> ILLMProvider:
    """`generate_summary` (FR-CALL-4) has no graph node of its own — uses
    the *first* `llm`-type node's primary provider (the same "first LLM
    node = primary" convention the control plane's denormalized
    `DeploymentConfig.llmProvider` column uses, see
    `apps/api/.../save-config.use-case.ts`).
    """
    for node in cfg.reasoning.graph:
        if isinstance(node, LlmNode):
            return llm_by_node[node.id].primary
    # Schema/Gate-B guarantees at least one `llm` node exists on a published
    # config (`reasoning.llm` completeness rule) — unreachable in practice.
    raise FactoryLoadError("no llm-type node in reasoning.graph", logical_key="reasoning.graph")


def build_pipeline(
    cfg: AgentRuntimeConfig,
    settings: Settings,
    control_plane: ControlPlaneClient,
    transport: ITransportProvider | None = None,
) -> ConversationPipeline:
    """Resolves every adapter + orchestration component for one session's
    `AgentRuntimeConfig` and wires a `ConversationPipeline`. Pure
    composition — no I/O beyond what `resolve_*`/`ControlPlaneClient`
    already do, which is what makes this independently unit-testable.

    @raises avatar_agent.registry.errors.FactoryLoadError: STT is required
        in v1 (FR-STT-1) — a failure here is fatal to job start.
    """
    secrets = DirectorySecretStore(settings.secrets_dir)

    stt = resolve_stt(cfg, secrets)  # required; propagates FactoryLoadError -> caller marks session failed
    llm_by_node = _resolve_llm_nodes(cfg, secrets)
    summary_llm = _resolve_summary_llm(cfg, llm_by_node)
    tts = resolve_tts(cfg, secrets)
    avatar = None
    try:
        avatar = resolve_avatar(cfg, secrets)
    except (FactoryLoadError, AvatarError) as err:
        # `FactoryLoadError`: no factory registered for this session's avatar
        # provider key at all (shouldn't happen for the two v1 catalog
        # entries -- `bithuman`/`alibaba-liveavatar` both have real factories
        # as of Phase 6/BL-019 -- but stays a non-fatal path for forward
        # compatibility with a future, not-yet-implemented provider key).
        # `AvatarError` (only ever raised by the adapter's own constructor,
        # never `AVATAR_NOT_FOUND` from actually asking the vendor -- that
        # only happens inside `start_session`, below): a missing credential
        # or a malformed `avatar_id` this session's own config never even
        # lets the adapter try to start with. Both collapse to the same
        # FR-AVATAR-5 audio-continues path -- only a *real* vendor
        # `AVATAR_NOT_FOUND` (from `pipeline.start_avatar_session`, once a
        # session actually asks bitHuman/LiveAvatar) is fatal per FR-AVATAR-1.
        logger.info(
            "avatar_unavailable_audio_only",
            session_id=str(cfg.session_id),
            provider=cfg.avatar.provider,
            reason=str(err),
        )

    orchestrator = LangGraphOrchestrator() if cfg.agent.runtime == "langgraph" else PydanticAiOrchestrator()

    memory = SessionMemory(cfg.agent.memory.window_turns, enabled=cfg.agent.memory.enabled)
    tool_executor = ToolExecutor()
    tools, tool_specs = _resolve_tools(cfg, secrets)

    # Phase 12b (BL-045/047): both new knowledge ports are satisfied by the
    # same `ControlPlaneClient` instance already constructed for this
    # session (see `ControlPlaneKnowledgeSearchAdapter`/
    # `ControlPlaneKnowledgeGapAdapter`'s own docstrings for why they're
    # thin adapters rather than methods named directly `search`/`record_gap`
    # on `ControlPlaneClient` itself).
    knowledge_search = ControlPlaneKnowledgeSearchAdapter(control_plane)
    knowledge_gap = ControlPlaneKnowledgeGapAdapter(control_plane)
    embedding_provider = _resolve_embedding_provider(secrets)
    # Phase 13 (BL-049/050/051) — same "satisfied by the same
    # `ControlPlaneClient` instance already constructed for this session"
    # pattern the two knowledge adapters above already use.
    skill_body_port = ControlPlaneSkillBodyAdapter(control_plane)
    # Phase 14 (BL-052..057) — same pattern again, for the Hitl node's
    # create/poll port.
    hitl_decision_port = ControlPlaneHitlDecisionAdapter(control_plane)
    # Phase 15 (BL-058/059) — same pattern again, for the Sub-agent node's
    # persona-fetch port and the Handoff node's alert-firing port.
    subagent_persona_port = ControlPlaneSubAgentPersonaAdapter(control_plane)
    alert_port = ControlPlaneAlertAdapter(control_plane)

    return ConversationPipeline(
        session_id=cfg.session_id,
        tenant_id=cfg.deployment.tenant_id,
        stt=stt,
        reasoning=cfg.reasoning,
        llm_by_node=llm_by_node,
        summary_llm=summary_llm,
        tts=tts,
        voice_id=cfg.tts.voice_id,
        system_prompt=_build_effective_system_prompt(cfg),
        residency_mode=cfg.privacy.send_to_remote_llm,
        memory=memory,
        default_llm=_resolve_default_llm(cfg, llm_by_node),
        knowledge_pipeline=cfg.knowledge.pipeline,
        knowledge_search=knowledge_search,
        knowledge_gap=knowledge_gap,
        embedding_provider=embedding_provider,
        skill_body_port=skill_body_port,
        secrets=secrets,
        hitl_decision_port=hitl_decision_port,
        subagent_persona_port=subagent_persona_port,
        alert_port=alert_port,
        tool_executor=tool_executor,
        tools=tools,
        tool_specs=tool_specs,
        orchestrator=orchestrator,
        control_plane=control_plane,
        degraded_message=cfg.alerts.degraded_mode_message,
        transport=transport,
        avatar=avatar,
    )


async def _pump_track_audio(track: rtc.Track) -> AsyncIterator[bytes]:
    """Adapts a subscribed LiveKit audio track into the raw 16kHz mono PCM
    byte stream `ISTTProvider.transcribe_stream` expects (FR-STT-1..4).
    """
    audio_stream = rtc.AudioStream(track, sample_rate=_STT_SAMPLE_RATE_HZ, num_channels=1)
    async for event in audio_stream:
        yield bytes(event.frame.data)


async def _guarded_teardown_step(coro: Awaitable[None], *, step: str, session_id: UUID) -> None:
    """Awaits one end-of-session teardown step, swallowing (and logging) any
    exception it raises so the steps after it — above all the terminal
    `"ended"` session event — still run.

    Teardown is a sequence of independent best-effort cleanups, not a
    transaction: an avatar adapter that fails to close or a summary that
    fails to generate must not cost the session its terminal event, which is
    what marks it `ended` for the whole control plane (and, downstream, for
    the end user's conversation history). `asyncio.CancelledError` is a
    `BaseException` and is deliberately NOT caught — a cancelled job must
    still unwind.

    @param coro: the teardown step to await.
    @param step: short identifier used in the failure log line.
    @param session_id: session being torn down, for log correlation.
    @returns nothing; never raises.
    """
    try:
        await coro
    except Exception:  # noqa: BLE001 - teardown must always reach the "ended" event
        logger.exception("teardown_step_failed", session_id=str(session_id), step=step)


async def handle_job(ctx: JobContext) -> None:
    """LiveKit Agents entrypoint (`WorkerOptions.entrypoint_fnc`).

    Room/job metadata carries `{"session_id": ..., "tenant_id": ...}`,
    set by the control plane's `IssueConversationTokenUseCase` at explicit
    dispatch time (LLD §8.3 step 7).
    """
    settings = load_settings()
    metadata = json.loads(ctx.job.metadata or "{}")
    session_id = UUID(metadata["session_id"])

    control_plane = ControlPlaneClient(settings.control_plane_internal_url, settings.internal_token)

    try:
        cfg = await control_plane.get_runtime_config(session_id)
    except Exception:
        logger.exception("runtime_config_fetch_failed", session_id=str(session_id))
        return

    await ctx.connect()
    transport = LiveKitTransportAdapter(ctx.room)

    try:
        pipeline = build_pipeline(cfg, settings, control_plane, transport)
    except FactoryLoadError as err:
        # STT is required in v1 (FR-STT-1) — no STT means the session cannot proceed.
        logger.error("pipeline_build_failed", session_id=str(session_id), logical_key=err.logical_key)
        await control_plane.send_event(session_id, SessionEventRequest(type="failed", error_code="STT_UNAVAILABLE", at=_now()))
        return

    try:
        await pipeline.start_avatar_session()
    except AvatarError as err:
        # FR-AVATAR-1: an unknown `avatar_id` is fatal to job start, exactly
        # like `STT_UNAVAILABLE` above — "Session failed (no video)", not a
        # degrade, since there is no video to ever recover into for a
        # misconfigured (not merely momentarily-unavailable) avatar_id.
        logger.error("avatar_not_found", session_id=str(session_id))
        await control_plane.send_event(session_id, SessionEventRequest(type="failed", error_code=err.code, at=_now()))
        return

    consumer_task = ctx.room.loop.create_task(pipeline.run_consumer_loop()) if hasattr(ctx.room, "loop") else None
    stt_tasks: list[asyncio.Task] = []

    def _on_track_subscribed(track: rtc.Track, publication: rtc.TrackPublication, participant: rtc.RemoteParticipant) -> None:
        """`Room.on("track_subscribed", ...)` — the real per-frame audio-track
        subscription this module's docstring previously only described (QA
        D-1). One `run_stt_loop` task per subscribed audio track — a room
        normally has exactly one remote (human) participant/track for a
        1:1 avatar call.
        """
        if track.kind != rtc.TrackKind.KIND_AUDIO:
            return
        task = asyncio.ensure_future(
            pipeline.run_stt_loop(
                _pump_track_audio(track),
                participant_identity=participant.identity,
                track_sid=publication.sid,
            )
        )
        stt_tasks.append(task)

    ctx.room.on("track_subscribed", _on_track_subscribed)

    try:
        # Per-frame audio-track subscription -> STT streaming is wired via
        # the `track_subscribed` handler above; TTS-frame -> LiveKit audio
        # publish and avatar video publish are wired inside `pipeline.py`
        # (`_speak`/`start_avatar_session`, Phase 5, BL-018).
        await ctx.room.disconnected if hasattr(ctx.room, "disconnected") else None
    finally:
        for task in stt_tasks:
            task.cancel()
        if consumer_task is not None:
            consumer_task.cancel()
        await _guarded_teardown_step(pipeline.aclose(), step="aclose", session_id=session_id)
        # FR-CALL-4 / QA D-1 (phase7-conversation-summary): the real
        # end-of-call path — this `finally` block is the only place a real
        # room teardown is observed, exactly like the `"ended"` event sent
        # right after it. Runs before that event so a summary genuinely
        # generated for this call is already posted by the time the control
        # plane marks the session `ended`.
        #
        # QA D-5 (phase7-agent-summary-wiring retry 1): the `"ended"` event
        # below must NOT depend on `generate_summary`'s own "never raises"
        # promise holding. It did not — an `AuthenticationError` the `openai`
        # adapter left unclassified propagated out of this very `finally`,
        # skipping the event and raising out of the entrypoint. The adapters
        # and `summary.post_call` are both hardened now; this guard is the
        # last line, so no future summary-path exception can ever again cost
        # a session its terminal event.
        await _guarded_teardown_step(pipeline.generate_summary(), step="generate_summary", session_id=session_id)
        await control_plane.send_event(session_id, SessionEventRequest(type="ended", at=_now()))


def _now():
    from datetime import UTC, datetime

    return datetime.now(UTC)
