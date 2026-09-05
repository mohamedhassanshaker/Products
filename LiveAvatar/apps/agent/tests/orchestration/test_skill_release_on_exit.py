"""R-S1/A5.2's "release on exit" — the single most important behavioral
proof in Phase 13 (BL-049/050/051, `docs/v2/BACKLOG.md`): a Skill node's
injected instructions must never survive past its own turn into a later,
unrelated turn's LLM prompt or into persistent `SessionMemory`.

Uses the **real** `LangGraphOrchestrator`/`GraphInterpreter` (not
`test_pipeline.py`'s own `FakeOrchestrator`, which never actually walks a
graph) wired into a real `ConversationPipeline`, driving three real turns
through `_process_utterance` — this is an executed, multi-turn proof, not
an assumption asserted only in a docstring.
"""

from __future__ import annotations

from uuid import UUID

from avatar_agent.contracts.runtime_config import InjectStage, ReasoningBlock, RetrievalPipelineConfig, RetryPolicy
from avatar_agent.orchestration.graph_langgraph import LangGraphOrchestrator
from avatar_agent.orchestration.memory import SessionMemory
from avatar_agent.orchestration.pipeline import ConversationPipeline
from avatar_agent.orchestration.tools import ToolExecutor
from avatar_agent.ports.llm import ResidencyPayload
from avatar_agent.ports.orchestration import ResolvedLlmNode, SkillBody, SkillKnowledgeFilters

SESSION_ID = UUID("11111111-1111-1111-1111-111111111111")
TENANT_ID = UUID("22222222-2222-2222-2222-222222222222")

# A distinctive marker standing in for a skill's real instructions body —
# chosen to be unmistakable in a failure message and to never
# coincidentally appear in any other string this test constructs.
_SECRET_MARKER = "TOP-SECRET-REFUND-SOP-DO-NOT-LEAK-4821"

_RETRY_ONCE = RetryPolicy(max_attempts=1, backoff_ms=[0])


class RecordingLlmProvider:
    """Real `ILLMProvider` double that records the exact `ResidencyPayload`
    it was called with on every call — this is what makes the release-on-
    exit proof real: the test inspects *what actually reached "the
    model"*, not an internal implementation detail."""

    key = "openai"

    def __init__(self, reply: str) -> None:
        self._reply = reply
        self.calls: list[ResidencyPayload] = []

    async def complete_stream(self, messages, tools, residency):  # noqa: ANN001
        self.calls.append(residency)

        async def _gen():
            yield {"delta": self._reply, "done": False}
            yield {"delta": "", "done": True, "tool_calls": []}

        return _gen()

    async def complete_structured(self, *a, **k):  # noqa: ANN002, ANN003
        raise NotImplementedError

    @property
    def first_token_ms(self) -> int | None:
        return None


class FakeSkillBodyPort:
    def __init__(self, body: SkillBody) -> None:
        self._body = body
        self.fetch_count = 0

    async def get_body(self, skill_id: str, version: int) -> SkillBody:  # noqa: ARG002
        self.fetch_count += 1
        return self._body


class FakeKnowledgeSearchPort:
    async def search(self, request):  # noqa: ANN001
        raise NotImplementedError  # never exercised — no retrieve node in this graph


class FakeKnowledgeGapPort:
    async def record_gap(self, **kwargs):  # noqa: ANN003
        raise NotImplementedError


class FakeTts:
    key = "fish-speech"

    async def synthesize_stream(self, text, voice_id):  # noqa: ANN001
        yield b"frame"

    @property
    def first_audio_ms(self):
        return 10


class FakeControlPlane:
    async def send_event(self, session_id, event):  # noqa: ANN001
        pass

    async def send_utterances(self, session_id, items):  # noqa: ANN001
        pass

    async def send_hops(self, session_id, items):  # noqa: ANN001
        pass

    async def send_alert(self, request):  # noqa: ANN001
        pass

    async def send_summary(self, session_id, request):  # noqa: ANN001
        pass


def _default_knowledge_pipeline() -> RetrievalPipelineConfig:
    return RetrievalPipelineConfig(inject=InjectStage(citation_format="none"))


def _router_to_skill_or_llm_reasoning() -> ReasoningBlock:
    """Entry Router: the exact utterance `"refund please"` routes to the
    Skill node; anything else falls to a plain LLM node. This is what lets
    the test distinguish "the skill triggered, injecting the marker" (turn
    1 and turn 3) from "an unrelated turn ran with no skill involved at
    all" (turn 2) — the release-on-exit property is only meaningfully
    tested by that second, skill-free turn.
    """
    return ReasoningBlock.model_validate(
        {
            "entry_node_id": "router-1",
            "background_entry_node_ids": [],
            "turn_budget_ms": 5000,
            "graph": [
                {
                    "id": "router-1",
                    "type": "router",
                    "name": "Route",
                    "lane": "foreground",
                    "on_error": {"action": "degrade"},
                    "on_deadline": {"action": "degrade"},
                    "branches": [{"condition": 'utterance == "refund please"', "next_node_id": "skill-1"}],
                    "default_next_node_id": "llm-2",
                },
                {
                    "id": "skill-1",
                    "type": "skill",
                    "name": "Refunds",
                    "lane": "foreground",
                    "on_error": {"action": "degrade"},
                    "on_deadline": {"action": "degrade"},
                    "skill_id": "skill-uuid-1",
                    "version": 1,
                    "budget_ms": 1500,
                    "next_node_id": None,
                },
                {
                    "id": "llm-2",
                    "type": "llm",
                    "name": "PlainAnswer",
                    "lane": "foreground",
                    "on_error": {"action": "degrade"},
                    "on_deadline": {"action": "degrade"},
                    "provider": "openai",
                    "model": "gpt-4o",
                    "retry": {"max_attempts": 1, "backoff_ms": [0]},
                    "next_node_id": None,
                },
            ],
        }
    )


def _make_pipeline(*, default_llm_provider, llm2_provider, skill_body_port, tenant_id=TENANT_ID):  # noqa: ANN001
    reasoning = _router_to_skill_or_llm_reasoning()
    return ConversationPipeline(
        session_id=SESSION_ID,
        tenant_id=tenant_id,
        stt=object(),
        reasoning=reasoning,
        llm_by_node={"llm-2": ResolvedLlmNode(primary=llm2_provider, fallback=None, retry=_RETRY_ONCE)},
        summary_llm=object(),
        tts=FakeTts(),
        voice_id="v1",
        system_prompt="You are a helpful support agent.",
        residency_mode="prompt_text_only",
        memory=SessionMemory(window_turns=16),
        default_llm=ResolvedLlmNode(primary=default_llm_provider, fallback=None, retry=_RETRY_ONCE),
        embedding_provider=None,
        knowledge_pipeline=_default_knowledge_pipeline(),
        knowledge_search=FakeKnowledgeSearchPort(),
        knowledge_gap=FakeKnowledgeGapPort(),
        skill_body_port=skill_body_port,
        secrets=None,
        tool_executor=ToolExecutor(),
        tools=[],
        tool_specs=[],
        orchestrator=LangGraphOrchestrator(),
        control_plane=FakeControlPlane(),
        degraded_message="Please hold.",
        transport=None,
        avatar=None,
    )


def _residency_text(residency: ResidencyPayload) -> str:
    """Every place a leaked marker could hide — system prompt and every message's content."""
    return residency.system_prompt + "".join(m["content"] for m in residency.messages)


async def test_release_on_exit_across_three_real_turns() -> None:
    skill_body = SkillBody(
        skill_id="skill-uuid-1",
        version=1,
        name="Refunds",
        description="Handle refund requests",
        instructions=_SECRET_MARKER,
        trigger_mode="model",
        tool_definitions=(),
        knowledge_filters=SkillKnowledgeFilters(),
        budget_ms=1500,
    )
    skill_body_port = FakeSkillBodyPort(skill_body)
    default_llm_provider = RecordingLlmProvider(reply="Sure, refund processed.")
    llm2_provider = RecordingLlmProvider(reply="It's sunny today.")
    pipeline = _make_pipeline(
        default_llm_provider=default_llm_provider, llm2_provider=llm2_provider, skill_body_port=skill_body_port
    )

    # --- Turn 1: triggers the Skill node — the marker MUST be injected. ---
    await pipeline._process_utterance(1, "refund please")

    assert skill_body_port.fetch_count == 1
    assert len(default_llm_provider.calls) == 1
    turn1_residency = default_llm_provider.calls[0]
    assert _SECRET_MARKER in _residency_text(turn1_residency), "sanity check: the skill must actually inject its instructions"

    # --- Turn 2: an unrelated turn, routed to the plain LLM node — the
    # marker must be completely absent from everything this turn's LLM
    # call received, and from persistent SessionMemory. This is the real
    # release-on-exit proof. ---
    await pipeline._process_utterance(2, "what's the weather")

    assert len(llm2_provider.calls) == 1
    turn2_residency = llm2_provider.calls[0]
    assert _SECRET_MARKER not in _residency_text(turn2_residency), (
        "RELEASE-ON-EXIT VIOLATION: the Skill node's injected instructions leaked into an unrelated turn's prompt"
    )

    memory_text = "".join(m["content"] for m in pipeline._memory.as_messages())
    assert _SECRET_MARKER not in memory_text, (
        "RELEASE-ON-EXIT VIOLATION: the Skill node's injected instructions leaked into persistent SessionMemory"
    )
    # SessionMemory legitimately holds the user utterances and the actual
    # spoken replies — confirming the memory isn't just empty by accident.
    assert "refund please" in memory_text
    assert "Sure, refund processed." in memory_text
    assert "what's the weather" in memory_text
    assert "It's sunny today." in memory_text

    # --- Turn 3: triggers the Skill node again — proves the *cache*
    # (`ctx.skill_body_cache`, per-session) doesn't itself become a leak
    # vector: the body is served from cache (fetch_count stays 1) but its
    # instructions are still correctly re-injected fresh for this turn's
    # own scoped call, exactly like turn 1. ---
    await pipeline._process_utterance(3, "refund please")

    assert skill_body_port.fetch_count == 1, "the cached skill body must not be re-fetched on a second trigger"
    assert len(default_llm_provider.calls) == 2
    turn3_residency = default_llm_provider.calls[1]
    assert _SECRET_MARKER in _residency_text(turn3_residency)

    # And turn 2's own (already-completed) call must not have been
    # retroactively mutated by turn 3 — `ResidencyPayload` instances are
    # frozen dataclasses, but this asserts the *behavior*, not just the type.
    assert _SECRET_MARKER not in _residency_text(turn2_residency)


async def test_skill_body_cache_is_never_shared_across_two_sessions_even_for_the_same_skill_and_version() -> None:
    """Security review item (Phase 13): "the lazy-fetch caching is
    per-session, not global." `TurnContext.skill_body_cache` is created
    once per `ConversationPipeline.__init__` (one instance = one live
    session) — this test proves two independently-constructed pipelines
    (as two concurrent calls, possibly for two different tenants, would
    be in the real LiveKit worker) never share a cache dict instance, and
    that a body fetched for tenant A's session is never silently reused by
    tenant B's session even though both reference the identical
    `skill_id`/`version` pair.
    """
    tenant_a = UUID("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")
    tenant_b = UUID("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb")

    body_for_a = SkillBody(
        skill_id="skill-uuid-1",
        version=1,
        name="Refunds",
        description="Handle refunds",
        instructions="TENANT-A-ONLY-INSTRUCTIONS",
        trigger_mode="model",
        tool_definitions=(),
        knowledge_filters=SkillKnowledgeFilters(),
        budget_ms=1500,
    )
    body_for_b = SkillBody(
        skill_id="skill-uuid-1",  # same skill id + version as tenant A...
        version=1,
        name="Refunds",
        description="Handle refunds",
        instructions="TENANT-B-ONLY-INSTRUCTIONS",  # ...but genuinely different content
        trigger_mode="model",
        tool_definitions=(),
        knowledge_filters=SkillKnowledgeFilters(),
        budget_ms=1500,
    )

    class _PerTenantSkillBodyPort:
        """Simulates two different tenants' skills happening to share an
        id/version — a pathological but structurally possible input the
        cache key's own tenant-id prefix (see
        `TurnContext.skill_body_cache`'s docstring) is meant to guard
        against.
        """

        def __init__(self, body) -> None:  # noqa: ANN001
            self._body = body
            self.calls = 0

        async def get_body(self, skill_id: str, version: int) -> SkillBody:  # noqa: ARG002
            self.calls += 1
            return self._body

    port_a = _PerTenantSkillBodyPort(body_for_a)
    port_b = _PerTenantSkillBodyPort(body_for_b)
    llm_a = RecordingLlmProvider(reply="ok-a")
    llm_b = RecordingLlmProvider(reply="ok-b")
    pipeline_a = _make_pipeline(
        default_llm_provider=llm_a, llm2_provider=RecordingLlmProvider(reply="x"), skill_body_port=port_a, tenant_id=tenant_a
    )
    pipeline_b = _make_pipeline(
        default_llm_provider=llm_b, llm2_provider=RecordingLlmProvider(reply="y"), skill_body_port=port_b, tenant_id=tenant_b
    )

    # Two entirely separate `ConversationPipeline` instances (== two live
    # sessions) must never share the same cache dict object.
    assert pipeline_a._skill_body_cache is not pipeline_b._skill_body_cache  # noqa: SLF001

    await pipeline_a._process_utterance(1, "refund please")
    await pipeline_b._process_utterance(1, "refund please")

    assert port_a.calls == 1
    assert port_b.calls == 1
    assert "TENANT-A-ONLY-INSTRUCTIONS" in _residency_text(llm_a.calls[0])
    assert "TENANT-B-ONLY-INSTRUCTIONS" not in _residency_text(llm_a.calls[0])
    assert "TENANT-B-ONLY-INSTRUCTIONS" in _residency_text(llm_b.calls[0])
    assert "TENANT-A-ONLY-INSTRUCTIONS" not in _residency_text(llm_b.calls[0])
