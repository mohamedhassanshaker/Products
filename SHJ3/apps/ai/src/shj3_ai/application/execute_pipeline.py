"""
`ExecutePipeline` — the graph-walking interpreter that replaces `process_turn.py`'s flat
`if/elif/else` dispatcher once a tenant has activated a pipeline
(`RouterConfigs.activePipelineVersionId IS NOT NULL`). See `domain/pipeline.py`'s own
module docstring for the pure scheduling logic this class is effectful glue around
(`next_ready_set`, `decide_loop_back`, `PipelineRunState`).

**Scope trim, stated plainly** (matching `process_turn.py`'s own convention of flagging a
deliberate cut rather than silently deciding): B-6's live, sub-turn token streaming
(`InvokeWithFallbackStreaming`, scoped in the legacy dispatcher to the Sequential-mode
primary agent) is NOT extended to pipeline-mode turns in this pass. A pipeline node's own
model call always uses the non-streaming `InvokeWithFallback.execute()`, emitting one
`agent_started`/`agent_finished` event pair per node — exactly the treatment every
non-"live" invoke already receives today (a secondary/worker invoke, Parallel,
SupervisorWorker). Real, incremental per-token forwarding for an arbitrary graph shape
(which node is "the" live one when several may run concurrently?) is a materially separate
feature; this keeps every pipeline turn's SSE contract structurally sound
(`trace_update`/`done`/`error` still fire correctly) without answering a design question
this wave's brief never asked.

**`merge_replies` is reused verbatim** at any join (a node with >= 2 satisfied inbound
edges) — already pure, already tested, and a join's inputs ARE just a flat reply list; this
is the single most important reuse in this design.
"""

from __future__ import annotations

import contextlib
import json
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from decimal import Decimal

from shj3_ai.application.fallback_chat import InvokeWithFallback
from shj3_ai.domain import condition_expr
from shj3_ai.domain import governance as gov
from shj3_ai.domain.condition_expr import ConditionAst, ConditionContext, ConditionNodeSnapshot
from shj3_ai.domain.identity import (
    AssuranceLevel,
    assurance_rank,
    required_level_to_assurance,
    satisfies_required_assurance,
)
from shj3_ai.domain.orchestration import (
    AgentReply,
    Budget,
    ConflictResolution,
    CostLedger,
    MergePolicy,
    TraceStep,
    TraceStepKind,
    TraceStepStatus,
    cost_ceiling_reached,
    hop_ceiling_reached,
    merge_replies,
    score_agent_confidence,
)
from shj3_ai.domain.pipeline import (
    LoopDecision,
    NodeErrorPolicy,
    NodeOutput,
    PipelineDefinition,
    PipelineNodeDef,
    PipelineNodeKind,
    PipelineRunState,
    ReadyKind,
    decide_loop_back,
    forward_edges_into,
    loop_edges_from,
    next_ready_set,
    topological_depth,
)
from shj3_ai.ports.chat_model import ChatMessage, ChatRequest, ToolSpec
from shj3_ai.ports.config_reader import AgentVersionConfig, ConfigReader
from shj3_ai.ports.tool_invoker import ToolInvocationOutcome, ToolInvoker

#: Duplicated, not imported, from `process_turn.py` — importing it there would make this
#: module and `process_turn.py` mutually dependent (`process_turn.py` is the one that
#: constructs and calls `ExecutePipeline`). A plain type alias costs nothing to keep in
#: sync by hand.
OnEvent = Callable[[str, dict[str, object]], Awaitable[None]]


class PipelineTurnFailedError(RuntimeError):
    """Raised when a node's `onErrorPolicy` is `FailTurn` and that node genuinely failed —
    `process_turn.py`'s wiring catches this and ends the turn as `TurnStatus.FAILED`, the
    same outcome a ceiling breach already produces today."""

    def __init__(self, node_key: str, reason: str) -> None:
        super().__init__(f"Pipeline node '{node_key}' failed: {reason}")
        self.node_key = node_key
        self.reason = reason


@dataclass(frozen=True, slots=True)
class PipelineRunRequest:
    definition: PipelineDefinition
    content: str
    #: The turn's own bound agent — resolved once by `process_turn.py` before this runs,
    #: exactly as it already resolves `agent_version` today. Used by any node with
    #: `usesTurnBoundAgent = True`.
    turn_bound_agent_version: AgentVersionConfig
    held_assurance: AssuranceLevel
    starting_ordinal: int
    budget: Budget
    grounding_confidence: float | None = None


@dataclass(frozen=True, slots=True)
class PipelineRunResult:
    final_text: str
    terminal_node_key: str | None
    steps: tuple[TraceStep, ...]
    ledger: CostLedger
    hop_count: int
    branch_count: int
    loop_iterations_total: int
    merge_policy_applied: str | None
    entry_confidence: float
    used_fallback_model: bool
    degraded: tuple[str, ...]
    tool_call_count: int
    step_up_required_level: AssuranceLevel | None
    ceiling_hit: str | None


@dataclass(slots=True)
class _NodeRunOutcome:
    output: NodeOutput
    steps: list[TraceStep]
    ordinal: int
    used_fallback: bool = False
    tool_call_delta: int = 0
    step_up_required_level: AssuranceLevel | None = None


class ExecutePipeline:
    def __init__(
        self,
        *,
        config: ConfigReader,
        chat_invoker: InvokeWithFallback,
        tool_invoker: ToolInvoker,
    ) -> None:
        self._config = config
        self._chat_invoker = chat_invoker
        self._tool_invoker = tool_invoker

    async def execute(
        self, request: PipelineRunRequest, *, on_event: OnEvent | None = None
    ) -> PipelineRunResult:
        defn = request.definition
        state = PipelineRunState(definition=defn)
        ledger = CostLedger()
        branch_ledgers: dict[str, CostLedger] = {"0": CostLedger()}
        steps: list[TraceStep] = []
        degraded: list[str] = []
        ordinal = request.starting_ordinal
        used_fallback_model = False
        tool_call_count = 0
        step_up_required_level: AssuranceLevel | None = None
        depth_by_key = topological_depth(defn)

        entry_node = defn.nodes[defn.entry_node_key]
        entry_confidence = (
            score_agent_confidence(request.turn_bound_agent_version.system_prompt, request.content)
            if entry_node.uses_turn_bound_agent
            or any(n.uses_turn_bound_agent for n in defn.nodes.values())
            else 1.0
        )

        compiled_conditions: dict[str, ConditionAst] = {}
        for node_key in defn.nodes:
            for edge in loop_edges_from(defn, node_key):
                if edge.condition_expression is None:
                    continue
                # A condition that fails to parse at run start is treated as a standing
                # EXIT_CONDITION_ERROR by `decide_loop_back` (no entry in
                # `compiled_conditions`) — fail closed, never silently TAKE.
                with contextlib.suppress(condition_expr.ConditionSyntaxError):
                    compiled_conditions[edge.edge_key] = condition_expr.parse(
                        edge.condition_expression
                    )

        ceiling_hit: str | None = None
        terminal_node_key: str | None = None
        loop_iterations_total = 0
        merge_policy_applied: str | None = None

        while True:
            ready = next_ready_set(state)
            if ready is None:
                break

            inbound_to_first = forward_edges_into(defn, ready.nodes[0].key)
            branch_id = (
                state.branch_of_node.get(inbound_to_first[0].from_node_key, "0")
                if inbound_to_first
                else "0"
            )

            outcomes: list[tuple[PipelineNodeDef, _NodeRunOutcome]] = []
            if ready.kind is ReadyKind.SEQUENTIAL:
                node = ready.nodes[0]
                outcome = await self._run_node(
                    node=node,
                    branch_id=branch_id,
                    request=request,
                    state=state,
                    ledger=ledger,
                    branch_ledgers=branch_ledgers,
                    ordinal=ordinal,
                    depth=depth_by_key.get(node.key),
                    on_event=on_event,
                )
                ordinal = outcome.ordinal
                outcomes.append((node, outcome))
            else:
                for i, node in enumerate(ready.nodes):
                    outcome = await self._run_node(
                        node=node,
                        branch_id=f"{branch_id}.{i}",
                        request=request,
                        state=state,
                        ledger=ledger,
                        branch_ledgers=branch_ledgers,
                        ordinal=ordinal,
                        depth=depth_by_key.get(node.key),
                        on_event=on_event,
                    )
                    ordinal = outcome.ordinal
                    outcomes.append((node, outcome))
                ordinal += 1
                steps.append(
                    TraceStep(
                        ordinal=ordinal,
                        kind=TraceStepKind.FAN_OUT,
                        label=f"Parallel: {', '.join(n.key for n, _ in outcomes)}",
                        status=TraceStepStatus.OK,
                        duration_ms=0,
                        branch_id=branch_id,
                    )
                )
                await self._emit_simple(
                    on_event, "fan_out", {"nodeKeys": [n.key for n, _ in outcomes]}
                )

            for node, outcome in outcomes:
                steps.extend(outcome.steps)
                used_fallback_model = used_fallback_model or outcome.used_fallback
                tool_call_count += outcome.tool_call_delta
                if outcome.step_up_required_level is not None and (
                    step_up_required_level is None
                    or assurance_rank(outcome.step_up_required_level)
                    > assurance_rank(step_up_required_level)
                ):
                    step_up_required_level = outcome.step_up_required_level
                state.apply_output(outcome.output)
                if node.kind == PipelineNodeKind.RESPONSE:
                    terminal_node_key = node.key

            if step_up_required_level is not None:
                # Mirrors the legacy dispatcher's own post-invocation check: a blocked
                # tool call is a pause, not a ceiling breach, and ends the turn here.
                break

            if hop_ceiling_reached(state.hop_count, request.budget):
                ceiling_hit = "max_hops"
                break
            if cost_ceiling_reached(ledger, request.budget):
                ceiling_hit = "cost_ceiling"
                break

            for node in ready.nodes:
                if not loop_edges_from(defn, node.key):
                    continue
                node_branch = state.branch_of_node.get(node.key, "0")
                ctx = self._build_condition_context(
                    state=state,
                    node_key=node.key,
                    ledger=ledger,
                    branch_ledger=branch_ledgers.get(node_branch, ledger),
                    grounding_confidence=request.grounding_confidence,
                    degraded=degraded,
                    used_fallback_model=used_fallback_model,
                )
                decision_pair = decide_loop_back(state, node.key, ctx, compiled_conditions)
                if decision_pair is None:
                    continue
                edge, decision = decision_pair
                ordinal += 1
                taken = state.loop_iterations.get(edge.edge_key, 0)
                steps.append(
                    TraceStep(
                        ordinal=ordinal,
                        kind=TraceStepKind.LOOP_BACK,
                        label=condition_expr.describe(compiled_conditions[edge.edge_key])
                        if edge.edge_key in compiled_conditions
                        else "unconditional",
                        status=TraceStepStatus.OK
                        if decision == LoopDecision.TAKE
                        else TraceStepStatus.SKIPPED,
                        duration_ms=0,
                        pipeline_node_key=node.key,
                        from_node_key=edge.from_node_key,
                        edge_kind="LoopBack",
                        branch_id=state.branch_of_node.get(node.key, "0"),
                        loop_iteration=taken + (1 if decision == LoopDecision.TAKE else 0),
                        result_summary=f"iteration {taken + 1}"
                        + (f"/{edge.max_iterations}" if edge.max_iterations else ""),
                        error_code={
                            LoopDecision.EXIT_MAX_ITERATIONS: "orchestration.loop_max_iterations_reached",
                            LoopDecision.EXIT_CONDITION_FALSE: "orchestration.condition_false",
                            LoopDecision.EXIT_CONDITION_ERROR: "orchestration.condition_parse_failed",
                        }.get(decision),
                    )
                )
                if decision == LoopDecision.TAKE:
                    loop_iterations_total += 1
                    state.take_loop(edge)

        merge_steps = [s for s in steps if s.kind == TraceStepKind.MERGE]
        if merge_steps:
            merge_policy_applied = (
                merge_steps[-1].label.split(" via ")[-1]
                if " via " in merge_steps[-1].label
                else None
            )

        if terminal_node_key is not None:
            final_output = state.node_outputs[terminal_node_key]
            final_text = final_output.text
        elif state.node_outputs:
            # A ceiling truncated the turn before a Response node was reached — fall back
            # to the most recently produced owning-entity output, else the last output at
            # all, matching the legacy dispatcher's own "always return SOMETHING" contract.
            owning = [o for o in state.node_outputs.values() if o.is_owning_entity]
            final_text = (owning[-1] if owning else list(state.node_outputs.values())[-1]).text
        else:
            final_text = ""

        branch_count = len(set(state.branch_of_node.values())) or 1

        return PipelineRunResult(
            final_text=final_text,
            terminal_node_key=terminal_node_key,
            steps=tuple(steps),
            ledger=ledger,
            hop_count=state.hop_count,
            branch_count=branch_count,
            loop_iterations_total=loop_iterations_total,
            merge_policy_applied=merge_policy_applied,
            entry_confidence=entry_confidence,
            used_fallback_model=used_fallback_model,
            degraded=tuple(degraded),
            tool_call_count=tool_call_count,
            step_up_required_level=step_up_required_level,
            ceiling_hit=ceiling_hit,
        )

    def _build_condition_context(
        self,
        *,
        state: PipelineRunState,
        node_key: str,
        ledger: CostLedger,
        branch_ledger: CostLedger,
        grounding_confidence: float | None,
        degraded: list[str],
        used_fallback_model: bool,
    ) -> ConditionContext:
        last = state.node_outputs.get(node_key)
        last_snapshot = (
            ConditionNodeSnapshot(
                text=last.text,
                confidence=last.confidence,
                status=last.status.value,
                agent_id=last.agent_id,
            )
            if last is not None
            else None
        )
        node_outputs = {
            key: ConditionNodeSnapshot(
                text=output.text,
                confidence=output.confidence,
                status=output.status.value,
                agent_id=output.agent_id,
            )
            for key, output in state.node_outputs.items()
        }
        edge_iter = next(iter(state.loop_iterations.values()), 0)
        return ConditionContext(
            iteration=edge_iter + 1,
            hop_count=state.hop_count,
            grounding_confidence=grounding_confidence,
            cost_tokens=ledger.total_tokens,
            cost_micro_aed=ledger.total_cost_micro_aed,
            branch_cost_tokens=branch_ledger.total_tokens,
            degraded=bool(degraded),
            used_fallback_model=used_fallback_model,
            last_reply=last_snapshot,
            node_outputs=node_outputs,
        )

    async def _emit_simple(
        self, on_event: OnEvent | None, name: str, payload: dict[str, object]
    ) -> None:
        if on_event is not None:
            await on_event(name, payload)

    async def _run_node(
        self,
        *,
        node: PipelineNodeDef,
        branch_id: str,
        request: PipelineRunRequest,
        state: PipelineRunState,
        ledger: CostLedger,
        branch_ledgers: dict[str, CostLedger],
        ordinal: int,
        depth: int | None,
        on_event: OnEvent | None,
    ) -> _NodeRunOutcome:
        defn = request.definition
        steps: list[TraceStep] = []
        inputs = [
            state.node_outputs[e.from_node_key]
            for e in forward_edges_into(defn, node.key)
            if e.edge_key in state.satisfied_edges and e.from_node_key in state.node_outputs
        ]

        if node.kind == PipelineNodeKind.START:
            output = NodeOutput(
                node_key=node.key,
                agent_id=None,
                text=request.content,
                confidence=Decimal("1"),
                is_owning_entity=False,
                status=TraceStepStatus.OK,
                via_edge_key=None,
                branch_id=branch_id,
            )
            return _NodeRunOutcome(output=output, steps=steps, ordinal=ordinal)

        if node.kind == PipelineNodeKind.RESPONSE:
            merged_text, merge_step, ordinal = self._merge_if_needed(
                node=node,
                inputs=inputs,
                defn=defn,
                ordinal=ordinal,
                branch_id=branch_id,
                depth=depth,
            )
            if merge_step is not None:
                steps.append(merge_step)
            output = NodeOutput(
                node_key=node.key,
                agent_id=None,
                text=merged_text,
                confidence=inputs[-1].confidence if inputs else Decimal("1"),
                is_owning_entity=True,
                status=TraceStepStatus.OK,
                via_edge_key=None,
                branch_id=branch_id,
            )
            return _NodeRunOutcome(output=output, steps=steps, ordinal=ordinal)

        # Agent / Supervisor -------------------------------------------------
        context_text, merge_step, ordinal = self._merge_if_needed(
            node=node, inputs=inputs, defn=defn, ordinal=ordinal, branch_id=branch_id, depth=depth
        )
        if merge_step is not None:
            steps.append(merge_step)

        agent_config = await self._resolve_agent_config(node, request)
        if agent_config is None:
            return await self._handle_node_failure(
                node=node,
                request=request,
                branch_id=branch_id,
                depth=depth,
                ordinal=ordinal,
                steps=steps,
                reason="orchestration.pipeline_agent_unresolved",
            )

        state.hop_count += 1
        branch_ledger = branch_ledgers.setdefault(branch_id, CostLedger())
        if (
            node.cost_ceiling_tokens_override is not None
            and branch_ledger.total_tokens >= node.cost_ceiling_tokens_override
        ):
            return await self._handle_node_failure(
                node=node,
                request=request,
                branch_id=branch_id,
                depth=depth,
                ordinal=ordinal,
                steps=steps,
                reason="orchestration.branch_cost_ceiling_reached",
            )

        system_prompt = agent_config.system_prompt
        if context_text and node.input_context_mode != "UserTurnOnly":
            system_prompt = f"{system_prompt}\n\nContext:\n{context_text}"

        tool_bindings = await self._config.list_tool_bindings(agent_config.agent_version_id)
        tool_specs = [
            ToolSpec(
                name=b.skill_key,
                description=b.skill_name or b.skill_key,
                input_schema_json=b.skill_input_schema_json or "{}",
            )
            for b in tool_bindings
            if b.is_enabled and b.skill_key
        ]
        bindings_by_key = {b.skill_key: b for b in tool_bindings if b.skill_key}

        chat_request = ChatRequest(
            model=agent_config.primary_model,
            messages=[
                ChatMessage(role="system", content=system_prompt),
                ChatMessage(role="user", content=request.content),
            ],
            temperature=agent_config.temperature,
            max_output_tokens=agent_config.max_output_tokens,
            tools=tool_specs,
        )

        await self._emit_simple(on_event, "agent_started", {"agentId": agent_config.agent_id})
        try:
            model_outcome = await self._chat_invoker.execute(
                chat_request, fallback_model=agent_config.fallback_model
            )
        except Exception as exc:
            return await self._handle_node_failure(
                node=node,
                request=request,
                branch_id=branch_id,
                depth=depth,
                ordinal=ordinal,
                steps=steps,
                reason=str(exc)[:200],
            )

        ledger.record(model_outcome.cost)
        branch_ledger.record(model_outcome.cost)
        ordinal += 1
        invoke_label = f"{agent_config.agent_id} via {model_outcome.cost.model}"
        invoke_summary = gov.mask_pii(model_outcome.response.text).masked_text[:500]
        if model_outcome.cost.used_fallback:
            invoke_label = (
                f"{agent_config.agent_id}: {agent_config.primary_model} failed "
                f"-> fallback {model_outcome.cost.model}"
            )
            invoke_summary = (
                f"primary failure: {gov.mask_pii(model_outcome.primary_error or '').masked_text}"[
                    :500
                ]
            )
        steps.append(
            TraceStep(
                ordinal=ordinal,
                kind=TraceStepKind.AGENT_INVOKE,
                label=invoke_label,
                status=TraceStepStatus.OK,
                duration_ms=model_outcome.cost.duration_ms,
                agent_id=agent_config.agent_id,
                is_secondary_agent=not node.is_owning_entity,
                result_summary=invoke_summary,
                error_code="orchestration.fallback_triggered"
                if model_outcome.cost.used_fallback
                else None,
                pipeline_node_key=node.key,
                branch_id=branch_id,
                depth=depth,
            )
        )
        await self._emit_simple(
            on_event, "agent_finished", {"agentId": agent_config.agent_id, "status": "Ok"}
        )

        reply_text = model_outcome.response.text
        tool_call_delta = 0
        step_up_level: AssuranceLevel | None = None
        if model_outcome.response.tool_call is not None:
            binding = bindings_by_key.get(model_outcome.response.tool_call.tool_name)
            if binding is not None and not satisfies_required_assurance(
                request.held_assurance, binding.required_assurance
            ):
                tool_call_delta += 1
                step_up_level = required_level_to_assurance(binding.required_assurance)
                ordinal += 1
                steps.append(
                    TraceStep(
                        ordinal=ordinal,
                        kind=TraceStepKind.TOOL_CALL,
                        label=f"{model_outcome.response.tool_call.tool_name} requires step-up",
                        status=TraceStepStatus.BLOCKED,
                        duration_ms=0,
                        tool_binding_id=binding.tool_binding_id,
                        error_code="authz.assurance_insufficient",
                        pipeline_node_key=node.key,
                        branch_id=branch_id,
                        depth=depth,
                    )
                )
            elif binding is not None:
                try:
                    arguments = json.loads(model_outcome.response.tool_call.arguments_json)
                except (json.JSONDecodeError, TypeError):
                    arguments = {}
                tool_result = await self._tool_invoker.invoke(
                    tool_binding_id=binding.tool_binding_id,
                    skill_key=binding.skill_key or "",
                    invocation_kind=binding.skill_invocation_kind or "Native",
                    api_connector_id=binding.api_connector_id,
                    arguments=arguments,
                    circuit_breaker_target_kind=binding.circuit_breaker_target_kind,
                    circuit_breaker_target_ref=binding.circuit_breaker_target_ref,
                )
                tool_call_delta += 1
                ordinal += 1
                steps.append(
                    TraceStep(
                        ordinal=ordinal,
                        kind=TraceStepKind.TOOL_CALL,
                        label=model_outcome.response.tool_call.tool_name,
                        status=TraceStepStatus.OK
                        if tool_result.outcome == ToolInvocationOutcome.OK
                        else TraceStepStatus.FAILED,
                        duration_ms=tool_result.duration_ms,
                        tool_binding_id=binding.tool_binding_id,
                        result_summary=(tool_result.result_json or tool_result.error or "")[:500],
                        error_code=None
                        if tool_result.outcome == ToolInvocationOutcome.OK
                        else tool_result.outcome.value,
                        pipeline_node_key=node.key,
                        branch_id=branch_id,
                        depth=depth,
                    )
                )
                if tool_result.outcome == ToolInvocationOutcome.OK and tool_result.result_json:
                    reply_text = f"Here's what I found: {tool_result.result_json}"
                elif tool_result.outcome == ToolInvocationOutcome.CIRCUIT_OPEN:
                    reply_text = (
                        "That service is temporarily unavailable — please try again shortly."
                    )
                else:
                    reply_text = "I couldn't complete that action right now."

        output = NodeOutput(
            node_key=node.key,
            agent_id=agent_config.agent_id,
            text=reply_text,
            confidence=Decimal(
                str(round(score_agent_confidence(agent_config.system_prompt, request.content), 4))
            ),
            is_owning_entity=node.is_owning_entity,
            status=TraceStepStatus.OK,
            via_edge_key=None,
            branch_id=branch_id,
        )
        return _NodeRunOutcome(
            output=output,
            steps=steps,
            ordinal=ordinal,
            used_fallback=model_outcome.cost.used_fallback,
            tool_call_delta=tool_call_delta,
            step_up_required_level=step_up_level,
        )

    def _merge_if_needed(
        self,
        *,
        node: PipelineNodeDef,
        inputs: list[NodeOutput],
        defn: PipelineDefinition,
        ordinal: int,
        branch_id: str,
        depth: int | None,
    ) -> tuple[str, TraceStep | None, int]:
        if not inputs:
            return "", None, ordinal
        if len(inputs) == 1:
            return inputs[0].text, None, ordinal
        policy = MergePolicy(node.merge_policy_override or defn.default_merge_policy)
        conflict = ConflictResolution(
            node.conflict_resolution_override or defn.default_conflict_resolution
        )
        result = merge_replies(
            [
                AgentReply(
                    agent_id=o.agent_id or "",
                    text=o.text,
                    confidence=o.confidence,
                    is_owning_entity=o.is_owning_entity,
                )
                for o in inputs
            ],
            merge_policy=policy,
            conflict_resolution=conflict,
        )
        ordinal += 1
        step = TraceStep(
            ordinal=ordinal,
            kind=TraceStepKind.MERGE,
            label=f"Merged {len(inputs)} repl{'y' if len(inputs) == 1 else 'ies'} via {result.policy_applied.value}",
            status=TraceStepStatus.OK,
            duration_ms=0,
            result_summary=f"{len(result.discarded)} discarded",
            pipeline_node_key=node.key,
            branch_id=branch_id,
            depth=depth,
        )
        return result.merged_text, step, ordinal

    async def _handle_node_failure(
        self,
        *,
        node: PipelineNodeDef,
        request: PipelineRunRequest,
        branch_id: str,
        depth: int | None,
        ordinal: int,
        steps: list[TraceStep],
        reason: str,
    ) -> _NodeRunOutcome:
        ordinal += 1
        steps.append(
            TraceStep(
                ordinal=ordinal,
                kind=TraceStepKind.AGENT_INVOKE,
                label=f"{node.key} failed",
                status=TraceStepStatus.FAILED,
                duration_ms=0,
                error_code=reason[:64],
                pipeline_node_key=node.key,
                branch_id=branch_id,
                depth=depth,
            )
        )
        if node.on_error_policy == NodeErrorPolicy.FAIL_TURN:
            raise PipelineTurnFailedError(node.key, reason)

        if (
            node.on_error_policy == NodeErrorPolicy.ROUTE_TO_FALLBACK_AGENT
            and request.definition.fallback_agent_id
        ):
            fallback_config = await self._config.get_current_agent_version(
                request.definition.fallback_agent_id
            )
            if fallback_config is not None:
                output = NodeOutput(
                    node_key=node.key,
                    agent_id=fallback_config.agent_id,
                    text=(
                        "I couldn't complete that with the usual agent, so I've routed this "
                        "to a fallback agent — please try rephrasing your request."
                    ),
                    confidence=Decimal("0.5"),
                    is_owning_entity=node.is_owning_entity,
                    status=TraceStepStatus.OK,
                    via_edge_key=None,
                    branch_id=branch_id,
                )
                return _NodeRunOutcome(output=output, steps=steps, ordinal=ordinal)

        # SkipNode (or RouteToFallbackAgent with no configured/resolvable fallback agent,
        # which degrades to the same safe behaviour): still marks this node's outgoing
        # edges satisfied via `apply_output` in the caller, so a downstream join never
        # deadlocks waiting on a node that will never produce real output.
        output = NodeOutput(
            node_key=node.key,
            agent_id=None,
            text="",
            confidence=Decimal("0"),
            is_owning_entity=False,
            status=TraceStepStatus.SKIPPED,
            via_edge_key=None,
            branch_id=branch_id,
        )
        return _NodeRunOutcome(output=output, steps=steps, ordinal=ordinal)

    async def _resolve_agent_config(
        self, node: PipelineNodeDef, request: PipelineRunRequest
    ) -> AgentVersionConfig | None:
        if node.uses_turn_bound_agent:
            return request.turn_bound_agent_version
        if node.agent_version_pin_id is not None:
            return await self._config.get_agent_version_by_id(node.agent_version_pin_id)
        if node.agent_id is not None:
            return await self._config.get_current_agent_version(node.agent_id)
        return None
