"""Unit tests for `LoopNodeExecutor` (Phase 11, BL-043) — real repeated
execution of a bounded body chain, with runtime guard enforcement proven
independently for each of the three guards (max_iterations, max_duration_ms,
max_cost), plus a genuine "this would otherwise run forever" case to prove a
runaway loop is actually cut, not just theoretically bounded.
"""

from __future__ import annotations

import asyncio
import time
from uuid import uuid4

from avatar_agent.contracts.runtime_config import LoopNode, ToolNode
from avatar_agent.orchestration.graph.ir import GraphNode, TurnContext
from avatar_agent.orchestration.graph.nodes.loop import LoopNodeExecutor
from avatar_agent.orchestration.tools import ToolDefinition
from avatar_agent.residency.filter import ResidencyPayload


def make_loop_node(**overrides: object) -> LoopNode:
    base: dict[str, object] = {
        "id": "loop-1",
        "type": "loop",
        "name": "Refine",
        "lane": "foreground",
        "on_error": {"action": "degrade"},
        "on_deadline": {"action": "degrade"},
        "body_entry_node_id": "tool-body",
        "condition": "counter == 3",
        "max_iterations": 10,
        "max_duration_ms": 10_000,
        "max_cost": 100,
        "next_node_id": None,
    }
    base.update(overrides)
    return LoopNode.model_validate(base)


def make_tool_node(node_id: str, api_ref: str, *, next_node_id: str | None = None) -> ToolNode:
    return ToolNode.model_validate(
        {
            "id": node_id,
            "type": "tool",
            "name": node_id,
            "lane": "foreground",
            "on_error": {"action": "degrade"},
            "on_deadline": {"action": "degrade"},
            "api_ref": api_ref,
            "argument_mapping": {},
            "next_node_id": next_node_id,
        }
    )


class _NullHopRecorder:
    def record(self, item):  # noqa: ANN001
        pass

    async def flush(self) -> None:
        pass


class CountingToolExecutor:
    """Increments `turn_state["counter"]` (the *real* `TurnContext.turn_state`
    dict, passed in after the `TurnContext` is constructed — see `make_ctx`)
    on every call and returns it as text — lets a Loop's `condition`
    genuinely depend on how many iterations have actually run, proving the
    loop is evaluated for real, not stubbed.
    """

    def __init__(self, turn_state: dict[str, object], *, delay: float = 0.0) -> None:
        self._turn_state = turn_state
        self._delay = delay
        self.call_count = 0

    async def invoke(self, tool: ToolDefinition, arguments: dict[str, object]) -> str:
        if self._delay:
            await asyncio.sleep(self._delay)
        self.call_count += 1
        self._turn_state["counter"] = self.call_count
        return str(self.call_count)


def make_ctx(
    *, nodes_by_id: dict[str, GraphNode], tool_definitions_by_api_ref: dict[str, ToolDefinition], delay: float = 0.0
) -> TurnContext:
    """Builds a `TurnContext` wired to a `CountingToolExecutor` that shares
    the *same* `turn_state` dict the context itself uses (required so the
    Loop's `condition` — evaluated against `ctx.turn_state` — actually sees
    each iteration's effect).
    """

    async def _speak(text: str) -> None:  # pragma: no cover
        pass

    turn_state: dict[str, object] = {}
    ctx = TurnContext(
        session_id=uuid4(),
        tenant_id=uuid4(),
        utterance_seq=1,
        llm_by_node={},
        tool_definitions_by_api_ref=tool_definitions_by_api_ref,
        tools_by_name={},
        tool_specs=[],
        tool_executor=CountingToolExecutor(turn_state, delay=delay),
        residency=ResidencyPayload(system_prompt="sys", messages=()),
        turn_state=turn_state,
        speak=_speak,
        hop_recorder=_NullHopRecorder(),
        nodes_by_id=nodes_by_id,
    )
    return ctx


def make_tool_def(api_ref: str = "body-api") -> ToolDefinition:
    return ToolDefinition(api_ref=api_ref, name=api_ref, method="GET", url="https://example.com", api_key=None)


async def test_repeats_the_body_until_the_condition_holds_then_continues_to_next_node_id() -> None:
    nodes_by_id: dict[str, GraphNode] = {"tool-body": make_tool_node("tool-body", "body-api")}
    ctx = make_ctx(nodes_by_id=nodes_by_id, tool_definitions_by_api_ref={"body-api": make_tool_def()})
    node = make_loop_node(condition="counter == 3", max_iterations=10, next_node_id="end-1")

    result, next_id = await LoopNodeExecutor().execute(node, ctx)

    assert result.status == "complete"
    assert next_id == "end-1"
    assert ctx.tool_executor.call_count == 3  # stopped the instant the condition first held
    assert ctx.turn_state["counter"] == 3


async def test_guard_max_iterations_stops_a_loop_whose_condition_never_holds() -> None:
    """The condition here can never be true (counter never reaches 999) — a
    real "this would otherwise run forever" case. Proving the guard actually
    cuts it, rather than the test merely asserting a config value, is the
    whole point of this test.
    """
    nodes_by_id: dict[str, GraphNode] = {"tool-body": make_tool_node("tool-body", "body-api")}
    ctx = make_ctx(nodes_by_id=nodes_by_id, tool_definitions_by_api_ref={"body-api": make_tool_def()})
    node = make_loop_node(
        condition="counter == 999",
        max_iterations=5,
        max_duration_ms=10_000,
        max_cost=1000,
        on_deadline={"action": "goto", "target_node_id": "recovery"},
    )

    started = time.monotonic()
    result, next_id = await LoopNodeExecutor().execute(node, ctx)
    elapsed = time.monotonic() - started

    assert elapsed < 1.0  # genuinely bounded, not hanging
    assert ctx.tool_executor.call_count == 5  # never more than max_iterations
    assert result.status == "timed_out"
    assert result.error_code == "LOOP_GUARD_EXCEEDED_max_iterations"
    assert next_id == "recovery"  # on_deadline, not on_error


async def test_guard_max_duration_ms_stops_a_loop_whose_iterations_are_individually_fast_but_numerous() -> None:
    nodes_by_id: dict[str, GraphNode] = {"tool-body": make_tool_node("tool-body", "body-api")}
    ctx = make_ctx(nodes_by_id=nodes_by_id, tool_definitions_by_api_ref={"body-api": make_tool_def()}, delay=0.03)
    executor = ctx.tool_executor
    node = make_loop_node(
        condition="counter == 999",  # never holds
        max_iterations=1000,  # effectively unbounded relative to the duration guard
        max_duration_ms=100,  # ~3 iterations' worth at 30ms each
        max_cost=10_000,
    )

    started = time.monotonic()
    result, next_id = await LoopNodeExecutor().execute(node, ctx)
    elapsed = time.monotonic() - started

    assert elapsed < 0.5  # cut well before 1000 * 30ms = 30s
    assert executor.call_count < 1000
    assert result.status == "timed_out"
    assert result.error_code == "LOOP_GUARD_EXCEEDED_max_duration_ms"


async def test_guard_max_cost_stops_a_loop_within_its_iteration_and_duration_budget() -> None:
    """`max_cost`'s unit is "1 per node executed in a body pass" — a
    single-Tool-node body costs 1 per iteration, so `max_cost=3` must stop
    the loop after exactly 3 iterations even though `max_iterations`/
    `max_duration_ms` would both permit far more.
    """
    nodes_by_id: dict[str, GraphNode] = {"tool-body": make_tool_node("tool-body", "body-api")}
    ctx = make_ctx(nodes_by_id=nodes_by_id, tool_definitions_by_api_ref={"body-api": make_tool_def()})
    node = make_loop_node(condition="counter == 999", max_iterations=1000, max_duration_ms=10_000, max_cost=3)

    result, next_id = await LoopNodeExecutor().execute(node, ctx)

    assert ctx.tool_executor.call_count == 3
    assert result.status == "timed_out"
    assert result.error_code == "LOOP_GUARD_EXCEEDED_max_cost"


async def test_a_guard_already_exceeded_before_any_iteration_runs_the_body_zero_times() -> None:
    """Defense-in-depth against a malformed/edited-after-validation config:
    `max_iterations=0` would fail V-2 at save time, but the runtime must
    still never execute even one iteration if it somehow gets here anyway.
    """
    nodes_by_id: dict[str, GraphNode] = {"tool-body": make_tool_node("tool-body", "body-api")}
    ctx = make_ctx(nodes_by_id=nodes_by_id, tool_definitions_by_api_ref={"body-api": make_tool_def()})
    node = make_loop_node(max_iterations=0)

    result, next_id = await LoopNodeExecutor().execute(node, ctx)

    assert ctx.tool_executor.call_count == 0
    assert result.status == "timed_out"
    assert result.error_code == "LOOP_GUARD_EXCEEDED_max_iterations"


async def test_a_malformed_condition_fails_the_node_and_resolves_on_error_not_next_node_id() -> None:
    nodes_by_id: dict[str, GraphNode] = {"tool-body": make_tool_node("tool-body", "body-api")}
    ctx = make_ctx(nodes_by_id=nodes_by_id, tool_definitions_by_api_ref={"body-api": make_tool_def()})
    node = make_loop_node(
        condition="counter > 1", next_node_id="wrong-target", on_error={"action": "goto", "target_node_id": "recovery"}
    )

    result, next_id = await LoopNodeExecutor().execute(node, ctx)

    assert result.status == "failed"
    assert result.error_code == "LOOP_CONDITION_INVALID"
    assert next_id == "recovery"
    assert ctx.tool_executor.call_count == 1  # the body ran once before the condition check blew up


async def test_output_text_is_the_last_iterations_body_output() -> None:
    nodes_by_id: dict[str, GraphNode] = {"tool-body": make_tool_node("tool-body", "body-api")}
    ctx = make_ctx(nodes_by_id=nodes_by_id, tool_definitions_by_api_ref={"body-api": make_tool_def()})
    node = make_loop_node(condition="counter == 2", next_node_id=None)

    result, _next_id = await LoopNodeExecutor().execute(node, ctx)

    assert result.output_text == "2"
    assert ctx.turn_state["loop-1"] == "2"
