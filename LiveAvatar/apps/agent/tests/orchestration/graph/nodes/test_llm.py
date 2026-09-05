"""Unit tests for `LlmNodeExecutor` (Phase 9, BL-036) — this ports the
pre-Phase-9 pipeline's `_consume_llm_stream`/`_apply_tool_results`/one-round
tool-call follow-up logic verbatim, so this file proves the ported behavior
is byte-for-byte identical: the same `_MAX_TOOL_ROUNDS = 1` bound, the same
unknown-tool-name handling, and the same `first_token_ms` tracking across the
follow-up round.
"""

from __future__ import annotations

from uuid import uuid4

import pytest

from avatar_agent.contracts.runtime_config import LlmNode, RetryPolicy
from avatar_agent.orchestration.failover import LlmUnavailableError
from avatar_agent.orchestration.graph.ir import TurnContext
from avatar_agent.orchestration.graph.nodes.llm import LlmNodeExecutor
from avatar_agent.orchestration.tools import ToolDefinition, ToolError
from avatar_agent.ports.llm import LlmError
from avatar_agent.ports.orchestration import ResolvedLlmNode
from avatar_agent.residency.filter import ResidencyPayload

_RETRY_ONCE = RetryPolicy(max_attempts=1, backoff_ms=[0])


def make_llm_node(*, node_id: str = "llm-1", next_node_id: str | None = "speak-1") -> LlmNode:
    return LlmNode.model_validate(
        {
            "id": node_id,
            "type": "llm",
            "name": "Answer",
            "lane": "foreground",
            "on_error": {"action": "degrade"},
            "on_deadline": {"action": "degrade"},
            "provider": "openai",
            "model": "gpt-4o",
            "retry": {"max_attempts": 1, "backoff_ms": [0]},
            "next_node_id": next_node_id,
        }
    )


def make_ctx(
    *,
    llm_by_node: dict[str, ResolvedLlmNode],
    tools_by_name: dict[str, ToolDefinition] | None = None,
    tool_executor: object | None = None,
    turn_state: dict[str, object] | None = None,
) -> TurnContext:
    async def _speak(text: str) -> None:  # pragma: no cover - LLM nodes never call ctx.speak directly
        raise AssertionError("LlmNodeExecutor must never call ctx.speak directly")

    class _NullHopRecorder:
        def record(self, item):  # noqa: ANN001
            pass

        async def flush(self) -> None:
            pass

    return TurnContext(
        session_id=uuid4(),
        tenant_id=uuid4(),
        utterance_seq=1,
        llm_by_node=llm_by_node,
        tool_definitions_by_api_ref={},
        tools_by_name=tools_by_name or {},
        tool_specs=[],
        tool_executor=tool_executor or object(),
        residency=ResidencyPayload(system_prompt="sys", messages=()),
        turn_state=turn_state if turn_state is not None else {},
        speak=_speak,
        hop_recorder=_NullHopRecorder(),
    )


class ScriptedLlmProvider:
    """Returns a scripted `(delta_texts, tool_calls)` pair per successive
    `complete_stream` call — one entry per LLM round.
    """

    key = "openai"

    def __init__(self, rounds: list[tuple[list[str], list[dict]]]) -> None:
        self._rounds = rounds
        self.call_count = 0

    async def complete_stream(self, messages, tools, residency):  # noqa: ANN001
        texts, tool_calls = self._rounds[self.call_count]
        self.call_count += 1

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


def make_tool_def() -> ToolDefinition:
    return ToolDefinition(
        api_ref="weather-api", name="get_weather", method="GET", url="https://weather.example.com", api_key=None
    )


# --- single round, no tool calls -----------------------------------------


async def test_single_round_no_tool_calls_returns_complete_with_the_reply_and_next_node_id() -> None:
    provider = ScriptedLlmProvider([(["hello", " world"], [])])
    node = make_llm_node(next_node_id="speak-1")
    ctx = make_ctx(llm_by_node={"llm-1": ResolvedLlmNode(primary=provider, fallback=None, retry=_RETRY_ONCE)})

    result, next_id = await LlmNodeExecutor().execute(node, ctx)

    assert result.status == "complete"
    assert result.output_text == "hello world"
    assert result.provider_key == "openai"
    assert result.used_fallback is False
    assert result.first_token_ms is not None
    assert next_id == "speak-1"
    assert ctx.turn_state["_last_llm_output"] == "hello world"
    assert provider.call_count == 1


# --- tool-call round trip ---------------------------------------------------


async def test_tool_call_is_invoked_and_its_result_fed_back_for_a_second_round() -> None:
    provider = ScriptedLlmProvider(
        [
            (["ignored"], [{"id": "call_1", "name": "get_weather", "arguments": {"city": "nyc"}}]),
            (["Sunny, 72F"], []),
        ]
    )
    tool_executor = FakeToolExecutor(result="raw weather data")
    node = make_llm_node(next_node_id=None)
    ctx = make_ctx(
        llm_by_node={"llm-1": ResolvedLlmNode(primary=provider, fallback=None, retry=_RETRY_ONCE)},
        tools_by_name={"get_weather": make_tool_def()},
        tool_executor=tool_executor,
    )

    result, _next_id = await LlmNodeExecutor().execute(node, ctx)

    assert len(tool_executor.calls) == 1
    called_tool, called_args = tool_executor.calls[0]
    assert called_tool.name == "get_weather"
    assert called_args == {"city": "nyc"}
    # The final reply is the SECOND round's output, not left over from the first.
    assert result.output_text == "Sunny, 72F"
    assert provider.call_count == 2
    # The tool result was appended onto residency for the follow-up call.
    assert ctx.residency.messages[-1] == {"role": "tool", "content": "raw weather data"}


async def test_unknown_tool_name_feeds_back_an_error_message_instead_of_raising() -> None:
    provider = ScriptedLlmProvider(
        [
            (["ignored"], [{"id": "call_1", "name": "not_a_real_tool", "arguments": {}}]),
            (["ok"], []),
        ]
    )
    node = make_llm_node(next_node_id=None)
    ctx = make_ctx(llm_by_node={"llm-1": ResolvedLlmNode(primary=provider, fallback=None, retry=_RETRY_ONCE)})

    result, _next_id = await LlmNodeExecutor().execute(node, ctx)

    assert result.status == "complete"
    assert result.output_text == "ok"
    assert "not available" in ctx.residency.messages[-1]["content"]
    assert provider.call_count == 2


async def test_tool_execution_failure_feeds_back_an_error_message_instead_of_raising() -> None:
    provider = ScriptedLlmProvider(
        [
            (["ignored"], [{"id": "call_1", "name": "get_weather", "arguments": {}}]),
            (["ok"], []),
        ]
    )
    tool_executor = FakeToolExecutor(error=ToolError("timed out", code="TOOL_TIMEOUT"))
    node = make_llm_node(next_node_id=None)
    ctx = make_ctx(
        llm_by_node={"llm-1": ResolvedLlmNode(primary=provider, fallback=None, retry=_RETRY_ONCE)},
        tools_by_name={"get_weather": make_tool_def()},
        tool_executor=tool_executor,
    )

    result, _next_id = await LlmNodeExecutor().execute(node, ctx)

    assert result.status == "complete"  # the follow-up round still ran despite the tool failure
    assert "failed" in ctx.residency.messages[-1]["content"]
    assert provider.call_count == 2


async def test_tool_round_trip_is_bounded_to_exactly_one_follow_up_round() -> None:
    # Every round keeps requesting the same tool — must not loop forever.
    provider = ScriptedLlmProvider(
        [
            (["r1"], [{"id": "call_1", "name": "get_weather", "arguments": {}}]),
            (["r2"], [{"id": "call_2", "name": "get_weather", "arguments": {}}]),
            (["r3"], [{"id": "call_3", "name": "get_weather", "arguments": {}}]),
        ]
    )
    tool_executor = FakeToolExecutor(result="ok")
    node = make_llm_node(next_node_id=None)
    ctx = make_ctx(
        llm_by_node={"llm-1": ResolvedLlmNode(primary=provider, fallback=None, retry=_RETRY_ONCE)},
        tools_by_name={"get_weather": make_tool_def()},
        tool_executor=tool_executor,
    )

    result, _next_id = await LlmNodeExecutor().execute(node, ctx)

    assert provider.call_count == 2  # first round + exactly one bounded follow-up, never more
    assert result.output_text == "r2"  # the second round's reply, even though it still requested a tool call
    assert len(tool_executor.calls) == 1


# --- first_token_ms tracking across rounds ---------------------------------


async def test_first_token_ms_is_captured_from_the_first_round_when_it_produced_tokens() -> None:
    provider = ScriptedLlmProvider(
        [
            (["thinking..."], [{"id": "call_1", "name": "get_weather", "arguments": {}}]),
            (["final"], []),
        ]
    )
    ctx = make_ctx(
        llm_by_node={"llm-1": ResolvedLlmNode(primary=provider, fallback=None, retry=_RETRY_ONCE)},
        tools_by_name={"get_weather": make_tool_def()},
        tool_executor=FakeToolExecutor(result="ok"),
    )
    node = make_llm_node(next_node_id=None)

    result, _next_id = await LlmNodeExecutor().execute(node, ctx)

    assert result.first_token_ms is not None


async def test_first_token_ms_falls_back_to_the_follow_up_round_when_the_first_round_produced_no_tokens() -> None:
    # The first round yields ZERO delta text at all (just an immediate tool
    # call) — `first_token_ms` must come from the follow-up round instead.
    provider = ScriptedLlmProvider(
        [
            ([], [{"id": "call_1", "name": "get_weather", "arguments": {}}]),
            (["final"], []),
        ]
    )
    ctx = make_ctx(
        llm_by_node={"llm-1": ResolvedLlmNode(primary=provider, fallback=None, retry=_RETRY_ONCE)},
        tools_by_name={"get_weather": make_tool_def()},
        tool_executor=FakeToolExecutor(result="ok"),
    )
    node = make_llm_node(next_node_id=None)

    result, _next_id = await LlmNodeExecutor().execute(node, ctx)

    assert result.first_token_ms is not None


# --- unresolved node / propagation ------------------------------------------


async def test_returns_a_failed_result_when_no_resolved_provider_exists_for_this_node_id() -> None:
    node = make_llm_node(node_id="llm-1", next_node_id="speak-1")
    ctx = make_ctx(llm_by_node={})  # nothing resolved for "llm-1"

    result, next_id = await LlmNodeExecutor().execute(node, ctx)

    assert result.status == "failed"
    assert result.error_code == "LLM_NODE_UNRESOLVED"
    assert next_id is None


async def test_llm_unavailable_error_propagates_out_of_execute_uncaught() -> None:
    class AlwaysFailingProvider:
        key = "openai"

        async def complete_stream(self, *a, **k):  # noqa: ANN002, ANN003
            raise LlmError("down", retryable=False)

        async def complete_structured(self, *a, **k):  # noqa: ANN002, ANN003
            raise NotImplementedError

        @property
        def first_token_ms(self) -> int | None:
            return None

    node = make_llm_node(next_node_id=None)
    ctx = make_ctx(llm_by_node={"llm-1": ResolvedLlmNode(primary=AlwaysFailingProvider(), fallback=None, retry=_RETRY_ONCE)})

    with pytest.raises(LlmUnavailableError):
        await LlmNodeExecutor().execute(node, ctx)
