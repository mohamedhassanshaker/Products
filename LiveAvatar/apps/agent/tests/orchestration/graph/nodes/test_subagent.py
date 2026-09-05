"""Unit tests for `SubAgentNodeExecutor` (Phase 15, BL-058).

Mirrors `test_skill.py`'s style (fake ports, a small `make_ctx`/
`make_subagent_node` pair, explicit happy-path/caching/failure-mode
sections) — see that file for the precedent this one follows.
"""

from __future__ import annotations

import asyncio
from uuid import uuid4

from avatar_agent.contracts.runtime_config import RetryPolicy, SubAgentNode
from avatar_agent.orchestration.graph.ir import TurnContext
from avatar_agent.orchestration.graph.nodes.subagent import SubAgentNodeExecutor
from avatar_agent.orchestration.tools import ToolError
from avatar_agent.ports.orchestration import ResolvedLlmNode, SubAgentPersona, SubAgentToolDefinition
from avatar_agent.ports.secrets import SecretNotFoundError
from avatar_agent.residency.filter import ResidencyPayload

_RETRY_ONCE = RetryPolicy(max_attempts=1, backoff_ms=[0])
_TARGET_TENANT_ID = "77777777-7777-7777-7777-777777777777"


def make_subagent_node(
    *,
    node_id: str = "subagent-1",
    target_tenant_id: str = _TARGET_TENANT_ID,
    handback_policy: str = "speak_and_return",
    budget_ms: int = 4000,
    next_node_id: str | None = "end-1",
) -> SubAgentNode:
    return SubAgentNode.model_validate(
        {
            "id": node_id,
            "type": "subagent",
            "name": "Delegate to billing",
            "lane": "foreground",
            "on_error": {"action": "goto", "target_node_id": "fallback-1"},
            "on_deadline": {"action": "degrade"},
            "target_tenant_id": target_tenant_id,
            "handback_policy": handback_policy,
            "budget_ms": budget_ms,
            "next_node_id": next_node_id,
        }
    )


def make_persona(
    *,
    system_prompt: str = "You are the billing agent.",
    tool_definitions: tuple[SubAgentToolDefinition, ...] = (),
) -> SubAgentPersona:
    return SubAgentPersona(tenant_id=_TARGET_TENANT_ID, system_prompt=system_prompt, tool_definitions=tool_definitions)


class ScriptedLlmProvider:
    """Same shape as `test_skill.py`'s own double — returns a scripted
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


class SlowLlmProvider:
    """Never resolves within any test's own short budget — proves the
    node's own `asyncio.wait_for(..., timeout=node.budget_ms / 1000)`
    actually cuts a genuinely slow delegated turn."""

    key = "openai"

    async def complete_stream(self, messages, tools, residency):  # noqa: ANN001
        await asyncio.sleep(1.0)
        raise AssertionError("should have been cut by the budget first")  # pragma: no cover

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


class FakeSubAgentPersonaPort:
    def __init__(self, persona: SubAgentPersona | None = None, *, raises: bool = False) -> None:
        self._persona = persona or make_persona()
        self._raises = raises
        self.calls: list[str] = []

    async def get_persona(self, target_tenant_id: str) -> SubAgentPersona:
        self.calls.append(target_tenant_id)
        if self._raises:
            raise RuntimeError("simulated fetch failure")
        return self._persona


class FakeSecretStore:
    def __init__(self, secrets: dict[str, str] | None = None) -> None:
        self._secrets = secrets or {}

    def resolve(self, credential_ref: str) -> str:
        if credential_ref not in self._secrets:
            raise SecretNotFoundError(credential_ref)
        return self._secrets[credential_ref]


class _NullHopRecorder:
    def record(self, item) -> None:  # noqa: ANN001
        pass

    async def flush(self) -> None:
        pass


def make_ctx(
    *,
    default_llm: ResolvedLlmNode | None,
    subagent_persona_port=None,  # noqa: ANN001
    secrets=None,  # noqa: ANN001
    tool_executor=None,  # noqa: ANN001
    subagent_persona_cache: dict | None = None,
    residency: ResidencyPayload | None = None,
    tenant_id=None,  # noqa: ANN001
) -> tuple[TurnContext, list[str]]:
    spoken: list[str] = []

    async def _speak(text: str) -> None:
        spoken.append(text)

    ctx = TurnContext(
        session_id=uuid4(),
        tenant_id=tenant_id if tenant_id is not None else uuid4(),
        utterance_seq=1,
        llm_by_node={},
        tool_definitions_by_api_ref={},
        tools_by_name={},
        tool_specs=[],
        tool_executor=tool_executor or object(),
        residency=residency or ResidencyPayload(system_prompt="Base prompt.", messages=()),
        turn_state={"utterance": "please transfer me to billing"},
        speak=_speak,
        hop_recorder=_NullHopRecorder(),
        default_llm=default_llm,
        subagent_persona_port=subagent_persona_port,
        secrets=secrets,
        subagent_persona_cache=subagent_persona_cache if subagent_persona_cache is not None else {},
    )
    return ctx, spoken


# --- happy path ----------------------------------------------------------


async def test_speak_and_return_speaks_the_delegated_reply_and_continues_to_next_node_id() -> None:
    provider = ScriptedLlmProvider([(["Your balance is $42."], [])])
    port = FakeSubAgentPersonaPort(make_persona(system_prompt="SECRET-BILLING-PERSONA"))
    node = make_subagent_node(handback_policy="speak_and_return", next_node_id="end-1")
    ctx, spoken = make_ctx(default_llm=ResolvedLlmNode(primary=provider, fallback=None, retry=_RETRY_ONCE), subagent_persona_port=port)

    result, next_id = await SubAgentNodeExecutor().execute(node, ctx)

    assert result.status == "complete"
    assert result.output_text == "Your balance is $42."
    assert result.node_type == "subagent"
    assert next_id == "end-1"
    assert spoken == ["Your balance is $42."]
    assert ctx.spoken is True
    assert ctx.turn_state["subagent-1"] == "Your balance is $42."
    # Persona swap, not augmentation: the target's own system prompt reached
    # the LLM call verbatim...
    assert provider.calls[0].system_prompt == "SECRET-BILLING-PERSONA"
    # ...but the original, shared ctx.residency was never mutated.
    assert ctx.residency.system_prompt == "Base prompt."


async def test_silent_return_never_speaks_but_still_sets_turn_state() -> None:
    provider = ScriptedLlmProvider([(["Refund of $10 issued."], [])])
    port = FakeSubAgentPersonaPort(make_persona())
    node = make_subagent_node(handback_policy="silent_return", next_node_id="end-1")
    ctx, spoken = make_ctx(default_llm=ResolvedLlmNode(primary=provider, fallback=None, retry=_RETRY_ONCE), subagent_persona_port=port)

    result, next_id = await SubAgentNodeExecutor().execute(node, ctx)

    assert result.status == "complete"
    assert next_id == "end-1"
    assert spoken == []  # never auto-spoken
    assert ctx.spoken is False
    assert ctx.turn_state["subagent-1"] == "Refund of $10 issued."


# --- caching ---------------------------------------------------------------


async def test_persona_is_fetched_once_and_reused_from_cache_on_a_second_call_with_the_same_ctx() -> None:
    provider = ScriptedLlmProvider([(["first"], []), (["second"], [])])
    port = FakeSubAgentPersonaPort()
    node = make_subagent_node()
    shared_cache: dict = {}
    ctx, _spoken = make_ctx(
        default_llm=ResolvedLlmNode(primary=provider, fallback=None, retry=_RETRY_ONCE),
        subagent_persona_port=port,
        subagent_persona_cache=shared_cache,
    )

    await SubAgentNodeExecutor().execute(node, ctx)
    await SubAgentNodeExecutor().execute(node, ctx)

    assert len(port.calls) == 1  # second execution reused the cache
    assert len(shared_cache) == 1


async def test_cache_key_is_scoped_by_tenant_id_and_target_tenant_id() -> None:
    provider = ScriptedLlmProvider([(["a"], []), (["b"], [])])
    port = FakeSubAgentPersonaPort()
    node_a = make_subagent_node(target_tenant_id="11111111-1111-1111-1111-111111111111")
    node_b = make_subagent_node(target_tenant_id="22222222-2222-2222-2222-222222222222")
    shared_cache: dict = {}
    ctx, _spoken = make_ctx(
        default_llm=ResolvedLlmNode(primary=provider, fallback=None, retry=_RETRY_ONCE),
        subagent_persona_port=port,
        subagent_persona_cache=shared_cache,
    )

    await SubAgentNodeExecutor().execute(node_a, ctx)
    await SubAgentNodeExecutor().execute(node_b, ctx)

    assert len(port.calls) == 2  # different target tenants never share a cache entry
    assert len(shared_cache) == 2


async def test_a_transient_fetch_failure_is_not_cached_so_the_next_trigger_retries() -> None:
    port = FakeSubAgentPersonaPort(raises=True)
    node = make_subagent_node()
    shared_cache: dict = {}
    ctx, _spoken = make_ctx(
        default_llm=ResolvedLlmNode(primary=object(), fallback=None, retry=_RETRY_ONCE),
        subagent_persona_port=port,
        subagent_persona_cache=shared_cache,
    )

    result, next_id = await SubAgentNodeExecutor().execute(node, ctx)

    assert result.status == "failed"
    assert result.error_code == "SUBAGENT_PERSONA_UNAVAILABLE"
    assert next_id == "fallback-1"
    assert shared_cache == {}


# --- tool round trip (the persona's own attached tools) ---------------------


async def test_persona_own_tool_is_invoked_and_result_fed_back_for_a_second_round() -> None:
    provider = ScriptedLlmProvider(
        [
            (["ignored"], [{"id": "call_1", "name": "lookup_balance", "arguments": {"account": "42"}}]),
            (["Balance retrieved."], []),
        ]
    )
    tool_executor = FakeToolExecutor(result="balance=42.00")
    persona = make_persona(
        tool_definitions=(
            SubAgentToolDefinition(
                api_ref="lookup_balance",
                name="lookup_balance",
                description="Looks up an account balance",
                method="GET",
                url="https://api.example.com/balance",
                credential_ref=None,
                args_schema={},
            ),
        )
    )
    port = FakeSubAgentPersonaPort(persona)
    node = make_subagent_node(next_node_id=None)
    ctx, spoken = make_ctx(
        default_llm=ResolvedLlmNode(primary=provider, fallback=None, retry=_RETRY_ONCE),
        subagent_persona_port=port,
        tool_executor=tool_executor,
    )

    result, _next_id = await SubAgentNodeExecutor().execute(node, ctx)

    assert len(tool_executor.calls) == 1
    called_tool, called_args = tool_executor.calls[0]
    assert called_tool.api_ref == "lookup_balance"
    assert called_args == {"account": "42"}
    assert result.output_text == "Balance retrieved."
    assert spoken == ["Balance retrieved."]


async def test_persona_tool_credential_is_resolved_lazily_via_ctx_secrets() -> None:
    provider = ScriptedLlmProvider(
        [
            (["ignored"], [{"id": "call_1", "name": "lookup_balance", "arguments": {}}]),
            (["done"], []),
        ]
    )
    tool_executor = FakeToolExecutor(result="ok")
    persona = make_persona(
        tool_definitions=(
            SubAgentToolDefinition(
                api_ref="lookup_balance",
                name="lookup_balance",
                description=None,
                method="GET",
                url="https://api.example.com/balance",
                credential_ref="secrets/billing-api",
                args_schema={},
            ),
        )
    )
    port = FakeSubAgentPersonaPort(persona)
    secrets = FakeSecretStore({"secrets/billing-api": "sk-live-123"})
    node = make_subagent_node(next_node_id=None)
    ctx, _spoken = make_ctx(
        default_llm=ResolvedLlmNode(primary=provider, fallback=None, retry=_RETRY_ONCE),
        subagent_persona_port=port,
        secrets=secrets,
        tool_executor=tool_executor,
    )

    await SubAgentNodeExecutor().execute(node, ctx)

    assert tool_executor.calls[0][0].api_key == "sk-live-123"


async def test_an_unresolvable_persona_tool_credential_does_not_fail_the_node() -> None:
    provider = ScriptedLlmProvider(
        [
            (["ignored"], [{"id": "call_1", "name": "lookup_balance", "arguments": {}}]),
            (["done"], []),
        ]
    )
    tool_executor = FakeToolExecutor(result="ok")
    persona = make_persona(
        tool_definitions=(
            SubAgentToolDefinition(
                api_ref="lookup_balance",
                name="lookup_balance",
                description=None,
                method="GET",
                url="https://api.example.com/balance",
                credential_ref="secrets/missing",
                args_schema={},
            ),
        )
    )
    port = FakeSubAgentPersonaPort(persona)
    secrets = FakeSecretStore({})
    node = make_subagent_node(next_node_id=None)
    ctx, _spoken = make_ctx(
        default_llm=ResolvedLlmNode(primary=provider, fallback=None, retry=_RETRY_ONCE),
        subagent_persona_port=port,
        secrets=secrets,
        tool_executor=tool_executor,
    )

    result, _next_id = await SubAgentNodeExecutor().execute(node, ctx)

    assert result.status == "complete"
    assert tool_executor.calls[0][0].api_key is None


# --- failure modes -----------------------------------------------------


async def test_missing_subagent_persona_port_is_a_recognized_failure() -> None:
    node = make_subagent_node()
    ctx, spoken = make_ctx(default_llm=ResolvedLlmNode(primary=object(), fallback=None, retry=_RETRY_ONCE), subagent_persona_port=None)

    result, next_id = await SubAgentNodeExecutor().execute(node, ctx)

    assert result.status == "failed"
    assert result.error_code == "SUBAGENT_PERSONA_UNAVAILABLE"
    assert next_id == "fallback-1"
    assert spoken == []


async def test_persona_fetch_failure_takes_on_error() -> None:
    node = make_subagent_node()
    ctx, _spoken = make_ctx(
        default_llm=ResolvedLlmNode(primary=object(), fallback=None, retry=_RETRY_ONCE),
        subagent_persona_port=FakeSubAgentPersonaPort(raises=True),
    )

    result, next_id = await SubAgentNodeExecutor().execute(node, ctx)

    assert result.status == "failed"
    assert result.error_code == "SUBAGENT_PERSONA_UNAVAILABLE"
    assert next_id == "fallback-1"


async def test_no_default_llm_available_is_a_recognized_failure() -> None:
    node = make_subagent_node()
    ctx, _spoken = make_ctx(default_llm=None, subagent_persona_port=FakeSubAgentPersonaPort())

    result, next_id = await SubAgentNodeExecutor().execute(node, ctx)

    assert result.status == "failed"
    assert result.error_code == "SUBAGENT_NO_LLM_AVAILABLE"
    assert next_id == "fallback-1"


async def test_budget_exceeded_is_a_recognized_failure_not_a_hang() -> None:
    node = make_subagent_node(budget_ms=10)
    ctx, spoken = make_ctx(
        default_llm=ResolvedLlmNode(primary=SlowLlmProvider(), fallback=None, retry=_RETRY_ONCE),
        subagent_persona_port=FakeSubAgentPersonaPort(),
    )

    result, next_id = await SubAgentNodeExecutor().execute(node, ctx)

    assert result.status == "failed"
    assert result.error_code == "SUBAGENT_BUDGET_EXCEEDED"
    assert next_id == "fallback-1"
    assert spoken == []


async def test_on_error_with_no_target_stops_the_walk() -> None:
    node = SubAgentNode.model_validate(
        {
            "id": "subagent-1",
            "type": "subagent",
            "name": "Delegate to billing",
            "lane": "foreground",
            "on_error": {"action": "end_turn"},
            "on_deadline": {"action": "degrade"},
            "target_tenant_id": _TARGET_TENANT_ID,
            "handback_policy": "speak_and_return",
            "budget_ms": 4000,
            "next_node_id": "end-1",
        }
    )
    ctx, _spoken = make_ctx(default_llm=None, subagent_persona_port=FakeSubAgentPersonaPort())

    result, next_id = await SubAgentNodeExecutor().execute(node, ctx)

    assert result.status == "failed"
    assert next_id is None
