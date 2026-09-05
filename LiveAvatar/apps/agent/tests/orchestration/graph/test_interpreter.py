"""Unit tests for `GraphInterpreter` (Phase 9, BL-036) — the state machine
that walks a `reasoning.graph` (A3.4 node execution + R-G2 lane separation).
"""

from __future__ import annotations

import asyncio
from unittest.mock import patch
from uuid import uuid4

import pytest

from avatar_agent.contracts.internal_api import HopItem
from avatar_agent.contracts.runtime_config import ReasoningBlock, RetryPolicy
from avatar_agent.orchestration.failover import LlmUnavailableError
from avatar_agent.orchestration.graph.interpreter import GraphInterpreter
from avatar_agent.orchestration.graph.ir import TurnContext
from avatar_agent.orchestration.tools import ToolDefinition, ToolError
from avatar_agent.ports.llm import LlmError
from avatar_agent.ports.orchestration import ResolvedLlmNode
from avatar_agent.residency.filter import ResidencyPayload

_RETRY_ONCE = RetryPolicy(max_attempts=1, backoff_ms=[0])


class FakeHopRecorder:
    def __init__(self) -> None:
        self.recorded: list[HopItem] = []
        self.flushed = False

    def record(self, item: HopItem) -> None:
        self.recorded.append(item)

    async def flush(self) -> None:
        self.flushed = True


def make_ctx(
    *,
    llm_by_node: dict[str, ResolvedLlmNode] | None = None,
    tool_definitions_by_api_ref: dict[str, ToolDefinition] | None = None,
    tools_by_name: dict[str, ToolDefinition] | None = None,
    tool_executor: object | None = None,
    turn_state: dict[str, object] | None = None,
    hop_recorder: FakeHopRecorder | None = None,
) -> tuple[TurnContext, list[str], FakeHopRecorder]:
    spoken: list[str] = []

    async def _speak(text: str) -> None:
        spoken.append(text)

    recorder = hop_recorder if hop_recorder is not None else FakeHopRecorder()
    ctx = TurnContext(
        session_id=uuid4(),
        tenant_id=uuid4(),
        utterance_seq=1,
        llm_by_node=llm_by_node or {},
        tool_definitions_by_api_ref=tool_definitions_by_api_ref or {},
        tools_by_name=tools_by_name or {},
        tool_specs=[],
        tool_executor=tool_executor or object(),
        residency=ResidencyPayload(system_prompt="sys", messages=()),
        turn_state=turn_state if turn_state is not None else {},
        speak=_speak,
        hop_recorder=recorder,
    )
    return ctx, spoken, recorder


def make_graph(graph_dict: dict[str, object]) -> ReasoningBlock:
    return ReasoningBlock.model_validate(graph_dict)


class FakeLlmProvider:
    key = "openai"

    def __init__(self, texts: list[str] | None = None, raises: LlmError | None = None) -> None:
        self._texts = texts if texts is not None else ["hello"]
        self._raises = raises

    async def complete_stream(self, messages, tools, residency):  # noqa: ANN001
        if self._raises is not None:
            raise self._raises

        async def _gen():
            for t in self._texts:
                yield {"delta": t, "done": False}
            yield {"delta": "", "done": True, "tool_calls": []}

        return _gen()

    async def complete_structured(self, *a, **k):  # noqa: ANN002, ANN003
        raise NotImplementedError

    @property
    def first_token_ms(self) -> int | None:
        return None


class FakeToolExecutor:
    def __init__(self, *, result: str | None = None, error: ToolError | None = None, delay: float = 0.0) -> None:
        self._result = result
        self._error = error
        self._delay = delay
        self.calls: list[tuple] = []

    async def invoke(self, tool, arguments):  # noqa: ANN001
        self.calls.append((tool, arguments))
        if self._delay:
            await asyncio.sleep(self._delay)
        if self._error is not None:
            raise self._error
        return self._result if self._result is not None else "ok"


def _single_llm_node_graph(*, entry_id: str = "llm-1") -> dict:
    return {
        "entry_node_id": entry_id,
        "background_entry_node_ids": [],
        "turn_budget_ms": 3000,
        "graph": [
            {
                "id": entry_id,
                "type": "llm",
                "name": "Answer",
                "lane": "foreground",
                "on_error": {"action": "degrade"},
                "on_deadline": {"action": "degrade"},
                "provider": "openai",
                "model": "gpt-4o",
                "retry": {"max_attempts": 1, "backoff_ms": [0]},
                "next_node_id": None,
            }
        ],
    }


# --- default single-LLM-node graph: implicit speak-then-end (R-G1) -------


async def test_default_single_llm_node_graph_speaks_exactly_once_via_implicit_speak_then_end() -> None:
    graph = make_graph(_single_llm_node_graph())
    provider = FakeLlmProvider(texts=["hello", " world"])
    ctx, spoken, _recorder = make_ctx(llm_by_node={"llm-1": ResolvedLlmNode(primary=provider, fallback=None, retry=_RETRY_ONCE)})

    result = await GraphInterpreter().run(graph, ctx)

    assert spoken == ["hello world"]
    assert result.spoken is True
    assert result.reply_text == "hello world"
    assert result.provider_key == "openai"
    assert len(result.node_trace) == 1
    assert result.node_trace[0].node_type == "llm"
    assert result.node_trace[0].status == "complete"


# --- explicit Router -> Tool -> LLM -> Speak -> End chain ------------------


def _router_branching_graph() -> dict:
    return {
        "entry_node_id": "router-1",
        "background_entry_node_ids": [],
        "turn_budget_ms": 3000,
        "graph": [
            {
                "id": "router-1",
                "type": "router",
                "name": "Intent router",
                "lane": "foreground",
                "on_error": {"action": "degrade"},
                "on_deadline": {"action": "degrade"},
                "branches": [{"condition": 'intent == "refund"', "next_node_id": "tool-1"}],
                "default_next_node_id": "end-1",
            },
            {
                "id": "tool-1",
                "type": "tool",
                "name": "Lookup order",
                "lane": "foreground",
                "on_error": {"action": "goto", "target_node_id": "end-1"},
                "on_deadline": {"action": "degrade"},
                "api_ref": "order-lookup",
                "argument_mapping": {},
                "next_node_id": "speak-1",
            },
            {
                "id": "speak-1",
                "type": "speak",
                "name": "Speak answer",
                "lane": "foreground",
                "on_error": {"action": "end_turn"},
                "on_deadline": {"action": "end_turn"},
                "mode": "literal",
                "text": "done",
                "next_node_id": "end-1",
            },
            {
                "id": "end-1",
                "type": "end",
                "name": "End turn",
                "lane": "foreground",
                "on_error": {"action": "end_turn"},
                "on_deadline": {"action": "end_turn"},
            },
        ],
    }


async def test_explicit_router_tool_speak_end_chain_walks_every_node_in_order() -> None:
    graph = make_graph(_router_branching_graph())
    tool_def = ToolDefinition(
        api_ref="order-lookup", name="lookup_order", method="GET", url="https://orders.example.com", api_key=None
    )
    tool_executor = FakeToolExecutor(result="order info")
    ctx, spoken, recorder = make_ctx(
        tool_definitions_by_api_ref={"order-lookup": tool_def},
        tool_executor=tool_executor,
        turn_state={"intent": "refund"},
    )

    result = await GraphInterpreter().run(graph, ctx)

    assert spoken == ["done"]
    assert [r.node_id for r in result.node_trace] == ["router-1", "tool-1", "speak-1", "end-1"]
    assert all(r.status == "complete" for r in result.node_trace)
    # Node-trace HopItems are recorded for every node executed, in order.
    assert [h.node_id for h in recorder.recorded] == ["router-1", "tool-1", "speak-1", "end-1"]
    assert all(h.hop == "node" for h in recorder.recorded)


# --- Tool node with an unknown api_ref: fails gracefully, no crash -------


async def test_tool_node_with_an_unknown_api_ref_fails_gracefully_and_takes_its_on_error_goto_edge() -> None:
    """Phase 10 fix (Phase 9 finding #2): `ToolNodeExecutor` treats an
    unresolvable `api_ref` as a recorded, non-fatal failure and now takes
    the node's own configured `on_error` edge — `tool-1` in
    `_router_branching_graph()` has `on_error: {goto -> end-1}`, so the walk
    goes straight there, **skipping** `speak-1` (its `next_node_id`)
    entirely. Before this fix the walk proceeded via `next_node_id`
    regardless of `on_error`, which is exactly the bug the Phase 9 close-out
    documented (the golden-path run's Tool node timeout reached Speak with
    no text to speak, rather than the configured recovery edge). The
    guarantee this test protects is still "never a crash" — proven by the
    walk terminating cleanly at `end-1` with a `failed` trace entry for the
    tool node — but the *destination* now matches what was configured.
    """
    graph_dict = _router_branching_graph()
    ctx, spoken, _recorder = make_ctx(tool_definitions_by_api_ref={}, turn_state={"intent": "refund"})

    result = await GraphInterpreter().run(make_graph(graph_dict), ctx)

    tool_result = next(r for r in result.node_trace if r.node_id == "tool-1")
    assert tool_result.status == "failed"
    assert tool_result.error_code == "TOOL_UNKNOWN"
    # Took tool-1's on_error goto ("end-1"), not its next_node_id ("speak-1").
    assert [r.node_id for r in result.node_trace] == ["router-1", "tool-1", "end-1"]
    assert spoken == []


# --- Router node with a malformed condition: fails gracefully, no crash --


async def test_router_node_with_a_malformed_condition_and_no_goto_on_error_stops_the_walk() -> None:
    """Phase 10 fix (Phase 9 finding #2): `router-1`'s `on_error` here is
    `degrade` (no `goto` configured), so a malformed condition now stops the
    walk entirely rather than silently falling through to
    `default_next_node_id` — the walk never reaches `end-1`. See the
    companion test below for the `goto`-configured case.
    """
    graph_dict = {
        "entry_node_id": "router-1",
        "background_entry_node_ids": [],
        "turn_budget_ms": 3000,
        "graph": [
            {
                "id": "router-1",
                "type": "router",
                "name": "Broken router",
                "lane": "foreground",
                "on_error": {"action": "degrade"},
                "on_deadline": {"action": "degrade"},
                "branches": [{"condition": "not a valid condition!!", "next_node_id": "unreachable"}],
                "default_next_node_id": "end-1",
            },
            {
                "id": "unreachable",
                "type": "end",
                "name": "Unreachable",
                "lane": "foreground",
                "on_error": {"action": "end_turn"},
                "on_deadline": {"action": "end_turn"},
            },
            {
                "id": "end-1",
                "type": "end",
                "name": "End turn",
                "lane": "foreground",
                "on_error": {"action": "end_turn"},
                "on_deadline": {"action": "end_turn"},
            },
        ],
    }
    ctx, _spoken, _recorder = make_ctx()

    result = await GraphInterpreter().run(make_graph(graph_dict), ctx)

    router_result = result.node_trace[0]
    assert router_result.status == "failed"
    assert router_result.error_code == "ROUTER_CONDITION_INVALID"
    assert [r.node_id for r in result.node_trace] == ["router-1"]


async def test_router_node_with_a_malformed_condition_and_a_goto_on_error_takes_that_edge() -> None:
    graph_dict = {
        "entry_node_id": "router-1",
        "background_entry_node_ids": [],
        "turn_budget_ms": 3000,
        "graph": [
            {
                "id": "router-1",
                "type": "router",
                "name": "Broken router",
                "lane": "foreground",
                "on_error": {"action": "goto", "target_node_id": "end-1"},
                "on_deadline": {"action": "degrade"},
                "branches": [{"condition": "not a valid condition!!", "next_node_id": "unreachable"}],
                "default_next_node_id": "unreachable",
            },
            {
                "id": "unreachable",
                "type": "end",
                "name": "Unreachable",
                "lane": "foreground",
                "on_error": {"action": "end_turn"},
                "on_deadline": {"action": "end_turn"},
            },
            {
                "id": "end-1",
                "type": "end",
                "name": "End turn",
                "lane": "foreground",
                "on_error": {"action": "end_turn"},
                "on_deadline": {"action": "end_turn"},
            },
        ],
    }
    ctx, _spoken, _recorder = make_ctx()

    result = await GraphInterpreter().run(make_graph(graph_dict), ctx)

    router_result = result.node_trace[0]
    assert router_result.status == "failed"
    assert router_result.error_code == "ROUTER_CONDITION_INVALID"
    assert [r.node_id for r in result.node_trace] == ["router-1", "end-1"]


# --- interpreter's own on_error edge: a genuinely uncaught node exception -


async def test_a_genuinely_uncaught_node_exception_is_caught_and_takes_the_nodes_on_error_goto() -> None:
    """Unlike Tool/Router's own recognized failure modes (above), a truly
    uncaught exception from a node executor (here: the LLM provider raising
    something `run_with_failover` doesn't classify as exhausted-with-no-
    fallback, i.e. anything other than `LlmUnavailableError`) is caught by
    `interpreter.py` itself and takes that node's `on_error` edge.
    """
    graph_dict = {
        "entry_node_id": "llm-1",
        "background_entry_node_ids": [],
        "turn_budget_ms": 3000,
        "graph": [
            {
                "id": "llm-1",
                "type": "llm",
                "name": "Answer",
                "lane": "foreground",
                "on_error": {"action": "goto", "target_node_id": "fallback-speak"},
                "on_deadline": {"action": "degrade"},
                "provider": "openai",
                "model": "gpt-4o",
                "retry": {"max_attempts": 1, "backoff_ms": [0]},
                "next_node_id": None,
            },
            {
                "id": "fallback-speak",
                "type": "speak",
                "name": "Fallback",
                "lane": "foreground",
                "on_error": {"action": "end_turn"},
                "on_deadline": {"action": "end_turn"},
                "mode": "literal",
                "text": "recovered",
                "next_node_id": "end-1",
            },
            {
                "id": "end-1",
                "type": "end",
                "name": "End turn",
                "lane": "foreground",
                "on_error": {"action": "end_turn"},
                "on_deadline": {"action": "end_turn"},
            },
        ],
    }

    class RaisingProvider:
        key = "openai"

        async def complete_stream(self, *a, **k):  # noqa: ANN002, ANN003
            raise RuntimeError("adapter bug, not an LlmError")

        async def complete_structured(self, *a, **k):  # noqa: ANN002, ANN003
            raise NotImplementedError

        @property
        def first_token_ms(self) -> int | None:
            return None

    ctx, spoken, _recorder = make_ctx(
        llm_by_node={"llm-1": ResolvedLlmNode(primary=RaisingProvider(), fallback=None, retry=_RETRY_ONCE)}
    )

    result = await GraphInterpreter().run(make_graph(graph_dict), ctx)

    llm_result = result.node_trace[0]
    assert llm_result.status == "failed"
    assert llm_result.error_code == "NODE_ERROR"
    assert spoken == ["recovered"]
    assert [r.node_id for r in result.node_trace] == ["llm-1", "fallback-speak", "end-1"]


# --- LlmUnavailableError propagates out of run() uncaught -----------------


async def test_llm_unavailable_error_propagates_out_of_run_uncaught() -> None:
    graph = make_graph(_single_llm_node_graph())
    provider = FakeLlmProvider(raises=LlmError("both legs exhausted", retryable=False))
    ctx, _spoken, _recorder = make_ctx(llm_by_node={"llm-1": ResolvedLlmNode(primary=provider, fallback=None, retry=_RETRY_ONCE)})

    with pytest.raises(LlmUnavailableError):
        await GraphInterpreter().run(graph, ctx)


# --- deadline degradation runtime (R-G13, Phase 10) ------------------------


def _tool_then_recovery_graph(*, turn_budget_ms: int, on_deadline: dict[str, object]) -> dict:
    return {
        "entry_node_id": "tool-1",
        "background_entry_node_ids": [],
        "turn_budget_ms": turn_budget_ms,
        "graph": [
            {
                "id": "tool-1",
                "type": "tool",
                "name": "Slow lookup",
                "lane": "foreground",
                "on_error": {"action": "end_turn"},
                "on_deadline": on_deadline,
                "api_ref": "order-lookup",
                "argument_mapping": {},
                "next_node_id": "end-1",
            },
            {
                "id": "recovery-1",
                "type": "speak",
                "name": "Recovery",
                "lane": "foreground",
                "on_error": {"action": "end_turn"},
                "on_deadline": {"action": "end_turn"},
                "mode": "literal",
                "text": "let me follow up",
                "next_node_id": "end-1",
            },
            {
                "id": "end-1",
                "type": "end",
                "name": "End turn",
                "lane": "foreground",
                "on_error": {"action": "end_turn"},
                "on_deadline": {"action": "end_turn"},
            },
        ],
    }


async def test_a_node_already_past_the_turn_budget_before_it_starts_is_cut_and_takes_on_deadline() -> None:
    """R-G13 — when the cumulative elapsed foreground time has already
    crossed `turn_budget_ms` before a node can even start, it is cut
    outright (never executed at all — `total_ms == 0`) and the walk takes
    that node's configured `on_deadline` edge. `now_ms()` is patched (rather
    than a real sleep) to deterministically simulate "100ms budget, 1000ms
    already elapsed" without depending on real wall-clock scheduling.
    """
    graph_dict = _tool_then_recovery_graph(turn_budget_ms=100, on_deadline={"action": "goto", "target_node_id": "recovery-1"})
    tool_def = ToolDefinition(
        api_ref="order-lookup", name="lookup_order", method="GET", url="https://orders.example.com", api_key=None
    )
    ctx, spoken, _recorder = make_ctx(
        tool_definitions_by_api_ref={"order-lookup": tool_def}, tool_executor=FakeToolExecutor(result="ok")
    )

    with patch("avatar_agent.orchestration.graph.interpreter.now_ms", side_effect=[0, 1000, 1000, 1000]):
        result = await GraphInterpreter().run(make_graph(graph_dict), ctx)

    tool_result = result.node_trace[0]
    assert tool_result.status == "timed_out"
    assert tool_result.error_code == "TURN_BUDGET_EXCEEDED"
    assert tool_result.total_ms == 0
    assert [r.node_id for r in result.node_trace] == ["tool-1", "recovery-1", "end-1"]
    assert spoken == ["let me follow up"]


async def test_a_node_past_the_turn_budget_with_no_goto_on_deadline_stops_the_walk() -> None:
    """Mirrors `on_error`'s no-`goto` fallback exactly: without a `goto`
    configured, a deadline cut stops the walk rather than proceeding
    anywhere.
    """
    graph_dict = _tool_then_recovery_graph(turn_budget_ms=100, on_deadline={"action": "degrade"})
    tool_def = ToolDefinition(
        api_ref="order-lookup", name="lookup_order", method="GET", url="https://orders.example.com", api_key=None
    )
    ctx, spoken, _recorder = make_ctx(
        tool_definitions_by_api_ref={"order-lookup": tool_def}, tool_executor=FakeToolExecutor(result="ok")
    )

    with patch("avatar_agent.orchestration.graph.interpreter.now_ms", side_effect=[0, 1000]):
        result = await GraphInterpreter().run(make_graph(graph_dict), ctx)

    assert [r.node_id for r in result.node_trace] == ["tool-1"]
    assert spoken == []


async def test_a_slow_in_flight_node_is_cut_mid_execution_via_asyncio_wait_for_and_takes_on_deadline() -> None:
    """R-G13 — a node whose execution genuinely outlives the *remaining*
    turn budget is cancelled mid-flight via `asyncio.wait_for` (a real
    "in-flight node cut", not a between-nodes check that lets an
    already-slow node run to completion), and the walk takes its
    `on_deadline` edge. Real timing (no mocking) — the tool's own
    artificial delay (300ms) comfortably exceeds the 100ms turn budget, so
    `asyncio.wait_for`'s cancellation is deterministic regardless of test
    host load.
    """
    graph_dict = _tool_then_recovery_graph(turn_budget_ms=100, on_deadline={"action": "goto", "target_node_id": "recovery-1"})
    tool_def = ToolDefinition(
        api_ref="order-lookup", name="lookup_order", method="GET", url="https://orders.example.com", api_key=None
    )
    slow_executor = FakeToolExecutor(result="ok", delay=0.3)
    ctx, spoken, _recorder = make_ctx(tool_definitions_by_api_ref={"order-lookup": tool_def}, tool_executor=slow_executor)

    result = await GraphInterpreter().run(make_graph(graph_dict), ctx)

    tool_result = result.node_trace[0]
    assert tool_result.status == "timed_out"
    assert tool_result.error_code == "TURN_BUDGET_EXCEEDED"
    assert [r.node_id for r in result.node_trace] == ["tool-1", "recovery-1", "end-1"]
    assert spoken == ["let me follow up"]


async def test_a_background_lane_node_reached_via_the_foreground_chain_is_exempt_from_the_deadline() -> None:
    """R-G14 — deadline enforcement, like the critical-path cost, excludes
    background-lane nodes regardless of elapsed time. This graph shape (a
    foreground `next_node_id` pointing at a `lane: background` node) is
    anomalous and not otherwise prevented by Gate A yet, but the
    interpreter must not crash or wrongly cut it.
    """
    graph_dict = _tool_then_recovery_graph(turn_budget_ms=100, on_deadline={"action": "degrade"})
    graph_dict["graph"][0]["lane"] = "background"
    tool_def = ToolDefinition(
        api_ref="order-lookup", name="lookup_order", method="GET", url="https://orders.example.com", api_key=None
    )
    ctx, spoken, _recorder = make_ctx(
        tool_definitions_by_api_ref={"order-lookup": tool_def}, tool_executor=FakeToolExecutor(result="ok")
    )

    with patch("avatar_agent.orchestration.graph.interpreter.now_ms", side_effect=[0, 1000, 1000]):
        result = await GraphInterpreter().run(make_graph(graph_dict), ctx)

    tool_result = result.node_trace[0]
    assert tool_result.status == "complete"  # ran normally, not cut — background lane is exempt
    assert [r.node_id for r in result.node_trace] == ["tool-1", "end-1"]
    assert spoken == []


# --- background nodes run detached ------------------------------------------


def _graph_with_background_entry(entry_id: str) -> dict:
    graph_dict = _single_llm_node_graph()
    graph_dict["background_entry_node_ids"] = [entry_id]
    graph_dict["graph"].append(
        {
            "id": entry_id,
            "type": "tool",
            "name": "Background tool",
            "lane": "background",
            "on_error": {"action": "end_turn"},
            "on_deadline": {"action": "end_turn"},
            "api_ref": "bg-tool",
            "argument_mapping": {},
            "next_node_id": None,
        }
    )
    return graph_dict


async def test_a_background_node_runs_detached_and_does_not_block_runs_return() -> None:
    bg_started = asyncio.Event()
    bg_finished = asyncio.Event()

    class SlowToolExecutor:
        async def invoke(self, tool, arguments):  # noqa: ANN001
            bg_started.set()
            await asyncio.sleep(0.05)
            bg_finished.set()
            return "bg done"

    tool_def = ToolDefinition(api_ref="bg-tool", name="bg_tool", method="GET", url="https://bg.example.com", api_key=None)
    provider = FakeLlmProvider(texts=["hi"])
    ctx, _spoken, recorder = make_ctx(
        llm_by_node={"llm-1": ResolvedLlmNode(primary=provider, fallback=None, retry=_RETRY_ONCE)},
        tool_definitions_by_api_ref={"bg-tool": tool_def},
        tool_executor=SlowToolExecutor(),
    )

    result = await GraphInterpreter().run(make_graph(_graph_with_background_entry("bg-1")), ctx)

    # run() returned before the background node's own sleep elapsed.
    assert bg_finished.is_set() is False
    assert result.spoken is True  # foreground path finished normally

    for _ in range(50):
        await asyncio.sleep(0.01)
        if bg_finished.is_set():
            break

    assert bg_started.is_set() is True
    assert bg_finished.is_set() is True
    # The background chain flushes the hop recorder itself once it completes
    # (the foreground path does not — that's `pipeline.py`'s job).
    assert recorder.flushed is True
    assert any(h.node_id == "bg-1" for h in recorder.recorded)


async def test_a_background_nodes_own_failure_never_propagates_to_the_caller() -> None:
    class RaisingToolExecutor:
        async def invoke(self, tool, arguments):  # noqa: ANN001
            await asyncio.sleep(0.01)
            raise RuntimeError("background tool blew up")

    tool_def = ToolDefinition(api_ref="bg-tool", name="bg_tool", method="GET", url="https://bg.example.com", api_key=None)
    provider = FakeLlmProvider(texts=["hi"])
    ctx, _spoken, recorder = make_ctx(
        llm_by_node={"llm-1": ResolvedLlmNode(primary=provider, fallback=None, retry=_RETRY_ONCE)},
        tool_definitions_by_api_ref={"bg-tool": tool_def},
        tool_executor=RaisingToolExecutor(),
    )

    # Must not raise, even though the background node's own executor will.
    result = await GraphInterpreter().run(make_graph(_graph_with_background_entry("bg-1")), ctx)
    assert result.spoken is True

    for _ in range(50):
        await asyncio.sleep(0.01)
        if any(h.node_id == "bg-1" for h in recorder.recorded):
            break

    bg_hop = next(h for h in recorder.recorded if h.node_id == "bg-1")
    assert bg_hop.error_code == "NODE_ERROR"
