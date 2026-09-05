"""Shared `on_error`/`on_deadline` edge resolution (Phase 10, BL-040/041).

**Phase 9 finding #2, fixed here**: a node executor's own *recognized*
failure (a timed-out tool call, a malformed Router condition) used to fall
through to that node's normal `next_node_id`/`default_next_node_id` instead
of its configured `on_error` edge — only a genuinely *uncaught* exception
ever reached `interpreter.py`'s on_error handling. That made Gate A's V-5
structural check ("every node has an `on_error` edge") validate something
the runtime didn't actually honor for the failure modes admins hit most.

Both `interpreter.py` (its own uncaught-exception path) and every node
executor with a recognized failure mode (`nodes/tool.py`, `nodes/router.py`)
now resolve `on_error` through this one function, so the two can never drift
apart again. `resolve_on_deadline` is the identical resolution for the
`on_deadline` edge, added this phase for R-G13's deadline-degradation
runtime (`interpreter.py`'s turn-budget enforcement).

Mirrored, not shared, in TypeScript
(`apps/api/.../domain/graph-edges.ts`) for the NestJS test-call simulator —
same duplication precedent this package's condition grammar already set
(see the plan doc's "Decisions made this phase" for Phase 9).
"""

from __future__ import annotations

from avatar_agent.contracts.runtime_config import GraphNode, NodeEdge


def _resolve(edge: NodeEdge, nodes_by_id: dict[str, GraphNode] | None) -> str | None:
    """`goto` with a target resolves to that target; `end_turn`/`degrade`
    (or a `goto` with no `target_node_id`) resolve to `None`, meaning the
    walk stops here and the interpreter's own terminal degradation applies.
    `nodes_by_id`, when given, defensively re-checks the target actually
    exists in this graph (Gate A already guarantees this at publish time —
    see `graph-structure.ts`'s docstring on the still-open Router-cycle
    gap — this is a cheap belt-and-suspenders check, not the source of
    truth for referential integrity).
    """
    if edge.action != "goto" or not edge.target_node_id:
        return None
    if nodes_by_id is not None and edge.target_node_id not in nodes_by_id:
        return None
    return edge.target_node_id


def resolve_on_error(node: GraphNode, nodes_by_id: dict[str, GraphNode] | None = None) -> str | None:
    """Resolves `node.on_error` to a next-node id, or `None` to stop the walk.

    Every node executor with a *recognized* failure mode must call this
    instead of returning its own `next_node_id`/`default_next_node_id` on
    that failure path (Phase 10 fix for Phase 9 finding #2).
    """
    return _resolve(node.on_error, nodes_by_id)


def resolve_on_deadline(node: GraphNode, nodes_by_id: dict[str, GraphNode] | None = None) -> str | None:
    """Resolves `node.on_deadline` to a next-node id, or `None` to stop the
    walk — R-G13's deadline-degradation runtime (Phase 10).
    """
    return _resolve(node.on_deadline, nodes_by_id)
