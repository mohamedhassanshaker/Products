"""Unit tests for `ParallelNodeExecutor` (Phase 11, BL-042) — real `asyncio`
concurrency (no mocked timing), covering each join policy's actual behavior:
`all`/`all_settled` wait for every branch; `first_success` takes the first
success and genuinely cancels the rest (proven by a cancellation marker, not
just a returned value); `quorum(n)` proceeds once n branches have *returned*
(not necessarily succeeded), per §A3.3's literal wording.
"""

from __future__ import annotations

import asyncio
import time
from uuid import uuid4

import pytest

from avatar_agent.contracts.runtime_config import LlmNode, ParallelNode, RetryPolicy, ToolNode
from avatar_agent.orchestration.failover import LlmUnavailableError
from avatar_agent.orchestration.graph.ir import GraphNode, TurnContext
from avatar_agent.orchestration.graph.nodes.parallel import ParallelNodeExecutor
from avatar_agent.orchestration.tools import ToolDefinition, ToolError
from avatar_agent.ports.llm import LlmError
from avatar_agent.ports.orchestration import ResolvedLlmNode
from avatar_agent.residency.filter import ResidencyPayload

_RETRY_ONCE = RetryPolicy(max_attempts=1, backoff_ms=[0])


def make_parallel_node(**overrides: object) -> ParallelNode:
    base: dict[str, object] = {
        "id": "parallel-1",
        "type": "parallel",
        "name": "Fan out",
        "lane": "foreground",
        "on_error": {"action": "degrade"},
        "on_deadline": {"action": "degrade"},
        "branches": [{"id": "a", "entry_node_id": "tool-a"}, {"id": "b", "entry_node_id": "tool-b"}],
        "join_policy": "all",
        "on_branch_error": "continue_partial",
        "next_node_id": None,
    }
    base.update(overrides)
    return ParallelNode.model_validate(base)


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


def make_llm_node(node_id: str) -> LlmNode:
    return LlmNode.model_validate(
        {
            "id": node_id,
            "type": "llm",
            "name": node_id,
            "lane": "foreground",
            "on_error": {"action": "degrade"},
            "on_deadline": {"action": "degrade"},
            "provider": "openai",
            "model": "gpt-4o",
            "retry": {"max_attempts": 1, "backoff_ms": [0]},
            "next_node_id": None,
        }
    )


class _NullHopRecorder:
    def record(self, item):  # noqa: ANN001
        pass

    async def flush(self) -> None:
        pass


class DelayedToolExecutor:
    """A real tool executor whose per-`api_ref` delay is configurable —
    lets a test build branches with genuinely different completion times, so
    join-policy behavior is proven with real `asyncio` concurrency rather
    than mocked/stubbed timing.

    `completed` only ever gains an entry for a call that ran to completion
    (past its `asyncio.sleep`) — a cancelled task never reaches that append,
    which is exactly how these tests prove a "loser" branch was genuinely
    cancelled, not merely ignored after finishing anyway.
    """

    def __init__(self, delays: dict[str, float], *, fail: set[str] | None = None) -> None:
        self._delays = delays
        self._fail = fail or set()
        self.completed: list[str] = []

    async def invoke(self, tool: ToolDefinition, arguments: dict[str, object]) -> str:
        await asyncio.sleep(self._delays.get(tool.api_ref, 0.0))
        if tool.api_ref in self._fail:
            raise ToolError("simulated failure", code="SIMULATED_FAILURE")
        self.completed.append(tool.api_ref)
        return f"result-{tool.api_ref}"


def make_ctx(
    *,
    nodes_by_id: dict[str, GraphNode],
    tool_definitions_by_api_ref: dict[str, ToolDefinition],
    tool_executor: object,
    llm_by_node: dict[str, ResolvedLlmNode] | None = None,
) -> TurnContext:
    async def _speak(text: str) -> None:  # pragma: no cover
        pass

    return TurnContext(
        session_id=uuid4(),
        tenant_id=uuid4(),
        utterance_seq=1,
        llm_by_node=llm_by_node or {},
        tool_definitions_by_api_ref=tool_definitions_by_api_ref,
        tools_by_name={},
        tool_specs=[],
        tool_executor=tool_executor,
        residency=ResidencyPayload(system_prompt="sys", messages=()),
        turn_state={},
        speak=_speak,
        hop_recorder=_NullHopRecorder(),
        nodes_by_id=nodes_by_id,
    )


def make_tool_def(api_ref: str) -> ToolDefinition:
    return ToolDefinition(api_ref=api_ref, name=api_ref, method="GET", url="https://example.com", api_key=None)


async def test_join_all_waits_for_every_branch_using_real_concurrency() -> None:
    """Two branches each take ~80ms; if they ran sequentially the whole node
    would take ~160ms. Asserting the real wall-clock time stays well under
    that proves genuine concurrent execution, not sequential-with-a-nicer-API.
    """
    nodes_by_id: dict[str, GraphNode] = {
        "tool-a": make_tool_node("tool-a", "api-a"),
        "tool-b": make_tool_node("tool-b", "api-b"),
    }
    executor = DelayedToolExecutor({"api-a": 0.08, "api-b": 0.08})
    ctx = make_ctx(
        nodes_by_id=nodes_by_id,
        tool_definitions_by_api_ref={"api-a": make_tool_def("api-a"), "api-b": make_tool_def("api-b")},
        tool_executor=executor,
    )
    node = make_parallel_node(join_policy="all", next_node_id="end-1")

    started = time.monotonic()
    result, next_id = await ParallelNodeExecutor().execute(node, ctx)
    elapsed = time.monotonic() - started

    assert elapsed < 0.15  # well under the ~160ms a sequential run would take
    assert result.status == "complete"
    assert next_id == "end-1"
    assert sorted(executor.completed) == ["api-a", "api-b"]
    assert ctx.turn_state["parallel-1"] == {"a": "result-api-a", "b": "result-api-b"}


async def test_join_all_with_on_branch_error_fail_fails_the_node_and_resolves_on_error() -> None:
    nodes_by_id: dict[str, GraphNode] = {
        "tool-a": make_tool_node("tool-a", "api-a"),
        "tool-b": make_tool_node("tool-b", "api-fails"),
    }
    executor = DelayedToolExecutor({"api-a": 0.0, "api-fails": 0.0}, fail={"api-fails"})
    ctx = make_ctx(
        nodes_by_id=nodes_by_id,
        tool_definitions_by_api_ref={"api-a": make_tool_def("api-a"), "api-fails": make_tool_def("api-fails")},
        tool_executor=executor,
    )
    node = make_parallel_node(
        join_policy="all",
        on_branch_error="fail",
        on_error={"action": "goto", "target_node_id": "recovery"},
        next_node_id="wrong-target",
    )

    result, next_id = await ParallelNodeExecutor().execute(node, ctx)

    assert result.status == "failed"
    assert result.error_code == "PARALLEL_BRANCH_FAILED"
    assert next_id == "recovery"


async def test_join_all_with_on_branch_error_continue_partial_still_proceeds() -> None:
    nodes_by_id: dict[str, GraphNode] = {
        "tool-a": make_tool_node("tool-a", "api-a"),
        "tool-b": make_tool_node("tool-b", "api-fails"),
    }
    executor = DelayedToolExecutor({"api-a": 0.0, "api-fails": 0.0}, fail={"api-fails"})
    ctx = make_ctx(
        nodes_by_id=nodes_by_id,
        tool_definitions_by_api_ref={"api-a": make_tool_def("api-a"), "api-fails": make_tool_def("api-fails")},
        tool_executor=executor,
    )
    node = make_parallel_node(join_policy="all", on_branch_error="continue_partial", next_node_id="end-1")

    result, next_id = await ParallelNodeExecutor().execute(node, ctx)

    assert result.status == "complete"
    assert next_id == "end-1"


async def test_join_all_settled_always_proceeds_even_with_on_branch_error_fail() -> None:
    """§A3.3's table: `all_settled` "waits for all, but proceeds with partial
    results if some fail" — unconditionally, `on_branch_error` is not
    consulted (unlike plain `all`).
    """
    nodes_by_id: dict[str, GraphNode] = {
        "tool-a": make_tool_node("tool-a", "api-a"),
        "tool-b": make_tool_node("tool-b", "api-fails"),
    }
    executor = DelayedToolExecutor({"api-a": 0.0, "api-fails": 0.0}, fail={"api-fails"})
    ctx = make_ctx(
        nodes_by_id=nodes_by_id,
        tool_definitions_by_api_ref={"api-a": make_tool_def("api-a"), "api-fails": make_tool_def("api-fails")},
        tool_executor=executor,
    )
    node = make_parallel_node(join_policy="all_settled", on_branch_error="fail", next_node_id="end-1")

    result, next_id = await ParallelNodeExecutor().execute(node, ctx)

    assert result.status == "complete"
    assert next_id == "end-1"


async def test_join_first_success_takes_the_first_success_and_genuinely_cancels_the_rest() -> None:
    nodes_by_id: dict[str, GraphNode] = {
        "tool-fast": make_tool_node("tool-fast", "api-fast"),
        "tool-slow": make_tool_node("tool-slow", "api-slow"),
    }
    executor = DelayedToolExecutor({"api-fast": 0.02, "api-slow": 5.0})
    ctx = make_ctx(
        nodes_by_id=nodes_by_id,
        tool_definitions_by_api_ref={"api-fast": make_tool_def("api-fast"), "api-slow": make_tool_def("api-slow")},
        tool_executor=executor,
    )
    node = make_parallel_node(
        branches=[{"id": "fast", "entry_node_id": "tool-fast"}, {"id": "slow", "entry_node_id": "tool-slow"}],
        join_policy="first_success",
        next_node_id="end-1",
    )

    started = time.monotonic()
    result, next_id = await ParallelNodeExecutor().execute(node, ctx)
    elapsed = time.monotonic() - started

    # Returns almost immediately after the fast branch — never waits
    # anywhere near the slow branch's 5s delay.
    assert elapsed < 0.5
    assert result.status == "complete"
    assert next_id == "end-1"
    # The slow branch's tool call was genuinely cancelled mid-sleep — it
    # never reached the point of recording completion.
    assert executor.completed == ["api-fast"]


async def test_join_first_success_with_no_success_and_on_branch_error_fail() -> None:
    nodes_by_id: dict[str, GraphNode] = {
        "tool-a": make_tool_node("tool-a", "api-a"),
        "tool-b": make_tool_node("tool-b", "api-b"),
    }
    executor = DelayedToolExecutor({"api-a": 0.0, "api-b": 0.0}, fail={"api-a", "api-b"})
    ctx = make_ctx(
        nodes_by_id=nodes_by_id,
        tool_definitions_by_api_ref={"api-a": make_tool_def("api-a"), "api-b": make_tool_def("api-b")},
        tool_executor=executor,
    )
    node = make_parallel_node(
        join_policy="first_success", on_branch_error="fail", on_error={"action": "goto", "target_node_id": "recovery"}
    )

    result, next_id = await ParallelNodeExecutor().execute(node, ctx)

    assert result.status == "failed"
    assert next_id == "recovery"


async def test_join_quorum_proceeds_once_n_branches_have_returned_regardless_of_success() -> None:
    """§A3.3's table: "Proceed when n branches have returned" — implemented
    literally (n *returned*, success or failure), proven here with a branch
    that *fails fast* counting toward the quorum just as much as one that
    *succeeds fast*, while a third, much slower branch is genuinely
    cancelled rather than waited on.
    """
    nodes_by_id: dict[str, GraphNode] = {
        "tool-fail": make_tool_node("tool-fail", "api-fail"),
        "tool-ok": make_tool_node("tool-ok", "api-ok"),
        "tool-slow": make_tool_node("tool-slow", "api-slow"),
    }
    executor = DelayedToolExecutor({"api-fail": 0.01, "api-ok": 0.01, "api-slow": 5.0}, fail={"api-fail"})
    ctx = make_ctx(
        nodes_by_id=nodes_by_id,
        tool_definitions_by_api_ref={
            "api-fail": make_tool_def("api-fail"),
            "api-ok": make_tool_def("api-ok"),
            "api-slow": make_tool_def("api-slow"),
        },
        tool_executor=executor,
    )
    node = make_parallel_node(
        branches=[
            {"id": "fail", "entry_node_id": "tool-fail"},
            {"id": "ok", "entry_node_id": "tool-ok"},
            {"id": "slow", "entry_node_id": "tool-slow"},
        ],
        join_policy="quorum",
        quorum_n=2,
        next_node_id="end-1",
    )

    started = time.monotonic()
    result, next_id = await ParallelNodeExecutor().execute(node, ctx)
    elapsed = time.monotonic() - started

    assert elapsed < 0.5
    assert result.status == "complete"  # any(succeeded) among the 2 that returned -> "ok" succeeded
    assert next_id == "end-1"
    assert "api-slow" not in executor.completed


async def test_join_quorum_fails_when_none_of_the_returned_branches_succeeded() -> None:
    nodes_by_id: dict[str, GraphNode] = {
        "tool-a": make_tool_node("tool-a", "api-a"),
        "tool-b": make_tool_node("tool-b", "api-b"),
    }
    executor = DelayedToolExecutor({"api-a": 0.0, "api-b": 0.0}, fail={"api-a", "api-b"})
    ctx = make_ctx(
        nodes_by_id=nodes_by_id,
        tool_definitions_by_api_ref={"api-a": make_tool_def("api-a"), "api-b": make_tool_def("api-b")},
        tool_executor=executor,
    )
    node = make_parallel_node(
        join_policy="quorum",
        quorum_n=2,
        on_branch_error="fail",
        on_error={"action": "goto", "target_node_id": "recovery"},
    )

    result, next_id = await ParallelNodeExecutor().execute(node, ctx)

    assert result.status == "failed"
    assert next_id == "recovery"


async def test_llm_unavailable_error_propagates_out_of_a_branch_and_cancels_siblings() -> None:
    """Both LLM legs exhausted inside a branch must propagate uncaught out
    of the Parallel node too (the package-wide "never caught" rule) — after
    genuinely cancelling any still-running sibling branch first.
    """

    class AlwaysFailingProvider:
        key = "openai"

        async def complete_stream(self, *a, **k):  # noqa: ANN002, ANN003
            raise LlmError("down", retryable=False)

        async def complete_structured(self, *a, **k):  # noqa: ANN002, ANN003
            raise NotImplementedError

        @property
        def first_token_ms(self) -> int | None:
            return None

    nodes_by_id: dict[str, GraphNode] = {
        "llm-fails": make_llm_node("llm-fails"),
        "tool-slow": make_tool_node("tool-slow", "api-slow"),
    }
    executor = DelayedToolExecutor({"api-slow": 5.0})
    ctx = make_ctx(
        nodes_by_id=nodes_by_id,
        tool_definitions_by_api_ref={"api-slow": make_tool_def("api-slow")},
        tool_executor=executor,
        llm_by_node={"llm-fails": ResolvedLlmNode(primary=AlwaysFailingProvider(), fallback=None, retry=_RETRY_ONCE)},
    )
    node = make_parallel_node(
        branches=[{"id": "fails", "entry_node_id": "llm-fails"}, {"id": "slow", "entry_node_id": "tool-slow"}],
        join_policy="all",
    )

    started = time.monotonic()
    with pytest.raises(LlmUnavailableError):
        await ParallelNodeExecutor().execute(node, ctx)
    elapsed = time.monotonic() - started

    assert elapsed < 0.5  # didn't wait for the slow branch's 5s delay
    assert executor.completed == []  # the slow branch was genuinely cancelled
