"""`ExecuteFlowStep` — direct tests for the two behaviours `test_process_turn.py`'s
escape/resume tests don't reach on their own: `ToolCall`'s retry-then-fall-through
(FR-FLOW-05) and `Handover`'s trigger (FR-FLOW-06)."""

from __future__ import annotations

import pytest

from shj3_ai.application.execute_flow import ExecuteFlowStep, FlowRunOutcome
from shj3_ai.domain.flows import FlowDefinition, FlowNodeDef, FlowNodeType, FlowState
from shj3_ai.domain.identity import AssuranceLevel
from shj3_ai.ports.config_reader import ToolBindingRow
from shj3_ai.ports.tool_invoker import ToolInvocationOutcome, ToolInvocationResult
from tests.application.orchestration_fakes import FakeToolInvoker


def _tool_call_definition(*, on_failure_key: str = "handover") -> FlowDefinition:
    nodes = {
        "get_bill": FlowNodeDef(
            id="n1",
            key="get_bill",
            type=FlowNodeType.TOOL_CALL,
            retry_count=1,
            on_failure_node_key=on_failure_key,
            tool_binding_id="tb1",
        ),
        "handover": FlowNodeDef(id="n2", key="handover", type=FlowNodeType.HANDOVER),
        "confirm": FlowNodeDef(id="n3", key="confirm", type=FlowNodeType.MESSAGE),
    }
    return FlowDefinition("fv1", "get_bill", None, True, nodes, {})


def _binding(required_assurance: str = "Anonymous") -> ToolBindingRow:
    return ToolBindingRow(
        tool_binding_id="tb1",
        target_kind="Skill",
        is_enabled=True,
        # `RequiredAssuranceLevel`'s real, closed vocabulary (`CK_ToolBindings_
        # requiredAssurance`) is `Anonymous`|`Verified`|`VerifiedPlusOtp`|
        # `VerifiedPlusDocument` — NOT the `L0`-`L3` rank scale
        # `Principal.assurance` uses. This fixture used to say `"L0"`, the
        # exact enum-vs-rank mismatch B-5 flagged and B-8 reconciles
        # (`domain/identity.py`); harmless before B-8's gate existed (nothing
        # read this field), but `required_level_to_assurance("L0")` raises
        # `KeyError` now that it does.
        required_assurance=required_assurance,
        skill_key="get_bill_status",
        skill_name="Get bill status",
        skill_input_schema_json="{}",
        skill_invocation_kind="Native",
        api_connector_id=None,
        circuit_breaker_target_kind=None,
        circuit_breaker_target_ref=None,
    )


class TestRetryThenFallThrough:
    @pytest.mark.asyncio
    async def test_two_consecutive_failures_retry_exactly_once_then_fall_through(self) -> None:
        failing_result = ToolInvocationResult(
            outcome=ToolInvocationOutcome.TIMEOUT,
            result_json=None,
            error="timed out",
            duration_ms=5,
        )
        tool_invoker = FakeToolInvoker(results={"get_bill_status": failing_result})
        step = ExecuteFlowStep(tool_invoker)
        definition = _tool_call_definition(on_failure_key="handover")
        state = FlowState(flow_version_id="fv1", current_node_key="get_bill")

        result = await step.execute(
            definition=definition,
            state=state,
            user_text="check my bill",
            tool_bindings_by_id={"tb1": _binding()},
            starting_ordinal=0,
        )

        # Exactly two attempts — never three (FR-FLOW-05's own acceptance bar).
        assert len(tool_invoker.invocations) == 2
        tool_call_steps = [s for s in result.steps if s.kind.value == "ToolCall"]
        assert len(tool_call_steps) == 2
        assert all(s.status.value == "Timeout" for s in tool_call_steps)
        # Falls through to the configured failure node rather than terminating.
        assert result.outcome == FlowRunOutcome.HANDOVER
        # FR-FLOW-12: a tool-call-failed-twice handover carries "ToolFailure",
        # not the node's own generic default.
        assert result.handover_reason == "ToolFailure"

    @pytest.mark.asyncio
    async def test_a_success_on_the_first_attempt_needs_no_retry(self) -> None:
        ok_result = ToolInvocationResult(
            outcome=ToolInvocationOutcome.OK,
            result_json='{"amountDueAed": 250}',
            error=None,
            duration_ms=5,
        )
        tool_invoker = FakeToolInvoker(results={"get_bill_status": ok_result})
        step = ExecuteFlowStep(tool_invoker)
        definition = _tool_call_definition(on_failure_key="confirm")
        state = FlowState(flow_version_id="fv1", current_node_key="get_bill")

        result = await step.execute(
            definition=definition,
            state=state,
            user_text="check my bill",
            tool_bindings_by_id={"tb1": _binding()},
            starting_ordinal=0,
        )

        assert len(tool_invoker.invocations) == 1
        assert result.outcome == FlowRunOutcome.COMPLETED


class TestHandoverTrigger:
    @pytest.mark.asyncio
    async def test_a_handover_node_triggers_directly(self) -> None:
        nodes = {"handover": FlowNodeDef(id="n1", key="handover", type=FlowNodeType.HANDOVER)}
        definition = FlowDefinition("fv1", "handover", None, True, nodes, {})
        state = FlowState(flow_version_id="fv1", current_node_key="handover")
        step = ExecuteFlowStep(FakeToolInvoker())

        result = await step.execute(
            definition=definition,
            state=state,
            user_text="I need help",
            tool_bindings_by_id={},
            starting_ordinal=0,
        )

        assert result.outcome == FlowRunOutcome.HANDOVER
        handover_steps = [s for s in result.steps if s.kind.value == "Handover"]
        assert len(handover_steps) == 1


class TestStepUpGate:
    """B-8: a `ToolCall` node's required assurance is evaluated BEFORE the
    tool call, never after (api.md §3.5, B11 tab 2's `[rule]`) — proven here
    the same way FR-FLOW-05's retry contract is proven above: real gate,
    real fake tool invoker, asserting the invoker was never called at all."""

    @pytest.mark.asyncio
    async def test_a_tool_call_below_the_bound_tools_required_level_is_blocked_pre_execution(
        self,
    ) -> None:
        tool_invoker = FakeToolInvoker()
        step = ExecuteFlowStep(tool_invoker)
        definition = _tool_call_definition(on_failure_key="confirm")
        state = FlowState(flow_version_id="fv1", current_node_key="get_bill")

        result = await step.execute(
            definition=definition,
            state=state,
            user_text="check my bill",
            tool_bindings_by_id={"tb1": _binding(required_assurance="VerifiedPlusOtp")},
            starting_ordinal=0,
            held_assurance=AssuranceLevel.L0,
        )

        # The gate, proven the only way that matters: the tool was never invoked.
        assert tool_invoker.invocations == []
        assert result.outcome == FlowRunOutcome.STEP_UP_REQUIRED
        assert result.required_assurance == AssuranceLevel.L2
        # The flow's position is preserved exactly — a pause, not a failure,
        # so retrying after step-up resumes at the very same node.
        assert result.state.current_node_key == "get_bill"
        blocked_steps = [s for s in result.steps if s.kind.value == "ToolCall"]
        assert len(blocked_steps) == 1
        assert blocked_steps[0].status.value == "Blocked"
        assert blocked_steps[0].error_code == "authz.assurance_insufficient"
        assert blocked_steps[0].tool_binding_id == "tb1"

    @pytest.mark.asyncio
    async def test_the_same_tool_call_succeeds_once_the_required_level_is_held(self) -> None:
        ok_result = ToolInvocationResult(
            outcome=ToolInvocationOutcome.OK,
            result_json='{"amountDueAed": 250}',
            error=None,
            duration_ms=5,
        )
        tool_invoker = FakeToolInvoker(results={"get_bill_status": ok_result})
        step = ExecuteFlowStep(tool_invoker)
        definition = _tool_call_definition(on_failure_key="confirm")
        state = FlowState(flow_version_id="fv1", current_node_key="get_bill")

        result = await step.execute(
            definition=definition,
            state=state,
            user_text="check my bill",
            tool_bindings_by_id={"tb1": _binding(required_assurance="VerifiedPlusOtp")},
            starting_ordinal=0,
            held_assurance=AssuranceLevel.L2,
        )

        assert len(tool_invoker.invocations) == 1
        assert result.outcome == FlowRunOutcome.COMPLETED

    @pytest.mark.asyncio
    async def test_a_nodes_own_override_is_stricter_than_the_bindings_floor(self) -> None:
        # The binding itself only asks for `Verified` (L1); the flow author
        # configured this specific node to require the document-check level.
        # `_required_assurance_for`'s own doc comment names this as the
        # directionally sensible reading of "which wins."
        nodes = {
            "get_bill": FlowNodeDef(
                id="n1",
                key="get_bill",
                type=FlowNodeType.TOOL_CALL,
                retry_count=1,
                on_failure_node_key="confirm",
                tool_binding_id="tb1",
                required_assurance="VerifiedPlusDocument",
            ),
            "confirm": FlowNodeDef(id="n3", key="confirm", type=FlowNodeType.MESSAGE),
        }
        definition = FlowDefinition("fv1", "get_bill", None, True, nodes, {})
        state = FlowState(flow_version_id="fv1", current_node_key="get_bill")
        tool_invoker = FakeToolInvoker()
        step = ExecuteFlowStep(tool_invoker)

        result = await step.execute(
            definition=definition,
            state=state,
            user_text="check my bill",
            tool_bindings_by_id={"tb1": _binding(required_assurance="Verified")},
            starting_ordinal=0,
            held_assurance=AssuranceLevel.L1,  # satisfies the binding, not the node
        )

        assert tool_invoker.invocations == []
        assert result.outcome == FlowRunOutcome.STEP_UP_REQUIRED
        assert result.required_assurance == AssuranceLevel.L3

    @pytest.mark.asyncio
    async def test_a_binding_not_found_is_reported_as_missing_never_as_a_step_up_pause(
        self,
    ) -> None:
        # The pre-existing `tool_binding_not_found` path (binding disabled or
        # removed since the flow was authored) must not be reinterpreted as a
        # step-up pause just because this wave added a second early-return
        # branch to the same `if`/`elif`/`else` chain.
        step = ExecuteFlowStep(FakeToolInvoker())
        definition = _tool_call_definition(on_failure_key="confirm")
        state = FlowState(flow_version_id="fv1", current_node_key="get_bill")

        result = await step.execute(
            definition=definition,
            state=state,
            user_text="check my bill",
            tool_bindings_by_id={},  # tb1 not found
            starting_ordinal=0,
            held_assurance=AssuranceLevel.L0,
        )

        assert result.outcome == FlowRunOutcome.COMPLETED
        failed_steps = [s for s in result.steps if s.kind.value == "ToolCall"]
        assert failed_steps[0].error_code == "tool_binding_not_found"
