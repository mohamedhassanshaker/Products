"""Hitl node executor (Phase 14, BL-052..057; `ARCHITECTURE_NOTES.md` §6;
`AgentBuilder_Reasoning_Skills_RAG_Orchestration_HITL.md` §A8) — pauses the
live turn at a `HitlGate` (referenced by `gate_id`, never inlined — mirrors
`ToolNode.api_ref`/`SkillNode.skill_id`'s by-reference convention), speaks
the mandatory hold treatment (R-H5), and short-polls for the reviewer's
decision (`ARCHITECTURE_NOTES.md` §6.2 point 3 — no push channel from the
control plane back to this process exists yet).

**v1 scope decisions** (this phase's judgment calls, documented here rather
than silently baked in):

1. **`proposed_action` is always a minimal `spoken_text` summary.** At the
   point a `hitl`-type node is actually reached, this codebase has no
   general notion of "the tool call or spoken text this gate is reviewing"
   attached to the node itself (unlike, say, a Tool node's own `api_ref`/
   `argument_mapping`) — that association lives server-side, on the
   `HitlGate` row's own `attachment_kind`/`attachment_ref`
   (`ARCHITECTURE_NOTES.md` §6.1), which this executor never needs to read
   (it only needs `gate_id` to create the decision). The best turn-local
   signal of "what the agent is about to do" is
   `ctx.turn_state["_last_llm_output"]` — the same value a downstream
   `speak`-type node (`mode: llm_output`) would otherwise speak — falling
   back to the caller's own utterance when no LLM/Skill node has run yet
   this turn. A future phase that wants a real `tool_call`-shaped
   `proposed_action` (arguments included) would need a Tool-node-adjacent
   placement convention this phase doesn't introduce.
2. **Hold treatment doubles as the periodic reassurance text.** The two
   HTTP endpoints this phase is given resolve exactly one spoken string
   server-side (`HitlDecisionCreated.hold_treatment_text`) — not the
   builder wireframe's separate "on entry" vs. "every N s" hold copy
   (`AgentBuilder_...HITL.md` §A8.4, which lives on fields of `HitlGate`
   this phase's two endpoints don't expose). Rather than fabricating a
   second string with no server-side source of truth, this executor speaks
   the same `hold_treatment_text` both at gate-entry and on every
   reassurance tick — still satisfies R-H5's actual requirement (the
   caller is told what/roughly how long, and silence is never used).
3. **Reassurance cadence: every 15s.** Neither R-H5 nor its surrounding
   prose pins an exact interval, but §A8.4's own wireframe for this exact
   field ("every [ 15 ] s") gives a concrete example value — used verbatim
   here rather than inventing an unrelated number.
4. **`denied`/`timed_out`/`escalated`/`deferred` are not business logic
   here.** This executor's only job is to report the decision accurately
   (R-H6's whole point is that a human can override the agent) — what a
   `denied` or deferred outcome *means* for the conversation is ordinary
   downstream graph wiring (e.g. a Router node branching on
   `$<this-node-id>`, the same convention `ToolNode`'s own output already
   supports), not hardcoded here. `denied` is reported via ordinary
   `next_node_id` routing (a live human decision, not a node failure);
   `timed_out`/`escalated`/`deferred` (the gate's own SLA path, no live
   reviewer reached in time) route via `on_deadline`, mirroring
   `registry.execute_one_node`'s own `CHAIN_BUDGET_EXCEEDED` precedent for
   "a deadline was hit" vs. `on_error`'s "the node itself broke".
5. **Caller disconnect mid-wait relies on existing cancellation, not a new
   hook.** `entrypoint.handle_job`'s teardown already cancels the whole
   in-flight `_process_utterance` task (`consumer_task.cancel()`) the
   instant `ctx.room.disconnected` fires, before sending the terminal
   `"ended"` session event. `asyncio.CancelledError` is a `BaseException`,
   not an `Exception` — it is never caught by this module's own broad
   `except Exception` blocks (the poll loop's transient-failure handling
   included), so a disconnect mid-wait unwinds this executor immediately
   rather than continuing to poll a dead session. Finalizing the orphaned
   `HitlDecision` row itself (R-H10's caller-abandonment metric) is
   necessarily server-side — the two-endpoint contract this phase is given
   has no agent-initiated "abandon" call, and `ARCHITECTURE_NOTES.md` §6.2
   point 5 already assigns this to "existing session/transport disconnect
   handling", which already receives that same `"ended"` event on the
   control-plane side. No new Python-side callback is added here — flagged
   as a scope boundary in this task's final report, not an oversight.
"""

from __future__ import annotations

import asyncio
import contextlib

import structlog

from avatar_agent.contracts.runtime_config import GraphNode, HitlNode
from avatar_agent.orchestration.graph.edges import resolve_on_deadline, resolve_on_error
from avatar_agent.orchestration.graph.ir import NodeResult, TurnContext
from avatar_agent.ports.orchestration import HitlDecisionRecord, HitlProposedAction, IHitlDecisionPort
from avatar_agent.telemetry.control_plane import now_ms

logger = structlog.get_logger(__name__)

# ARCHITECTURE_NOTES.md §6.2 point 3: "every ~1-2s" — the midpoint of that
# range. Against a typical 30-45s SLA this poll latency is immaterial (the
# same doc's own observation).
_POLL_INTERVAL_S = 1.5

# See this module's docstring, decision #3.
_REASSURANCE_INTERVAL_S = 15.0

_TERMINAL_LIVE_DECISIONS = ("approved", "denied", "edited_approved")
_TERMINAL_SLA_DECISIONS = ("timed_out", "escalated", "deferred")


def _failure(node: HitlNode, started: int, error_code: str) -> tuple[NodeResult, str | None]:
    return (
        NodeResult(
            node_id=node.id,
            node_type="hitl",
            lane=node.lane,
            status="failed",
            total_ms=now_ms() - started,
            error_code=error_code,
        ),
        resolve_on_error(node),
    )


async def _reassurance_loop(ctx: TurnContext, text: str) -> None:
    """Speaks `text` again every `_REASSURANCE_INTERVAL_S` until cancelled —
    R-H5's "silence during an approval is never acceptable". Runs as a
    detached task alongside `_await_decision` below; `HitlNodeExecutor
    .execute`'s own `finally` always cancels it once the wait ends, one way
    or another, so it never outlives the node it belongs to.
    """
    if not text:
        return
    while True:
        await asyncio.sleep(_REASSURANCE_INTERVAL_S)
        await ctx.speak(text)


async def _await_decision(port: IHitlDecisionPort, decision_id: str, sla_seconds: int) -> HitlDecisionRecord | None:
    """Short-polls `get_decision` every `_POLL_INTERVAL_S` until it leaves
    `pending`, or `sla_seconds` elapses (`ARCHITECTURE_NOTES.md` §6.2 point
    3's locally-tracked deadline — defense-in-depth; a server-side
    `hitl-sla-sweep` job is the real enforcement, not built here). Returns
    `None` on that local deadline.

    A transient poll failure is logged and retried, not treated as fatal —
    a single flaky request must never cut short an otherwise-live approval
    wait; `sla_seconds` still bounds how long a genuinely broken port can
    spin here.
    """
    deadline_ms = now_ms() + sla_seconds * 1000
    while now_ms() < deadline_ms:
        await asyncio.sleep(_POLL_INTERVAL_S)
        try:
            record = await port.get_decision(decision_id)
        except Exception:  # noqa: BLE001 - one bad poll must not abort the whole wait; see docstring
            logger.warning("HITL_DECISION_POLL_FAILED", decision_id=decision_id)
            continue
        if record.decision != "pending":
            return record
    return None


class HitlNodeExecutor:
    """`NodeExecutor` for `type: hitl` nodes."""

    async def execute(self, node: GraphNode, ctx: TurnContext) -> tuple[NodeResult, str | None]:
        # See `LlmNodeExecutor.execute`'s comment: `GraphNode` (not
        # `HitlNode`) to structurally satisfy the `NodeExecutor` Protocol.
        assert isinstance(node, HitlNode)
        started = now_ms()

        if ctx.hitl_decision_port is None:
            logger.warning("HITL_DECISION_PORT_UNAVAILABLE", node_id=node.id)
            return _failure(node, started, "HITL_DECISION_PORT_UNAVAILABLE")

        # See this module's docstring, decision #1.
        last_output = ctx.turn_state.get("_last_llm_output")
        utterance = ctx.turn_state.get("utterance")
        if isinstance(last_output, str) and last_output:
            summary = last_output
        elif isinstance(utterance, str):
            summary = utterance
        else:
            summary = ""
        proposed_action = HitlProposedAction(kind="spoken_text", summary=summary)

        try:
            created = await ctx.hitl_decision_port.create_decision(
                tenant_id=ctx.tenant_id,
                session_id=ctx.session_id,
                gate_id=node.gate_id,
                utterance_seq=ctx.utterance_seq,
                proposed_action=proposed_action,
            )
        except Exception:  # noqa: BLE001 - a create failure is a recognized node failure, not a crash
            logger.warning("HITL_DECISION_CREATE_FAILED", node_id=node.id, gate_id=node.gate_id)
            return _failure(node, started, "HITL_DECISION_UNAVAILABLE")

        # R-H5: the caller is told what's being waited on before anything
        # else happens — the exact same `ctx.speak()` mechanism `speak.py`
        # uses, not a reimplementation of it.
        if created.hold_treatment_text:
            await ctx.speak(created.hold_treatment_text)
            ctx.spoken = True

        reassurance_task = asyncio.ensure_future(_reassurance_loop(ctx, created.hold_treatment_text))
        try:
            record = await _await_decision(ctx.hitl_decision_port, created.id, created.sla_seconds)
        finally:
            reassurance_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await reassurance_task

        if record is None:
            logger.warning("HITL_POLL_DEADLINE_EXCEEDED", node_id=node.id, decision_id=created.id)
            ctx.turn_state[node.id] = "timed_out"
            return (
                NodeResult(
                    node_id=node.id,
                    node_type="hitl",
                    lane=node.lane,
                    status="timed_out",
                    total_ms=now_ms() - started,
                    output_text="timed_out",
                    error_code="HITL_POLL_DEADLINE_EXCEEDED",
                ),
                resolve_on_deadline(node),
            )

        # Downstream Router/Tool nodes reference this node's outcome the
        # same way they already reference a Tool/Skill node's own output
        # (`nodes/tool.py`'s `_resolve_arguments`, the condition grammar's
        # `$<node_id>` lookups) — see this module's docstring, decision #4.
        ctx.turn_state[node.id] = record.decision
        if record.decision == "edited_approved" and record.edited_arguments is not None:
            ctx.turn_state[f"{node.id}.edited_arguments"] = record.edited_arguments

        if record.decision in _TERMINAL_LIVE_DECISIONS:
            return (
                NodeResult(
                    node_id=node.id,
                    node_type="hitl",
                    lane=node.lane,
                    status="complete",
                    total_ms=now_ms() - started,
                    output_text=record.decision,
                ),
                node.next_node_id,
            )

        # `timed_out` / `escalated` / `deferred` (`_TERMINAL_SLA_DECISIONS`)
        # — the gate's own SLA path was taken server-side, not a node
        # -execution failure — same `on_deadline`-not-`on_error` treatment
        # `registry.execute_one_node`'s own `CHAIN_BUDGET_EXCEEDED` case
        # gives a chain-level deadline miss.
        return (
            NodeResult(
                node_id=node.id,
                node_type="hitl",
                lane=node.lane,
                status="timed_out",
                total_ms=now_ms() - started,
                output_text=record.decision,
                error_code=f"HITL_{record.decision.upper()}",
            ),
            resolve_on_deadline(node),
        )
