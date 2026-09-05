"""Unit tests for `ToolNodeExecutor` (Phase 9, BL-036)."""

from __future__ import annotations

from uuid import uuid4

from avatar_agent.contracts.runtime_config import ToolNode
from avatar_agent.orchestration.graph.ir import TurnContext
from avatar_agent.orchestration.graph.nodes.tool import ToolNodeExecutor
from avatar_agent.orchestration.tools import ToolDefinition, ToolError
from avatar_agent.residency.filter import ResidencyPayload


def make_tool_node(
    *,
    node_id: str = "lookup",
    api_ref: str = "weather-api",
    argument_mapping: dict[str, str] | None = None,
    next_node_id: str | None = "next",
    on_error: dict[str, object] | None = None,
) -> ToolNode:
    return ToolNode.model_validate(
        {
            "id": node_id,
            "type": "tool",
            "name": "Lookup",
            "lane": "foreground",
            "on_error": on_error or {"action": "degrade"},
            "on_deadline": {"action": "degrade"},
            "api_ref": api_ref,
            "argument_mapping": argument_mapping or {},
            "next_node_id": next_node_id,
        }
    )


def make_ctx(
    *,
    tool_definitions_by_api_ref: dict[str, ToolDefinition] | None = None,
    tool_executor: object | None = None,
    turn_state: dict[str, object] | None = None,
) -> TurnContext:
    async def _speak(text: str) -> None:  # pragma: no cover - not exercised here
        pass

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
        tool_definitions_by_api_ref=tool_definitions_by_api_ref or {},
        tools_by_name={},
        tool_specs=[],
        tool_executor=tool_executor or object(),
        residency=ResidencyPayload(system_prompt="sys", messages=()),
        turn_state=turn_state if turn_state is not None else {},
        speak=_speak,
        hop_recorder=_NullHopRecorder(),
    )


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


def make_tool_def(api_ref: str = "weather-api") -> ToolDefinition:
    return ToolDefinition(api_ref=api_ref, name="get_weather", method="GET", url="https://weather.example.com", api_key=None)


async def test_tool_executes_and_stores_the_result_in_turn_state_keyed_by_node_id() -> None:
    node = make_tool_node(node_id="lookup", argument_mapping={"city": "$utterance", "unit": "celsius"}, next_node_id="speak-1")
    tool_executor = FakeToolExecutor(result="Sunny")
    ctx = make_ctx(
        tool_definitions_by_api_ref={"weather-api": make_tool_def()},
        tool_executor=tool_executor,
        turn_state={"utterance": "nyc weather"},
    )

    result, next_id = await ToolNodeExecutor().execute(node, ctx)

    assert result.status == "complete"
    assert result.output_text == "Sunny"
    assert ctx.turn_state["lookup"] == "Sunny"
    assert next_id == "speak-1"
    _called_tool, called_args = tool_executor.calls[0]
    assert called_args == {"city": "nyc weather", "unit": "celsius"}


async def test_unknown_api_ref_returns_a_failed_result_and_resolves_the_on_error_goto_edge() -> None:
    """Phase 10 fix (Phase 9 finding #2): a recognized failure (unknown
    `api_ref`) now takes the node's own configured `on_error` edge — proven
    here by a `goto` target that differs from `next_node_id`, so the two
    can't be confused.
    """
    node = make_tool_node(
        api_ref="missing-api", next_node_id="fallback-1", on_error={"action": "goto", "target_node_id": "recovery-1"}
    )
    ctx = make_ctx(tool_definitions_by_api_ref={})

    result, next_id = await ToolNodeExecutor().execute(node, ctx)

    assert result.status == "failed"
    assert result.error_code == "TOOL_UNKNOWN"
    assert next_id == "recovery-1"


async def test_unknown_api_ref_with_no_goto_on_error_stops_the_walk_instead_of_proceeding_to_next_node_id() -> None:
    """Without a `goto` configured, a recognized failure now stops the walk
    (mirrors the interpreter's own uncaught-exception handling) rather than
    silently proceeding via `next_node_id` as if nothing happened — the
    literal Phase 9 finding #2 bug, fixed.
    """
    node = make_tool_node(api_ref="missing-api", next_node_id="fallback-1")  # default on_error: degrade
    ctx = make_ctx(tool_definitions_by_api_ref={})

    result, next_id = await ToolNodeExecutor().execute(node, ctx)

    assert result.status == "failed"
    assert result.error_code == "TOOL_UNKNOWN"
    assert next_id is None


async def test_tool_error_from_the_executor_resolves_the_on_error_goto_edge() -> None:
    tool_executor = FakeToolExecutor(error=ToolError("timed out", code="TOOL_TIMEOUT"))
    node = make_tool_node(next_node_id="end-1", on_error={"action": "goto", "target_node_id": "fallback-speak"})
    ctx = make_ctx(tool_definitions_by_api_ref={"weather-api": make_tool_def()}, tool_executor=tool_executor)

    result, next_id = await ToolNodeExecutor().execute(node, ctx)

    assert result.status == "failed"
    assert result.error_code == "TOOL_TIMEOUT"
    assert next_id == "fallback-speak"


async def test_tool_error_from_the_executor_with_no_goto_on_error_stops_the_walk() -> None:
    tool_executor = FakeToolExecutor(error=ToolError("timed out", code="TOOL_TIMEOUT"))
    node = make_tool_node(next_node_id="end-1")  # default on_error: degrade, no goto
    ctx = make_ctx(tool_definitions_by_api_ref={"weather-api": make_tool_def()}, tool_executor=tool_executor)

    result, next_id = await ToolNodeExecutor().execute(node, ctx)

    assert result.status == "failed"
    assert result.error_code == "TOOL_TIMEOUT"
    assert next_id is None


async def test_argument_mapping_resolves_state_prefixed_node_keyed_and_literal_values() -> None:
    node = make_tool_node(
        node_id="lookup2",
        argument_mapping={"a": "$state.foo", "b": "$lookup1", "c": "literal-value"},
        next_node_id=None,
    )
    tool_executor = FakeToolExecutor(result="ok")
    ctx = make_ctx(
        tool_definitions_by_api_ref={"weather-api": make_tool_def()},
        tool_executor=tool_executor,
        turn_state={"foo": "bar", "lookup1": "prior-result"},
    )

    await ToolNodeExecutor().execute(node, ctx)

    _tool, args = tool_executor.calls[0]
    assert args == {"a": "bar", "b": "prior-result", "c": "literal-value"}


async def test_argument_mapping_resolves_an_unknown_state_key_to_none() -> None:
    node = make_tool_node(argument_mapping={"x": "$does_not_exist"}, next_node_id=None)
    tool_executor = FakeToolExecutor(result="ok")
    ctx = make_ctx(tool_definitions_by_api_ref={"weather-api": make_tool_def()}, tool_executor=tool_executor, turn_state={})

    await ToolNodeExecutor().execute(node, ctx)

    _tool, args = tool_executor.calls[0]
    assert args == {"x": None}
