"""Unit tests for `RouterNodeExecutor` (Phase 9, BL-036)."""

from __future__ import annotations

from uuid import uuid4

from avatar_agent.contracts.runtime_config import RouterNode
from avatar_agent.orchestration.graph.ir import TurnContext
from avatar_agent.orchestration.graph.nodes.router import RouterNodeExecutor
from avatar_agent.residency.filter import ResidencyPayload


def make_router_node(
    *,
    node_id: str = "router-1",
    branches: list[dict],
    default_next_node_id: str,
    on_error: dict[str, object] | None = None,
) -> RouterNode:
    return RouterNode.model_validate(
        {
            "id": node_id,
            "type": "router",
            "name": "Router",
            "lane": "foreground",
            "on_error": on_error or {"action": "degrade"},
            "on_deadline": {"action": "degrade"},
            "branches": branches,
            "default_next_node_id": default_next_node_id,
        }
    )


def make_ctx(*, turn_state: dict[str, object] | None = None) -> TurnContext:
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
        tool_definitions_by_api_ref={},
        tools_by_name={},
        tool_specs=[],
        tool_executor=object(),
        residency=ResidencyPayload(system_prompt="sys", messages=()),
        turn_state=turn_state if turn_state is not None else {},
        speak=_speak,
        hop_recorder=_NullHopRecorder(),
    )


async def test_router_takes_the_first_matching_branch() -> None:
    node = make_router_node(
        branches=[
            {"condition": 'intent == "refund"', "next_node_id": "refund-flow"},
            {"condition": 'intent == "complaint"', "next_node_id": "complaint-flow"},
        ],
        default_next_node_id="fallback",
    )
    ctx = make_ctx(turn_state={"intent": "complaint"})

    result, next_id = await RouterNodeExecutor().execute(node, ctx)

    assert result.status == "complete"
    assert next_id == "complaint-flow"


async def test_router_falls_through_to_the_default_branch_when_no_branch_matches() -> None:
    node = make_router_node(
        branches=[{"condition": 'intent == "refund"', "next_node_id": "refund-flow"}], default_next_node_id="fallback"
    )
    ctx = make_ctx(turn_state={"intent": "unrelated"})

    result, next_id = await RouterNodeExecutor().execute(node, ctx)

    assert result.status == "complete"
    assert next_id == "fallback"


async def test_router_with_a_malformed_condition_resolves_the_on_error_goto_edge() -> None:
    """Phase 10 fix (Phase 9 finding #2): a malformed condition now takes
    the node's own configured `on_error` edge — proven here by a `goto`
    target that differs from `default_next_node_id`, so the two can't be
    confused.
    """
    node = make_router_node(
        branches=[{"condition": "not a valid condition!!", "next_node_id": "refund-flow"}],
        default_next_node_id="fallback",
        on_error={"action": "goto", "target_node_id": "recovery-1"},
    )
    ctx = make_ctx(turn_state={"intent": "refund"})

    result, next_id = await RouterNodeExecutor().execute(node, ctx)

    assert result.status == "failed"
    assert result.error_code == "ROUTER_CONDITION_INVALID"
    assert next_id == "recovery-1"


async def test_router_with_a_malformed_condition_and_no_goto_on_error_stops_the_walk() -> None:
    """Without a `goto` configured, a malformed condition now stops the walk
    (mirrors the interpreter's own uncaught-exception handling) rather than
    silently falling to `default_next_node_id` as if the router had simply
    not matched any branch — the literal Phase 9 finding #2 bug, fixed.
    """
    node = make_router_node(
        branches=[{"condition": "not a valid condition!!", "next_node_id": "refund-flow"}], default_next_node_id="fallback"
    )
    ctx = make_ctx(turn_state={"intent": "refund"})

    result, next_id = await RouterNodeExecutor().execute(node, ctx)

    assert result.status == "failed"
    assert result.error_code == "ROUTER_CONDITION_INVALID"
    assert next_id is None
