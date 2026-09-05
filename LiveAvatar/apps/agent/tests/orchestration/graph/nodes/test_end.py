"""Unit tests for `EndNodeExecutor` (Phase 9, BL-036) — a terminal no-op."""

from __future__ import annotations

from uuid import uuid4

from avatar_agent.contracts.runtime_config import EndNode
from avatar_agent.orchestration.graph.ir import TurnContext
from avatar_agent.orchestration.graph.nodes.end import EndNodeExecutor
from avatar_agent.residency.filter import ResidencyPayload


def make_end_node(*, node_id: str = "end-1") -> EndNode:
    return EndNode.model_validate(
        {
            "id": node_id,
            "type": "end",
            "name": "End turn",
            "lane": "foreground",
            "on_error": {"action": "end_turn"},
            "on_deadline": {"action": "end_turn"},
        }
    )


def make_ctx() -> TurnContext:
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
        turn_state={},
        speak=_speak,
        hop_recorder=_NullHopRecorder(),
    )


async def test_end_node_is_a_terminal_no_op() -> None:
    node = make_end_node()
    ctx = make_ctx()

    result, next_id = await EndNodeExecutor().execute(node, ctx)

    assert result.status == "complete"
    assert result.node_type == "end"
    assert next_id is None
