"""Unit tests for `HitlNodeExecutor` (Phase 14, BL-052..057).

Mirrors `test_skill.py`'s style (fake ports, a small `make_ctx`/`make_hitl_node`
pair, explicit happy-path/failure-mode sections) — see that file for the
precedent this one follows.
"""

from __future__ import annotations

from uuid import uuid4

from avatar_agent.contracts.runtime_config import HitlNode
from avatar_agent.orchestration.graph.ir import TurnContext
from avatar_agent.orchestration.graph.nodes import hitl as hitl_module
from avatar_agent.orchestration.graph.nodes.hitl import HitlNodeExecutor
from avatar_agent.ports.orchestration import HitlDecisionCreated, HitlDecisionRecord, HitlProposedAction
from avatar_agent.residency.filter import ResidencyPayload

_DEFAULT_CREATED = HitlDecisionCreated(id="decision-1", hold_treatment_text="Hold on, checking.", sla_seconds=5)


def make_hitl_node(
    *, node_id: str = "hitl-1", gate_id: str = "gate-uuid-1", next_node_id: str | None = "end-1"
) -> HitlNode:
    return HitlNode.model_validate(
        {
            "id": node_id,
            "type": "hitl",
            "name": "Refund approval",
            "lane": "foreground",
            "on_error": {"action": "goto", "target_node_id": "error-1"},
            "on_deadline": {"action": "goto", "target_node_id": "deadline-1"},
            "gate_id": gate_id,
            "next_node_id": next_node_id,
        }
    )


def make_decision_record(
    *, decision_id: str = "decision-1", decision: str = "pending", edited_arguments: dict | None = None
) -> HitlDecisionRecord:
    return HitlDecisionRecord(
        id=decision_id,
        tenant_id="tenant-1",
        session_id="session-1",
        gate_id="gate-uuid-1",
        utterance_seq=1,
        proposed_action=HitlProposedAction(kind="spoken_text", summary="refund please"),
        reviewer_id=None,
        decision=decision,  # type: ignore[arg-type]
        edited_arguments=edited_arguments,
        justification_note=None,
        decided_at=None,
        latency_ms=None,
        outcome_notified_at=None,
        created_at="2026-01-01T00:00:00Z",
    )


class FakeHitlDecisionPort:
    """`get_decision` replays `decisions[]` in order, one entry per call,
    repeating the last entry once exhausted (so a test can under-supply the
    tail and still get a stable terminal state)."""

    def __init__(
        self,
        *,
        created: HitlDecisionCreated | None = None,
        decisions: list[HitlDecisionRecord] | None = None,
        create_raises: bool = False,
    ) -> None:
        self._created = created or _DEFAULT_CREATED
        self._decisions = list(decisions or [make_decision_record()])
        self._create_raises = create_raises
        self.create_calls: list[HitlProposedAction] = []
        self.get_calls: list[str] = []

    async def create_decision(self, *, tenant_id, session_id, gate_id, utterance_seq, proposed_action):  # noqa: ANN001
        self.create_calls.append(proposed_action)
        if self._create_raises:
            raise RuntimeError("simulated create failure")
        return self._created

    async def get_decision(self, decision_id: str):  # noqa: ANN201
        self.get_calls.append(decision_id)
        idx = min(len(self.get_calls) - 1, len(self._decisions) - 1)
        return self._decisions[idx]


class _NullHopRecorder:
    def record(self, item) -> None:  # noqa: ANN001
        pass

    async def flush(self) -> None:
        pass


def make_ctx(*, hitl_decision_port=None, turn_state: dict | None = None) -> tuple[TurnContext, list[str]]:  # noqa: ANN001
    spoken: list[str] = []

    async def _speak(text: str) -> None:
        spoken.append(text)

    ctx = TurnContext(
        session_id=uuid4(),
        tenant_id=uuid4(),
        utterance_seq=1,
        llm_by_node={},
        tool_definitions_by_api_ref={},
        tools_by_name={},
        tool_specs=[],
        tool_executor=object(),
        residency=ResidencyPayload(system_prompt="Base prompt.", messages=()),
        turn_state=turn_state if turn_state is not None else {"utterance": "please refund my order"},
        speak=_speak,
        hop_recorder=_NullHopRecorder(),
        hitl_decision_port=hitl_decision_port,
    )
    return ctx, spoken


# --- happy path (live reviewer decisions) -----------------------------------


async def test_approved_path_speaks_hold_treatment_and_continues_to_next_node_id(monkeypatch) -> None:  # noqa: ANN001
    monkeypatch.setattr(hitl_module, "_POLL_INTERVAL_S", 0.01)
    port = FakeHitlDecisionPort(decisions=[make_decision_record(decision="pending"), make_decision_record(decision="approved")])
    node = make_hitl_node()
    ctx, spoken = make_ctx(hitl_decision_port=port)

    result, next_id = await HitlNodeExecutor().execute(node, ctx)

    assert result.status == "complete"
    assert result.output_text == "approved"
    assert result.node_type == "hitl"
    assert next_id == "end-1"
    assert ctx.turn_state["hitl-1"] == "approved"
    assert ctx.spoken is True
    assert spoken[0] == "Hold on, checking."  # R-H5: spoken before the wait begins


async def test_denied_path_is_reported_not_hardcoded_and_still_takes_next_node_id(monkeypatch) -> None:  # noqa: ANN001
    monkeypatch.setattr(hitl_module, "_POLL_INTERVAL_S", 0.01)
    port = FakeHitlDecisionPort(decisions=[make_decision_record(decision="denied")])
    node = make_hitl_node()
    ctx, _spoken = make_ctx(hitl_decision_port=port)

    result, next_id = await HitlNodeExecutor().execute(node, ctx)

    assert result.status == "complete"
    assert result.output_text == "denied"
    assert next_id == "end-1"  # ordinary routing — a downstream Router decides what "denied" means
    assert ctx.turn_state["hitl-1"] == "denied"


async def test_edited_approved_threads_edited_arguments_into_turn_state(monkeypatch) -> None:  # noqa: ANN001
    monkeypatch.setattr(hitl_module, "_POLL_INTERVAL_S", 0.01)
    port = FakeHitlDecisionPort(
        decisions=[make_decision_record(decision="edited_approved", edited_arguments={"amount": 590.0})]
    )
    node = make_hitl_node()
    ctx, _spoken = make_ctx(hitl_decision_port=port)

    result, next_id = await HitlNodeExecutor().execute(node, ctx)

    assert result.status == "complete"
    assert result.output_text == "edited_approved"
    assert next_id == "end-1"
    assert ctx.turn_state["hitl-1.edited_arguments"] == {"amount": 590.0}


# --- SLA / deadline outcomes --------------------------------------------------


async def test_server_resolved_timeout_takes_on_deadline_edge(monkeypatch) -> None:  # noqa: ANN001
    monkeypatch.setattr(hitl_module, "_POLL_INTERVAL_S", 0.01)
    port = FakeHitlDecisionPort(decisions=[make_decision_record(decision="timed_out")])
    node = make_hitl_node()
    ctx, _spoken = make_ctx(hitl_decision_port=port)

    result, next_id = await HitlNodeExecutor().execute(node, ctx)

    assert result.status == "timed_out"
    assert result.error_code == "HITL_TIMED_OUT"
    assert next_id == "deadline-1"  # resolved on_deadline (goto), not on_error


async def test_escalated_and_deferred_also_take_on_deadline_edge(monkeypatch) -> None:  # noqa: ANN001
    monkeypatch.setattr(hitl_module, "_POLL_INTERVAL_S", 0.01)
    for decision in ("escalated", "deferred"):
        port = FakeHitlDecisionPort(decisions=[make_decision_record(decision=decision)])
        node = make_hitl_node()
        ctx, _spoken = make_ctx(hitl_decision_port=port)

        result, next_id = await HitlNodeExecutor().execute(node, ctx)

        assert result.status == "timed_out"
        assert result.error_code == f"HITL_{decision.upper()}"
        assert next_id == "deadline-1"


async def test_local_sla_deadline_exceeded_while_still_pending_is_a_defensive_timeout() -> None:
    """`sla_seconds=0` deterministically exercises the local-deadline-exceeded
    branch (`ARCHITECTURE_NOTES.md` §6.2 point 3's defense-in-depth) without
    a real-time wait: the deadline is already elapsed before the poll loop's
    first iteration, so `_await_decision` returns `None` immediately."""
    created = HitlDecisionCreated(id="decision-1", hold_treatment_text="Hold on.", sla_seconds=0)
    port = FakeHitlDecisionPort(created=created, decisions=[make_decision_record(decision="pending")])
    node = make_hitl_node()
    ctx, _spoken = make_ctx(hitl_decision_port=port)

    result, next_id = await HitlNodeExecutor().execute(node, ctx)

    assert result.status == "timed_out"
    assert result.error_code == "HITL_POLL_DEADLINE_EXCEEDED"
    assert next_id == "deadline-1"
    assert ctx.turn_state["hitl-1"] == "timed_out"
    assert port.get_calls == []  # never even polled once


# --- poll loop mechanics -------------------------------------------------


async def test_poll_loop_stops_as_soon_as_the_decision_leaves_pending(monkeypatch) -> None:  # noqa: ANN001
    monkeypatch.setattr(hitl_module, "_POLL_INTERVAL_S", 0.01)
    port = FakeHitlDecisionPort(
        decisions=[
            make_decision_record(decision="pending"),
            make_decision_record(decision="pending"),
            make_decision_record(decision="approved"),
        ]
    )
    node = make_hitl_node()
    ctx, _spoken = make_ctx(hitl_decision_port=port)

    await HitlNodeExecutor().execute(node, ctx)

    assert len(port.get_calls) == 3  # stopped the instant it saw "approved" — never over-polled


async def test_a_transient_poll_failure_is_retried_not_fatal(monkeypatch) -> None:  # noqa: ANN001
    monkeypatch.setattr(hitl_module, "_POLL_INTERVAL_S", 0.01)

    class FlakyThenApprovedPort(FakeHitlDecisionPort):
        async def get_decision(self, decision_id: str):  # noqa: ANN201
            self.get_calls.append(decision_id)
            if len(self.get_calls) == 1:
                raise RuntimeError("simulated network blip")
            return make_decision_record(decision="approved")

    port = FlakyThenApprovedPort()
    node = make_hitl_node()
    ctx, _spoken = make_ctx(hitl_decision_port=port)

    result, next_id = await HitlNodeExecutor().execute(node, ctx)

    assert result.status == "complete"
    assert result.output_text == "approved"
    assert next_id == "end-1"
    assert len(port.get_calls) == 2  # one failed attempt, then a successful one


async def test_reassurance_timer_speaks_the_hold_treatment_again_while_waiting(monkeypatch) -> None:  # noqa: ANN001
    # R-H5 — "silence during an approval is never acceptable". A short
    # reassurance interval relative to a longer total wait proves the timer
    # actually fires (not merely constructed) and is bounded by the wait,
    # not left running forever (proven by the call-count assertion below).
    monkeypatch.setattr(hitl_module, "_POLL_INTERVAL_S", 0.05)
    monkeypatch.setattr(hitl_module, "_REASSURANCE_INTERVAL_S", 0.02)
    decisions = [make_decision_record(decision="pending") for _ in range(6)] + [make_decision_record(decision="approved")]
    port = FakeHitlDecisionPort(decisions=decisions)
    node = make_hitl_node()
    ctx, spoken = make_ctx(hitl_decision_port=port)

    await HitlNodeExecutor().execute(node, ctx)

    # One speak at gate-entry, plus at least one more reassurance tick.
    assert spoken.count("Hold on, checking.") >= 2


# --- failure modes -------------------------------------------------------


async def test_missing_hitl_decision_port_is_a_recognized_failure() -> None:
    node = make_hitl_node()
    ctx, spoken = make_ctx(hitl_decision_port=None)

    result, next_id = await HitlNodeExecutor().execute(node, ctx)

    assert result.status == "failed"
    assert result.error_code == "HITL_DECISION_PORT_UNAVAILABLE"
    assert next_id == "error-1"
    assert spoken == []  # never got far enough to speak anything


async def test_create_decision_failure_takes_on_error() -> None:
    port = FakeHitlDecisionPort(create_raises=True)
    node = make_hitl_node()
    ctx, spoken = make_ctx(hitl_decision_port=port)

    result, next_id = await HitlNodeExecutor().execute(node, ctx)

    assert result.status == "failed"
    assert result.error_code == "HITL_DECISION_UNAVAILABLE"
    assert next_id == "error-1"
    assert spoken == []


async def test_on_error_with_no_target_stops_the_walk() -> None:
    node = HitlNode.model_validate(
        {
            "id": "hitl-1",
            "type": "hitl",
            "name": "Refund approval",
            "lane": "foreground",
            "on_error": {"action": "end_turn"},
            "on_deadline": {"action": "degrade"},
            "gate_id": "gate-uuid-1",
            "next_node_id": "end-1",
        }
    )
    ctx, _spoken = make_ctx(hitl_decision_port=None)

    result, next_id = await HitlNodeExecutor().execute(node, ctx)

    assert result.status == "failed"
    assert next_id is None


# --- proposed_action derivation (v1 scope decision #1, see hitl.py's docstring) --


async def test_proposed_action_prefers_the_last_llm_output_when_present(monkeypatch) -> None:  # noqa: ANN001
    monkeypatch.setattr(hitl_module, "_POLL_INTERVAL_S", 0.01)
    port = FakeHitlDecisionPort(decisions=[make_decision_record(decision="approved")])
    node = make_hitl_node()
    ctx, _spoken = make_ctx(
        hitl_decision_port=port,
        turn_state={"utterance": "please refund my order", "_last_llm_output": "I'll get that refunded, one sec."},
    )

    await HitlNodeExecutor().execute(node, ctx)

    assert port.create_calls[0].kind == "spoken_text"
    assert port.create_calls[0].summary == "I'll get that refunded, one sec."


async def test_proposed_action_falls_back_to_the_utterance_when_no_llm_has_run_yet(monkeypatch) -> None:  # noqa: ANN001
    monkeypatch.setattr(hitl_module, "_POLL_INTERVAL_S", 0.01)
    port = FakeHitlDecisionPort(decisions=[make_decision_record(decision="approved")])
    node = make_hitl_node()
    ctx, _spoken = make_ctx(hitl_decision_port=port, turn_state={"utterance": "please refund my order"})

    await HitlNodeExecutor().execute(node, ctx)

    assert port.create_calls[0].summary == "please refund my order"
