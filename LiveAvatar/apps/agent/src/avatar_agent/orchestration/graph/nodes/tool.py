"""Tool node executor (Phase 9, BL-036) — reuses `ToolExecutor.invoke` as-is
(no vendor SDK, safe to call directly). `argument_mapping` resolves each
value against `ctx.turn_state`: a `$`-prefixed value looks up a turn-state
key (`$utterance`, `$<node_id>`, optionally `$state.<key>`); anything else
is passed through as a literal string. Deliberately tiny — no expression
language beyond variable substitution (mirrors the TypeScript test-call
simulator's `resolveArgumentMapping`).

**Phase 10 fix (Phase 9 finding #2)**: a recognized failure (unknown
`api_ref`, or `ToolExecutor.invoke` raising `ToolError`) now resolves the
node's own `on_error` edge via `edges.resolve_on_error` instead of always
proceeding to `next_node_id` as if nothing happened.
"""

from __future__ import annotations

from avatar_agent.contracts.runtime_config import GraphNode, ToolNode
from avatar_agent.orchestration.graph.edges import resolve_on_error
from avatar_agent.orchestration.graph.ir import NodeResult, TurnContext
from avatar_agent.orchestration.tools import ToolError
from avatar_agent.telemetry.control_plane import now_ms


def _resolve_arguments(mapping: dict[str, str], turn_state: dict[str, object]) -> dict[str, object]:
    args: dict[str, object] = {}
    for key, value in mapping.items():
        if value.startswith("$"):
            field_name = value[1:]
            if field_name.startswith("state."):
                field_name = field_name[len("state.") :]
            args[key] = turn_state.get(field_name)
        else:
            args[key] = value
    return args


class ToolNodeExecutor:
    """`NodeExecutor` for `type: tool` nodes."""

    async def execute(self, node: GraphNode, ctx: TurnContext) -> tuple[NodeResult, str | None]:
        # See `LlmNodeExecutor.execute`'s comment: `GraphNode` (not `ToolNode`)
        # to structurally satisfy the `NodeExecutor` Protocol.
        assert isinstance(node, ToolNode)
        started = now_ms()
        definition = ctx.tool_definitions_by_api_ref.get(node.api_ref)
        if definition is None:
            return (
                NodeResult(
                    node_id=node.id,
                    node_type="tool",
                    lane=node.lane,
                    status="failed",
                    total_ms=now_ms() - started,
                    error_code="TOOL_UNKNOWN",
                ),
                resolve_on_error(node),
            )
        args = _resolve_arguments(node.argument_mapping, ctx.turn_state)
        try:
            result_text = await ctx.tool_executor.invoke(definition, args)
        except ToolError as err:
            return (
                NodeResult(
                    node_id=node.id,
                    node_type="tool",
                    lane=node.lane,
                    status="failed",
                    total_ms=now_ms() - started,
                    error_code=err.code,
                ),
                resolve_on_error(node),
            )
        ctx.turn_state[node.id] = result_text
        return (
            NodeResult(
                node_id=node.id,
                node_type="tool",
                lane=node.lane,
                status="complete",
                total_ms=now_ms() - started,
                output_text=result_text,
            ),
            node.next_node_id,
        )
