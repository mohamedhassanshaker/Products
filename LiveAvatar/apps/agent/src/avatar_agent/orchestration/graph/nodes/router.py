"""Router node executor (Phase 9, BL-036) — evaluates branches via the
allow-listed condition grammar (`condition_grammar.py`, never `eval`'d).

**Phase 10 fix (Phase 9 finding #2)**: a malformed condition (recognized as
`GraphConditionError`) now resolves the node's own `on_error` edge via
`edges.resolve_on_error` instead of always falling to
`default_next_node_id` as if the router had simply not matched any branch.
"""

from __future__ import annotations

from avatar_agent.contracts.runtime_config import GraphNode, RouterNode
from avatar_agent.orchestration.graph.condition_grammar import GraphConditionError, evaluate_condition
from avatar_agent.orchestration.graph.edges import resolve_on_error
from avatar_agent.orchestration.graph.ir import NodeResult, TurnContext
from avatar_agent.telemetry.control_plane import now_ms


class RouterNodeExecutor:
    """`NodeExecutor` for `type: router` nodes."""

    async def execute(self, node: GraphNode, ctx: TurnContext) -> tuple[NodeResult, str | None]:
        # See `LlmNodeExecutor.execute`'s comment: `GraphNode` (not
        # `RouterNode`) to structurally satisfy the `NodeExecutor` Protocol.
        assert isinstance(node, RouterNode)
        started = now_ms()
        try:
            for branch in node.branches:
                if evaluate_condition(branch.condition, ctx.turn_state):  # type: ignore[arg-type]
                    return (
                        NodeResult(
                            node_id=node.id, node_type="router", lane=node.lane, status="complete", total_ms=now_ms() - started
                        ),
                        branch.next_node_id,
                    )
        except GraphConditionError:
            return (
                NodeResult(
                    node_id=node.id,
                    node_type="router",
                    lane=node.lane,
                    status="failed",
                    total_ms=now_ms() - started,
                    error_code="ROUTER_CONDITION_INVALID",
                ),
                resolve_on_error(node),
            )
        return (
            NodeResult(node_id=node.id, node_type="router", lane=node.lane, status="complete", total_ms=now_ms() - started),
            node.default_next_node_id,
        )
