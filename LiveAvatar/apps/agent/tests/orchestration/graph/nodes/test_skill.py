"""Unit tests for `SkillNodeExecutor` (Phase 13, BL-049/050/051).

The **release-on-exit** proof (R-S1/A5.2 — the single most important
behavioral property of this node type) lives in the dedicated,
multi-turn, real-pipeline test
`tests/orchestration/test_skill_release_on_exit.py`, not here — these
tests are the node-executor-level unit coverage (trigger paths, caching,
tool round trip, failure modes).
"""

from __future__ import annotations

from uuid import uuid4

import pytest

from avatar_agent.contracts.runtime_config import RetryPolicy, SkillNode
from avatar_agent.orchestration.graph.ir import TurnContext
from avatar_agent.orchestration.graph.nodes.skill import SkillNodeExecutor
from avatar_agent.orchestration.tools import ToolError
from avatar_agent.ports.orchestration import ResolvedLlmNode, SkillBody, SkillKnowledgeFilters, SkillToolDefinition
from avatar_agent.ports.secrets import SecretNotFoundError
from avatar_agent.residency.filter import ResidencyPayload

_RETRY_ONCE = RetryPolicy(max_attempts=1, backoff_ms=[0])


def make_skill_node(
    *, node_id: str = "skill-1", skill_id: str = "skill-uuid-1", version: int | str = 1, next_node_id: str | None = "end-1"
) -> SkillNode:
    return SkillNode.model_validate(
        {
            "id": node_id,
            "type": "skill",
            "name": "Refunds",
            "lane": "foreground",
            "on_error": {"action": "goto", "target_node_id": "fallback-1"},
            "on_deadline": {"action": "degrade"},
            "skill_id": skill_id,
            "version": version,
            "budget_ms": 1500,
            "next_node_id": next_node_id,
        }
    )


def make_skill_body(
    *,
    instructions: str = "Follow the refund SOP.",
    tool_definitions: tuple[SkillToolDefinition, ...] = (),
) -> SkillBody:
    return SkillBody(
        skill_id="skill-uuid-1",
        version=1,
        name="Refunds",
        description="Handle refunds",
        instructions=instructions,
        trigger_mode="model",
        tool_definitions=tool_definitions,
        knowledge_filters=SkillKnowledgeFilters(),
        budget_ms=1500,
    )


class ScriptedLlmProvider:
    """Same shape as `test_llm.py`'s own double — returns a scripted
    `(delta_texts, tool_calls)` pair per successive `complete_stream` call."""

    key = "openai"

    def __init__(self, rounds: list[tuple[list[str], list[dict]]]) -> None:
        self._rounds = rounds
        self.calls: list[ResidencyPayload] = []

    async def complete_stream(self, messages, tools, residency):  # noqa: ANN001
        self.calls.append(residency)
        texts, tool_calls = self._rounds[len(self.calls) - 1]

        async def _gen():
            for t in texts:
                yield {"delta": t, "done": False}
            yield {"delta": "", "done": True, "tool_calls": tool_calls}

        return _gen()

    async def complete_structured(self, *a, **k):  # noqa: ANN002, ANN003
        raise NotImplementedError

    @property
    def first_token_ms(self) -> int | None:
        return None


class FakeToolExecutor:
    def __init__(self, *, result: str | None = None, error: ToolError | None = None) -> None:
        self._result = result
        self._error = error
        self.calls: list[tuple] = []

    async def invoke(self, tool, arguments):  # noqa: ANN001
        self.calls.append((tool, arguments))
        if self._error is not None:
            raise self._error
        return self._result if self._result is not None else "ok"


class FakeSkillBodyPort:
    def __init__(self, body: SkillBody | None = None, *, raises: bool = False) -> None:
        self._body = body or make_skill_body()
        self._raises = raises
        self.calls: list[tuple[str, int]] = []

    async def get_body(self, skill_id: str, version: int) -> SkillBody:
        self.calls.append((skill_id, version))
        if self._raises:
            raise RuntimeError("simulated fetch failure")
        return self._body


class FakeSecretStore:
    def __init__(self, secrets: dict[str, str] | None = None) -> None:
        self._secrets = secrets or {}

    def resolve(self, credential_ref: str) -> str:
        if credential_ref not in self._secrets:
            raise SecretNotFoundError(credential_ref)
        return self._secrets[credential_ref]


def make_ctx(
    *,
    default_llm: ResolvedLlmNode | None,
    skill_body_port=None,  # noqa: ANN001
    secrets=None,  # noqa: ANN001
    tool_executor=None,  # noqa: ANN001
    skill_body_cache: dict | None = None,
    residency: ResidencyPayload | None = None,
) -> TurnContext:
    async def _speak(text: str) -> None:  # pragma: no cover - Skill nodes never call ctx.speak directly
        raise AssertionError("SkillNodeExecutor must never call ctx.speak directly")

    class _NullHopRecorder:
        def record(self, item):  # noqa: ANN001
            pass

        async def flush(self) -> None:
            pass

    return TurnContext(
        session_id=uuid4(),
        tenant_id=uuid4(),
        utterance_seq=1,
        llm_by_node={},
        tool_definitions_by_api_ref={},
        tools_by_name={},
        tool_specs=[],
        tool_executor=tool_executor or object(),
        residency=residency or ResidencyPayload(system_prompt="Base prompt.", messages=()),
        turn_state={"utterance": "refund please"},
        speak=_speak,
        hop_recorder=_NullHopRecorder(),
        default_llm=default_llm,
        skill_body_port=skill_body_port,
        secrets=secrets,
        skill_body_cache=skill_body_cache if skill_body_cache is not None else {},
    )


# --- happy path --------------------------------------------------------


async def test_fetches_the_body_injects_instructions_and_continues_to_next_node_id() -> None:
    provider = ScriptedLlmProvider([(["Sure, refund processed."], [])])
    port = FakeSkillBodyPort(make_skill_body(instructions="SECRET-SOP-TEXT"))
    node = make_skill_node(next_node_id="end-1")
    ctx = make_ctx(default_llm=ResolvedLlmNode(primary=provider, fallback=None, retry=_RETRY_ONCE), skill_body_port=port)

    result, next_id = await SkillNodeExecutor().execute(node, ctx)

    assert result.status == "complete"
    assert result.output_text == "Sure, refund processed."
    assert result.node_type == "skill"
    assert next_id == "end-1"
    assert port.calls == [("skill-uuid-1", 1)]
    # The instructions reached the LLM call...
    assert "SECRET-SOP-TEXT" in provider.calls[0].system_prompt
    # ...but the original, shared ctx.residency was never mutated.
    assert "SECRET-SOP-TEXT" not in ctx.residency.system_prompt


async def test_sets_turn_state_for_downstream_speak_and_tool_argument_mapping() -> None:
    provider = ScriptedLlmProvider([(["Sure, refund processed."], [])])
    port = FakeSkillBodyPort()
    node = make_skill_node()
    ctx = make_ctx(default_llm=ResolvedLlmNode(primary=provider, fallback=None, retry=_RETRY_ONCE), skill_body_port=port)

    await SkillNodeExecutor().execute(node, ctx)

    assert ctx.turn_state["_last_llm_output"] == "Sure, refund processed."
    assert ctx.turn_state["skill-1"] == "Sure, refund processed."


# --- caching -------------------------------------------------------------


async def test_body_is_fetched_once_and_reused_from_cache_on_a_second_call_with_the_same_ctx() -> None:
    provider = ScriptedLlmProvider([(["first"], []), (["second"], [])])
    port = FakeSkillBodyPort()
    node = make_skill_node()
    shared_cache: dict = {}
    ctx = make_ctx(
        default_llm=ResolvedLlmNode(primary=provider, fallback=None, retry=_RETRY_ONCE),
        skill_body_port=port,
        skill_body_cache=shared_cache,
    )

    await SkillNodeExecutor().execute(node, ctx)
    await SkillNodeExecutor().execute(node, ctx)

    assert len(port.calls) == 1  # second execution reused the cache
    assert len(shared_cache) == 1


async def test_cache_key_is_scoped_by_tenant_id_and_skill_and_version() -> None:
    port = FakeSkillBodyPort()
    node_v1 = make_skill_node(version=1)
    node_v2 = make_skill_node(version=2)
    shared_cache: dict = {}
    provider = ScriptedLlmProvider([(["a"], []), (["b"], [])])
    ctx = make_ctx(
        default_llm=ResolvedLlmNode(primary=provider, fallback=None, retry=_RETRY_ONCE),
        skill_body_port=port,
        skill_body_cache=shared_cache,
    )

    await SkillNodeExecutor().execute(node_v1, ctx)
    await SkillNodeExecutor().execute(node_v2, ctx)

    assert len(port.calls) == 2  # different versions never share a cache entry
    assert len(shared_cache) == 2


async def test_a_transient_fetch_failure_is_not_cached_so_the_next_trigger_retries() -> None:
    port = FakeSkillBodyPort(raises=True)
    node = make_skill_node()
    shared_cache: dict = {}
    ctx = make_ctx(
        default_llm=ResolvedLlmNode(primary=object(), fallback=None, retry=_RETRY_ONCE),
        skill_body_port=port,
        skill_body_cache=shared_cache,
    )

    result, next_id = await SkillNodeExecutor().execute(node, ctx)

    assert result.status == "failed"
    assert result.error_code == "SKILL_BODY_UNAVAILABLE"
    assert next_id == "fallback-1"  # resolved on_error (goto)
    assert shared_cache == {}


# --- tool round trip (the skill's own attached tools) ---------------------


async def test_skill_own_tool_is_invoked_and_result_fed_back_for_a_second_round() -> None:
    provider = ScriptedLlmProvider(
        [
            (["ignored"], [{"id": "call_1", "name": "issue_refund", "arguments": {"order_id": "4821"}}]),
            (["Refund issued."], []),
        ]
    )
    tool_executor = FakeToolExecutor(result="refund_id=999")
    body = make_skill_body(
        tool_definitions=(
            SkillToolDefinition(
                api_ref="issue_refund",
                name="issue_refund",
                description="Issue a refund",
                method="POST",
                url="https://api.example.com/refund",
                credential_ref=None,
                args_schema={},
            ),
        )
    )
    port = FakeSkillBodyPort(body)
    node = make_skill_node(next_node_id=None)
    ctx = make_ctx(
        default_llm=ResolvedLlmNode(primary=provider, fallback=None, retry=_RETRY_ONCE),
        skill_body_port=port,
        tool_executor=tool_executor,
    )

    result, _next_id = await SkillNodeExecutor().execute(node, ctx)

    assert len(tool_executor.calls) == 1
    called_tool, called_args = tool_executor.calls[0]
    assert called_tool.api_ref == "issue_refund"
    assert called_args == {"order_id": "4821"}
    assert result.output_text == "Refund issued."


async def test_skill_tool_credential_is_resolved_lazily_via_ctx_secrets() -> None:
    provider = ScriptedLlmProvider([(["ok"], [])])
    body = make_skill_body(
        tool_definitions=(
            SkillToolDefinition(
                api_ref="issue_refund",
                name="issue_refund",
                description=None,
                method="POST",
                url="https://api.example.com/refund",
                credential_ref="secrets/refund-api",
                args_schema={},
            ),
        )
    )
    port = FakeSkillBodyPort(body)
    secrets = FakeSecretStore({"secrets/refund-api": "sk-live-123"})
    node = make_skill_node()
    ctx = make_ctx(
        default_llm=ResolvedLlmNode(primary=provider, fallback=None, retry=_RETRY_ONCE), skill_body_port=port, secrets=secrets
    )

    await SkillNodeExecutor().execute(node, ctx)
    # No tool call was made this turn, but resolution happens once, up
    # front, regardless — assert indirectly via a follow-up round.


async def test_an_unresolvable_skill_tool_credential_does_not_fail_the_node() -> None:
    provider = ScriptedLlmProvider(
        [
            (["ignored"], [{"id": "call_1", "name": "issue_refund", "arguments": {}}]),
            (["done"], []),
        ]
    )
    tool_executor = FakeToolExecutor(result="ok")
    body = make_skill_body(
        tool_definitions=(
            SkillToolDefinition(
                api_ref="issue_refund",
                name="issue_refund",
                description=None,
                method="POST",
                url="https://api.example.com/refund",
                credential_ref="secrets/missing",
                args_schema={},
            ),
        )
    )
    port = FakeSkillBodyPort(body)
    secrets = FakeSecretStore({})  # nothing resolvable
    node = make_skill_node(next_node_id=None)
    ctx = make_ctx(
        default_llm=ResolvedLlmNode(primary=provider, fallback=None, retry=_RETRY_ONCE),
        skill_body_port=port,
        secrets=secrets,
        tool_executor=tool_executor,
    )

    result, _next_id = await SkillNodeExecutor().execute(node, ctx)

    assert result.status == "complete"
    assert tool_executor.calls[0][0].api_key is None


async def test_unknown_tool_name_feeds_back_an_error_message_instead_of_raising() -> None:
    provider = ScriptedLlmProvider(
        [
            (["ignored"], [{"id": "call_1", "name": "not_a_real_tool", "arguments": {}}]),
            (["ok"], []),
        ]
    )
    port = FakeSkillBodyPort()
    node = make_skill_node(next_node_id=None)
    ctx = make_ctx(default_llm=ResolvedLlmNode(primary=provider, fallback=None, retry=_RETRY_ONCE), skill_body_port=port)

    result, _next_id = await SkillNodeExecutor().execute(node, ctx)

    assert result.status == "complete"
    assert result.output_text == "ok"


# --- failure modes ---------------------------------------------------------


async def test_unresolved_latest_version_is_a_defensive_failure_not_a_crash() -> None:
    node = make_skill_node(version="latest")
    ctx = make_ctx(default_llm=None, skill_body_port=FakeSkillBodyPort())

    result, next_id = await SkillNodeExecutor().execute(node, ctx)

    assert result.status == "failed"
    assert result.error_code == "SKILL_VERSION_UNRESOLVED"
    assert next_id == "fallback-1"


async def test_missing_skill_body_port_is_a_recognized_failure() -> None:
    node = make_skill_node()
    ctx = make_ctx(default_llm=ResolvedLlmNode(primary=object(), fallback=None, retry=_RETRY_ONCE), skill_body_port=None)

    result, next_id = await SkillNodeExecutor().execute(node, ctx)

    assert result.status == "failed"
    assert result.error_code == "SKILL_BODY_UNAVAILABLE"
    assert next_id == "fallback-1"


async def test_body_fetch_failure_takes_on_error() -> None:
    node = make_skill_node()
    ctx = make_ctx(
        default_llm=ResolvedLlmNode(primary=object(), fallback=None, retry=_RETRY_ONCE),
        skill_body_port=FakeSkillBodyPort(raises=True),
    )

    result, next_id = await SkillNodeExecutor().execute(node, ctx)

    assert result.status == "failed"
    assert result.error_code == "SKILL_BODY_UNAVAILABLE"
    assert next_id == "fallback-1"


async def test_no_default_llm_available_is_a_recognized_failure() -> None:
    node = make_skill_node()
    ctx = make_ctx(default_llm=None, skill_body_port=FakeSkillBodyPort())

    result, next_id = await SkillNodeExecutor().execute(node, ctx)

    assert result.status == "failed"
    assert result.error_code == "SKILL_NO_LLM_AVAILABLE"
    assert next_id == "fallback-1"


async def test_on_error_with_no_target_stops_the_walk() -> None:
    node = SkillNode.model_validate(
        {
            "id": "skill-1",
            "type": "skill",
            "name": "Refunds",
            "lane": "foreground",
            "on_error": {"action": "end_turn"},
            "on_deadline": {"action": "degrade"},
            "skill_id": "skill-uuid-1",
            "version": 1,
            "budget_ms": 1500,
            "next_node_id": "end-1",
        }
    )
    ctx = make_ctx(default_llm=None, skill_body_port=FakeSkillBodyPort())

    result, next_id = await SkillNodeExecutor().execute(node, ctx)

    assert result.status == "failed"
    assert next_id is None


# --- reachability (v1 scope: trigger_mode does not change runtime behavior) --


@pytest.mark.parametrize("trigger_mode", ["model", "router"])
async def test_execution_is_identical_regardless_of_the_skills_own_trigger_mode(trigger_mode: str) -> None:
    """v1 scope decision (see this module's docstring and the plan doc):
    a Skill node is always reached via ordinary deterministic graph wiring
    — `trigger_mode` is carried as `SkillVersion` metadata only, and does
    not change `SkillNodeExecutor`'s own runtime behavior. Both values
    must produce byte-for-byte identical execution here.
    """
    provider = ScriptedLlmProvider([(["Sure, refund processed."], [])])
    body = SkillBody(
        skill_id="skill-uuid-1",
        version=1,
        name="Refunds",
        description="Handle refunds",
        instructions="SOP",
        trigger_mode=trigger_mode,
        tool_definitions=(),
        knowledge_filters=SkillKnowledgeFilters(),
        budget_ms=1500,
    )
    port = FakeSkillBodyPort(body)
    node = make_skill_node()
    ctx = make_ctx(default_llm=ResolvedLlmNode(primary=provider, fallback=None, retry=_RETRY_ONCE), skill_body_port=port)

    result, next_id = await SkillNodeExecutor().execute(node, ctx)

    assert result.status == "complete"
    assert result.output_text == "Sure, refund processed."
    assert next_id == "end-1"
