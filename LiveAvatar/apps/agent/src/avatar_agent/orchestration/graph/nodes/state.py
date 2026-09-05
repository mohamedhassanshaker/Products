"""State node executor (Phase 15, BL-060; `ARCHITECTURE_NOTES.md` §3.2) —
session-scoped variable read/write, **in-memory only**, spanning the whole
session (multiple turns) via `ctx.session_state` — deliberately **not**
`ctx.turn_state`, which resets every turn (see `ports.orchestration
.TurnContext.session_state`'s own docstring for the "created once by
`ConversationPipeline.__init__`, threaded by reference into every turn's
fresh `TurnContext`" wiring that makes cross-turn persistence work). No
Postgres write path exists or is planned for v1 (BACKLOG BL-060) — session
teardown discards it, by design.

`mode: 'write'` resolves `node.value` via the exact same `$`-prefixed
reference syntax `nodes/tool.py`'s `argument_mapping` already implements —
reused verbatim via `tool._resolve_arguments` (a single-field `{"value":
...}` mapping is enough to drive that helper), never reimplemented, per
this phase's explicit instruction. A `$<node_id>` value therefore lets a
State write capture another node's own output, not just a literal string.

**Judgment call — `StateNode.value` required-for-write is not re-validated
here.** Per this phase's schema (`StateNode`'s own docstring in
`contracts/runtime_config.py`), that cross-field rule is enforced
server-side, in `apps/api`'s Gate A structural check
(`graph-structure.ts`'s `checkStateValue`) — a config reaching this
executor has already passed that gate. `node.value or ""` is a purely
defensive fallback (never expected to trigger in practice) rather than a
crash, mirroring this codebase's general "a config/runtime disagreement is
a recognized node condition, never an unhandled exception" posture.

**Judgment call — a read stores its result under *two* `turn_state` keys.**
`turn_state[node.id]` follows the universal "every node's own output is
referenceable by id" convention every other node type already sets
(`ToolNode`, `SkillNode`, `HitlNode`, ...). `turn_state[node.variable]` is
set *additionally* because `nodes/tool.py`'s `_resolve_arguments` (and, by
the same grammar, a Router condition) already special-cases a `$state.<key>`
reference by stripping the `state.` prefix and looking the remainder up
directly in `turn_state` — writing the value under its own variable name
too is what makes `$state.<variable>` resolve to a State-node-read value
downstream, without inventing a second lookup convention. A `mode: 'write'`
node sets both keys the same way, for symmetry and so a downstream node can
reference either a write's own node-id output or its variable name
interchangeably, exactly like a read.
"""

from __future__ import annotations

from avatar_agent.contracts.runtime_config import GraphNode, StateNode
from avatar_agent.orchestration.graph.ir import NodeResult, TurnContext
from avatar_agent.orchestration.graph.nodes.tool import _resolve_arguments
from avatar_agent.telemetry.control_plane import now_ms


class StateNodeExecutor:
    """`NodeExecutor` for `type: state` nodes."""

    async def execute(self, node: GraphNode, ctx: TurnContext) -> tuple[NodeResult, str | None]:
        # See `LlmNodeExecutor.execute`'s comment: `GraphNode` (not
        # `StateNode`) to structurally satisfy the `NodeExecutor` Protocol.
        assert isinstance(node, StateNode)
        started = now_ms()

        if node.mode == "read":
            value = ctx.session_state.get(node.variable)
        else:
            resolved = _resolve_arguments({"value": node.value or ""}, ctx.turn_state)
            value = resolved["value"]
            ctx.session_state[node.variable] = value

        # See this module's docstring for why both keys are set.
        ctx.turn_state[node.id] = value
        ctx.turn_state[node.variable] = value

        return (
            NodeResult(
                node_id=node.id,
                node_type="state",
                lane=node.lane,
                status="complete",
                total_ms=now_ms() - started,
                output_text=str(value) if value is not None else None,
            ),
            node.next_node_id,
        )
