"""Shared node-type dispatch table + bounded chain walker (Phase 11,
BL-042/043). `interpreter.py`'s foreground/background walks previously
defined their own private `_EXECUTORS` dict; this module extracts it (now
with `parallel`/`loop` added) so `nodes/parallel.py`/`nodes/loop.py` can
recurse into a Parallel branch's or Loop body's own chain — which may
itself contain any node type this codebase supports, including a nested
Router/Parallel/Loop/LLM/Tool — through the exact same dispatch table and
per-node deadline/on_error/on_deadline semantics `interpreter.py`'s own
foreground loop uses.

**Deferred-import note (the one place this package does this deliberately)**:
`NODE_EXECUTORS`'s construction imports every `nodes/*.py` module, including
`nodes/parallel.py` and `nodes/loop.py`. Those two modules, in turn, need
`walk_chain` from *this* module to recurse into their own branch/body
chains. A top-level `from avatar_agent.orchestration.graph.registry import
...` inside `nodes/parallel.py`/`nodes/loop.py` would therefore be a
circular import (this module -> nodes.parallel -> this module, before
either has finished initializing). Both of those modules instead import
`walk_chain` **inside their `execute()` method**, deferred to call time —
by then both modules are already fully present in `sys.modules`, so the
import is a plain, safe attribute lookup. `interpreter.py` itself imports
this module normally (it does not participate in the cycle — it never
imported the individual `nodes/*.py` executor classes directly to begin
with, only this module's dispatch table).

`interpreter.py`'s own main foreground loop and `_run_background_chain` are
**not** rewritten to call `walk_chain` — see the plan doc's Phase 11 section
for why (avoiding regression risk to Phase 10's already-gated,
empirically-tuned deadline/one-shot-degradation logic). They simply import
`NODE_EXECUTORS` from here instead of defining their own copy, which is what
makes `parallel`/`loop` reachable node types from the top-level walk too.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field

import structlog

from avatar_agent.contracts.internal_api import HopItem
from avatar_agent.contracts.runtime_config import GraphNode
from avatar_agent.orchestration.failover import LlmUnavailableError
from avatar_agent.orchestration.graph.edges import resolve_on_deadline, resolve_on_error
from avatar_agent.orchestration.graph.ir import NodeResult, TurnContext
from avatar_agent.orchestration.graph.nodes import NodeExecutor
from avatar_agent.orchestration.graph.nodes.end import EndNodeExecutor
from avatar_agent.orchestration.graph.nodes.handoff import HandoffNodeExecutor
from avatar_agent.orchestration.graph.nodes.hitl import HitlNodeExecutor
from avatar_agent.orchestration.graph.nodes.llm import LlmNodeExecutor
from avatar_agent.orchestration.graph.nodes.loop import LoopNodeExecutor
from avatar_agent.orchestration.graph.nodes.parallel import ParallelNodeExecutor
from avatar_agent.orchestration.graph.nodes.retrieve import RetrieveNodeExecutor
from avatar_agent.orchestration.graph.nodes.router import RouterNodeExecutor
from avatar_agent.orchestration.graph.nodes.skill import SkillNodeExecutor
from avatar_agent.orchestration.graph.nodes.speak import SpeakNodeExecutor
from avatar_agent.orchestration.graph.nodes.state import StateNodeExecutor
from avatar_agent.orchestration.graph.nodes.subagent import SubAgentNodeExecutor
from avatar_agent.orchestration.graph.nodes.tool import ToolNodeExecutor
from avatar_agent.telemetry.control_plane import now_ms

logger = structlog.get_logger(__name__)

# Same defensive bound `interpreter.py`'s own `_MAX_STEPS` uses — shared here
# so a Parallel branch/Loop-body-iteration walk gets an identical guard
# against an accidental cycle (V-4 already rejects one at publish time; this
# is runtime defense-in-depth, same posture as `interpreter.py`'s own).
MAX_CHAIN_STEPS = 100

NODE_EXECUTORS: dict[str, NodeExecutor] = {
    "llm": LlmNodeExecutor(),
    "tool": ToolNodeExecutor(),
    "retrieve": RetrieveNodeExecutor(),
    "router": RouterNodeExecutor(),
    "speak": SpeakNodeExecutor(),
    "end": EndNodeExecutor(),
    "parallel": ParallelNodeExecutor(),
    "loop": LoopNodeExecutor(),
    "skill": SkillNodeExecutor(),
    "hitl": HitlNodeExecutor(),
    "subagent": SubAgentNodeExecutor(),
    "handoff": HandoffNodeExecutor(),
    "state": StateNodeExecutor(),
}


@dataclass
class ChainResult:
    """The outcome of walking one bounded chain (a Parallel branch, a Loop
    body pass). Deliberately does not carry a top-level `GraphRunResult`-style
    shape — a chain is an internal concept, not a turn.
    """

    trace: list[NodeResult] = field(default_factory=list)
    last_output_text: str | None = None

    @property
    def succeeded(self) -> bool:
        """The chain's last executed node completed without error/timeout.
        An empty trace (a missing entry node — already reported by Gate A on
        a real save) counts as not succeeded.
        """
        return bool(self.trace) and self.trace[-1].status == "complete"


async def execute_one_node(node: GraphNode, ctx: TurnContext, *, remaining_ms: float | None) -> tuple[NodeResult, str | None]:
    """Executes exactly one node, honoring `remaining_ms` as a deadline for
    *this* execution (`None` means no per-node timeout at all — used for a
    chain with no budget_ms/remaining-duration of its own). Never raises
    except `LlmUnavailableError` (propagated exactly as `interpreter.py`'s
    own per-node handling does) — every other failure mode is captured into
    a `status="failed"/"timed_out"` `NodeResult` and resolved via
    `resolve_on_error`/`resolve_on_deadline`, so a recognized failure inside
    a branch/loop-body node never bypasses its own `on_error`/`on_deadline`
    edge (the exact bug class Phase 9/10 fixed for the top-level walk).
    """
    executor = NODE_EXECUTORS[node.type]
    started = now_ms()
    if remaining_ms is not None and remaining_ms <= 0:
        logger.warning("GRAPH_CHAIN_BUDGET_EXCEEDED", node_id=node.id, node_type=node.type)
        return (
            NodeResult(
                node_id=node.id,
                node_type=node.type,
                lane=node.lane,
                status="timed_out",
                total_ms=0,
                error_code="CHAIN_BUDGET_EXCEEDED",
            ),
            resolve_on_deadline(node, ctx.nodes_by_id),
        )
    try:
        if remaining_ms is not None:
            result, next_id = await asyncio.wait_for(executor.execute(node, ctx), timeout=remaining_ms / 1000)
        else:
            result, next_id = await executor.execute(node, ctx)
    except LlmUnavailableError:
        raise
    except TimeoutError:
        logger.warning("GRAPH_CHAIN_NODE_CUT_AT_DEADLINE", node_id=node.id, node_type=node.type)
        result = NodeResult(
            node_id=node.id,
            node_type=node.type,
            lane=node.lane,
            status="timed_out",
            total_ms=now_ms() - started,
            error_code="CHAIN_BUDGET_EXCEEDED",
        )
        next_id = resolve_on_deadline(node, ctx.nodes_by_id)
    except Exception:  # noqa: BLE001 - captured as a node failure, never crashes the chain
        logger.exception("GRAPH_CHAIN_NODE_FAILED", node_id=node.id, node_type=node.type)
        result = NodeResult(
            node_id=node.id,
            node_type=node.type,
            lane=node.lane,
            status="failed",
            total_ms=now_ms() - started,
            error_code="NODE_ERROR",
        )
        next_id = resolve_on_error(node, ctx.nodes_by_id)
    return result, next_id


async def walk_chain(
    start_id: str | None, ctx: TurnContext, *, budget_ms: float | None = None, max_steps: int = MAX_CHAIN_STEPS
) -> ChainResult:
    """Walks a bounded node chain starting at `start_id` until it naturally
    terminates (a node whose own next-hop is `None` — the same "dangling
    next_node_id" terminal convention the top-level foreground walk uses,
    scoped here to one branch/loop-body pass), `max_steps` is hit, or
    `budget_ms` (this chain's *own* deadline, independent of the outer turn
    budget) elapses. Recurses through `NODE_EXECUTORS` for every node type,
    including nested `parallel`/`loop` nodes — this is what makes "a branch
    may itself contain any node type, including nested Router/Parallel/Loop"
    work.

    The *outer* turn-level deadline is not this function's concern: when a
    Parallel/Loop node is itself reached from the top-level foreground walk,
    `interpreter.py`'s existing `asyncio.wait_for(executor.execute(node,
    ctx), timeout=remaining_ms / 1000)` already wraps *any* node type's
    whole `execute()` call — including a Parallel/Loop node's — so the
    outer budget is enforced generically, with zero changes needed here.
    """
    deadline_at = now_ms() + budget_ms if budget_ms is not None else None
    trace: list[NodeResult] = []
    last_output: str | None = None
    current_id = start_id
    steps = 0
    while current_id is not None and steps < max_steps:
        steps += 1
        node = ctx.nodes_by_id.get(current_id)
        if node is None:
            logger.warning("GRAPH_CHAIN_NODE_MISSING", node_id=current_id)
            break
        remaining = (deadline_at - now_ms()) if deadline_at is not None else None
        result, next_id = await execute_one_node(node, ctx, remaining_ms=remaining)
        trace.append(result)
        # R-G9/BL-039 — every node execution is recorded on the session,
        # including one reached only inside a Parallel branch or Loop body
        # (not just the top-level foreground/background walks, which record
        # this same way in `interpreter.py`). Without this, the session
        # detail node trace would be blind to everything that happens inside
        # a branch/loop-body pass — a real debugging gap for exactly the
        # graphs this phase introduces.
        ctx.hop_recorder.record(
            HopItem(
                utterance_seq=ctx.utterance_seq,
                hop="node",
                node_id=result.node_id,
                node_type=result.node_type,
                lane=result.lane,
                total_ms=result.total_ms,
                error_code=result.error_code,
                provider_key=result.provider_key,
                used_fallback=result.used_fallback,
                first_token_ms=result.first_token_ms,
            )
        )
        if result.output_text is not None:
            last_output = result.output_text
        current_id = next_id
    return ChainResult(trace=trace, last_output_text=last_output)
