"""Unit tests for `SpeakNodeExecutor` (Phase 9, BL-036) — `mode: llm_output`
reads `ctx.turn_state["_last_llm_output"]`, `mode: literal` uses `node.text`,
and empty resolved text is a no-op (never calls `ctx.speak`).
"""

from __future__ import annotations

from uuid import uuid4

from avatar_agent.contracts.runtime_config import SpeakNode
from avatar_agent.orchestration.graph.ir import TurnContext
from avatar_agent.orchestration.graph.nodes.speak import SpeakNodeExecutor
from avatar_agent.residency.filter import ResidencyPayload


def make_speak_node(
    *, node_id: str = "speak-1", mode: str, text: str | None = None, next_node_id: str | None = "end-1"
) -> SpeakNode:
    return SpeakNode.model_validate(
        {
            "id": node_id,
            "type": "speak",
            "name": "Speak",
            "lane": "foreground",
            "on_error": {"action": "end_turn"},
            "on_deadline": {"action": "end_turn"},
            "mode": mode,
            "text": text,
            "next_node_id": next_node_id,
        }
    )


def make_ctx(*, turn_state: dict[str, object] | None = None) -> tuple[TurnContext, list[str]]:
    spoken: list[str] = []

    async def _speak(text: str) -> None:
        spoken.append(text)

    class _NullHopRecorder:
        def record(self, item):  # noqa: ANN001
            pass

        async def flush(self) -> None:
            pass

    ctx = TurnContext(
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
    return ctx, spoken


async def test_llm_output_mode_speaks_the_last_llm_output_from_turn_state() -> None:
    node = make_speak_node(mode="llm_output", next_node_id="end-1")
    ctx, spoken = make_ctx(turn_state={"_last_llm_output": "hello there"})

    result, next_id = await SpeakNodeExecutor().execute(node, ctx)

    assert spoken == ["hello there"]
    assert ctx.spoken is True
    assert result.status == "complete"
    assert result.output_text == "hello there"
    assert next_id == "end-1"


async def test_literal_mode_speaks_the_nodes_own_text() -> None:
    node = make_speak_node(mode="literal", text="Thanks for calling.", next_node_id="end-1")
    ctx, spoken = make_ctx()

    result, _next_id = await SpeakNodeExecutor().execute(node, ctx)

    assert spoken == ["Thanks for calling."]
    assert result.output_text == "Thanks for calling."
    assert ctx.spoken is True


async def test_is_a_no_op_when_llm_output_mode_resolves_to_empty_text() -> None:
    node = make_speak_node(mode="llm_output", next_node_id="end-1")
    ctx, spoken = make_ctx(turn_state={})  # no "_last_llm_output" key at all

    result, next_id = await SpeakNodeExecutor().execute(node, ctx)

    assert spoken == []
    assert ctx.spoken is False
    assert result.status == "complete"
    assert result.output_text == ""
    assert next_id == "end-1"


async def test_is_a_no_op_when_literal_mode_has_no_text() -> None:
    node = make_speak_node(mode="literal", text=None, next_node_id="end-1")
    ctx, spoken = make_ctx()

    result, _next_id = await SpeakNodeExecutor().execute(node, ctx)

    assert spoken == []
    assert ctx.spoken is False
    assert result.output_text == ""
