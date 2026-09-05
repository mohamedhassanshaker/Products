"""Loop node executor (Phase 11, BL-043) — repeats `body_entry_node_id`'s
chain via `orchestration.graph.registry.walk_chain` until `condition` holds
("repeat **until** the condition holds", A3.2's own wording — the loop stops
the first time `evaluate_condition(...)` returns `True`), reusing the Router
condition grammar verbatim (never a second evaluator).

**Runtime guard enforcement is defense-in-depth, independent of the
publish-time V-2 check** (`contracts/runtime_config.py`'s `ReasoningBlock`
validator, and the TypeScript mirror in `graph-rules.ts`): every one of the
three guards (`max_iterations`, `max_duration_ms`, `max_cost`) is re-checked
here **before every iteration**, so a config edited outside the normal save
path (or any future bypass of the publish-time check) still can never
produce an actual infinite loop. The instant any guard is exceeded, the loop
stops and resolves **`on_deadline`** (not `on_error`) — a guard trip is
conceptually "ran out of budget," the same category `on_deadline` already
covers for the turn-level deadline (`interpreter.py`) — through the shared
`edges.resolve_on_deadline` helper, so this can never bypass its own edge
the way Phase 9's Tool/Router bug did before Phase 10 fixed it.

**`max_cost` unit**: abstract cost units, one unit = one node executed
during a single loop-body pass (see `LoopNode`'s docstring in
`contracts/runtime_config.py` for why).

**Deferred import**: see `registry.py`'s module docstring for why
`walk_chain` is imported inside `execute()` rather than at module top level.
"""

from __future__ import annotations

import structlog

from avatar_agent.contracts.runtime_config import GraphNode, LoopNode
from avatar_agent.orchestration.graph.condition_grammar import GraphConditionError, evaluate_condition
from avatar_agent.orchestration.graph.edges import resolve_on_deadline, resolve_on_error
from avatar_agent.orchestration.graph.ir import NodeResult, TurnContext
from avatar_agent.telemetry.control_plane import now_ms

logger = structlog.get_logger(__name__)


class LoopNodeExecutor:
    """`NodeExecutor` for `type: loop` nodes."""

    async def execute(self, node: GraphNode, ctx: TurnContext) -> tuple[NodeResult, str | None]:
        # See `LlmNodeExecutor.execute`'s comment: `GraphNode` (not
        # `LoopNode`) to structurally satisfy the `NodeExecutor` Protocol.
        assert isinstance(node, LoopNode)
        from avatar_agent.orchestration.graph.registry import walk_chain  # deferred — see registry.py's docstring

        started = now_ms()
        iterations = 0
        cost_used = 0.0
        last_output_text: str | None = None
        condition_held = False
        guard_tripped: str | None = None

        while True:
            elapsed_ms = now_ms() - started
            # Guards checked *before* starting another iteration — the
            # moment any is already exceeded, stop immediately without
            # running one more pass.
            if iterations >= node.max_iterations:
                guard_tripped = "max_iterations"
                break
            if elapsed_ms >= node.max_duration_ms:
                guard_tripped = "max_duration_ms"
                break
            if cost_used >= node.max_cost:
                guard_tripped = "max_cost"
                break

            remaining_duration_ms = node.max_duration_ms - elapsed_ms
            chain_result = await walk_chain(node.body_entry_node_id, ctx, budget_ms=remaining_duration_ms)
            iterations += 1
            cost_used += len(chain_result.trace)
            if chain_result.last_output_text is not None:
                last_output_text = chain_result.last_output_text

            try:
                if evaluate_condition(node.condition, ctx.turn_state):  # type: ignore[arg-type]
                    condition_held = True
                    break
            except GraphConditionError:
                logger.exception("GRAPH_LOOP_CONDITION_INVALID", node_id=node.id)
                return (
                    NodeResult(
                        node_id=node.id,
                        node_type="loop",
                        lane=node.lane,
                        status="failed",
                        total_ms=now_ms() - started,
                        error_code="LOOP_CONDITION_INVALID",
                    ),
                    resolve_on_error(node),
                )

        if last_output_text is not None:
            ctx.turn_state[node.id] = last_output_text

        if condition_held:
            return (
                NodeResult(
                    node_id=node.id,
                    node_type="loop",
                    lane=node.lane,
                    status="complete",
                    total_ms=now_ms() - started,
                    output_text=last_output_text,
                ),
                node.next_node_id,
            )

        # A guard tripped before the condition ever held — never a silent
        # infinite loop, regardless of what the config says. Recorded as
        # `timed_out` (A3.4's state machine — the same status the top-level
        # turn-budget cut uses) with a guard-specific error code.
        logger.warning("GRAPH_LOOP_GUARD_EXCEEDED", node_id=node.id, guard=guard_tripped, iterations=iterations)
        return (
            NodeResult(
                node_id=node.id,
                node_type="loop",
                lane=node.lane,
                status="timed_out",
                total_ms=now_ms() - started,
                output_text=last_output_text,
                error_code=f"LOOP_GUARD_EXCEEDED_{guard_tripped}",
            ),
            resolve_on_deadline(node),
        )
