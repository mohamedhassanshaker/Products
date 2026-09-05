"""Speak node executor (Phase 9, BL-036) — calls `ctx.speak(text)`, a
callback threaded in from `pipeline.py` rather than returning text for the
caller to speak. This is the contained piece of "Speak becomes a mid-turn
callback" surgery `ARCHITECTURE_NOTES.md` §3.2 flags; the larger refactor
(interruptible speech, HITL hold-treatment) is Phase 14.
"""

from __future__ import annotations

from avatar_agent.contracts.runtime_config import GraphNode, SpeakNode
from avatar_agent.orchestration.graph.ir import NodeResult, TurnContext
from avatar_agent.telemetry.control_plane import now_ms


class SpeakNodeExecutor:
    """`NodeExecutor` for `type: speak` nodes."""

    async def execute(self, node: GraphNode, ctx: TurnContext) -> tuple[NodeResult, str | None]:
        # See `LlmNodeExecutor.execute`'s comment: `GraphNode` (not
        # `SpeakNode`) to structurally satisfy the `NodeExecutor` Protocol.
        assert isinstance(node, SpeakNode)
        started = now_ms()
        if node.mode == "literal":
            text = node.text or ""
        else:
            last = ctx.turn_state.get("_last_llm_output")
            text = last if isinstance(last, str) else ""
        if text:
            await ctx.speak(text)
            ctx.spoken = True
        return (
            NodeResult(
                node_id=node.id,
                node_type="speak",
                lane=node.lane,
                status="complete",
                total_ms=now_ms() - started,
                output_text=text,
            ),
            node.next_node_id,
        )
