"""One `NodeExecutor` per Phase 9 graph node type (BL-036)."""

from __future__ import annotations

from typing import Protocol

from avatar_agent.contracts.runtime_config import GraphNode
from avatar_agent.orchestration.graph.ir import NodeResult, TurnContext


class NodeExecutor(Protocol):
    """Common shape every node executor implements. Returns the node's
    `NodeResult` plus the id of the next node to walk to (`None` ends the
    current chain — either a terminal node, or a node whose own
    `next_node_id` is unset).
    """

    async def execute(self, node: GraphNode, ctx: TurnContext) -> tuple[NodeResult, str | None]: ...
