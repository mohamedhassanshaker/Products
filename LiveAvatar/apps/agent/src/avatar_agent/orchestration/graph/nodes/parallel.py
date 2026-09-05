"""Parallel node executor (Phase 11, BL-042) — fans `node.branches` out as
concurrent `asyncio` tasks (each running its own bounded sub-chain via
`orchestration.graph.registry.walk_chain`, recursing through the same
type-keyed executor registry every other node type is dispatched from — a
branch may itself contain any node type this codebase supports, including a
nested Router/Parallel/Loop/LLM/Tool), then joins them per `join_policy`
(`all`/`first_success`/`quorum`/`all_settled` — `best_of`, BL-069, is not in
the schema's `JoinPolicy` union at all, see `contracts/runtime_config.py`).

**Deferred import**: see `registry.py`'s module docstring for why
`walk_chain` is imported inside `execute()` rather than at module top level
(breaking a circular import between this module and the registry that
builds the dispatch table containing this executor).
"""

from __future__ import annotations

import asyncio
from typing import TYPE_CHECKING

import structlog

from avatar_agent.contracts.runtime_config import GraphNode, ParallelBranch, ParallelNode
from avatar_agent.orchestration.failover import LlmUnavailableError
from avatar_agent.orchestration.graph.edges import resolve_on_error
from avatar_agent.orchestration.graph.ir import NodeResult, TurnContext
from avatar_agent.telemetry.control_plane import now_ms

if TYPE_CHECKING:
    # Type-checking only — see the module docstring for why the real import
    # is deferred to inside `execute()` instead.
    from avatar_agent.orchestration.graph.registry import ChainResult

logger = structlog.get_logger(__name__)


async def _cancel_pending(pending: set[asyncio.Task[tuple[ParallelBranch, ChainResult]]]) -> None:
    """Cancels every still-running task and waits for the cancellation to
    actually land, so a join policy that stops early (`first_success`,
    `quorum`) never leaks a running branch task past this node's own
    `execute()` call returning.
    """
    for task in pending:
        task.cancel()
    if pending:
        await asyncio.gather(*pending, return_exceptions=True)


class ParallelNodeExecutor:
    """`NodeExecutor` for `type: parallel` nodes."""

    async def execute(self, node: GraphNode, ctx: TurnContext) -> tuple[NodeResult, str | None]:
        # See `LlmNodeExecutor.execute`'s comment: `GraphNode` (not
        # `ParallelNode`) to structurally satisfy the `NodeExecutor` Protocol.
        assert isinstance(node, ParallelNode)
        from avatar_agent.orchestration.graph.registry import walk_chain  # deferred — see registry.py's docstring

        started = now_ms()

        async def run_branch(branch: ParallelBranch) -> tuple[ParallelBranch, ChainResult]:
            result = await walk_chain(branch.entry_node_id, ctx, budget_ms=branch.budget_ms)
            return branch, result

        tasks: set[asyncio.Task[tuple[ParallelBranch, ChainResult]]] = {
            asyncio.ensure_future(run_branch(b)) for b in node.branches
        }
        outcomes: dict[str, ChainResult] = {}

        try:
            if node.join_policy == "first_success":
                pending = set(tasks)
                winner: ParallelBranch | None = None
                while pending:
                    done, pending = await asyncio.wait(pending, return_when=asyncio.FIRST_COMPLETED)
                    for task in done:
                        branch, chain_result = await task
                        outcomes[branch.id] = chain_result
                        if winner is None and chain_result.succeeded:
                            winner = branch
                    if winner is not None:
                        break
                await _cancel_pending(pending)
                succeeded = winner is not None
            elif node.join_policy == "quorum":
                # §A3.3's table: "Proceed when n branches have returned" —
                # implemented literally (n *returned*, not n *succeeded*).
                needed = max(min(node.quorum_n or 1, len(node.branches)), 1)
                pending = set(tasks)
                while pending and len(outcomes) < needed:
                    done, pending = await asyncio.wait(pending, return_when=asyncio.FIRST_COMPLETED)
                    for task in done:
                        branch, chain_result = await task
                        outcomes[branch.id] = chain_result
                await _cancel_pending(pending)
                succeeded = any(cr.succeeded for cr in outcomes.values())
            else:  # "all" / "all_settled"
                completed = await asyncio.gather(*tasks)
                for branch, chain_result in completed:
                    outcomes[branch.id] = chain_result
                succeeded = all(cr.succeeded for cr in outcomes.values())
        except LlmUnavailableError:
            # Both LLM legs exhausted somewhere in a branch — propagate
            # uncaught (the package-wide rule, see `nodes/llm.py`), but never
            # leak the sibling tasks first.
            await _cancel_pending({t for t in tasks if not t.done()})
            raise

        any_branch_failed = any(not cr.succeeded for cr in outcomes.values())
        if node.join_policy == "all_settled":
            # Always proceeds with partial results if some fail — literal
            # table wording; `on_branch_error` is not consulted.
            node_failed = False
        elif node.join_policy in ("first_success", "quorum"):
            node_failed = (not succeeded) and node.on_branch_error == "fail"
        else:  # "all"
            node_failed = any_branch_failed and node.on_branch_error == "fail"

        # Every branch's own leaf node already wrote its result into
        # `ctx.turn_state[<that node's own id>]` (the existing Tool-node
        # convention) — no extra plumbing needed for a downstream compose
        # step to read a specific branch's output. This is a convenience
        # summary only.
        ctx.turn_state[node.id] = {branch_id: cr.last_output_text for branch_id, cr in outcomes.items()}

        if node_failed:
            return (
                NodeResult(
                    node_id=node.id,
                    node_type="parallel",
                    lane=node.lane,
                    status="failed",
                    total_ms=now_ms() - started,
                    error_code="PARALLEL_BRANCH_FAILED",
                ),
                resolve_on_error(node),
            )

        output_text = self._pick_output_text(node, outcomes)
        return (
            NodeResult(
                node_id=node.id,
                node_type="parallel",
                lane=node.lane,
                status="complete",
                total_ms=now_ms() - started,
                output_text=output_text,
            ),
            node.next_node_id,
        )

    def _pick_output_text(self, node: ParallelNode, outcomes: dict[str, ChainResult]) -> str | None:
        for branch in node.branches:
            outcome = outcomes.get(branch.id)
            if outcome is not None and outcome.succeeded and outcome.last_output_text:
                return outcome.last_output_text
        return None
