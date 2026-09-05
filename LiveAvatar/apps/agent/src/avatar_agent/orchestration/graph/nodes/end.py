"""End node executor (Phase 9, BL-036) — terminates the turn. A no-op."""

from __future__ import annotations

from avatar_agent.contracts.runtime_config import EndNode, GraphNode
from avatar_agent.orchestration.graph.ir import NodeResult, TurnContext


class EndNodeExecutor:
    """`NodeExecutor` for `type: end` nodes."""

    async def execute(self, node: GraphNode, ctx: TurnContext) -> tuple[NodeResult, str | None]:
        # See `LlmNodeExecutor.execute`'s comment: `GraphNode` (not
        # `EndNode`) to structurally satisfy the `NodeExecutor` Protocol.
        assert isinstance(node, EndNode)
        return (
            NodeResult(node_id=node.id, node_type="end", lane=node.lane, status="complete", total_ms=0),
            None,
        )
