"""Unit tests for `entrypoint.build_pipeline`/`handle_job` — the per-job
composition root and its LiveKit room/track wiring.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock
from uuid import UUID

from avatar_agent.contracts.runtime_config import AgentRuntimeConfig
from avatar_agent.entrypoint import _resolve_default_llm, _resolve_llm_nodes, _resolve_summary_llm, build_pipeline, handle_job
from avatar_agent.orchestration.pipeline import ConversationPipeline
from avatar_agent.registry.errors import FactoryLoadError
from avatar_agent.secrets.directory_store import DirectorySecretStore
from avatar_agent.settings import Settings

TENANT_ID = "11111111-1111-1111-1111-111111111111"
SESSION_ID = "22222222-2222-2222-2222-222222222222"


_DEFAULT_KNOWLEDGE = {
    "pipeline": {
        "rewrite": {"enabled": True, "context_turns": 3, "budget_ms": 150},
        "hybrid_search": {"vector_weight": 0.6, "keyword_weight": 0.4, "candidates": 20, "budget_ms": 100},
        "metadata_filter": {"enabled": False, "budget_ms": 20},
        "rerank": {"enabled": False},
        "threshold": {"min_score": 0.5, "budget_ms": 10},
        "inject": {"token_cap": 1200, "citation_format": "numbered", "budget_ms": 30},
    }
}


def make_cfg(**overrides: object) -> AgentRuntimeConfig:
    base = {
        "version": 1,
        "deployment": {"tenant_id": TENANT_ID, "name": "t"},
        "transport": {"provider": "livekit", "room_namespace": "acme"},
        "stt": {"provider": "deepgram", "credential_ref": "secrets/deepgram", "language": "en-US"},
        "reasoning": {
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
                    "credential_ref": "secrets/openai",
                    "model": "gpt-4o",
                    "retry": {"max_attempts": 3, "backoff_ms": [200, 400, 800]},
                    "next_node_id": None,
                }
            ],
        },
        "tts": {"provider": "fish-speech", "credential_ref": "secrets/fish-speech", "voice_id": "v1"},
        "avatar": {"provider": "bithuman", "credential_ref": "secrets/bithuman", "avatar_id": "a1"},
        "agent": {
            "runtime": "langgraph",
            "system_prompt": "hi",
            "tools": [],
            "memory": {"enabled": True, "window_turns": 16},
        },
        "knowledge": _DEFAULT_KNOWLEDGE,
        "privacy": {"send_to_remote_llm": "prompt_text_only", "retain_transcripts_days": 90, "recordings_enabled": False},
        "alerts": {"degraded_mode_message": "hold on"},
        "session_id": SESSION_ID,
        "room_name": "acme_s1",
        "endpoints": {
            "deepgram": "https://stt.example.com",
            "openai": "https://api.openai.com",
            "fish-speech": "https://tts.example.com",
        },
    }
    base.update(overrides)
    return AgentRuntimeConfig.model_validate(base)


def make_settings(tmp_path) -> Settings:
    (tmp_path / "secrets").mkdir()
    for name, value in [
        ("secrets/deepgram", "dg-key"),
        ("secrets/openai", "sk-key"),
        ("secrets/fish-speech", "fs-key"),
        ("secrets/anthropic", "an-key"),
    ]:
        path = tmp_path / name
        path.write_text(value, encoding="utf-8")
    return Settings(secrets_dir=str(tmp_path))


class FakeControlPlane:
    async def send_hops(self, *a, **k):  # noqa: ANN002, ANN003
        pass


def test_build_pipeline_resolves_stt_llm_tts_and_returns_a_conversation_pipeline(tmp_path) -> None:
    pipeline = build_pipeline(make_cfg(), make_settings(tmp_path), FakeControlPlane())  # type: ignore[arg-type]
    assert isinstance(pipeline, ConversationPipeline)


def test_build_pipeline_propagates_factory_load_error_when_stt_is_unresolvable(tmp_path) -> None:
    cfg = make_cfg()
    cfg.stt.credential_ref = "secrets/does-not-exist"
    try:
        build_pipeline(cfg, make_settings(tmp_path), FakeControlPlane())  # type: ignore[arg-type]
        raised = False
    except FactoryLoadError:
        raised = True
    assert raised


def test_build_pipeline_tolerates_an_unresolvable_fallback_without_raising(tmp_path) -> None:
    cfg = make_cfg(
        reasoning={
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
                    "credential_ref": "secrets/openai",
                    "model": "gpt-4o",
                    "fallback": {
                        "provider": "anthropic",
                        "credential_ref": "secrets/does-not-exist",
                        "model": "claude-3-5-sonnet",
                    },
                    "retry": {"max_attempts": 3, "backoff_ms": [200, 400, 800]},
                    "next_node_id": None,
                }
            ],
        }
    )
    # Must not raise even though the fallback leg's credential can't resolve.
    pipeline = build_pipeline(cfg, make_settings(tmp_path), FakeControlPlane())  # type: ignore[arg-type]
    assert isinstance(pipeline, ConversationPipeline)


# --- Phase 9 (BL-036): `_resolve_llm_nodes`/`_resolve_summary_llm` ---------


_TWO_LLM_NODE_REASONING = {
    "entry_node_id": "llm-1",
    "background_entry_node_ids": [],
    "turn_budget_ms": 3000,
    "graph": [
        {
            "id": "llm-1",
            "type": "llm",
            "name": "Primary node",
            "lane": "foreground",
            "on_error": {"action": "degrade"},
            "on_deadline": {"action": "degrade"},
            "provider": "openai",
            "credential_ref": "secrets/openai",
            "model": "gpt-4o",
            "retry": {"max_attempts": 3, "backoff_ms": [200, 400, 800]},
            "next_node_id": None,
        },
        {
            "id": "llm-2",
            "type": "llm",
            "name": "Secondary node",
            "lane": "foreground",
            "on_error": {"action": "degrade"},
            "on_deadline": {"action": "degrade"},
            "provider": "anthropic",
            "credential_ref": "secrets/anthropic",
            "model": "claude-3-5-sonnet",
            "retry": {"max_attempts": 3, "backoff_ms": [200, 400, 800]},
            "next_node_id": None,
        },
    ],
}


def test_resolve_llm_nodes_resolves_every_llm_type_node(tmp_path) -> None:
    """Phase 9 (BL-036): every `llm`-type `reasoning.graph[]` node's provider
    is resolved, not just one primary/fallback pair (R-G1/BL-036).
    """
    cfg = make_cfg(reasoning=_TWO_LLM_NODE_REASONING)
    secrets = DirectorySecretStore(make_settings(tmp_path).secrets_dir)

    resolved = _resolve_llm_nodes(cfg, secrets)

    assert set(resolved) == {"llm-1", "llm-2"}
    assert resolved["llm-1"].primary.key == "openai"
    assert resolved["llm-2"].primary.key == "anthropic"
    assert resolved["llm-1"].fallback is None


def test_resolve_llm_nodes_a_nodes_fallback_failing_to_resolve_is_logged_and_skipped(tmp_path) -> None:
    reasoning = {
        "entry_node_id": "llm-1",
        "background_entry_node_ids": [],
        "turn_budget_ms": 3000,
        "graph": [
            {
                "id": "llm-1",
                "type": "llm",
                "name": "Primary node",
                "lane": "foreground",
                "on_error": {"action": "degrade"},
                "on_deadline": {"action": "degrade"},
                "provider": "openai",
                "credential_ref": "secrets/openai",
                "model": "gpt-4o",
                "fallback": {"provider": "anthropic", "credential_ref": "secrets/does-not-exist", "model": "claude-3-5-sonnet"},
                "retry": {"max_attempts": 3, "backoff_ms": [200, 400, 800]},
                "next_node_id": None,
            }
        ],
    }
    cfg = make_cfg(reasoning=reasoning)
    secrets = DirectorySecretStore(make_settings(tmp_path).secrets_dir)

    # Must not raise even though the fallback leg's credential can't resolve.
    resolved = _resolve_llm_nodes(cfg, secrets)

    assert resolved["llm-1"].primary.key == "openai"
    assert resolved["llm-1"].fallback is None


def test_resolve_llm_nodes_a_nodes_primary_failing_to_resolve_propagates_factory_load_error(tmp_path) -> None:
    reasoning = {
        "entry_node_id": "llm-1",
        "background_entry_node_ids": [],
        "turn_budget_ms": 3000,
        "graph": [
            {
                "id": "llm-1",
                "type": "llm",
                "name": "Primary node",
                "lane": "foreground",
                "on_error": {"action": "degrade"},
                "on_deadline": {"action": "degrade"},
                "provider": "openai",
                "credential_ref": "secrets/does-not-exist",
                "model": "gpt-4o",
                "retry": {"max_attempts": 3, "backoff_ms": [200, 400, 800]},
                "next_node_id": None,
            }
        ],
    }
    cfg = make_cfg(reasoning=reasoning)
    secrets = DirectorySecretStore(make_settings(tmp_path).secrets_dir)

    try:
        _resolve_llm_nodes(cfg, secrets)
        raised = False
    except FactoryLoadError:
        raised = True
    assert raised


def test_resolve_summary_llm_uses_the_first_llm_type_nodes_primary_provider(tmp_path) -> None:
    cfg = make_cfg(reasoning=_TWO_LLM_NODE_REASONING)
    secrets = DirectorySecretStore(make_settings(tmp_path).secrets_dir)
    llm_by_node = _resolve_llm_nodes(cfg, secrets)

    summary_llm = _resolve_summary_llm(cfg, llm_by_node)

    assert summary_llm is llm_by_node["llm-1"].primary
    assert summary_llm.key == "openai"


def test_resolve_default_llm_uses_the_first_llm_type_nodes_resolved_node(tmp_path) -> None:
    """Phase 12b (BL-045/047): the Retrieve node's rewrite stage has no LLM
    node of its own — `ctx.default_llm` comes from the *first* `llm`-type
    node's resolved `ResolvedLlmNode`, the same convention
    `_resolve_summary_llm` uses."""
    cfg = make_cfg(reasoning=_TWO_LLM_NODE_REASONING)
    secrets = DirectorySecretStore(make_settings(tmp_path).secrets_dir)
    llm_by_node = _resolve_llm_nodes(cfg, secrets)

    default_llm = _resolve_default_llm(cfg, llm_by_node)

    assert default_llm is llm_by_node["llm-1"]


def test_resolve_default_llm_returns_none_when_the_graph_has_no_llm_node(tmp_path) -> None:
    cfg = make_cfg(
        reasoning={
            "entry_node_id": "end-1",
            "background_entry_node_ids": [],
            "turn_budget_ms": 3000,
            "graph": [
                {
                    "id": "end-1",
                    "type": "end",
                    "name": "End",
                    "lane": "foreground",
                    "on_error": {"action": "degrade"},
                    "on_deadline": {"action": "degrade"},
                }
            ],
        }
    )
    secrets = DirectorySecretStore(make_settings(tmp_path).secrets_dir)
    llm_by_node = _resolve_llm_nodes(cfg, secrets)

    assert _resolve_default_llm(cfg, llm_by_node) is None


def test_build_pipeline_threads_the_knowledge_pipeline_and_default_llm_into_the_pipeline(tmp_path, monkeypatch) -> None:
    """Phase 12b (BL-045/047): `build_pipeline` reads `cfg.knowledge
    .pipeline` and the first LLM node's resolved leg, and threads both into
    `ConversationPipeline` for the Retrieve node executor to use."""
    import avatar_agent.entrypoint as entrypoint_module

    fake_embedding_provider = object()
    monkeypatch.setattr(entrypoint_module, "resolve_embedding", lambda cfg, secrets: fake_embedding_provider)  # noqa: ARG005

    cfg = make_cfg()
    pipeline = build_pipeline(cfg, make_settings(tmp_path), FakeControlPlane())  # type: ignore[arg-type]

    assert pipeline._knowledge_pipeline == cfg.knowledge.pipeline
    assert pipeline._default_llm is not None
    assert pipeline._default_llm.primary.key == "openai"
    assert pipeline._knowledge_search is not None
    assert pipeline._knowledge_gap is not None
    assert pipeline._embedding_provider is fake_embedding_provider


def test_resolve_embedding_provider_returns_the_resolved_adapter_on_success(monkeypatch) -> None:
    import avatar_agent.entrypoint as entrypoint_module

    fake_provider = object()
    monkeypatch.setattr(entrypoint_module, "resolve_embedding", lambda cfg, secrets: fake_provider)  # noqa: ARG005

    class _FakeSecrets:
        def resolve(self, credential_ref: str) -> str:
            raise AssertionError("must not be called: credential_ref is always None for this hardcoded config")

    assert entrypoint_module._resolve_embedding_provider(_FakeSecrets()) is fake_provider  # type: ignore[arg-type]


def test_resolve_embedding_provider_returns_none_and_never_raises_when_resolution_fails(monkeypatch) -> None:
    """A missing platform-wide API key (the realistic failure mode, since
    this resolution always passes `credential_ref=None`) must never fail
    job start -- retrieval simply becomes unavailable for the session."""
    import avatar_agent.entrypoint as entrypoint_module

    def _raise(cfg, secrets):  # noqa: ANN001, ARG001
        raise RuntimeError("Missing credentials")

    monkeypatch.setattr(entrypoint_module, "resolve_embedding", _raise)

    class _FakeSecrets:
        def resolve(self, credential_ref: str) -> str:
            raise AssertionError("must not be called")

    assert entrypoint_module._resolve_embedding_provider(_FakeSecrets()) is None  # type: ignore[arg-type]


def test_build_pipeline_selects_pydantic_ai_orchestrator_when_configured(tmp_path) -> None:
    from avatar_agent.orchestration.graph_pydantic_ai import PydanticAiOrchestrator

    cfg = make_cfg()
    cfg.agent.runtime = "pydantic-ai"
    pipeline = build_pipeline(cfg, make_settings(tmp_path), FakeControlPlane())  # type: ignore[arg-type]
    assert isinstance(pipeline._orchestrator, PydanticAiOrchestrator)


def test_build_pipeline_resolves_tool_definitions_into_real_tools_and_specs(tmp_path) -> None:
    """QA fix (phase4-agent-python D-2): `cfg.tool_definitions` must
    actually be read and turned into `ToolDefinition`/`ToolSpec` instances,
    not hardcoded to `[]`.
    """
    cfg = make_cfg(
        agent={
            "runtime": "langgraph",
            "system_prompt": "hi",
            "tools": [{"name": "get_weather", "api_ref": "weather-api", "enabled": True}],
            "memory": {"enabled": True, "window_turns": 16},
        },
        tool_definitions=[
            {
                "api_ref": "weather-api",
                "name": "get_weather",
                "description": "Looks up the weather",
                "method": "GET",
                "url": "https://weather.example.com",
                "credential_ref": None,
                "args_schema": {"type": "object"},
            }
        ],
    )
    pipeline = build_pipeline(cfg, make_settings(tmp_path), FakeControlPlane())  # type: ignore[arg-type]

    assert "get_weather" in pipeline._tools_by_name
    assert pipeline._tools_by_name["get_weather"].url == "https://weather.example.com/"
    assert pipeline._tool_specs == [
        {"name": "get_weather", "description": "Looks up the weather", "parameters": {"type": "object"}}
    ]


def test_build_pipeline_does_not_fail_the_whole_job_when_a_tool_credential_is_unresolvable(tmp_path) -> None:
    cfg = make_cfg(
        tool_definitions=[
            {
                "api_ref": "weather-api",
                "name": "get_weather",
                "description": None,
                "method": "GET",
                "url": "https://weather.example.com",
                "credential_ref": "secrets/does-not-exist",
                "args_schema": {},
            }
        ],
    )
    # Must not raise even though the tool's own credential can't resolve.
    pipeline = build_pipeline(cfg, make_settings(tmp_path), FakeControlPlane())  # type: ignore[arg-type]
    assert pipeline._tools_by_name["get_weather"].api_key is None


def test_build_pipeline_resolves_the_bithuman_avatar_adapter_when_credential_present(tmp_path) -> None:
    """BL-018: once `resolve_avatar` has a real `bithuman` factory, a
    session whose credential actually resolves gets a live avatar adapter
    wired into the pipeline, not `None`.
    """
    (tmp_path / "secrets").mkdir()
    for name, value in [
        ("secrets/deepgram", "dg-key"),
        ("secrets/openai", "sk-key"),
        ("secrets/fish-speech", "fs-key"),
        ("secrets/bithuman", "bh-key"),
    ]:
        (tmp_path / name).write_text(value, encoding="utf-8")
    settings = Settings(secrets_dir=str(tmp_path))

    pipeline = build_pipeline(make_cfg(), settings, FakeControlPlane())  # type: ignore[arg-type]

    assert pipeline._avatar is not None
    assert pipeline._avatar.key == "bithuman"


def test_build_pipeline_tolerates_an_unresolvable_avatar_credential_without_raising(tmp_path) -> None:
    """No `secrets/bithuman` file exists in `make_settings` -- must not fail
    job start (FR-AVATAR-5's audio-continues path for "no avatar adapter"),
    matching how an unresolvable LLM fallback is already tolerated.
    """
    pipeline = build_pipeline(make_cfg(), make_settings(tmp_path), FakeControlPlane())  # type: ignore[arg-type]
    assert pipeline._avatar is None


def test_build_pipeline_tolerates_a_malformed_avatar_id_without_raising(tmp_path) -> None:
    """A traversal-shaped `avatar_id` fails the adapter's own constructor
    (`AvatarError`, not `FactoryLoadError`) -- `build_pipeline` must still
    swallow it into "no avatar this session" rather than letting a
    different exception type escape uncaught.
    """
    (tmp_path / "secrets").mkdir()
    for name, value in [
        ("secrets/deepgram", "dg-key"),
        ("secrets/openai", "sk-key"),
        ("secrets/fish-speech", "fs-key"),
        ("secrets/bithuman", "bh-key"),
    ]:
        (tmp_path / name).write_text(value, encoding="utf-8")
    settings = Settings(secrets_dir=str(tmp_path))
    cfg = make_cfg(avatar={"provider": "bithuman", "credential_ref": "secrets/bithuman", "avatar_id": "../../etc/passwd"})

    pipeline = build_pipeline(cfg, settings, FakeControlPlane())  # type: ignore[arg-type]

    assert pipeline._avatar is None


class FakeRoom:
    """Minimal `rtc.Room` double: captures the `track_subscribed` handler
    and exposes just enough surface for `handle_job` to run one iteration.
    """

    def __init__(self) -> None:
        self._handlers: dict[str, object] = {}
        self.loop = MagicMock()
        self.loop.create_task = lambda coro: _NoopTask(coro)
        # Deliberately no `disconnected` attribute — `handle_job`'s
        # `hasattr(ctx.room, "disconnected")` check then evaluates to
        # `False`, so the room-membership wait short-circuits to `None`
        # immediately instead of awaiting a real disconnect future.
        self.local_participant = MagicMock()

    def on(self, event: str, callback=None):  # noqa: ANN001
        self._handlers[event] = callback
        return callback

    def fire_track_subscribed(self, track, publication, participant) -> None:  # noqa: ANN001
        self._handlers["track_subscribed"](track, publication, participant)


class _NoopTask:
    def __init__(self, coro) -> None:  # noqa: ANN001
        coro.close()

    def cancel(self) -> None:
        pass


class FakeJobContext:
    def __init__(self, room: FakeRoom, session_id: str) -> None:
        self.room = room
        self.job = type("Job", (), {"metadata": f'{{"session_id": "{session_id}"}}'})()
        self.connect = AsyncMock()


async def test_handle_job_subscribes_to_the_remote_audio_track_and_runs_the_stt_loop(tmp_path, monkeypatch) -> None:
    """QA regression (phase4-agent-python D-1): before this fix, nothing in
    `handle_job` ever subscribed to a track or called `run_stt_loop`/
    `on_final_utterance` — this proves the real `track_subscribed` wiring
    now reaches `ConversationPipeline.run_stt_loop`.
    """
    import avatar_agent.entrypoint as entrypoint_module

    cfg = make_cfg()
    fake_pipeline = MagicMock()
    fake_pipeline.run_consumer_loop = AsyncMock()
    fake_pipeline.run_stt_loop = AsyncMock()
    fake_pipeline.start_avatar_session = AsyncMock()
    fake_pipeline.aclose = AsyncMock()
    fake_pipeline.generate_summary = AsyncMock()

    fake_control_plane = MagicMock()
    fake_control_plane.get_runtime_config = AsyncMock(return_value=cfg)
    fake_control_plane.send_event = AsyncMock()

    monkeypatch.setattr(entrypoint_module, "ControlPlaneClient", lambda *a, **k: fake_control_plane)
    monkeypatch.setattr(entrypoint_module, "build_pipeline", lambda *a, **k: fake_pipeline)
    monkeypatch.setattr(entrypoint_module, "load_settings", lambda: make_settings(tmp_path))

    room = FakeRoom()
    ctx = FakeJobContext(room, SESSION_ID)

    from livekit import rtc

    audio_track = type("Track", (), {"kind": rtc.TrackKind.KIND_AUDIO})()
    publication = type("Pub", (), {"sid": "TR_1"})()
    participant = type("Participant", (), {"identity": "caller-1"})()

    async def _run() -> None:
        job_task = entrypoint_module.asyncio.ensure_future(handle_job(ctx))
        await entrypoint_module.asyncio.sleep(0)  # let handle_job register the track_subscribed handler
        room.fire_track_subscribed(audio_track, publication, participant)
        await entrypoint_module.asyncio.sleep(0)
        await job_task

    await _run()

    fake_pipeline.run_stt_loop.assert_called_once()
    _args, kwargs = fake_pipeline.run_stt_loop.call_args
    assert kwargs["participant_identity"] == "caller-1"
    assert kwargs["track_sid"] == "TR_1"
    fake_control_plane.send_event.assert_awaited()  # the "ended" event was sent on the way out
    # QA fix (phase7-conversation-summary D-1): the teardown path must
    # genuinely call `generate_summary`, not merely define it somewhere
    # never reached.
    fake_pipeline.generate_summary.assert_awaited_once()


async def test_handle_job_ignores_a_non_audio_track(tmp_path, monkeypatch) -> None:
    import avatar_agent.entrypoint as entrypoint_module

    cfg = make_cfg()
    fake_pipeline = MagicMock()
    fake_pipeline.run_consumer_loop = AsyncMock()
    fake_pipeline.run_stt_loop = AsyncMock()
    fake_pipeline.start_avatar_session = AsyncMock()
    fake_pipeline.aclose = AsyncMock()
    fake_pipeline.generate_summary = AsyncMock()

    fake_control_plane = MagicMock()
    fake_control_plane.get_runtime_config = AsyncMock(return_value=cfg)
    fake_control_plane.send_event = AsyncMock()

    monkeypatch.setattr(entrypoint_module, "ControlPlaneClient", lambda *a, **k: fake_control_plane)
    monkeypatch.setattr(entrypoint_module, "build_pipeline", lambda *a, **k: fake_pipeline)
    monkeypatch.setattr(entrypoint_module, "load_settings", lambda: make_settings(tmp_path))

    room = FakeRoom()
    ctx = FakeJobContext(room, SESSION_ID)

    from livekit import rtc

    video_track = type("Track", (), {"kind": rtc.TrackKind.KIND_VIDEO})()
    publication = type("Pub", (), {"sid": "TR_1"})()
    participant = type("Participant", (), {"identity": "caller-1"})()

    job_task = entrypoint_module.asyncio.ensure_future(handle_job(ctx))
    await entrypoint_module.asyncio.sleep(0)
    room.fire_track_subscribed(video_track, publication, participant)
    await entrypoint_module.asyncio.sleep(0)
    await job_task

    fake_pipeline.run_stt_loop.assert_not_called()


async def test_handle_job_fails_the_session_when_the_avatar_id_is_unknown(tmp_path, monkeypatch) -> None:
    """FR-AVATAR-1: `AvatarError(code="AVATAR_NOT_FOUND")` from
    `start_avatar_session` must abort job start the same way
    `STT_UNAVAILABLE` already does -- "Session failed (no video)", never a
    degrade, since there is no misconfigured `avatar_id` to recover into.
    """
    import avatar_agent.entrypoint as entrypoint_module
    from avatar_agent.ports.avatar import AvatarError

    cfg = make_cfg()
    fake_pipeline = MagicMock()
    fake_pipeline.run_consumer_loop = AsyncMock()
    fake_pipeline.run_stt_loop = AsyncMock()
    fake_pipeline.start_avatar_session = AsyncMock(side_effect=AvatarError("not found", code="AVATAR_NOT_FOUND"))
    fake_pipeline.aclose = AsyncMock()

    fake_control_plane = MagicMock()
    fake_control_plane.get_runtime_config = AsyncMock(return_value=cfg)
    fake_control_plane.send_event = AsyncMock()

    monkeypatch.setattr(entrypoint_module, "ControlPlaneClient", lambda *a, **k: fake_control_plane)
    monkeypatch.setattr(entrypoint_module, "build_pipeline", lambda *a, **k: fake_pipeline)
    monkeypatch.setattr(entrypoint_module, "load_settings", lambda: make_settings(tmp_path))

    room = FakeRoom()
    ctx = FakeJobContext(room, SESSION_ID)

    await handle_job(ctx)

    fake_pipeline.run_consumer_loop.assert_not_called()
    fake_control_plane.send_event.assert_awaited_once()
    _args, _kwargs = fake_control_plane.send_event.call_args
    event = _args[1]
    assert event.type == "failed"
    assert event.error_code == "AVATAR_NOT_FOUND"


async def test_handle_job_still_sends_the_ended_event_when_summary_generation_raises(tmp_path, monkeypatch) -> None:
    """QA D-5 (phase7-agent-summary-wiring retry 1), layer 3 of 3.

    QA drove a non-`LlmError` exception (standing in for a real
    `openai.AuthenticationError` the adapter never classified) through the
    real `handle_job` and proved it propagated out of the teardown `finally`
    itself: the terminal `"ended"` session event was never sent and
    `handle_job` raised out to its caller.

    Both upstream layers are fixed (the adapters now classify every failure
    into `LlmError`; `generate_and_send_summary` now also catches broadly),
    but this test deliberately bypasses both — `generate_summary` itself
    raises a never-anticipated exception type — so it verifies the teardown
    guard on its own merits. A regression in either upstream layer must not
    be able to hide behind this one, and vice versa.
    """
    import avatar_agent.entrypoint as entrypoint_module

    class NeverAnticipatedError(RuntimeError):
        pass

    cfg = make_cfg()
    fake_pipeline = MagicMock()
    fake_pipeline.run_consumer_loop = AsyncMock()
    fake_pipeline.run_stt_loop = AsyncMock()
    fake_pipeline.start_avatar_session = AsyncMock()
    fake_pipeline.aclose = AsyncMock()
    fake_pipeline.generate_summary = AsyncMock(side_effect=NeverAnticipatedError("unclassified adapter failure"))

    fake_control_plane = MagicMock()
    fake_control_plane.get_runtime_config = AsyncMock(return_value=cfg)
    fake_control_plane.send_event = AsyncMock()

    monkeypatch.setattr(entrypoint_module, "ControlPlaneClient", lambda *a, **k: fake_control_plane)
    monkeypatch.setattr(entrypoint_module, "build_pipeline", lambda *a, **k: fake_pipeline)
    monkeypatch.setattr(entrypoint_module, "load_settings", lambda: make_settings(tmp_path))

    ctx = FakeJobContext(FakeRoom(), SESSION_ID)

    # Must not raise out of the entrypoint at all (the D-5 symptom).
    await handle_job(ctx)

    fake_pipeline.generate_summary.assert_awaited_once()
    fake_control_plane.send_event.assert_awaited_once()
    _args, _kwargs = fake_control_plane.send_event.call_args
    assert _args[1].type == "ended"


async def test_handle_job_still_sends_the_ended_event_when_pipeline_aclose_raises(tmp_path, monkeypatch) -> None:
    """Same guard, applied to the teardown step before the summary: no
    best-effort cleanup in the `finally` may cost the session its terminal
    event.
    """
    import avatar_agent.entrypoint as entrypoint_module

    cfg = make_cfg()
    fake_pipeline = MagicMock()
    fake_pipeline.run_consumer_loop = AsyncMock()
    fake_pipeline.run_stt_loop = AsyncMock()
    fake_pipeline.start_avatar_session = AsyncMock()
    fake_pipeline.aclose = AsyncMock(side_effect=RuntimeError("avatar SDK blew up on close"))
    fake_pipeline.generate_summary = AsyncMock()

    fake_control_plane = MagicMock()
    fake_control_plane.get_runtime_config = AsyncMock(return_value=cfg)
    fake_control_plane.send_event = AsyncMock()

    monkeypatch.setattr(entrypoint_module, "ControlPlaneClient", lambda *a, **k: fake_control_plane)
    monkeypatch.setattr(entrypoint_module, "build_pipeline", lambda *a, **k: fake_pipeline)
    monkeypatch.setattr(entrypoint_module, "load_settings", lambda: make_settings(tmp_path))

    ctx = FakeJobContext(FakeRoom(), SESSION_ID)

    await handle_job(ctx)

    fake_pipeline.generate_summary.assert_awaited_once()  # a failed aclose does not skip it either
    _args, _kwargs = fake_control_plane.send_event.call_args
    assert _args[1].type == "ended"


class _SummaryFakeLlm:
    """Duck-typed `ILLMProvider` double used only to prove the real
    end-of-call path reaches an LLM call for the post-call summary —
    `complete_stream` is never exercised here.
    """

    key = "openai"

    def __init__(self) -> None:
        from avatar_agent.contracts.structured import PostCallSummary

        self._result = PostCallSummary(summary_text="Real end-of-call summary.")

    async def complete_stream(self, *a, **k):  # noqa: ANN002, ANN003
        raise NotImplementedError

    async def complete_structured(self, messages, schema, residency):  # noqa: ANN001
        return self._result

    @property
    def first_token_ms(self):
        return None


async def test_handle_job_genuinely_reaches_and_posts_the_post_call_summary_on_teardown(tmp_path, monkeypatch) -> None:
    """QA regression (phase7-conversation-summary D-1): before this fix,
    `generate_and_send_summary` was only ever invoked by its own isolated
    unit test (`tests/summary/test_post_call.py`) with hand-built fakes —
    `entrypoint.handle_job`'s real teardown path never called it, so every
    genuinely-ended production session was stuck at `summary_status="none"`
    forever, even though the function itself was 100% unit-test covered.

    This test drives the REAL `handle_job` end-of-call path — a real
    `ConversationPipeline` instance (not a `MagicMock` standing in for
    `generate_summary`) with only the LLM/network-boundary adapters faked —
    and asserts a summary is genuinely posted via
    `ControlPlaneClient.send_summary`, proving the wiring survives all the
    way from the room disconnecting to a real `POST .../summary` call, not
    merely that `generate_and_send_summary` works in isolation.
    """
    import avatar_agent.entrypoint as entrypoint_module
    from avatar_agent.contracts.runtime_config import InjectStage, RetrievalPipelineConfig
    from avatar_agent.orchestration.memory import SessionMemory
    from avatar_agent.orchestration.pipeline import ConversationPipeline
    from avatar_agent.orchestration.tools import ToolExecutor
    from avatar_agent.ports.orchestration import ResolvedLlmNode

    class _FakeKnowledgeSearchPort:
        async def search(self, request):  # noqa: ANN001
            raise NotImplementedError

    class _FakeKnowledgeGapPort:
        async def record_gap(self, **kwargs):  # noqa: ANN003
            raise NotImplementedError

    cfg = make_cfg()

    sent_summaries: list[tuple] = []

    class RealishControlPlane:
        """Captures every internal write a real `ControlPlaneClient` would
        make, without any network I/O — the same fakery style already used
        by `tests/orchestration/test_pipeline.py`'s `FakeControlPlane` and
        `tests/summary/test_post_call.py`'s `FakeControlPlane`.
        """

        async def get_runtime_config(self, session_id):  # noqa: ANN001
            return cfg

        async def send_event(self, session_id, event):  # noqa: ANN001
            pass

        async def send_utterances(self, session_id, items):  # noqa: ANN001
            pass

        async def send_hops(self, session_id, items):  # noqa: ANN001
            pass

        async def send_alert(self, request):  # noqa: ANN001
            pass

        async def send_summary(self, session_id, request):  # noqa: ANN001
            sent_summaries.append((session_id, request))

    control_plane = RealishControlPlane()

    # A real `ConversationPipeline` — the exact class `build_pipeline`
    # would construct — with only the LLM adapter faked (no real vendor
    # network call), standing in for what `build_pipeline` would have
    # resolved via the registry for this session's real runtime config.
    summary_llm = _SummaryFakeLlm()
    real_pipeline = ConversationPipeline(
        session_id=UUID(SESSION_ID),
        tenant_id=UUID(TENANT_ID),
        stt=object(),
        reasoning=cfg.reasoning,
        llm_by_node={  # type: ignore[union-attr]
            cfg.reasoning.graph[0].id: ResolvedLlmNode(primary=summary_llm, fallback=None, retry=cfg.reasoning.graph[0].retry)
        },
        summary_llm=summary_llm,
        tts=object(),
        voice_id="v1",
        system_prompt="hi",
        residency_mode="prompt_text_only",
        memory=SessionMemory(window_turns=16),
        default_llm=None,
        embedding_provider=None,
        knowledge_pipeline=RetrievalPipelineConfig(inject=InjectStage(citation_format="none")),
        knowledge_search=_FakeKnowledgeSearchPort(),
        knowledge_gap=_FakeKnowledgeGapPort(),
        tool_executor=ToolExecutor(),
        tools=[],
        tool_specs=[],
        orchestrator=object(),
        control_plane=control_plane,
        degraded_message="hold on",
        transport=None,
        avatar=None,
    )

    monkeypatch.setattr(entrypoint_module, "ControlPlaneClient", lambda *a, **k: control_plane)
    monkeypatch.setattr(entrypoint_module, "build_pipeline", lambda *a, **k: real_pipeline)
    monkeypatch.setattr(entrypoint_module, "load_settings", lambda: make_settings(tmp_path))

    room = FakeRoom()
    ctx = FakeJobContext(room, SESSION_ID)

    # No track ever subscribed and `room.disconnected` doesn't exist on
    # `FakeRoom`, so `handle_job` falls straight through to its `finally`
    # teardown — exactly the real "room disconnected" case this bug hid
    # behind.
    await handle_job(ctx)

    assert len(sent_summaries) == 1, (
        "handle_job's real teardown path must genuinely call "
        "pipeline.generate_summary() -> generate_and_send_summary() -> "
        "control_plane.send_summary(), not merely leave the wiring as an "
        "isolated, never-invoked function"
    )
    session_id, request = sent_summaries[0]
    assert str(session_id) == SESSION_ID
    assert request.summary_status == "ready"
    assert request.summary_text == "Real end-of-call summary."
