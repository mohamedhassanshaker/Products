"""Unit tests for `StateNodeExecutor` (Phase 15, BL-060) — session-scoped,
cross-turn variable read/write. `ctx.session_state` is exercised directly
(a plain `dict`, mirrors `ports.orchestration.TurnContext.session_state`'s
own "created once per session, threaded by reference into every turn's
fresh `TurnContext`" wiring) — a cross-turn test simply reuses the same
dict instance across two separately-constructed `TurnContext`s, exactly
the way `ConversationPipeline` does in production.
"""

from __future__ import annotations

from uuid import uuid4

from avatar_agent.contracts.runtime_config import StateNode
from avatar_agent.orchestration.graph.ir import TurnContext
from avatar_agent.orchestration.graph.nodes.state import StateNodeExecutor
from avatar_agent.residency.filter import ResidencyPayload


def make_state_node(
    *,
    node_id: str = "state-1",
    mode: str = "write",
    variable: str = "order_id",
    value: str | None = "4821",
    next_node_id: str | None = "end-1",
) -> StateNode:
    payload = {
        "id": node_id,
        "type": "state",
        "name": "Remember order id",
        "lane": "foreground",
        "on_error": {"action": "degrade"},
        "on_deadline": {"action": "degrade"},
        "mode": mode,
        "variable": variable,
        "next_node_id": next_node_id,
    }
    if value is not None:
        payload["value"] = value
    return StateNode.model_validate(payload)


class _NullHopRecorder:
    def record(self, item) -> None:  # noqa: ANN001
        pass

    async def flush(self) -> None:
        pass


def make_ctx(*, turn_state: dict | None = None, session_state: dict | None = None) -> TurnContext:
    async def _speak(text: str) -> None:  # pragma: no cover - State nodes never speak
        raise AssertionError("StateNodeExecutor must never call ctx.speak")

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
        session_state=session_state if session_state is not None else {},
    )


# --- write mode --------------------------------------------------------


async def test_write_a_literal_value_into_session_state_and_continues() -> None:
    session_state: dict = {}
    node = make_state_node(mode="write", variable="order_id", value="4821")
    ctx = make_ctx(session_state=session_state)

    result, next_id = await StateNodeExecutor().execute(node, ctx)

    assert result.status == "complete"
    assert result.node_type == "state"
    assert next_id == "end-1"
    assert session_state["order_id"] == "4821"


async def test_write_sets_turn_state_under_both_node_id_and_variable_name() -> None:
    node = make_state_node(mode="write", variable="order_id", value="4821")
    ctx = make_ctx()

    await StateNodeExecutor().execute(node, ctx)

    assert ctx.turn_state["state-1"] == "4821"
    assert ctx.turn_state["order_id"] == "4821"


async def test_write_resolves_a_dollar_prefixed_reference_to_another_nodes_output() -> None:
    """Reuses `tool.py`'s `$`-prefixed argument-reference resolution helper
    verbatim — a State write can capture another node's own output, not
    just a literal string (same convention `ToolNode.argument_mapping`
    already uses)."""
    node = make_state_node(mode="write", variable="last_reply", value="$llm-1")
    ctx = make_ctx(turn_state={"llm-1": "Your order ships tomorrow."})

    result, _next_id = await StateNodeExecutor().execute(node, ctx)

    assert result.output_text == "Your order ships tomorrow."
    assert ctx.session_state["last_reply"] == "Your order ships tomorrow."


async def test_write_resolves_a_dollar_state_prefixed_reference() -> None:
    """`$state.<key>` strips the `state.` prefix and looks the remainder up
    directly in `turn_state` (`tool.py`'s own grammar) — proven here the
    same way a Tool node's `argument_mapping` would exercise it."""
    node = make_state_node(mode="write", variable="copy_of_utterance", value="$state.utterance")
    ctx = make_ctx(turn_state={"utterance": "please refund my order"})

    await StateNodeExecutor().execute(node, ctx)

    assert ctx.session_state["copy_of_utterance"] == "please refund my order"


# --- read mode -----------------------------------------------------------


async def test_read_an_unset_variable_yields_none_without_failing() -> None:
    node = make_state_node(mode="read", variable="order_id", value=None)
    ctx = make_ctx()

    result, next_id = await StateNodeExecutor().execute(node, ctx)

    assert result.status == "complete"
    assert result.output_text is None
    assert next_id == "end-1"
    assert ctx.turn_state["state-1"] is None
    assert ctx.turn_state["order_id"] is None


async def test_read_a_previously_written_variable_sets_turn_state_under_both_keys() -> None:
    node = make_state_node(mode="read", variable="order_id", value=None)
    ctx = make_ctx(session_state={"order_id": "4821"})

    result, _next_id = await StateNodeExecutor().execute(node, ctx)

    assert result.output_text == "4821"
    assert ctx.turn_state["state-1"] == "4821"
    assert ctx.turn_state["order_id"] == "4821"


# --- cross-turn persistence (the whole point of session_state) -----------


async def test_a_write_in_one_turn_is_visible_to_a_read_in_a_later_turn_sharing_the_same_session_state() -> None:
    """Mirrors `ConversationPipeline`'s own wiring: one `session_state` dict
    is created once per session and threaded *by reference* into every
    turn's fresh `TurnContext` — proven here by literally reusing the same
    dict instance across two independently-constructed contexts, standing
    in for "turn 1" and "turn 2".
    """
    shared_session_state: dict = {}
    write_ctx = make_ctx(session_state=shared_session_state)
    write_node = make_state_node(mode="write", variable="order_id", value="4821")
    await StateNodeExecutor().execute(write_node, write_ctx)

    # `turn_state` is deliberately NOT shared across the two contexts (it
    # resets every turn in production) — only `session_state` is.
    read_ctx = make_ctx(session_state=shared_session_state)
    read_node = make_state_node(mode="read", variable="order_id", value=None)
    result, _next_id = await StateNodeExecutor().execute(read_node, read_ctx)

    assert result.output_text == "4821"
    assert write_ctx.turn_state is not read_ctx.turn_state  # separate turn_state instances, unlike session_state
    assert read_ctx.turn_state["order_id"] == "4821"
