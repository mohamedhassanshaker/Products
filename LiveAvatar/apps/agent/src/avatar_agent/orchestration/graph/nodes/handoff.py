"""Handoff node executor (Phase 15, BL-059; `ARCHITECTURE_NOTES.md` §3.2) —
"transfer to a human." v1 ships intent only: record the handoff (fires an
alert reusing the existing `POST /internal/alerts` endpoint, new `AlertType`
value `handoff_requested` — no new endpoint), transition session-scoped
state (a `turn_state` marker). Real PSTN/SIP transfer mechanics are out of
scope (BACKLOG BL-059).

**Terminal, exactly like `EndNode`** (see `nodes/end.py`) — `HandoffNode`
deliberately has no `next_node_id` field at all (once control leaves the AI
there is nothing left for this turn's graph walk to do). This executor does
**not** disconnect the LiveKit session/room itself — it only ends this
turn's graph walk, the same scope `end.py` already has; real transfer is a
telephony-integration decision this phase does not make.

**Judgment call — the `turn_state` marker's exact shape**: `turn_state[node
.id] = "handed_off"`, mirroring every other node type's own
`turn_state[node.id]` output convention (a downstream Router branch, if
this node somehow weren't terminal on some future path, could reference it
the same way any other node's output is already referenceable via
`$<node_id>`). A bare string is enough for v1 — there is no further
business logic for this executor to encode beyond "a handoff was
requested"; a richer structured record (destination, summary, timestamp)
would be speculative given `HandoffNode` has no downstream consumer this
phase.

**Judgment call — alert delivery never fails the node.** `ControlPlaneClient
.send_alert` is already best-effort (buffered/retried, "telemetry loss is
preferred over dropping a live call" — that module's own docstring); the
broad `except Exception` here is defense-in-depth for a fake/test `IAlertPort`
implementation, not a real expected failure mode. A missing `alert_port` or
an alert-delivery failure is logged and otherwise ignored — `HandoffNode`
has no on_error-reachable alternative next step (it is terminal, exactly
like `EndNode`, which also never fails), so there is nothing more useful for
an `on_error` edge to route to here.
"""

from __future__ import annotations

import structlog

from avatar_agent.contracts.internal_api import AlertType
from avatar_agent.contracts.runtime_config import GraphNode, HandoffNode
from avatar_agent.orchestration.graph.ir import NodeResult, TurnContext
from avatar_agent.telemetry.control_plane import now_ms

logger = structlog.get_logger(__name__)

_ALERT_TYPE: AlertType = "handoff_requested"


class HandoffNodeExecutor:
    """`NodeExecutor` for `type: handoff` nodes."""

    async def execute(self, node: GraphNode, ctx: TurnContext) -> tuple[NodeResult, str | None]:
        # See `LlmNodeExecutor.execute`'s comment: `GraphNode` (not
        # `HandoffNode`) to structurally satisfy the `NodeExecutor` Protocol.
        assert isinstance(node, HandoffNode)
        started = now_ms()

        # "Transition session-scoped state" (`ARCHITECTURE_NOTES.md` §3.2) —
        # see this module's docstring for the exact-shape judgment call.
        ctx.turn_state[node.id] = "handed_off"

        if ctx.alert_port is None:
            logger.warning("HANDOFF_ALERT_PORT_UNAVAILABLE", node_id=node.id)
        else:
            try:
                await ctx.alert_port.send_alert(
                    tenant_id=ctx.tenant_id,
                    alert_type=_ALERT_TYPE,
                    message=f"Handoff requested to '{node.destination}': {node.context_summary}",
                )
            except Exception:  # noqa: BLE001 - see this module's docstring: alert delivery must never fail the handoff itself
                logger.warning("HANDOFF_ALERT_FAILED", node_id=node.id, destination=node.destination)

        return (
            NodeResult(
                node_id=node.id,
                node_type="handoff",
                lane=node.lane,
                status="complete",
                total_ms=now_ms() - started,
                output_text="handed_off",
            ),
            None,
        )
