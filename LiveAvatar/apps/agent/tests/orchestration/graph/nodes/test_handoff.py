"""Unit tests for `HandoffNodeExecutor` (Phase 15, BL-059) — a terminal node
that fires an alert and sets a `turn_state` marker, never disconnects
anything itself. Mirrors `test_end.py`'s terminal-no-op style plus
`test_hitl.py`'s fake-port-with-call-log style for the alert assertion.
"""

from __future__ import annotations

from uuid import uuid4

from avatar_agent.contracts.runtime_config import HandoffNode
from avatar_agent.orchestration.graph.ir import TurnContext
from avatar_agent.orchestration.graph.nodes.handoff import HandoffNodeExecutor
from avatar_agent.residency.filter import ResidencyPayload


def make_handoff_node(
    *, node_id: str = "handoff-1", destination: str = "billing-queue", context_summary: str = "Caller wants a refund."
) -> HandoffNode:
    return HandoffNode.model_validate(
        {
            "id": node_id,
            "type": "handoff",
            "name": "Transfer to human",
            "lane": "foreground",
            "on_error": {"action": "end_turn"},
            "on_deadline": {"action": "end_turn"},
            "destination": destination,
            "context_summary": context_summary,
        }
    )


class FakeAlertPort:
    def __init__(self, *, raises: bool = False) -> None:
        self._raises = raises
        self.calls: list[tuple] = []

    async def send_alert(self, *, tenant_id, alert_type, message):  # noqa: ANN001
        self.calls.append((tenant_id, alert_type, message))
        if self._raises:
            raise RuntimeError("simulated alert delivery failure")


class _NullHopRecorder:
    def record(self, item) -> None:  # noqa: ANN001
        pass

    async def flush(self) -> None:
        pass


def make_ctx(*, alert_port=None, tenant_id=None) -> TurnContext:  # noqa: ANN001
    async def _speak(text: str) -> None:  # pragma: no cover - Handoff nodes never speak
        raise AssertionError("HandoffNodeExecutor must never call ctx.speak")

    return TurnContext(
        session_id=uuid4(),
        tenant_id=tenant_id if tenant_id is not None else uuid4(),
        utterance_seq=1,
        llm_by_node={},
        tool_definitions_by_api_ref={},
        tools_by_name={},
        tool_specs=[],
        tool_executor=object(),
        residency=ResidencyPayload(system_prompt="sys", messages=()),
        turn_state={},
        speak=_speak,
        hop_recorder=_NullHopRecorder(),
        alert_port=alert_port,
    )


# --- happy path -------------------------------------------------------------


async def test_handoff_is_terminal_and_never_speaks() -> None:
    node = make_handoff_node()
    ctx = make_ctx(alert_port=FakeAlertPort())

    result, next_id = await HandoffNodeExecutor().execute(node, ctx)

    assert result.status == "complete"
    assert result.node_type == "handoff"
    assert next_id is None  # terminal, like EndNode — no next_node_id to continue to


async def test_handoff_sets_a_turn_state_marker() -> None:
    node = make_handoff_node()
    ctx = make_ctx(alert_port=FakeAlertPort())

    await HandoffNodeExecutor().execute(node, ctx)

    assert ctx.turn_state["handoff-1"] == "handed_off"


async def test_handoff_fires_an_alert_built_from_destination_and_context_summary() -> None:
    tenant_id = uuid4()
    port = FakeAlertPort()
    node = make_handoff_node(destination="billing-queue", context_summary="Caller wants a refund exceeding authority.")
    ctx = make_ctx(alert_port=port, tenant_id=tenant_id)

    await HandoffNodeExecutor().execute(node, ctx)

    assert len(port.calls) == 1
    called_tenant_id, called_type, called_message = port.calls[0]
    assert called_tenant_id == tenant_id
    assert called_type == "handoff_requested"
    assert "billing-queue" in called_message
    assert "Caller wants a refund exceeding authority." in called_message


# --- best-effort alert delivery: never fails the handoff itself ------------


async def test_missing_alert_port_does_not_fail_the_node() -> None:
    node = make_handoff_node()
    ctx = make_ctx(alert_port=None)

    result, next_id = await HandoffNodeExecutor().execute(node, ctx)

    assert result.status == "complete"
    assert next_id is None
    assert ctx.turn_state["handoff-1"] == "handed_off"


async def test_alert_delivery_failure_does_not_fail_the_node() -> None:
    node = make_handoff_node()
    ctx = make_ctx(alert_port=FakeAlertPort(raises=True))

    result, next_id = await HandoffNodeExecutor().execute(node, ctx)

    assert result.status == "complete"
    assert next_id is None
    assert ctx.turn_state["handoff-1"] == "handed_off"
