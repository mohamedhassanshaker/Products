"""`ExecuteFlowStep` — B7's runtime: walks a `FlowDefinition` from a live
`FlowState` by one logical turn's worth of nodes, using `domain.flows`'s pure
state machine for every decision and `ToolInvoker` for the one node type with a
real side effect (`ToolCall`).

Bounded by `_MAX_NODES_PER_TURN` — a flow that somehow formed a cycle among
`Message`/`Condition` nodes with no `Question`/`ToolCall` node to pause on
cannot spin forever within one turn; it degrades to the free-text escape path
instead, the same way `domain.orchestration.loop_detected` bounds the
agent-hop loop.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum

from shj3_ai.domain.flows import (
    FlowDefinition,
    FlowNodeDef,
    FlowNodeType,
    FlowState,
    apply_free_text_escape,
    fill_slot,
    is_free_text_escape,
    move_to,
    record_tool_retry,
    resolve_default_or_matching_edge,
    should_retry,
)
from shj3_ai.domain.identity import (
    AssuranceLevel,
    required_level_to_assurance,
    satisfies_required_assurance,
)
from shj3_ai.domain.orchestration import TraceStep, TraceStepKind, TraceStepStatus
from shj3_ai.ports.config_reader import ToolBindingRow
from shj3_ai.ports.tool_invoker import ToolInvocationOutcome, ToolInvoker

_MAX_NODES_PER_TURN = 12


class FlowRunOutcome(StrEnum):
    AWAITING_INPUT = "awaiting_input"
    ESCAPED = "escaped"
    HANDOVER = "handover"
    COMPLETED = "completed"
    BUDGET_EXCEEDED = "budget_exceeded"
    #: B-8: a `ToolCall` node's required assurance (the node's own override, or
    #: its bound tool's floor — see `_required_assurance_for` below) is not
    #: satisfied by the conversation's currently-held level. The tool call is
    #: never attempted — this is api.md §3.5's "pause, not a failure",
    #: evaluated **before** the call, matching B11 tab 2's `[rule]`.
    STEP_UP_REQUIRED = "step_up_required"


@dataclass(frozen=True, slots=True)
class FlowRunResult:
    outcome: FlowRunOutcome
    state: FlowState
    message_text: str
    steps: tuple[TraceStep, ...]
    handover_reason: str | None = None
    #: Set only when `outcome is STEP_UP_REQUIRED` — the level the citizen must
    #: reach before this exact node can be retried. `ProcessTurn` surfaces this
    #: on the turn result / `step_up_required` SSE event (api.md §5.2).
    required_assurance: AssuranceLevel | None = None


def _required_assurance_for(node: FlowNodeDef, binding: ToolBindingRow) -> str | None:
    """The effective required-assurance floor for a `ToolCall` node: the node's
    own authored override (`FlowNodes.requiredAssurance`) when the flow author
    set one, otherwise the bound tool's own baseline
    (`ToolBindings.requiredAssurance`, B11 tab 2 — "the binding carries policy,
    so the same skill can be anonymous for one agent and require OTP for
    another," `docs/data-model.md` §4.6). **Flagged judgment call**: neither
    doc names which of the two wins when both are set: this reads the node's
    override as authoritative, since a flow author configuring a *stricter*
    per-node requirement than the tool's own floor is the only directionally
    sensible reason to set it at all — the alternative (the binding always
    wins) would make the node's own column write-only and never read.
    """
    return (
        node.required_assurance
        if node.required_assurance is not None
        else binding.required_assurance
    )


class ExecuteFlowStep:
    __slots__ = ("_tool_invoker",)

    def __init__(self, tool_invoker: ToolInvoker) -> None:
        self._tool_invoker = tool_invoker

    async def execute(
        self,
        *,
        definition: FlowDefinition,
        state: FlowState,
        user_text: str,
        tool_bindings_by_id: dict[str, ToolBindingRow],
        starting_ordinal: int,
        held_assurance: AssuranceLevel = AssuranceLevel.L0,
    ) -> FlowRunResult:
        steps: list[TraceStep] = []
        ordinal = starting_ordinal
        current_state = state
        message_text = ""
        forced_handover_reason: str | None = None

        if is_free_text_escape(user_text):
            escaped_state = apply_free_text_escape(current_state, user_text)
            ordinal += 1
            steps.append(
                TraceStep(
                    ordinal=ordinal,
                    kind=TraceStepKind.FLOW_ESCAPE,
                    label=f"Free-text escape at {current_state.current_node_key}",
                    status=TraceStepStatus.OK,
                    duration_ms=0,
                )
            )
            return FlowRunResult(
                outcome=FlowRunOutcome.ESCAPED,
                state=escaped_state,
                message_text="",
                steps=tuple(steps),
            )

        # A slot-bearing node that is currently *awaiting* an answer treats
        # this turn's free text as the answer, rather than re-visiting the
        # node's own prompt — this is the "resume" half of FR-FLOW-09.
        node = definition.nodes.get(current_state.current_node_key)
        if (
            node is not None
            and node.type == FlowNodeType.QUESTION
            and node.slot_name
            and current_state.slots.get(node.slot_name) is None
        ):
            current_state = fill_slot(current_state, node.slot_name, user_text)
            edge = resolve_default_or_matching_edge(definition, node.key, current_state.slots)
            if edge is not None:
                current_state = move_to(current_state, edge.to_node_key)

        for _ in range(_MAX_NODES_PER_TURN):
            node = definition.nodes.get(current_state.current_node_key)
            if node is None:
                return FlowRunResult(
                    outcome=FlowRunOutcome.COMPLETED,
                    state=current_state,
                    message_text=message_text,
                    steps=tuple(steps),
                )

            if node.type == FlowNodeType.MESSAGE:
                message_text = f"[flow:{node.key}] {node.key}"
                ordinal += 1
                steps.append(
                    TraceStep(
                        ordinal=ordinal,
                        kind=TraceStepKind.AGENT_INVOKE,
                        label=f"Message node {node.key}",
                        status=TraceStepStatus.OK,
                        duration_ms=0,
                    )
                )
                edge = resolve_default_or_matching_edge(definition, node.key, current_state.slots)
                if edge is None:
                    return FlowRunResult(
                        FlowRunOutcome.COMPLETED, current_state, message_text, tuple(steps)
                    )
                current_state = move_to(current_state, edge.to_node_key)
                continue

            if node.type == FlowNodeType.QUESTION:
                if node.slot_name and current_state.slots.get(node.slot_name) is not None:
                    edge = resolve_default_or_matching_edge(
                        definition, node.key, current_state.slots
                    )
                    if edge is None:
                        return FlowRunResult(
                            FlowRunOutcome.COMPLETED, current_state, message_text, tuple(steps)
                        )
                    current_state = move_to(current_state, edge.to_node_key)
                    continue
                ordinal += 1
                steps.append(
                    TraceStep(
                        ordinal=ordinal,
                        kind=TraceStepKind.AGENT_INVOKE,
                        label=f"Question node {node.key} awaiting {node.slot_name}",
                        status=TraceStepStatus.OK,
                        duration_ms=0,
                    )
                )
                return FlowRunResult(
                    outcome=FlowRunOutcome.AWAITING_INPUT,
                    state=current_state,
                    message_text=f"[flow:{node.key}] awaiting {node.slot_name}",
                    steps=tuple(steps),
                )

            if node.type == FlowNodeType.CONDITION:
                edge = resolve_default_or_matching_edge(definition, node.key, current_state.slots)
                ordinal += 1
                steps.append(
                    TraceStep(
                        ordinal=ordinal,
                        kind=TraceStepKind.FLOW_ESCAPE
                        if edge is None
                        else TraceStepKind.AGENT_INVOKE,
                        label=f"Condition node {node.key}",
                        status=TraceStepStatus.OK if edge is not None else TraceStepStatus.SKIPPED,
                        duration_ms=0,
                    )
                )
                if edge is None:
                    return FlowRunResult(
                        FlowRunOutcome.COMPLETED, current_state, message_text, tuple(steps)
                    )
                current_state = move_to(current_state, edge.to_node_key)
                continue

            if node.type == FlowNodeType.HANDOVER:
                # FR-FLOW-06/FR-FLOW-12: a Handover reached because a tool call
                # just exhausted its retries carries "ToolFailure" regardless
                # of the node's own configured reason (`forced_handover_reason`,
                # set by the `TOOL_CALL` branch below); reached any other way,
                # the node's own `handoverReason` column is authoritative,
                # defaulting to "LowConfidence" for a node authored without one.
                reason = forced_handover_reason or node.handover_reason or "LowConfidence"
                ordinal += 1
                steps.append(
                    TraceStep(
                        ordinal=ordinal,
                        kind=TraceStepKind.HANDOVER,
                        label=f"Handover node {node.key} ({reason})",
                        status=TraceStepStatus.OK,
                        duration_ms=0,
                    )
                )
                return FlowRunResult(
                    outcome=FlowRunOutcome.HANDOVER,
                    state=current_state,
                    message_text=message_text,
                    steps=tuple(steps),
                    handover_reason=reason,
                )

            if node.type == FlowNodeType.TOOL_CALL:
                binding = (
                    tool_bindings_by_id.get(node.tool_binding_id) if node.tool_binding_id else None
                )
                ordinal += 1
                if binding is None:
                    steps.append(
                        TraceStep(
                            ordinal=ordinal,
                            kind=TraceStepKind.TOOL_CALL,
                            label=f"Tool-call node {node.key}",
                            status=TraceStepStatus.FAILED,
                            duration_ms=0,
                            # `CK_OrchestrationTraceSteps_toolCallHasBinding`:
                            # a `ToolCall`-kind step must carry a real
                            # `toolBindingId`. `node.tool_binding_id` (the
                            # node's own authored target, guaranteed non-null
                            # by `CK_FlowNodes_toolCallFields`) satisfies that
                            # even when the runtime config lookup below found
                            # no *live* `ToolBindingRow` for it (disabled or
                            # removed since the flow was authored) — the trace
                            # still names exactly which binding the flow
                            # targeted, which is the more useful record either way.
                            tool_binding_id=node.tool_binding_id,
                            error_code="tool_binding_not_found",
                        )
                    )
                elif not satisfies_required_assurance(
                    held_assurance, _required_assurance_for(node, binding)
                ):
                    # B-8: evaluated BEFORE the tool call, never after — the
                    # binding is real and enabled, but the conversation's
                    # currently-held assurance does not satisfy the node's own
                    # override (if authored) or the bound tool's floor.
                    # `self._tool_invoker.invoke` is never reached on this path.
                    steps.append(
                        TraceStep(
                            ordinal=ordinal,
                            kind=TraceStepKind.TOOL_CALL,
                            label=f"Tool-call node {node.key} requires step-up",
                            status=TraceStepStatus.BLOCKED,
                            duration_ms=0,
                            tool_binding_id=binding.tool_binding_id,
                            error_code="authz.assurance_insufficient",
                        )
                    )
                    return FlowRunResult(
                        outcome=FlowRunOutcome.STEP_UP_REQUIRED,
                        state=current_state,
                        message_text=message_text,
                        steps=tuple(steps),
                        required_assurance=required_level_to_assurance(
                            _required_assurance_for(node, binding) or "Anonymous"
                        ),
                    )
                else:
                    result = await self._tool_invoker.invoke(
                        tool_binding_id=binding.tool_binding_id,
                        skill_key=binding.skill_key or "",
                        invocation_kind=binding.skill_invocation_kind or "Native",
                        api_connector_id=binding.api_connector_id,
                        arguments=dict(current_state.slots),
                        circuit_breaker_target_kind=binding.circuit_breaker_target_kind,
                        circuit_breaker_target_ref=binding.circuit_breaker_target_ref,
                    )
                    if result.outcome == ToolInvocationOutcome.OK:
                        steps.append(
                            TraceStep(
                                ordinal=ordinal,
                                kind=TraceStepKind.TOOL_CALL,
                                label=f"Tool-call node {node.key} -> {binding.skill_key}",
                                status=TraceStepStatus.OK,
                                duration_ms=result.duration_ms,
                                tool_binding_id=binding.tool_binding_id,
                                result_summary=(result.result_json or "")[:500],
                            )
                        )
                        edge = resolve_default_or_matching_edge(
                            definition, node.key, current_state.slots
                        )
                        if edge is None:
                            return FlowRunResult(
                                FlowRunOutcome.COMPLETED, current_state, message_text, tuple(steps)
                            )
                        current_state = move_to(current_state, edge.to_node_key)
                        continue
                    # FR-FLOW-05: retry once on failure/timeout, then fall through.
                    current_state, attempt = record_tool_retry(current_state, node.key)
                    status = (
                        TraceStepStatus.TIMEOUT
                        if result.outcome == ToolInvocationOutcome.TIMEOUT
                        else TraceStepStatus.FAILED
                    )
                    steps.append(
                        TraceStep(
                            ordinal=ordinal,
                            kind=TraceStepKind.TOOL_CALL,
                            label=f"Tool-call node {node.key} attempt {attempt}",
                            status=status,
                            duration_ms=result.duration_ms,
                            tool_binding_id=binding.tool_binding_id,
                            # `errorCode` is `VARCHAR(64)` — the raw error
                            # text (unbounded) belongs in `result_summary`,
                            # not here.
                            error_code=(result.error or "tool_call_failed")[:64],
                            result_summary=result.error[:500] if result.error else None,
                        )
                    )
                    if should_retry(node, attempt):
                        continue  # same node, same slot values, one more attempt
                if node.on_failure_node_key is not None:
                    fallthrough_node = definition.nodes.get(node.on_failure_node_key)
                    if fallthrough_node is not None:
                        if fallthrough_node.type == FlowNodeType.HANDOVER:
                            forced_handover_reason = "ToolFailure"
                        current_state = move_to(current_state, fallthrough_node.key)
                        continue
                return FlowRunResult(
                    FlowRunOutcome.COMPLETED, current_state, message_text, tuple(steps)
                )

        # Exhausted the per-turn node budget without pausing or completing —
        # treat as an implicit escape so the turn always terminates cleanly
        # rather than silently truncating mid-flow.
        return FlowRunResult(
            FlowRunOutcome.ESCAPED,
            apply_free_text_escape(current_state, user_text),
            message_text,
            tuple(steps),
        )
