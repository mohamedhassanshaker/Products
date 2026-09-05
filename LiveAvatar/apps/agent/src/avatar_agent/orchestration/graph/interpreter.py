"""The multi-node graph interpreter (Phase 9, BL-036; deadline enforcement
Phase 10, BL-041) — walks a `GraphDefinition` (the Pydantic `reasoning`
mirror), implementing the A3.4 node execution state machine and R-G2's lane
separation. Replaces today's "graph" (a single node wrapping
`failover.py`'s retry logic) with a real interpreter both
`LangGraphOrchestrator` and `PydanticAiOrchestrator` wrap
(`graph_langgraph.py`/`graph_pydantic_ai.py`), exactly as they wrap
`run_with_failover` today.

**Lane separation** (R-G2, UC-G2): background nodes are **not** spliced
into the foreground `next_node_id` chain — they are separate entry points
(`GraphDefinition.background_entry_node_ids`), scheduled as detached
`asyncio.create_task`s once the foreground path finishes (after it has
spoken, or reached an explicit `end`), never awaited by the turn. See the
plan doc's "Decisions made this phase" for why.

**Deadline degradation (R-G13, Phase 10)**: per-node budgets were already
validated at publish time by `critical-path.ts` — this runtime side is
deliberately simpler, per `ARCHITECTURE_NOTES.md` §3.3: track cumulative
elapsed wall-clock time since the turn started, and once a foreground
node's execution would (or does) cross `graph.turn_budget_ms`, cut it and
take its `on_deadline` edge. No live re-run of the build-time algorithm.
Only the *hard* deadline is implemented — see the plan doc's "Soft vs. hard
deadline" note for why a distinct soft threshold has nothing to act on yet
(no Parallel/optional-branch concept exists until Phase 11).

**`LlmUnavailableError` is not caught here** — it propagates through
uncaught (see `nodes/llm.py`'s docstring) so `pipeline.py`'s existing
degraded-mode handling keeps working unchanged for the default case.
"""

from __future__ import annotations

import asyncio

import structlog

from avatar_agent.contracts.internal_api import HopItem
from avatar_agent.orchestration.failover import LlmUnavailableError
from avatar_agent.orchestration.graph.edges import resolve_on_deadline, resolve_on_error
from avatar_agent.orchestration.graph.ir import GraphDefinition, GraphNode, GraphRunResult, NodeResult, TurnContext
from avatar_agent.orchestration.graph.registry import NODE_EXECUTORS
from avatar_agent.telemetry.control_plane import now_ms

logger = structlog.get_logger(__name__)

# Defensive bound against an accidental cycle a Router branch could create.
# V-4 (real cycle detection, `graph-rules.ts` / `ReasoningBlock`'s model
# validator) rejects this at publish time as of Phase 11 — this remains a
# runtime backstop, not a substitute for that check (belt-and-suspenders,
# same posture the rest of this package already takes toward its own
# publish-time guarantees).
_MAX_STEPS = 100

# Phase 11 (BL-042/043): the node-type dispatch table now lives in
# `registry.py` (shared with `nodes/parallel.py`/`nodes/loop.py`'s own
# branch/body chain-walking) — `parallel`/`loop` become reachable node types
# from this top-level walk with zero changes to the loop below.
_EXECUTORS = NODE_EXECUTORS


class GraphInterpreter:
    """Stateless — one instance is reused across turns (mirrors
    `LangGraphOrchestrator`/`PydanticAiOrchestrator` being compiled once per
    process).
    """

    async def run(self, graph: GraphDefinition, ctx: TurnContext) -> GraphRunResult:
        nodes_by_id: dict[str, GraphNode] = {n.id: n for n in graph.graph}
        # Phase 11 (BL-042/043): published onto `ctx` (previously a local-
        # only variable) so a Parallel/Loop node executor reached anywhere in
        # this walk — including nested inside another Parallel/Loop's own
        # branch/body — can resolve its branch/body references without
        # widening the `NodeExecutor.execute(node, ctx)` Protocol every
        # existing executor already implements.
        ctx.nodes_by_id = nodes_by_id
        trace: list[NodeResult] = []
        last_llm: NodeResult | None = None
        turn_started = now_ms()
        # R-G13 is a one-shot degradation, not a repeated gate: once a node
        # has been cut for exceeding `turn_budget_ms` and the walk has taken
        # its `on_deadline` edge, every node from there on runs unconstrained
        # by the (already-blown, and only ever growing) elapsed-time check —
        # otherwise the on_deadline destination itself (typically a Speak
        # node delivering "let me follow up") would be immediately re-cut by
        # the same stale check and never get to run, defeating the entire
        # point of having a recovery edge at all.
        deadline_exceeded = False

        current_id: str | None = graph.entry_node_id
        steps = 0
        while current_id is not None and steps < _MAX_STEPS:
            steps += 1
            node = nodes_by_id.get(current_id)
            if node is None:
                logger.warning("GRAPH_NODE_MISSING", node_id=current_id, session_id=str(ctx.session_id))
                break

            executor = _EXECUTORS[node.type]
            started = now_ms()

            # R-G13/R-G14 — deadline enforcement applies only to this node's
            # own foreground-lane budget; a background-lane node reached
            # through the (already anomalous — Gate A doesn't prevent this
            # today) foreground chain is exempt, same exclusion
            # `critical-path.ts` applies at publish time.
            remaining_ms = graph.turn_budget_ms - (started - turn_started)
            if node.lane == "foreground" and not deadline_exceeded and remaining_ms <= 0:
                # The deadline was already crossed before this node could
                # even start — cut it outright, never begin executing it.
                logger.warning("GRAPH_TURN_BUDGET_EXCEEDED", node_id=node.id, node_type=node.type, session_id=str(ctx.session_id))
                deadline_exceeded = True
                result = NodeResult(
                    node_id=node.id,
                    node_type=node.type,
                    lane=node.lane,
                    status="timed_out",
                    total_ms=0,
                    error_code="TURN_BUDGET_EXCEEDED",
                )
                next_id = resolve_on_deadline(node, nodes_by_id)
            else:
                try:
                    if node.lane == "foreground" and not deadline_exceeded:
                        result, next_id = await asyncio.wait_for(executor.execute(node, ctx), timeout=remaining_ms / 1000)
                    else:
                        result, next_id = await executor.execute(node, ctx)
                except LlmUnavailableError:
                    raise  # both LLM legs exhausted — propagate to pipeline.py unchanged
                except TimeoutError:
                    # R-G13 — the node was genuinely cut mid-flight
                    # (`asyncio.wait_for` cancels the underlying task on
                    # timeout): a real "in-flight node cut", not a
                    # between-nodes check that lets a slow node finish anyway.
                    logger.warning(
                        "GRAPH_NODE_CUT_AT_DEADLINE", node_id=node.id, node_type=node.type, session_id=str(ctx.session_id)
                    )
                    deadline_exceeded = True
                    result = NodeResult(
                        node_id=node.id,
                        node_type=node.type,
                        lane=node.lane,
                        status="timed_out",
                        total_ms=now_ms() - started,
                        error_code="TURN_BUDGET_EXCEEDED",
                    )
                    next_id = resolve_on_deadline(node, nodes_by_id)
                except Exception:  # noqa: BLE001 - any other node failure takes on_error, never kills the turn
                    logger.exception("GRAPH_NODE_FAILED", node_id=node.id, node_type=node.type, session_id=str(ctx.session_id))
                    result = NodeResult(
                        node_id=node.id,
                        node_type=node.type,
                        lane=node.lane,
                        status="failed",
                        total_ms=now_ms() - started,
                        error_code="NODE_ERROR",
                    )
                    next_id = resolve_on_error(node, nodes_by_id)

            trace.append(result)
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
            # Phase 13 (BL-049/050/051): a completed Skill node produces the
            # exact same `NodeResult` shape an LLM node does (`output_text`/
            # `provider_key`/`used_fallback`/`first_token_ms`) — tracked
            # here identically so R-G1's implicit "speak the last LLM
            # output, then end" default-case fallback (below) and a
            # downstream `speak`-type node's `mode: llm_output` (which reads
            # `ctx.turn_state["_last_llm_output"]`, set by both node types)
            # both work when a Skill node is the last thing on the
            # foreground path, exactly as they already do for a plain LLM
            # node.
            if node.type in ("llm", "skill") and result.status == "complete":
                last_llm = result

            current_id = next_id
            if current_id is None and node.type not in ("speak", "end") and not ctx.spoken:
                # R-G1 default-case semantics: the foreground chain ran out
                # without an explicit Speak/End node — speak the last LLM
                # node's output, then end (mirrors the pre-Phase-9 pipeline
                # calling `_speak()` unconditionally once per turn).
                if last_llm is not None and last_llm.output_text:
                    await ctx.speak(last_llm.output_text)
                    ctx.spoken = True

        for bg_entry_id in graph.background_entry_node_ids:
            asyncio.create_task(self._run_background_chain(bg_entry_id, nodes_by_id, ctx))

        return GraphRunResult(
            reply_text=last_llm.output_text if last_llm else None,
            provider_key=last_llm.provider_key if last_llm else None,
            used_fallback=last_llm.used_fallback if last_llm else False,
            first_token_ms=last_llm.first_token_ms if last_llm else None,
            spoken=ctx.spoken,
            node_trace=trace,
        )

    async def _run_background_chain(self, entry_id: str, nodes_by_id: dict[str, GraphNode], ctx: TurnContext) -> None:
        """Runs one background-lane chain to completion, detached from the
        turn (UC-G2 — "the CRM write happens afterwards without the caller
        waiting on it"). Failures are logged, never surfaced to the caller.
        """
        current_id: str | None = entry_id
        steps = 0
        while current_id is not None and steps < _MAX_STEPS:
            steps += 1
            node = nodes_by_id.get(current_id)
            if node is None:
                break
            executor = _EXECUTORS[node.type]
            started = now_ms()
            try:
                result, next_id = await executor.execute(node, ctx)
            except Exception:  # noqa: BLE001 - a background failure must never affect the turn
                logger.exception(
                    "GRAPH_BACKGROUND_NODE_FAILED", node_id=node.id, node_type=node.type, session_id=str(ctx.session_id)
                )
                result = NodeResult(
                    node_id=node.id,
                    node_type=node.type,
                    lane=node.lane,
                    status="failed",
                    total_ms=now_ms() - started,
                    error_code="NODE_ERROR",
                )
                next_id = resolve_on_error(node, nodes_by_id)
            ctx.hop_recorder.record(
                HopItem(
                    utterance_seq=ctx.utterance_seq,
                    hop="node",
                    node_id=result.node_id,
                    node_type=result.node_type,
                    lane=result.lane,
                    total_ms=result.total_ms,
                    error_code=result.error_code,
                )
            )
            current_id = next_id
        await ctx.hop_recorder.flush()
