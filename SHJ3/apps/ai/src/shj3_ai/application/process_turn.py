"""`ProcessTurn` — the full B4 pipeline (architecture.md §7, api.md §5.1):

    guardrail pre-check -> route -> execute -> merge -> guardrail post-check
    -> stream + persist

Stages 1 and 5 are structural (architecture.md §7: "a locked policy cannot be
toggled by any role, so the check is structural, not configurable") — PII
masking and the prompt-injection filter run unconditionally, called directly
from `domain.governance`, never behind a config read. Everything else
(execution mode, ceilings, merge policy, unlocked guardrail thresholds) is
resolved from `RouterConfig`/`Policy`/`PolicyOverride` through `ConfigReader`.

**Raw vs. masked content, precisely**: NFR-DATA-08 requires masking *before
persistence*, not before processing — an agent that needs to act on a real
account number cannot do so from a redaction token. So this use case keeps
`command.content` (raw) for every processing step (routing, model prompts,
tool arguments) and only ever hands `domain.governance.mask_pii(...)`'s output
to `OrchestrationStore` (turn rows, trace step `arguments_masked`/
`result_summary`) or to the citizen-facing `message_text`. Nothing raw crosses
that line. **Persistence stays unchanged by B-6's live streaming below**: the
final persisted `ConversationTurn.contentMasked`/trace is still built from the
fully-assembled, guardrail-post-masked text exactly as before
(`post_masking.masked_text` in `execute()`).

**B-6: real, incremental token streaming — and one deliberate, flagged
tradeoff.** `execute()` takes an optional `on_event` callback
(`OnEvent = Callable[[str, dict], Awaitable[None]]`); when supplied,
`conversation_router.py`'s SSE endpoint receives every stage-transition event
this pipeline produces the instant it happens, rather than re-deriving them
from an already-finished `TurnResult` the way this module's B-5 predecessor
did. The one place this pass gives genuinely live, sub-turn granularity is
the common widget path: the Sequential-mode primary agent's own text
generation, which calls `ChatModel.stream()` (via
`fallback_chat.InvokeWithFallbackStreaming`) and forwards each real
`delta_text` to `on_event("token", ...)` as it arrives — a real await
between each, no artificial buffering. Every other shape (a
secondary/worker invoke, Parallel, SupervisorWorker, the flow engine's own
internal steps) keeps emitting one event per *completed* step, not
token-level — a reasonable, explicitly flagged scope trim for this pass
rather than plumbing live per-token forwarding through every execution mode
at once; see `_emit_step`'s own docstring.

The streamed tokens are therefore the model's own **pre**-guardrail-post,
**pre**-merge text (masking/merge only run once the whole reply is in hand,
stage 4-5 below) — a citizen watching the live stream can see raw text a
later stage might still refuse or rewrite. This is a deliberate, reasoned
tradeoff, not an oversight: the SSE grammar's own documented contract
(api.md §5.2 rule 4, "`error` after some `token` events is legal and
expected... clients must be able to retract streamed text") already
anticipates partial, not-yet-guardrailed text reaching the client and being
retracted. NFR-DATA-08 protects the *persisted record*'s integrity — which
this pass never touches, see the paragraph above — not what a live citizen's
own screen transiently renders before a retraction. Flagged here plainly
rather than silently decided.
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal
from enum import StrEnum

from shj3_ai.application.execute_flow import ExecuteFlowStep, FlowRunOutcome
from shj3_ai.application.execute_pipeline import (
    ExecutePipeline,
    PipelineRunRequest,
    PipelineTurnFailedError,
)
from shj3_ai.application.fallback_chat import InvokeWithFallback, InvokeWithFallbackStreaming
from shj3_ai.application.hybrid_retrieve import HybridRetrieve
from shj3_ai.domain import governance as gov
from shj3_ai.domain.flows import FlowState
from shj3_ai.domain.identity import (
    AssuranceLevel,
    assurance_rank,
    effective_assurance,
    required_level_to_assurance,
    satisfies_required_assurance,
)
from shj3_ai.domain.ids import new_ulid
from shj3_ai.domain.orchestration import (
    AgentReply,
    Budget,
    ConflictResolution,
    CostLedger,
    ExecutionMode,
    MergePolicy,
    RoutingCandidate,
    TraceStep,
    TraceStepKind,
    TraceStepStatus,
    cost_ceiling_reached,
    filter_candidates_by_scope,
    hop_ceiling_reached,
    loop_detected,
    merge_replies,
    route,
)
from shj3_ai.domain.pipeline import PipelineDefinition
from shj3_ai.ports.chat_model import ChatMessage, ChatRequest, ToolSpec
from shj3_ai.ports.circuit_breaker import CircuitBreakerPort
from shj3_ai.ports.config_reader import (
    AgentVersionConfig,
    CandidateAgent,
    ConfigReader,
    PolicyOverrideRow,
    PolicyRow,
)
from shj3_ai.ports.flow_reader import FlowReader
from shj3_ai.ports.flow_state_store import FlowStateStore
from shj3_ai.ports.identity_reader import IdentityReader
from shj3_ai.ports.orchestration_store import (
    CitationToPersist,
    OrchestrationStore,
    TraceToPersist,
    TurnToPersist,
)
from shj3_ai.ports.pipeline_reader import PipelineReader
from shj3_ai.ports.tool_invoker import ToolInvocationOutcome, ToolInvoker


class ConversationNotFoundError(RuntimeError):
    def __init__(self, conversation_id: str) -> None:
        super().__init__(f'Conversation "{conversation_id}" does not exist.')
        self.conversation_id = conversation_id


class AgentNotFoundError(RuntimeError):
    def __init__(self, agent_id: str) -> None:
        super().__init__(f'Agent "{agent_id}" has no current, resolvable version.')
        self.agent_id = agent_id


class TurnStatus(StrEnum):
    COMPLETED = "completed"
    REFUSED = "refused"
    BLOCKED = "blocked"
    ESCALATED = "escalated"
    FAILED = "failed"
    #: B-8: a step-up rule blocked a tool call before it was attempted. api.md
    #: §3.5's "pause, not a failure" — the turn resumes once the citizen
    #: completes the challenge, matching `_finish`'s own `was_refused`
    #: computation, which does not treat this as a refusal.
    STEP_UP_REQUIRED = "step_up_required"


@dataclass(frozen=True, slots=True)
class ProcessTurnCommand:
    conversation_id: str
    turn_id: str
    content: str
    channel: str
    locale: str
    agent_id: str
    turn_ordinal: int
    budget_override: Budget | None = None
    knowledge_collection_ids: list[str] | None = None
    #: B-9: when set, pins the turn to this SPECIFIC `AgentVersion` (resolved
    #: via `ConfigReader.get_agent_version_by_id`, including a Draft-status
    #: one) instead of `Agent.current_version_id` — golden-set regression
    #: evaluation's own need to score a version under test before it is
    #: published. `None` (every existing caller) keeps today's
    #: current-version resolution unchanged. Kept last so no existing
    #: positional-argument call site breaks.
    agent_version_id: str | None = None


@dataclass(frozen=True, slots=True)
class FlowStateSummary:
    flow_version_id: str | None
    node_key: str | None
    slots: dict[str, str]
    awaiting_slot: str | None


@dataclass(frozen=True, slots=True)
class UsageSummary:
    tokens_in: int
    tokens_out: int
    cost_micro_aed: int
    model_calls: int
    tool_calls: int


@dataclass(frozen=True, slots=True)
class TurnResult:
    turn_id: str
    conversation_id: str
    trace_id: str
    status: TurnStatus
    message_text: str
    execution_mode: str
    flow_state: FlowStateSummary | None
    steps: tuple[TraceStep, ...]
    degraded: tuple[str, ...]
    usage: UsageSummary
    grounding_confidence: float | None
    used_fallback_model: bool
    escape_triggered: bool
    #: Purely additive — `None`/`0` whenever no pipeline ran this turn (every legacy-mode
    #: turn), populated when `execution_mode == "Pipeline"`. Mirrors `TraceToPersist`'s own
    #: identically-named fields (`_finish` is the one place both are derived from).
    pipeline_version_id: str | None = None
    pipeline_label: str | None = None
    terminal_node_key: str | None = None


JsonScalar = bool | int | float | str

CandidateAgentConfig = AgentVersionConfig | CandidateAgent

# B-6: a live event sink `ProcessTurn.execute()` calls at each stage
# transition, so the SSE endpoint's job becomes "forward what this already
# emits" rather than re-deriving events from an already-finished
# `TurnResult` (see this module's own streaming section further down, and
# `conversation_router.py`'s module docstring for the endpoint-side half of
# this). `None` for every caller that does not need it — additive, so every
# existing call site/test keeps working unchanged.
OnEvent = Callable[[str, dict[str, object]], Awaitable[None]]


@dataclass(frozen=True, slots=True)
class _EffectivePolicies:
    grounding_threshold: float
    financial_advice_blocked: bool
    in_scope_restriction_enabled: bool
    pii_masking_locked: bool
    injection_filter_locked: bool


_REFUSAL_TEXT = "I can't answer that with enough confidence — would you like me to connect you with a live agent?"
_BLOCKED_TEXT = "I can't process that request."

# The government-service vocabulary this deployment's seeded agents actually
# cover (`check_in_scope_restriction`'s own real-keyword parameter — see that
# function's docstring for why this lives at the caller rather than as a
# hardcoded list inside `domain/`). A real deployment would resolve this per
# tenant from the tenant's own service catalogue; hardcoded here as the
# honest, flagged scope for this pass — matching how `general_faq` seeded
# agent's own `restrict_in_scope_services` override already disables this
# check entirely for the one agent B-3 seeded specifically to answer outside
# this vocabulary (FR-GOV-07's own acceptance example).
_IN_SCOPE_KEYWORDS = (
    "bill",
    "invoice",
    "payment",
    "account",
    "permit",
    "licence",
    "license",
    "service centre",
    "service center",
    "provider",
    "sewa",
    "utility",
    "utilities",
)


def _masked_arguments_json(raw_json: str, limit: int = 500) -> str:
    """A tool call's arguments, PII-masked and guaranteed valid, bounded JSON —
    `CK_OrchestrationTraceSteps_argumentsMasked_isJson` requires `ISJSON(...)
    = 1`. Two real, confirmed-live failure modes a naive `mask_pii(raw)[:500]`
    hits: masking can turn a bare, unquoted numeric value into a non-numeric
    redaction token (e.g. `{"amount": 12345678}` -> `{"amount":
    [REDACTED:ACCOUNT_NUMBER]}`, no longer valid JSON), and length-truncation
    can cut a JSON document mid-structure just as easily. Falls back to a
    guaranteed-valid wrapper whenever the masked/truncated form isn't itself
    valid JSON — the wrapper's own inner string is bounded well short of
    `limit` so JSON string-escaping (quotes, backslashes) can never push the
    final, dumped output over it."""
    masked = gov.mask_pii(raw_json).masked_text
    if len(masked) <= limit:
        try:
            json.loads(masked)
            return masked
        except json.JSONDecodeError:
            pass
    inner = masked[: max(0, limit - 50)]
    return json.dumps({"masked": inner})[:limit]


def _resolve_policy_value(
    policy: PolicyRow, override: PolicyOverrideRow | None
) -> tuple[bool, str | None]:
    """`FR-GOV-08`: "the effective policy for an agent is the override where
    present, otherwise the global value." Locked policies never reach this
    function with an override (`platform.OverridablePolicies`'s
    absence-of-parent-row FK makes that unrepresentable), so `override` is
    only ever non-`None` here for an unlocked policy."""
    if override is not None:
        if override.mode == "Disabled":
            return False, None
        return True, override.value_json
    return True, policy.default_value_json


class ProcessTurn:
    def __init__(
        self,
        *,
        config: ConfigReader,
        store: OrchestrationStore,
        chat_invoker: InvokeWithFallback,
        breaker: CircuitBreakerPort,
        tool_invoker: ToolInvoker,
        flow_reader: FlowReader,
        flow_state_store: FlowStateStore,
        flow_executor: ExecuteFlowStep,
        identity_reader: IdentityReader,
        retrieval: HybridRetrieve | None = None,
        pipelines: PipelineReader | None = None,
        pipeline_executor: ExecutePipeline | None = None,
    ) -> None:
        self._config = config
        self._store = store
        self._chat_invoker = chat_invoker
        self._breaker = breaker
        self._tool_invoker = tool_invoker
        self._flow_reader = flow_reader
        self._flow_state_store = flow_state_store
        self._flow_executor = flow_executor
        self._identity_reader = identity_reader
        self._retrieval = retrieval
        # Both optional and both required together in practice
        # (`router_config.active_pipeline_version_id` gates the branch in
        # `execute()` below): a tenant that has never activated a pipeline
        # never touches either, so every existing call site/test keeps
        # constructing `ProcessTurn` unchanged. A tenant that HAS activated
        # one but whose caller forgot to wire these degrades safely to the
        # legacy dispatcher (see `execute()`) rather than crashing the turn.
        self._pipelines = pipelines
        self._pipeline_executor = pipeline_executor
        # Built from the exact same underlying `ChatModel` `chat_invoker`
        # already wraps (`InvokeWithFallback.chat_model` is public precisely
        # for this) — no second, parallel "which model client" wiring
        # decision for a caller to get wrong. Cheap to construct (no I/O);
        # only ever used on the Sequential-mode primary invoke path, and
        # only when a real `on_event` sink was supplied to `execute()`.
        self._streaming_chat_invoker = InvokeWithFallbackStreaming(chat_invoker.chat_model)

    async def execute(
        self, command: ProcessTurnCommand, *, on_event: OnEvent | None = None
    ) -> TurnResult:
        conversation = await self._store.get_conversation(command.conversation_id)
        if conversation is None:
            raise ConversationNotFoundError(command.conversation_id)

        # B-8: resolved fresh every turn, never cached on the conversation row —
        # a step-up completed via `shj3-web` mid-conversation must be visible to
        # the very next turn's tool-call gate. An anonymous conversation
        # (`citizen_identity_id is None`) holds `L0`, matching
        # `ANONYMOUS_ASSURANCE`'s TypeScript-side meaning: not an error state.
        held_assurance = await self._resolve_held_assurance(conversation.citizen_identity_id)

        # B-9: an explicit `agent_version_id` (evaluation's own version-pin,
        # e.g. scoring a Draft version before it is published) always wins
        # over the ordinary current-version resolution; either miss still
        # raises the same `AgentNotFoundError`.
        agent_version = (
            await self._config.get_agent_version_by_id(command.agent_version_id)
            if command.agent_version_id is not None
            else await self._config.get_current_agent_version(command.agent_id)
        )
        if agent_version is None:
            raise AgentNotFoundError(command.agent_id)

        router_config = await self._config.get_router_config()
        budget = command.budget_override or Budget(
            max_hops=router_config.max_hops,
            max_loop_iterations=router_config.max_loop_iterations,
            cost_ceiling_tokens=router_config.cost_ceiling_tokens,
            cost_ceiling_micro_aed=router_config.cost_ceiling_micro_aed,
        )
        # A tenant with `activePipelineVersionId` set but no `pipelines`/
        # `pipeline_executor` wired (a caller that forgot, or a preview
        # context that intentionally omits them) degrades to the legacy
        # dispatcher below rather than crashing the turn.
        pipeline_definition: PipelineDefinition | None = None
        if router_config.active_pipeline_version_id is not None and self._pipelines is not None:
            pipeline_definition = await self._pipelines.get_active_pipeline_version()
        use_pipeline = pipeline_definition is not None and self._pipeline_executor is not None
        execution_mode = (
            ExecutionMode.PIPELINE if use_pipeline else ExecutionMode(router_config.execution_mode)
        )

        ledger = CostLedger()
        steps: list[TraceStep] = []
        degraded: list[str] = []
        ordinal = 0
        hop_count = 0
        recent_agent_ids: list[str] = []
        tool_call_count = 0
        used_fallback_model = False
        #: B-8: set by `invoke_agent` when an agent's own tool-calling decision
        #: is gated — checked after every candidate has been invoked (mirroring
        #: the `ceiling_hit` check below, which runs on the identical schedule),
        #: since a tool-call decision happens deep inside a closure this
        #: function does not otherwise unwind out of mid-mode.
        step_up_required_level: AssuranceLevel | None = None

        # ================= stage 1: guardrail pre-check (structural + config) ==
        policies = await self._resolve_policies(command.agent_id)

        masking = gov.mask_pii(command.content)
        injection = gov.detect_prompt_injection(command.content)
        financial = (
            gov.check_financial_advice_block(command.content)
            if policies.financial_advice_blocked
            else gov.ContentPolicyResult(blocked=False)
        )
        in_scope = (
            gov.check_in_scope_restriction(command.content, _IN_SCOPE_KEYWORDS)
            if policies.in_scope_restriction_enabled
            else gov.ContentPolicyResult(blocked=False)
        )
        pre_blocked = injection.blocked or financial.blocked or in_scope.blocked
        pre_block_reason = (
            "guardrail.prompt_injection_detected"
            if injection.blocked
            else "guardrail.financial_advice_blocked"
            if financial.blocked
            else "guardrail.out_of_scope"
            if in_scope.blocked
            else None
        )
        ordinal += 1
        steps.append(
            TraceStep(
                ordinal=ordinal,
                kind=TraceStepKind.GUARDRAIL_PRE,
                label="PII mask + prompt-injection filter + content policy",
                status=TraceStepStatus.BLOCKED if pre_blocked else TraceStepStatus.OK,
                duration_ms=0,
                # `arguments_masked` is `CK_OrchestrationTraceSteps_
                # argumentsMasked_isJson`-constrained (real tool-call
                # arguments only) — free text belongs in `result_summary`,
                # confirmed live against a real SQL Server rejection before
                # this was moved.
                result_summary=masking.masked_text[:500],
                error_code=pre_block_reason,
            )
        )
        await self._emit_step(on_event, steps[-1])

        await self._store.persist_turn(
            TurnToPersist(
                id=new_ulid(),
                conversation_id=command.conversation_id,
                ordinal=command.turn_ordinal,
                role="Citizen",
                content_masked=masking.masked_text,
                content_format="Text",
                agent_version_id=agent_version.agent_version_id,
                locale_code=command.locale,
                input_tokens=None,
                output_tokens=None,
                latency_ms=None,
                was_refused=False,
                refusal_reason=None,
            )
        )

        if pre_blocked:
            return await self._finish(
                command=command,
                status=TurnStatus.BLOCKED,
                message_text=_BLOCKED_TEXT,
                execution_mode=execution_mode,
                steps=steps,
                degraded=degraded,
                ledger=ledger,
                tool_call_count=tool_call_count,
                grounding_confidence=None,
                used_fallback_model=False,
                escape_triggered=False,
                flow_state=None,
                guardrail_pre_result="Blocked",
                guardrail_post_result="Skipped",
                agent_version_id=agent_version.agent_version_id,
                routed_agent_id=agent_version.agent_id,
                hop_count=hop_count,
                on_event=on_event,
            )

        # ================= flow engine (B7) =================================
        flow_state = await self._flow_state_store.get_state(command.conversation_id)
        flow_definition = None
        if flow_state is not None:
            flow_definition = await self._flow_reader.get_flow_version_by_id(
                flow_state.flow_version_id
            )
        else:
            flow_definition = await self._flow_reader.get_flow_version_for_agent(
                agent_version.agent_version_id
            )
            if flow_definition is not None:
                flow_state = FlowState(
                    flow_version_id=flow_definition.flow_version_id,
                    current_node_key=flow_definition.entry_node_id,
                )

        escape_triggered = False
        if flow_definition is not None and flow_state is not None:
            tool_bindings = await self._config.list_tool_bindings(agent_version.agent_version_id)
            bindings_by_id = {b.tool_binding_id: b for b in tool_bindings}
            flow_result = await self._flow_executor.execute(
                definition=flow_definition,
                state=flow_state,
                user_text=command.content,
                tool_bindings_by_id=bindings_by_id,
                starting_ordinal=ordinal,
                held_assurance=held_assurance,
            )
            steps.extend(flow_result.steps)
            ordinal += len(flow_result.steps)
            tool_call_count += sum(
                1 for s in flow_result.steps if s.kind == TraceStepKind.TOOL_CALL
            )
            # The flow engine runs each of its own steps to completion
            # synchronously (`ExecuteFlowStep.execute()` is not itself
            # `on_event`-aware — B-6's live-token treatment is scoped to the
            # Sequential-mode primary agent invoke below, not the flow
            # engine) — so these arrive as soon as the whole flow segment
            # finishes, one event per completed step, not token-level. Still
            # a real improvement over the pre-B-6 shape: emitted here, as
            # soon as this data exists, rather than buffered until the
            # entire turn ends.
            for flow_step in flow_result.steps:
                await self._emit_step(on_event, flow_step)

            if flow_result.outcome == FlowRunOutcome.AWAITING_INPUT:
                await self._flow_state_store.set_state(command.conversation_id, flow_result.state)
                return await self._finish(
                    command=command,
                    status=TurnStatus.COMPLETED,
                    message_text=gov.mask_pii(flow_result.message_text).masked_text,
                    execution_mode=execution_mode,
                    steps=steps,
                    degraded=degraded,
                    ledger=ledger,
                    tool_call_count=tool_call_count,
                    grounding_confidence=None,
                    used_fallback_model=False,
                    escape_triggered=False,
                    flow_state=flow_result.state,
                    guardrail_pre_result="Pass",
                    guardrail_post_result="Pass",
                    agent_version_id=agent_version.agent_version_id,
                    routed_agent_id=agent_version.agent_id,
                    hop_count=hop_count,
                    on_event=on_event,
                )
            if flow_result.outcome == FlowRunOutcome.STEP_UP_REQUIRED:
                # B-8: the flow's own ToolCall node was gated — never invoked.
                # The flow's position is preserved exactly (same node, same
                # slots), matching AWAITING_INPUT's own persistence: a step-up
                # is a pause, not a failure, and the citizen resumes at the
                # same node once the challenge completes (api.md §3.5).
                await self._flow_state_store.set_state(command.conversation_id, flow_result.state)
                required = flow_result.required_assurance or AssuranceLevel.L0
                if on_event is not None:
                    # api.md §5.2's `step_up_required` event — not `TraceStep`-shaped,
                    # so `_emit_step` (built for trace rows) does not apply here.
                    await on_event("step_up_required", {"level": required.value})
                return await self._finish(
                    command=command,
                    status=TurnStatus.STEP_UP_REQUIRED,
                    message_text="Please verify your identity to continue.",
                    execution_mode=execution_mode,
                    steps=steps,
                    degraded=degraded,
                    ledger=ledger,
                    tool_call_count=tool_call_count,
                    grounding_confidence=None,
                    used_fallback_model=False,
                    escape_triggered=False,
                    flow_state=flow_result.state,
                    guardrail_pre_result="Pass",
                    guardrail_post_result="Skipped",
                    agent_version_id=agent_version.agent_version_id,
                    routed_agent_id=agent_version.agent_id,
                    hop_count=hop_count,
                    on_event=on_event,
                )
            if flow_result.outcome == FlowRunOutcome.HANDOVER:
                await self._flow_state_store.clear_state(command.conversation_id)
                return await self._finish(
                    command=command,
                    status=TurnStatus.ESCALATED,
                    message_text="Connecting you with a live agent.",
                    execution_mode=execution_mode,
                    steps=steps,
                    degraded=degraded,
                    ledger=ledger,
                    tool_call_count=tool_call_count,
                    grounding_confidence=None,
                    used_fallback_model=False,
                    escape_triggered=False,
                    flow_state=None,
                    guardrail_pre_result="Pass",
                    guardrail_post_result="Pass",
                    agent_version_id=agent_version.agent_version_id,
                    routed_agent_id=agent_version.agent_id,
                    hop_count=hop_count,
                    on_event=on_event,
                )
            if flow_result.outcome == FlowRunOutcome.COMPLETED:
                await self._flow_state_store.clear_state(command.conversation_id)
                flow_state = None  # the flow is finished; nothing left to resume
            elif flow_result.outcome == FlowRunOutcome.ESCAPED:
                escape_triggered = True
                flow_state = flow_result.state
                await self._flow_state_store.set_state(command.conversation_id, flow_state)

        # A tenant-wide degraded flag (key #6) means at least one breaker's
        # `serveCachedWhenDown`/apology fallback is currently active somewhere
        # — surfaced on the trace's `degraded[]` even when this specific
        # turn's own tool calls succeed, so B5 tab 4 and a diagnostics rail
        # agree on tenant health. Applies to every execution mode, pipeline
        # included, so it's checked once here rather than duplicated in both
        # branches below.
        if await self._breaker.is_degraded():
            degraded.append("circuit_breaker_degraded_mode")

        routed_agent_id: str
        routing_confidence: float
        merged_text: str
        merge_policy_applied: str | None
        ceiling_hit: str | None = None
        # Purely additive trace identity — `None`/default whenever no pipeline actually
        # ran this turn (every legacy-mode turn, and a pipeline-mode turn blocked before
        # reaching stage 2/3 above).
        pipeline_version_id = pipeline_definition.pipeline_version_id if pipeline_definition else None
        pipeline_design_id = pipeline_definition.pipeline_design_id if pipeline_definition else None
        pipeline_label = pipeline_definition.label if pipeline_definition else None
        terminal_node_key: str | None = None
        branch_count = 1
        loop_iterations_total = 0

        if pipeline_definition is not None and self._pipeline_executor is not None:
            pipeline_budget = Budget.from_pipeline(
                max_total_hops=pipeline_definition.max_total_hops,
                cost_ceiling_tokens=pipeline_definition.cost_ceiling_tokens,
                cost_ceiling_micro_aed=pipeline_definition.cost_ceiling_micro_aed,
            ).narrowed_by(
                router_max_tokens=router_config.cost_ceiling_tokens,
                router_max_micro_aed=router_config.cost_ceiling_micro_aed,
            )
            try:
                pipeline_result = await self._pipeline_executor.execute(
                    PipelineRunRequest(
                        definition=pipeline_definition,
                        content=command.content,
                        turn_bound_agent_version=agent_version,
                        held_assurance=held_assurance,
                        starting_ordinal=ordinal,
                        budget=pipeline_budget,
                        # Wave-1 scope trim, per the design's own documented
                        # fallback: retrieval still runs after the pipeline
                        # executes (unchanged ordering below), so a loop
                        # condition can't yet read `groundingConfidence`
                        # mid-run.
                        grounding_confidence=None,
                    ),
                    on_event=on_event,
                )
            except PipelineTurnFailedError as exc:
                ordinal += 1
                steps.append(
                    TraceStep(
                        ordinal=ordinal,
                        kind=TraceStepKind.AGENT_INVOKE,
                        label=f"Pipeline node '{exc.node_key}' failed",
                        status=TraceStepStatus.FAILED,
                        duration_ms=0,
                        error_code="orchestration.pipeline_turn_failed",
                        pipeline_node_key=exc.node_key,
                    )
                )
                return await self._finish(
                    command=command,
                    status=TurnStatus.FAILED,
                    message_text="I've reached the limit for this request — let me connect you with a live agent.",
                    execution_mode=execution_mode,
                    steps=steps,
                    degraded=degraded,
                    ledger=ledger,
                    tool_call_count=tool_call_count,
                    grounding_confidence=None,
                    used_fallback_model=used_fallback_model,
                    escape_triggered=escape_triggered,
                    flow_state=flow_state,
                    guardrail_pre_result="Pass",
                    guardrail_post_result="Skipped",
                    agent_version_id=agent_version.agent_version_id,
                    routed_agent_id=agent_version.agent_id,
                    hop_count=hop_count,
                    pipeline_version_id=pipeline_version_id,
                    pipeline_design_id=pipeline_design_id,
                    pipeline_label=pipeline_label,
                    on_event=on_event,
                )
            steps.extend(pipeline_result.steps)
            ordinal += len(pipeline_result.steps)
            ledger = pipeline_result.ledger
            hop_count = pipeline_result.hop_count
            used_fallback_model = pipeline_result.used_fallback_model
            tool_call_count += pipeline_result.tool_call_count
            step_up_required_level = pipeline_result.step_up_required_level
            degraded.extend(pipeline_result.degraded)
            merged_text = pipeline_result.final_text
            merge_policy_applied = pipeline_result.merge_policy_applied
            routed_agent_id = pipeline_result.terminal_node_key or agent_version.agent_id
            routing_confidence = pipeline_result.entry_confidence
            ceiling_hit = pipeline_result.ceiling_hit
            terminal_node_key = pipeline_result.terminal_node_key
            branch_count = pipeline_result.branch_count
            loop_iterations_total = pipeline_result.loop_iterations_total
        else:
            # ============= stage 2: route ====================================
            primary_candidate = RoutingCandidate(
                agent_id=agent_version.agent_id,
                agent_version_id=agent_version.agent_version_id,
                name=agent_version.agent_id,
                system_prompt=agent_version.system_prompt,
            )
            max_secondary = {
                ExecutionMode.SEQUENTIAL: 0,
                ExecutionMode.PARALLEL: 1,
                ExecutionMode.SUPERVISOR_WORKER: 2,
            }[execution_mode]
            other_candidates = []
            if max_secondary > 0:
                raw_candidates = await self._config.list_published_agents(
                    exclude_agent_id=agent_version.agent_id
                )
                other_candidates = filter_candidates_by_scope(
                    [
                        RoutingCandidate(c.agent_id, c.agent_version_id, c.name, c.system_prompt)
                        for c in raw_candidates
                    ],
                    scope=router_config.agent_selection_scope,
                    scope_list=router_config.agent_scope_list,
                )
            decision = route(
                command.content,
                primary_candidate,
                other_candidates,
                execution_mode=execution_mode,
                max_secondary=max_secondary,
            )
            ordinal += 1
            steps.append(
                TraceStep(
                    ordinal=ordinal,
                    kind=TraceStepKind.ROUTE,
                    label=f"Routed to {decision.primary.agent_id} (mode={execution_mode.value})",
                    status=TraceStepStatus.OK,
                    duration_ms=0,
                    agent_id=decision.primary.agent_id,
                    confidence=Decimal(str(round(decision.confidence, 4))),
                )
            )
            await self._emit_step(on_event, steps[-1])

            # ============= stage 3: execute ==================================
            replies: list[AgentReply] = []
            candidate_configs: dict[str, CandidateAgentConfig] = {
                c.agent_id: c for c in (await self._config.list_published_agents())
            }
            candidate_configs[agent_version.agent_id] = agent_version

            async def invoke_agent(
                candidate: RoutingCandidate, *, is_secondary: bool, extra_context: str = ""
            ) -> AgentReply:
                nonlocal hop_count, used_fallback_model, tool_call_count, step_up_required_level
                hop_count += 1
                recent_agent_ids.append(candidate.agent_id)
                cfg = candidate_configs.get(candidate.agent_id)
                primary_model = cfg.primary_model if cfg else agent_version.primary_model
                fallback_model = cfg.fallback_model if cfg else agent_version.fallback_model
                temperature = cfg.temperature if cfg else agent_version.temperature
                max_output_tokens = cfg.max_output_tokens if cfg else agent_version.max_output_tokens
                system_prompt = candidate.system_prompt + (
                    f"\n\nContext:\n{extra_context}" if extra_context else ""
                )

                tool_bindings = await self._config.list_tool_bindings(candidate.agent_version_id)
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

                request = ChatRequest(
                    model=primary_model,
                    messages=[
                        ChatMessage(role="system", content=system_prompt),
                        ChatMessage(role="user", content=command.content),
                    ],
                    temperature=temperature,
                    max_output_tokens=max_output_tokens,
                    tools=tool_specs,
                )
                # B-6's one live-token seam: the common widget path (Sequential
                # mode's single, primary invoke) streams the model's own
                # generation genuinely incrementally, forwarding each real delta
                # to `on_event("token", ...)` as it arrives. Every other shape
                # (a secondary/worker invoke, Parallel, SupervisorWorker) keeps
                # the non-streaming `complete()` call — a reasonable, explicitly
                # flagged scope trim (see this module's own docstring) rather
                # than plumbing live per-token forwarding through every
                # execution mode in one pass.
                if (
                    on_event is not None
                    and execution_mode == ExecutionMode.SEQUENTIAL
                    and not is_secondary
                ):
                    streamed_live = True
                    live_on_event = on_event  # `on_event is not None` above narrows this

                    async def _forward_delta(delta: str) -> None:
                        await live_on_event("token", {"text": delta})

                    await live_on_event("agent_started", {"agentId": candidate.agent_id})
                    outcome = await self._streaming_chat_invoker.execute(
                        request, fallback_model=fallback_model, on_delta=_forward_delta
                    )
                else:
                    streamed_live = False
                    outcome = await self._chat_invoker.execute(request, fallback_model=fallback_model)
                ledger.record(outcome.cost)
                if outcome.cost.used_fallback:
                    used_fallback_model = True
                nonlocal ordinal
                ordinal += 1
                # FR-AGENT-12: "a trace entry naming both models and the
                # trigger" — not just which model ultimately answered. When the
                # fallback fired, the label names the failed primary model and
                # the answering fallback model together, and `error_code` carries
                # the primary's own failure reason (`ChatModelUnavailableError`'s
                # message) as the recorded trigger.
                invoke_label = f"{candidate.agent_id} via {outcome.cost.model}"
                invoke_summary = gov.mask_pii(outcome.response.text).masked_text[:500]
                if outcome.cost.used_fallback:
                    invoke_label = (
                        f"{candidate.agent_id}: {primary_model} failed -> fallback {outcome.cost.model}"
                    )
                    trigger = gov.mask_pii(outcome.primary_error or "").masked_text
                    invoke_summary = f"primary failure: {trigger}"[:500]
                steps.append(
                    TraceStep(
                        ordinal=ordinal,
                        kind=TraceStepKind.AGENT_INVOKE,
                        label=invoke_label,
                        status=TraceStepStatus.OK,
                        duration_ms=outcome.cost.duration_ms,
                        agent_id=candidate.agent_id,
                        is_secondary_agent=is_secondary,
                        result_summary=invoke_summary,
                        # `errorCode` is `VARCHAR(64)` — a stable, short code
                        # here, never the (unbounded) raw provider error message,
                        # which lives instead in `result_summary` above for the
                        # fallback case.
                        error_code="orchestration.fallback_triggered"
                        if outcome.cost.used_fallback
                        else None,
                    )
                )
                if streamed_live:
                    await live_on_event(
                        "agent_finished",
                        {"agentId": candidate.agent_id, "status": steps[-1].status.value},
                    )
                else:
                    await self._emit_step(on_event, steps[-1])

                reply_text = outcome.response.text
                if outcome.response.tool_call is not None:
                    binding = bindings_by_key.get(outcome.response.tool_call.tool_name)
                    if binding is not None and not satisfies_required_assurance(
                        held_assurance, binding.required_assurance
                    ):
                        # B-8: evaluated BEFORE the tool call, never after — the
                        # same gate `ExecuteFlowStep` applies to a flow's own
                        # ToolCall node, applied here to an agent's own tool-calling
                        # decision. `self._tool_invoker.invoke` is never reached.
                        blocked_level = required_level_to_assurance(binding.required_assurance)
                        if step_up_required_level is None or assurance_rank(
                            blocked_level
                        ) > assurance_rank(step_up_required_level):
                            step_up_required_level = blocked_level
                        tool_call_count += 1
                        ordinal += 1
                        steps.append(
                            TraceStep(
                                ordinal=ordinal,
                                kind=TraceStepKind.TOOL_CALL,
                                label=f"{outcome.response.tool_call.tool_name} requires step-up",
                                status=TraceStepStatus.BLOCKED,
                                duration_ms=0,
                                tool_binding_id=binding.tool_binding_id,
                                error_code="authz.assurance_insufficient",
                            )
                        )
                        await self._emit_step(on_event, steps[-1])
                    elif binding is not None:
                        try:
                            arguments = json.loads(outcome.response.tool_call.arguments_json)
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
                        tool_call_count += 1
                        ordinal += 1
                        steps.append(
                            TraceStep(
                                ordinal=ordinal,
                                kind=TraceStepKind.TOOL_CALL,
                                label=f"{outcome.response.tool_call.tool_name}",
                                status=TraceStepStatus.OK
                                if tool_result.outcome == ToolInvocationOutcome.OK
                                else TraceStepStatus.FAILED,
                                duration_ms=tool_result.duration_ms,
                                tool_binding_id=binding.tool_binding_id,
                                arguments_masked=_masked_arguments_json(json.dumps(arguments)),
                                result_summary=(tool_result.result_json or tool_result.error or "")[
                                    :500
                                ],
                                error_code=None
                                if tool_result.outcome == ToolInvocationOutcome.OK
                                else tool_result.outcome.value,
                            )
                        )
                        await self._emit_step(on_event, steps[-1])
                        if tool_result.outcome == ToolInvocationOutcome.OK and tool_result.result_json:
                            reply_text = f"Here's what I found: {tool_result.result_json}"
                        elif tool_result.outcome == ToolInvocationOutcome.CIRCUIT_OPEN:
                            reply_text = (
                                "That service is temporarily unavailable — please try again shortly."
                            )
                        else:
                            reply_text = "I couldn't complete that action right now."

                return AgentReply(
                    agent_id=candidate.agent_id,
                    text=reply_text,
                    confidence=Decimal(str(round(decision.confidence, 4))),
                    is_owning_entity=not is_secondary,
                )

            if execution_mode == ExecutionMode.SEQUENTIAL:
                replies.append(await invoke_agent(decision.primary, is_secondary=False))
            elif execution_mode == ExecutionMode.PARALLEL:
                tasks = [invoke_agent(decision.primary, is_secondary=False)]
                tasks.extend(invoke_agent(c, is_secondary=True) for c in decision.secondary)
                replies.extend(await asyncio.gather(*tasks))
            else:  # SUPERVISOR_WORKER
                worker_replies = [await invoke_agent(c, is_secondary=True) for c in decision.secondary]
                plan_summary = "; ".join(f"{w.agent_id}: {w.text[:120]}" for w in worker_replies)
                review = await invoke_agent(
                    decision.primary, is_secondary=False, extra_context=plan_summary
                )
                replies = [*worker_replies, review]

            routed_agent_id = decision.primary.agent_id
            routing_confidence = decision.confidence
            if hop_ceiling_reached(hop_count, budget):
                ceiling_hit = "max_hops"
            elif loop_detected(recent_agent_ids, budget):
                ceiling_hit = "loop_ceiling"
            elif cost_ceiling_reached(ledger, budget):
                ceiling_hit = "cost_ceiling"

        # ============= shared: step-up + ceiling checks (both modes) =========
        # B-8: at least one candidate's/node's own tool-calling decision was
        # gated. Checked before the ceiling block below on the same
        # post-invocation schedule — a blocked tool call is a pause, not a
        # ceiling breach, and must not be reported as one.
        if step_up_required_level is not None:
            if on_event is not None:
                await on_event("step_up_required", {"level": step_up_required_level.value})
            return await self._finish(
                command=command,
                status=TurnStatus.STEP_UP_REQUIRED,
                message_text="Please verify your identity to continue.",
                execution_mode=execution_mode,
                steps=steps,
                degraded=degraded,
                ledger=ledger,
                tool_call_count=tool_call_count,
                grounding_confidence=None,
                used_fallback_model=used_fallback_model,
                escape_triggered=escape_triggered,
                flow_state=flow_state,
                guardrail_pre_result="Pass",
                guardrail_post_result="Skipped",
                agent_version_id=agent_version.agent_version_id,
                routed_agent_id=routed_agent_id,
                hop_count=hop_count,
                pipeline_version_id=pipeline_version_id,
                pipeline_design_id=pipeline_design_id,
                pipeline_label=pipeline_label,
                on_event=on_event,
            )

        if ceiling_hit is not None:
            ordinal += 1
            steps.append(
                TraceStep(
                    ordinal=ordinal,
                    kind=TraceStepKind.MERGE,
                    label=f"Turn terminated: {ceiling_hit} reached",
                    status=TraceStepStatus.BLOCKED,
                    duration_ms=0,
                    error_code=f"orchestration.{ceiling_hit}_exceeded",
                )
            )
            return await self._finish(
                command=command,
                status=TurnStatus.FAILED,
                message_text="I've reached the limit for this request — let me connect you with a live agent.",
                execution_mode=execution_mode,
                steps=steps,
                degraded=degraded,
                ledger=ledger,
                tool_call_count=tool_call_count,
                grounding_confidence=None,
                used_fallback_model=used_fallback_model,
                escape_triggered=escape_triggered,
                flow_state=flow_state,
                guardrail_pre_result="Pass",
                guardrail_post_result="Skipped",
                agent_version_id=agent_version.agent_version_id,
                routed_agent_id=routed_agent_id,
                hop_count=hop_count,
                pipeline_version_id=pipeline_version_id,
                pipeline_design_id=pipeline_design_id,
                pipeline_label=pipeline_label,
                terminal_node_key=terminal_node_key,
                branch_count=branch_count,
                loop_iterations_total=loop_iterations_total,
                on_event=on_event,
            )

        # ================= stage 4: merge (legacy only — a pipeline's own
        # joins already merged internally; `merged_text`/`merge_policy_applied`
        # were set from `pipeline_result` above) =============================
        if not use_pipeline:
            merge_policy = MergePolicy(router_config.response_merge_policy)
            conflict_resolution = ConflictResolution(router_config.conflict_resolution)
            merge_result = merge_replies(
                replies, merge_policy=merge_policy, conflict_resolution=conflict_resolution
            )
            ordinal += 1
            steps.append(
                TraceStep(
                    ordinal=ordinal,
                    kind=TraceStepKind.MERGE,
                    label=f"Merged {len(replies)} repl{'y' if len(replies) == 1 else 'ies'} via {merge_result.policy_applied.value}",
                    status=TraceStepStatus.OK,
                    duration_ms=0,
                    result_summary=f"{len(merge_result.discarded)} discarded",
                )
            )
            merged_text = merge_result.merged_text
            merge_policy_applied = merge_result.policy_applied.value

        # ================= retrieval (RAG grounding, optional) ==============
        grounding_confidence: float | None = None
        citations: list[CitationToPersist] = []
        if self._retrieval is not None:
            retrieval_outcome = await self._retrieval.execute(
                command.content, command.knowledge_collection_ids
            )
            ordinal += 1
            steps.append(
                TraceStep(
                    ordinal=ordinal,
                    kind=TraceStepKind.RETRIEVAL,
                    label=f"{len(retrieval_outcome.results)} passages",
                    status=TraceStepStatus.OK,
                    duration_ms=retrieval_outcome.duration_ms,
                    confidence=Decimal(str(round(retrieval_outcome.grounding_confidence, 4))),
                )
            )
            await self._emit_step(on_event, steps[-1])
            if retrieval_outcome.degraded:
                degraded.extend(retrieval_outcome.degradation_reasons)
            grounding_confidence = retrieval_outcome.grounding_confidence
            citations = [
                CitationToPersist(
                    id="",  # replaced with a real id in `_finish`
                    trace_id="",  # replaced with the real trace id in `_finish`
                    turn_id="",  # replaced with the real turn id in `_finish`
                    chunk_id=passage.chunk_id,
                    knowledge_source_id=passage.knowledge_source_id,
                    rank=rank,
                    vector_score=Decimal(str(round(passage.vector_score, 4))),
                    graph_score=Decimal(str(round(passage.graph_score, 4))),
                    hybrid_score=Decimal(str(round(passage.score, 4))),
                    rerank_score=None,
                    retrieved_via=passage.retrieved_via,
                    graph_path=None,
                    was_cited=rank <= 3,
                )
                for rank, passage in enumerate(retrieval_outcome.results, start=1)
            ]

        # ================= stage 5: guardrail post-check (structural + config) =====
        post_masking = gov.mask_pii(merged_text)
        # Never fall back to `merged_text` here even for a falsy (empty)
        # masked result — an "or" fallback to the unmasked text would be
        # exactly the NFR-DATA-08 violation this stage exists to prevent.
        final_text = post_masking.masked_text
        guardrail_post_result = "Pass"
        status = TurnStatus.COMPLETED

        if grounding_confidence is not None:
            check = gov.check_grounding_threshold(
                grounding_confidence, policies.grounding_threshold
            )
            if not check.passed:
                guardrail_post_result = "Blocked"
                status = TurnStatus.REFUSED
                final_text = _REFUSAL_TEXT

        ordinal += 1
        steps.append(
            TraceStep(
                ordinal=ordinal,
                kind=TraceStepKind.GUARDRAIL_POST,
                label=f"Post-check: {guardrail_post_result}",
                status=TraceStepStatus.BLOCKED
                if guardrail_post_result == "Blocked"
                else TraceStepStatus.OK,
                duration_ms=0,
                confidence=Decimal(str(round(grounding_confidence, 4)))
                if grounding_confidence is not None
                else None,
            )
        )
        await self._emit_step(on_event, steps[-1])

        return await self._finish(
            command=command,
            status=status,
            message_text=final_text,
            execution_mode=execution_mode,
            steps=steps,
            degraded=degraded,
            ledger=ledger,
            tool_call_count=tool_call_count,
            grounding_confidence=grounding_confidence,
            used_fallback_model=used_fallback_model,
            escape_triggered=escape_triggered,
            flow_state=flow_state,
            guardrail_pre_result="Pass",
            guardrail_post_result=guardrail_post_result,
            agent_version_id=agent_version.agent_version_id,
            routed_agent_id=routed_agent_id,
            hop_count=hop_count,
            citations=citations,
            merge_policy_applied=merge_policy_applied,
            routing_confidence=routing_confidence,
            pipeline_version_id=pipeline_version_id,
            pipeline_design_id=pipeline_design_id,
            pipeline_label=pipeline_label,
            terminal_node_key=terminal_node_key,
            branch_count=branch_count,
            loop_iterations_total=loop_iterations_total,
            on_event=on_event,
        )

    async def _emit_step(self, on_event: OnEvent | None, step: TraceStep) -> None:
        """Emit the SSE event(s) the pre-B-6 `conversation_router._sse_events`
        used to derive post-hoc from an already-finished `TurnResult`'s
        steps — now emitted the instant each step itself completes, for
        every trace-step kind this pass does NOT give token-level treatment
        (route, retrieval, flow-escape, handover, guardrail, and any
        tool-call/agent-invoke produced by a path other than the live-
        streamed Sequential-mode primary invoke — e.g. a secondary/worker
        invoke, or the flow engine's own internal steps). A real, if coarser,
        improvement even for those: arriving as soon as this step's own data
        exists rather than buffered until the whole turn ends. A no-op when
        `on_event` is `None` (the JSON-envelope caller, and every existing
        test)."""
        if on_event is None:
            return
        kind = step.kind
        if kind == TraceStepKind.GUARDRAIL_PRE:
            await on_event("guardrail", {"stage": "pre", "status": step.status.value})
        elif kind == TraceStepKind.ROUTE:
            await on_event(
                "route", {"agentId": step.agent_id, "confidence": float(step.confidence or 0)}
            )
        elif kind == TraceStepKind.AGENT_INVOKE:
            await on_event("agent_started", {"agentId": step.agent_id})
            await on_event(
                "agent_finished", {"agentId": step.agent_id, "status": step.status.value}
            )
        elif kind == TraceStepKind.TOOL_CALL:
            await on_event(
                "tool_call_started", {"toolBindingId": step.tool_binding_id, "label": step.label}
            )
            await on_event(
                "tool_call_finished",
                {"toolBindingId": step.tool_binding_id, "outcome": step.status.value},
            )
        elif kind == TraceStepKind.RETRIEVAL:
            await on_event("retrieval", {"label": step.label})
        elif kind == TraceStepKind.FLOW_ESCAPE:
            await on_event("flow_escape", {"label": step.label})
        elif kind == TraceStepKind.HANDOVER:
            await on_event("handover_triggered", {"label": step.label})
        elif kind == TraceStepKind.GUARDRAIL_POST:
            await on_event("guardrail", {"stage": "post", "status": step.status.value})
        # MERGE carries no SSE event, matching the pre-B-6 router's own
        # switch (api.md §5.2's grammar table has no `merge` event either).

    async def _resolve_held_assurance(self, citizen_identity_id: str | None) -> AssuranceLevel:
        """B-8: the conversation's currently-held assurance, resolved fresh
        every turn via `IdentityReader` — never cached on the conversation
        row, so a step-up completed mid-conversation is visible to the very
        next turn's tool-call gate. `citizen_identity_id is None` (an
        anonymous session) short-circuits to `L0` without a read;
        `effective_assurance` itself also decays an expired verification
        back to `L0`."""
        record = (
            await self._identity_reader.get_assurance(citizen_identity_id)
            if citizen_identity_id is not None
            else None
        )
        return effective_assurance(record, datetime.now(UTC))

    async def _resolve_policies(self, agent_id: str) -> _EffectivePolicies:
        policies = {p.policy_key: p for p in await self._config.list_policies()}
        overrides = {o.policy_key: o for o in await self._config.list_policy_overrides(agent_id)}

        def value_for(key: str, default: JsonScalar) -> JsonScalar:
            # A `Policy.defaultValueJson`/`PolicyOverride.valueJson` value is
            # only ever one of these four JSON leaf shapes for the policies
            # this pipeline reads (`CK_Policies_kind IN
            # ('Boolean','Threshold','Enum')`) — a real, narrower type than
            # `json.loads`'s own `Any`, kept explicit rather than erased to
            # `object` (which `float()`/`bool()` below cannot accept) or left
            # as `Any` (which would silently accept a malformed JSON document
            # of the wrong shape without mypy ever flagging it).
            policy = policies.get(key)
            if policy is None:
                return default
            enabled, value_json = _resolve_policy_value(policy, overrides.get(key))
            if not enabled:
                return default
            parsed = (
                json.loads(value_json)
                if value_json is not None
                else json.loads(policy.default_value_json)
            )
            # `CK_Policies_defaultValueJson_isJson`/`CK_PolicyOverrides_valueJson_
            # isJson` both enforce `ISJSON(...) = 1` — and SQL Server's `ISJSON`
            # only accepts a JSON *object or array*, never a bare scalar
            # (`ISJSON('true')` is 0 on SQL Server 2022, confirmed directly
            # against the real container before this shape was chosen). So a
            # bare boolean/number can never legally live in this column; every
            # value this pipeline seeds/reads is wrapped as `{"value": <scalar>}`.
            raw = parsed.get("value") if isinstance(parsed, dict) else None
            if not isinstance(raw, bool | int | float | str):
                return default
            return raw

        return _EffectivePolicies(
            grounding_threshold=float(value_for("grounding_threshold", 0.60)),
            financial_advice_blocked=bool(value_for("block_financial_advice", True)),
            in_scope_restriction_enabled=bool(value_for("restrict_in_scope_services", False)),
            pii_masking_locked=policies.get("mask_pii_in_transcripts") is not None
            and policies["mask_pii_in_transcripts"].is_locked,
            injection_filter_locked=policies.get("prompt_injection_filter") is not None
            and policies["prompt_injection_filter"].is_locked,
        )

    async def _finish(
        self,
        *,
        command: ProcessTurnCommand,
        status: TurnStatus,
        message_text: str,
        execution_mode: ExecutionMode,
        steps: list[TraceStep],
        degraded: list[str],
        ledger: CostLedger,
        tool_call_count: int,
        grounding_confidence: float | None,
        used_fallback_model: bool,
        escape_triggered: bool,
        flow_state: FlowState | None,
        guardrail_pre_result: str,
        guardrail_post_result: str,
        agent_version_id: str,
        routed_agent_id: str,
        hop_count: int,
        citations: list[CitationToPersist] | None = None,
        merge_policy_applied: str | None = None,
        routing_confidence: float | None = None,
        pipeline_version_id: str | None = None,
        pipeline_design_id: str | None = None,
        pipeline_label: str | None = None,
        terminal_node_key: str | None = None,
        branch_count: int = 1,
        loop_iterations_total: int = 0,
        on_event: OnEvent | None = None,
    ) -> TurnResult:
        trace_id = new_ulid()
        turn_row_id = new_ulid()

        # `CK_ConversationTurns_refusalPaired`: wasRefused and refusalReason
        # must be set together or not at all. REFUSED/BLOCKED/FAILED all
        # ended the turn without a real answer, so all three carry a reason;
        # ESCALATED handed the citizen to a human — not a refusal.
        was_refused = status in (TurnStatus.REFUSED, TurnStatus.BLOCKED, TurnStatus.FAILED)
        refusal_reason = (
            guardrail_pre_result
            if status == TurnStatus.BLOCKED
            else guardrail_post_result
            if was_refused
            else None
        )

        await self._store.persist_turn(
            TurnToPersist(
                id=turn_row_id,
                conversation_id=command.conversation_id,
                ordinal=command.turn_ordinal + 1,
                role="Assistant",
                content_masked=message_text,
                content_format="Text",
                agent_version_id=agent_version_id,
                locale_code=command.locale,
                input_tokens=ledger.total_input_tokens,
                output_tokens=ledger.total_output_tokens,
                latency_ms=sum(s.duration_ms for s in steps),
                was_refused=was_refused,
                refusal_reason=refusal_reason,
            )
        )

        await self._store.persist_trace(
            TraceToPersist(
                id=trace_id,
                conversation_id=command.conversation_id,
                turn_id=turn_row_id,
                execution_mode=execution_mode.value,
                routed_agent_id=routed_agent_id,
                routed_agent_version_id=agent_version_id,
                routing_confidence=Decimal(str(round(routing_confidence, 4)))
                if routing_confidence is not None
                else None,
                hop_count=hop_count,
                total_input_tokens=ledger.total_input_tokens,
                total_output_tokens=ledger.total_output_tokens,
                total_cost_micro_aed=ledger.total_cost_micro_aed,
                pending_slot_name=flow_state.current_node_key if flow_state else None,
                escape_triggered=escape_triggered,
                merge_policy_applied=merge_policy_applied,
                guardrail_pre_result=guardrail_pre_result,
                guardrail_post_result=guardrail_post_result,
                grounding_confidence=Decimal(str(round(grounding_confidence, 4)))
                if grounding_confidence is not None
                else None,
                duration_ms=sum(s.duration_ms for s in steps),
                steps=tuple(steps),
                pipeline_version_id=pipeline_version_id,
                pipeline_design_id=pipeline_design_id,
                pipeline_label=pipeline_label,
                terminal_node_key=terminal_node_key,
                branch_count=branch_count,
                loop_iterations_total=loop_iterations_total,
            )
        )

        if citations:
            await self._store.persist_citations(
                [
                    CitationToPersist(
                        id=new_ulid(),
                        trace_id=trace_id,
                        turn_id=turn_row_id,
                        chunk_id=c.chunk_id,
                        knowledge_source_id=c.knowledge_source_id,
                        rank=c.rank,
                        vector_score=c.vector_score,
                        graph_score=c.graph_score,
                        hybrid_score=c.hybrid_score,
                        rerank_score=c.rerank_score,
                        retrieved_via=c.retrieved_via,
                        graph_path=c.graph_path,
                        was_cited=c.was_cited,
                    )
                    for c in citations
                ]
            )

        # The two events every SSE stream must end with exactly one of
        # (api.md §5.2 rule 1) — emitted here, the one place every branch of
        # `execute()` funnels through, so no early-return path can forget
        # either one. `trace_update` precedes it, mirroring the pre-B-6
        # router's own ordering.
        if on_event is not None:
            await on_event(
                "trace_update",
                {"traceId": trace_id, "mode": execution_mode.value, "hopCount": len(steps)},
            )
            if status in (TurnStatus.REFUSED, TurnStatus.BLOCKED, TurnStatus.FAILED):
                await on_event(
                    "error",
                    {
                        "type": f"https://api.shj3.gov.ae/problems/turn.{status.value}",
                        "title": status.value,
                        "status": 200,
                        "code": f"turn.{status.value}",
                        "detail": message_text,
                    },
                )
            else:
                await on_event("done", {"turnId": command.turn_id, "status": status.value})

        return TurnResult(
            turn_id=command.turn_id,
            conversation_id=command.conversation_id,
            trace_id=trace_id,
            status=status,
            message_text=message_text,
            execution_mode=execution_mode.value,
            flow_state=FlowStateSummary(
                flow_version_id=flow_state.flow_version_id if flow_state else None,
                node_key=flow_state.current_node_key if flow_state else None,
                slots=dict(flow_state.slots) if flow_state else {},
                awaiting_slot=flow_state.current_node_key if flow_state else None,
            )
            if flow_state
            else None,
            steps=tuple(steps),
            degraded=tuple(degraded),
            usage=UsageSummary(
                tokens_in=ledger.total_input_tokens,
                tokens_out=ledger.total_output_tokens,
                cost_micro_aed=ledger.total_cost_micro_aed,
                model_calls=len(ledger.calls),
                tool_calls=tool_call_count,
            ),
            grounding_confidence=grounding_confidence,
            used_fallback_model=used_fallback_model,
            escape_triggered=escape_triggered,
            pipeline_version_id=pipeline_version_id,
            pipeline_label=pipeline_label,
            terminal_node_key=terminal_node_key,
        )
