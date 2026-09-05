"""Unit tests for `orchestration.graph.registry` (Phase 11, BL-042/043) —
`execute_one_node`/`walk_chain`, the shared chain-walking primitives
`nodes/parallel.py`/`nodes/loop.py` recurse through.
"""

from __future__ import annotations

import asyncio
from uuid import uuid4

from avatar_agent.contracts.internal_api import HopItem
from avatar_agent.contracts.runtime_config import EndNode, GraphNode, ToolNode
from avatar_agent.orchestration.graph.ir import TurnContext
from avatar_agent.orchestration.graph.registry import NODE_EXECUTORS, execute_one_node, walk_chain
from avatar_agent.orchestration.tools import ToolDefinition, ToolError
from avatar_agent.residency.filter import ResidencyPayload


class FakeHopRecorder:
    def __init__(self) -> None:
        self.recorded: list[HopItem] = []

    def record(self, item: HopItem) -> None:
        self.recorded.append(item)

    async def flush(self) -> None:
        pass


class FakeToolExecutor:
    def __init__(
        self, *, result: str | None = None, error: ToolError | None = None, delay: float = 0.0, delays: list[float] | None = None
    ) -> None:
        self._result = result
        self._error = error
        self._delay = delay
        self._delays = list(delays) if delays is not None else None
        self.calls: list[tuple] = []

    async def invoke(self, tool, arguments):  # noqa: ANN001
        self.calls.append((tool, arguments))
        delay = self._delays.pop(0) if self._delays else self._delay
        if delay:
            await asyncio.sleep(delay)
        if self._error is not None:
            raise self._error
        return self._result if self._result is not None else "ok"


def make_ctx(
    *,
    nodes_by_id: dict[str, GraphNode] | None = None,
    tool_definitions_by_api_ref: dict[str, ToolDefinition] | None = None,
    tool_executor: object | None = None,
    turn_state: dict[str, object] | None = None,
    hop_recorder: FakeHopRecorder | None = None,
) -> TurnContext:
    async def _speak(text: str) -> None:  # pragma: no cover
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
        hop_recorder=hop_recorder or FakeHopRecorder(),
        nodes_by_id=nodes_by_id or {},
    )


def make_tool_node(**overrides: object) -> ToolNode:
    base = {
        "id": "tool-1",
        "type": "tool",
        "name": "Lookup",
        "lane": "foreground",
        "on_error": {"action": "degrade"},
        "on_deadline": {"action": "degrade"},
        "api_ref": "weather-api",
        "argument_mapping": {},
        "next_node_id": None,
    }
    base.update(overrides)
    return ToolNode.model_validate(base)


def make_end_node(**overrides: object) -> EndNode:
    base = {
        "id": "end-1",
        "type": "end",
        "name": "End",
        "lane": "foreground",
        "on_error": {"action": "degrade"},
        "on_deadline": {"action": "degrade"},
    }
    base.update(overrides)
    return EndNode.model_validate(base)


def make_tool_def(api_ref: str = "weather-api") -> ToolDefinition:
    return ToolDefinition(api_ref=api_ref, name="get_weather", method="GET", url="https://weather.example.com", api_key=None)


class TestNodeExecutors:
    def test_registers_all_thirteen_node_types(self) -> None:
        """Phase 15 (BL-058/059/060) completes the full 13-type A3.2 set
        (`ARCHITECTURE_NOTES.md` §1) with Sub-agent/Handoff/State."""
        assert set(NODE_EXECUTORS.keys()) == {
            "llm",
            "tool",
            "retrieve",
            "router",
            "speak",
            "end",
            "parallel",
            "loop",
            "skill",
            "hitl",
            "subagent",
            "handoff",
            "state",
        }


class TestExecuteOneNode:
    async def test_executes_a_node_with_no_deadline_and_returns_its_next_id(self) -> None:
        node = make_tool_node(next_node_id="end-1")
        ctx = make_ctx(tool_definitions_by_api_ref={"weather-api": make_tool_def()}, tool_executor=FakeToolExecutor(result="ok"))
        result, next_id = await execute_one_node(node, ctx, remaining_ms=None)
        assert result.status == "complete"
        assert next_id == "end-1"

    async def test_cuts_a_node_outright_when_remaining_ms_is_already_zero_or_negative(self) -> None:
        node = make_tool_node(next_node_id="end-1")
        ctx = make_ctx(tool_definitions_by_api_ref={"weather-api": make_tool_def()}, tool_executor=FakeToolExecutor(result="ok"))
        result, next_id = await execute_one_node(node, ctx, remaining_ms=0)
        assert result.status == "timed_out"
        assert result.error_code == "CHAIN_BUDGET_EXCEEDED"
        assert next_id is None  # default on_deadline: degrade, no goto

    async def test_a_genuinely_slow_node_is_cut_mid_flight_by_asyncio_wait_for(self) -> None:
        node = make_tool_node(next_node_id="end-1")
        ctx = make_ctx(
            tool_definitions_by_api_ref={"weather-api": make_tool_def()},
            tool_executor=FakeToolExecutor(result="ok", delay=1.0),
        )
        result, next_id = await execute_one_node(node, ctx, remaining_ms=20)
        assert result.status == "timed_out"
        assert result.error_code == "CHAIN_BUDGET_EXCEEDED"
        assert next_id is None

    async def test_a_recognized_tool_failure_resolves_on_error_not_next_node_id(self) -> None:
        node = make_tool_node(next_node_id="wrong-target", on_error={"action": "goto", "target_node_id": "recovery"})
        ctx = make_ctx(tool_definitions_by_api_ref={})  # unknown api_ref -> TOOL_UNKNOWN
        result, next_id = await execute_one_node(node, ctx, remaining_ms=None)
        assert result.status == "failed"
        assert result.error_code == "TOOL_UNKNOWN"
        assert next_id == "recovery"


class TestWalkChain:
    async def test_walks_a_multi_node_chain_to_its_natural_dangling_termination(self) -> None:
        nodes_by_id = {"tool-1": make_tool_node(next_node_id="end-1"), "end-1": make_end_node()}
        ctx = make_ctx(
            nodes_by_id=nodes_by_id,
            tool_definitions_by_api_ref={"weather-api": make_tool_def()},
            tool_executor=FakeToolExecutor(result="42"),
        )
        result = await walk_chain("tool-1", ctx)
        assert [r.node_id for r in result.trace] == ["tool-1", "end-1"]
        assert result.last_output_text == "42"

    async def test_records_every_node_it_executes_via_the_hop_recorder(self) -> None:
        """R-G9/BL-039 — a chain walked on behalf of a Parallel branch/Loop
        body must still be visible in the session's node trace, exactly like
        the top-level foreground walk (`interpreter.py`'s own recording).
        """
        nodes_by_id = {"tool-1": make_tool_node(next_node_id="end-1"), "end-1": make_end_node()}
        recorder = FakeHopRecorder()
        ctx = make_ctx(
            nodes_by_id=nodes_by_id,
            tool_definitions_by_api_ref={"weather-api": make_tool_def()},
            tool_executor=FakeToolExecutor(result="42"),
            hop_recorder=recorder,
        )
        await walk_chain("tool-1", ctx)
        assert [item.node_id for item in recorder.recorded] == ["tool-1", "end-1"]
        assert all(item.hop == "node" for item in recorder.recorded)

    async def test_a_missing_node_id_stops_the_walk_rather_than_raising(self) -> None:
        ctx = make_ctx(nodes_by_id={})
        result = await walk_chain("does-not-exist", ctx)
        assert result.trace == []
        assert result.last_output_text is None

    async def test_a_start_id_of_none_produces_an_empty_chain(self) -> None:
        ctx = make_ctx(nodes_by_id={})
        result = await walk_chain(None, ctx)
        assert result.trace == []
        assert result.last_output_text is None

    async def test_budget_ms_bounds_the_whole_chain_not_just_one_node(self) -> None:
        # Generous, deliberately asymmetric margins to avoid CI timing
        # flakiness: the first two nodes' 30ms delays comfortably fit inside
        # a 100ms chain budget individually and cumulatively, but the third
        # node's 500ms delay can never fit in whatever tiny remainder is
        # left (~40ms) — proving the deadline is tracked cumulatively across
        # the *whole* chain, not reset fresh for each node.
        nodes_by_id = {
            "tool-1": make_tool_node(id="tool-1", next_node_id="tool-2"),
            "tool-2": make_tool_node(id="tool-2", next_node_id="tool-3"),
            "tool-3": make_tool_node(id="tool-3", next_node_id=None),
        }
        ctx = make_ctx(
            nodes_by_id=nodes_by_id,
            tool_definitions_by_api_ref={"weather-api": make_tool_def()},
            tool_executor=FakeToolExecutor(result="ok", delays=[0.03, 0.03, 0.5]),
        )
        result = await walk_chain("tool-1", ctx, budget_ms=100)
        assert result.trace[0].status == "complete"
        assert result.trace[1].status == "complete"
        assert result.trace[2].status == "timed_out"

    async def test_a_chain_result_succeeded_property_reflects_the_last_node_status(self) -> None:
        nodes_by_id = {"tool-1": make_tool_node(next_node_id=None)}
        ok_ctx = make_ctx(
            nodes_by_id=nodes_by_id,
            tool_definitions_by_api_ref={"weather-api": make_tool_def()},
            tool_executor=FakeToolExecutor(),
        )
        ok_result = await walk_chain("tool-1", ok_ctx)
        assert ok_result.succeeded is True

        failing_ctx = make_ctx(nodes_by_id=nodes_by_id, tool_definitions_by_api_ref={})  # unknown api_ref -> failed
        failing_result = await walk_chain("tool-1", failing_ctx)
        assert failing_result.succeeded is False

    async def test_an_empty_trace_is_not_succeeded(self) -> None:
        ctx = make_ctx(nodes_by_id={})
        result = await walk_chain("ghost", ctx)
        assert result.succeeded is False

    async def test_respects_max_steps_on_a_pathological_cycle(self) -> None:
        nodes_by_id = {
            "tool-1": make_tool_node(id="tool-1", next_node_id="tool-2"),
            "tool-2": make_tool_node(id="tool-2", next_node_id="tool-1"),
        }
        ctx = make_ctx(
            nodes_by_id=nodes_by_id,
            tool_definitions_by_api_ref={"weather-api": make_tool_def()},
            tool_executor=FakeToolExecutor(),
        )
        result = await walk_chain("tool-1", ctx, max_steps=5)
        assert len(result.trace) == 5
