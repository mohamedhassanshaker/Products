"""Orchestrator/router config preview — `POST /v1/orchestration/trace-preview`.

Lets a platform admin type a sample prompt and see exactly which agents the tenant's
CURRENT, REAL, saved `RouterConfig` would invoke and how their replies would be merged —
without spending real money and without persisting a real `Conversations`/
`ConversationTurns`/`OrchestrationTraces` row. This is a different feature from
`sandbox_router.py`'s "chat with a Draft agent/flow version" (no draft-version resolution,
no multi-turn `flowVersionId`/`FlowState` seeding concept here — every preview run is a
single, stateless turn against the tenant's real, currently-Published agents), but it
reuses that router's own "run the real pipeline, swap out only what must never touch real
data/money" template directly.

Real vs. sandboxed, precisely
------------------------------
`ConfigReader` (`SqlAlchemyOrchestrationRepository`) is REAL and unchanged — this is the
one port a preview must never fake: it is the tenant's actual saved `RouterConfig` (execution
mode, agent-combination scope, ceilings, merge/conflict policy) the whole feature exists to
validate. A fake config here would make the preview lie about what the saved config does.
`CircuitBreakerPort`/`FlowReader`/`FlowStateStore` are also real, for the identical reasons
`sandbox_router.py`'s own module doc already gives (breaker state is read unconditionally
every turn; a Published agent may be flow-bound).

Two ports ARE swapped, for the same reason `sandbox_router.py` already established:
`OrchestrationStore` -> `InMemorySandboxOrchestrationStore` (never persists a real row) and
`ToolInvoker` -> `SandboxToolInvoker` wrapping a real `SkillInvoker` (never lets a bound
`ApiConnector` reach a real external system).

One deliberate DEVIATION from `sandbox_router.py`: the chat model. `sandbox_router.py` calls
`chat_model_from_environment()`, which returns the REAL `LiteLlmChatModel` whenever a live
`SHJ3_OPENROUTER_API_KEY` is configured — acceptable there because sandbox testing is an
Agent Designer's own opt-in "spend real tokens to test my draft" flow. A config *preview*
must never spend real money regardless of whether the tenant has a real API key configured,
so this router constructs `DeterministicChatModel()` directly and unconditionally, never
calling the environment-conditional factory.

No permission check happens here — confirmed by reading every router in this package: none
of them ever inspects `principal.permissions`. `TenantContextDep`'s trust boundary is the
network-policy boundary this service already relies on everywhere; the real enforcement
point for this feature is `apps/web`'s own Server Action, gated on `orchestration:manage`.
"""

from __future__ import annotations

import dataclasses
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from shj3_ai.adapters.inbound.conversation_router import TurnEnvelopeOut, _to_envelope
from shj3_ai.adapters.inbound.tenant_auth import TenantContextDep
from shj3_ai.adapters.outbound.cache.redis_circuit_breaker import RedisCircuitBreaker
from shj3_ai.adapters.outbound.cache.redis_flow_state_store import RedisFlowStateStore
from shj3_ai.adapters.outbound.chat.deterministic_chat_model import DeterministicChatModel
from shj3_ai.adapters.outbound.sandbox.in_memory_orchestration_store import (
    InMemorySandboxOrchestrationStore,
)
from shj3_ai.adapters.outbound.sandbox.sandbox_tool_invoker import SandboxToolInvoker
from shj3_ai.adapters.outbound.sql.flow_repository import SqlAlchemyFlowReader
from shj3_ai.adapters.outbound.sql.orchestration_repository import SqlAlchemyOrchestrationRepository
from shj3_ai.adapters.outbound.sql.pipeline_repository import SqlAlchemyPipelineReader
from shj3_ai.adapters.outbound.tools.skill_invoker import SkillInvoker
from shj3_ai.application.execute_flow import ExecuteFlowStep
from shj3_ai.application.execute_pipeline import ExecutePipeline
from shj3_ai.application.fallback_chat import InvokeWithFallback
from shj3_ai.application.process_turn import (
    AgentNotFoundError,
    ConversationNotFoundError,
    ProcessTurn,
    ProcessTurnCommand,
)
from shj3_ai.domain import condition_expr
from shj3_ai.domain.ids import new_ulid
from shj3_ai.domain.orchestration import ConflictResolution, MergePolicy
from shj3_ai.domain.pipeline import (
    InputContextMode,
    NodeErrorPolicy,
    PipelineDefinition,
    PipelineEdgeDef,
    PipelineEdgeKind,
    PipelineNodeDef,
    PipelineNodeKind,
    validate_definition,
)
from shj3_ai.domain.tenancy import TenantSlug
from shj3_ai.ports.circuit_breaker import CircuitBreakerPort
from shj3_ai.ports.config_reader import (
    AgentVersionConfig,
    CandidateAgent,
    CircuitBreakerConfigRow,
    PolicyOverrideRow,
    PolicyRow,
    PriorTurnRow,
    RouterConfigRow,
    ToolBindingRow,
)
from shj3_ai.ports.flow_reader import FlowReader
from shj3_ai.ports.flow_state_store import FlowStateStore
from shj3_ai.ports.pipeline_reader import PipelineReader

router = APIRouter(prefix="/v1/orchestration", tags=["orchestration"])


def _config_reader(context: TenantContextDep) -> SqlAlchemyOrchestrationRepository:
    return SqlAlchemyOrchestrationRepository(context.tenant)


ConfigReaderDep = Annotated[SqlAlchemyOrchestrationRepository, Depends(_config_reader)]


def _flow_reader(context: TenantContextDep) -> FlowReader:
    return SqlAlchemyFlowReader(context.tenant)


FlowReaderDep = Annotated[FlowReader, Depends(_flow_reader)]


def _flow_state_store(context: TenantContextDep) -> FlowStateStore:
    return RedisFlowStateStore(context.tenant)


FlowStateStoreDep = Annotated[FlowStateStore, Depends(_flow_state_store)]


def _circuit_breaker(context: TenantContextDep) -> CircuitBreakerPort:
    return RedisCircuitBreaker(context.tenant)


CircuitBreakerDep = Annotated[CircuitBreakerPort, Depends(_circuit_breaker)]


class TracePreviewIn(BaseModel):
    #: No single default agent exists for a tenant's router — the caller (apps/web) picks
    #: one from the same Published-agents list the "combine agents" multi-select uses.
    #: Required unless `pipeline_version_id` names a pipeline whose entry resolves without
    #: a turn-bound agent (a fixed-`agentId`/`agentVersionPinId` entry node) — see
    #: `run_trace_preview`'s own check.
    primary_agent_id: str | None = Field(default=None, alias="primaryAgentId")
    content: str
    locale: str = "en"
    #: Unset (the default): dry-runs the tenant's real ACTIVE, Published pipeline exactly
    #: as a citizen turn would (or the legacy dispatcher, if none is active). Set: pins
    #: this SPECIFIC pipeline version — Draft included — regardless of what
    #: `RouterConfigs.activePipelineVersionId` currently points at, mirroring
    #: `sandbox_router.py`'s own `flowVersionId`/`agentVersionId` draft-pin precedent. Lets
    #: an admin dry-run a pipeline before publishing it.
    pipeline_version_id: str | None = Field(default=None, alias="pipelineVersionId")


class _PipelineVersionPinningConfigReader:
    """Decorates the real `SqlAlchemyOrchestrationRepository` (as `ConfigReader`),
    overriding only `get_router_config().active_pipeline_version_id` so `ProcessTurn`'s own
    `router_config.active_pipeline_version_id is not None` gate — and the pipeline it then
    loads — reflect the PINNED version, never the tenant's real, currently-active one. Every
    other method delegates to the real reader unchanged, since a preview must never fake
    agent/policy/tool-binding configuration (this module's own doc comment)."""

    def __init__(
        self, real: SqlAlchemyOrchestrationRepository, pinned_pipeline_version_id: str
    ) -> None:
        self._real = real
        self._pinned_pipeline_version_id = pinned_pipeline_version_id

    async def get_current_agent_version(self, agent_id: str) -> AgentVersionConfig | None:
        return await self._real.get_current_agent_version(agent_id)

    async def get_agent_version_by_id(self, agent_version_id: str) -> AgentVersionConfig | None:
        return await self._real.get_agent_version_by_id(agent_version_id)

    async def list_published_agents(
        self, exclude_agent_id: str | None = None
    ) -> list[CandidateAgent]:
        return await self._real.list_published_agents(exclude_agent_id)

    async def get_router_config(self) -> RouterConfigRow:
        real_config = await self._real.get_router_config()
        return dataclasses.replace(
            real_config, active_pipeline_version_id=self._pinned_pipeline_version_id
        )

    async def list_tool_bindings(self, agent_version_id: str) -> list[ToolBindingRow]:
        return await self._real.list_tool_bindings(agent_version_id)

    async def list_policies(self) -> list[PolicyRow]:
        return await self._real.list_policies()

    async def list_policy_overrides(self, agent_id: str) -> list[PolicyOverrideRow]:
        return await self._real.list_policy_overrides(agent_id)

    async def get_circuit_breaker_config(
        self, target_kind: str, target_ref: str
    ) -> CircuitBreakerConfigRow | None:
        return await self._real.get_circuit_breaker_config(target_kind, target_ref)

    async def get_prior_turns(self, conversation_id: str, limit: int) -> list[PriorTurnRow]:
        return await self._real.get_prior_turns(conversation_id, limit)


class _PinnedPipelineReader:
    """Wraps the real `SqlAlchemyPipelineReader`, resolving `get_active_pipeline_version()`
    to one SPECIFIC, pinned version (Draft included) via `get_pipeline_version_by_id`
    instead — the `PipelineReader` half of the same pin `_PipelineVersionPinningConfigReader`
    establishes on the `ConfigReader` side."""

    def __init__(self, real: SqlAlchemyPipelineReader, pinned_pipeline_version_id: str) -> None:
        self._real = real
        self._pinned_pipeline_version_id = pinned_pipeline_version_id

    async def get_active_pipeline_version(self) -> PipelineDefinition | None:
        return await self._real.get_pipeline_version_by_id(self._pinned_pipeline_version_id)

    async def get_pipeline_version_by_id(
        self, pipeline_version_id: str
    ) -> PipelineDefinition | None:
        return await self._real.get_pipeline_version_by_id(pipeline_version_id)


def _build_process_turn(
    *,
    tenant: TenantSlug,
    config: SqlAlchemyOrchestrationRepository,
    breaker: CircuitBreakerPort,
    flow_reader: FlowReader,
    flow_state_store: FlowStateStore,
    preview_id: str,
    agent_id: str | None,
    locale: str,
    pipeline_version_id: str | None,
) -> ProcessTurn:
    real_tool_invoker = SkillInvoker(breaker, config, tenant)
    tool_invoker = SandboxToolInvoker(real_tool_invoker)
    flow_executor = ExecuteFlowStep(tool_invoker)
    store = InMemorySandboxOrchestrationStore(
        sandbox_session_id=preview_id,
        agent_id=agent_id or "",
        locale=locale,
        channel_key="preview",
    )
    # Unconditional, never `chat_model_from_environment()` — see this module's own
    # doc comment on why a preview must never risk real spend.
    chat_invoker = InvokeWithFallback(DeterministicChatModel())

    # A pinned `pipelineVersionId` wraps both the config and pipeline readers so
    # `ProcessTurn` itself needs no preview-specific branch — it just sees a
    # `RouterConfigs.activePipelineVersionId` that happens to already name the
    # pinned version (`_PipelineVersionPinningConfigReader`'s own doc comment).
    effective_config: SqlAlchemyOrchestrationRepository | _PipelineVersionPinningConfigReader = (
        config
    )
    pipelines: PipelineReader = SqlAlchemyPipelineReader(tenant)
    if pipeline_version_id is not None:
        effective_config = _PipelineVersionPinningConfigReader(config, pipeline_version_id)
        pipelines = _PinnedPipelineReader(SqlAlchemyPipelineReader(tenant), pipeline_version_id)

    return ProcessTurn(
        config=effective_config,
        store=store,
        chat_invoker=chat_invoker,
        breaker=breaker,
        tool_invoker=tool_invoker,
        flow_reader=flow_reader,
        flow_state_store=flow_state_store,
        flow_executor=flow_executor,
        # Structurally satisfies `IdentityReader`, never actually invoked: a preview
        # carries no real citizen identity, so B-8's gate short-circuits to L0 without
        # calling this port — the identical trick `sandbox_router.py` already documents.
        identity_reader=config,
        # No knowledge-collection scope in this feature's brief.
        retrieval=None,
        pipelines=pipelines,
        pipeline_executor=ExecutePipeline(
            config=effective_config, chat_invoker=chat_invoker, tool_invoker=tool_invoker
        ),
    )


async def _resolve_preview_agent_id(
    *, pipeline_reader: SqlAlchemyPipelineReader, body: TracePreviewIn
) -> str:
    """`primaryAgentId` stays required at the `ProcessTurn`/`ProcessTurnCommand` boundary
    (that resolution — policy scoping, `TurnToPersist.agentVersionId` — is core, unchanged,
    heavily-tested behaviour, not something this preview-only endpoint should fork). What
    this DOES relax: a caller previewing a pipeline whose entry is a fixed (not
    turn-bound) agent node no longer has to separately name that same agent again —
    resolved here from the pipeline definition itself, once, before `ProcessTurn` ever
    runs. Only a node with `usesTurnBoundAgent = True` genuinely requires the caller to
    say which agent is "the turn's own" — there, `primaryAgentId` is still mandatory."""
    if body.primary_agent_id is not None:
        return body.primary_agent_id

    definition = (
        await pipeline_reader.get_pipeline_version_by_id(body.pipeline_version_id)
        if body.pipeline_version_id is not None
        else await pipeline_reader.get_active_pipeline_version()
    )
    if definition is None:
        raise HTTPException(
            status_code=422, detail={"code": "orchestration.primary_agent_id_required"}
        )
    if any(n.uses_turn_bound_agent for n in definition.nodes.values()):
        raise HTTPException(
            status_code=422,
            detail={"code": "orchestration.primary_agent_id_required_for_turn_bound_node"},
        )
    fallback_agent_id = next(
        (n.agent_id for n in definition.nodes.values() if n.agent_id is not None), None
    )
    if fallback_agent_id is None:
        raise HTTPException(
            status_code=422, detail={"code": "orchestration.primary_agent_id_required"}
        )
    return fallback_agent_id


@router.post("/trace-preview", response_model=TurnEnvelopeOut)
async def run_trace_preview(
    body: TracePreviewIn,
    context: TenantContextDep,
    config: ConfigReaderDep,
    flow_reader: FlowReaderDep,
    flow_state_store: FlowStateStoreDep,
    breaker: CircuitBreakerDep,
) -> TurnEnvelopeOut:
    preview_id = f"preview:{new_ulid()}"
    agent_id = await _resolve_preview_agent_id(
        pipeline_reader=SqlAlchemyPipelineReader(context.tenant), body=body
    )
    process_turn = _build_process_turn(
        tenant=context.tenant,
        config=config,
        breaker=breaker,
        flow_reader=flow_reader,
        flow_state_store=flow_state_store,
        preview_id=preview_id,
        agent_id=agent_id,
        locale=body.locale,
        pipeline_version_id=body.pipeline_version_id,
    )
    command = ProcessTurnCommand(
        conversation_id=preview_id,
        turn_id=f"turn:{new_ulid()}",
        content=body.content,
        channel="preview",
        locale=body.locale,
        agent_id=agent_id,
        turn_ordinal=1,
        # Unset: resolves the agent's real, current PUBLISHED version
        # (`get_current_agent_version`), exactly what a real citizen turn would
        # resolve — never a Draft, unlike `sandbox_router.py`'s own `agentVersionId`.
    )
    try:
        result = await process_turn.execute(command)
    except ConversationNotFoundError as error:
        # Unreachable in practice (`InMemorySandboxOrchestrationStore` always resolves
        # the one synthetic id it was built for) — kept for the same defensive-parity
        # reason `sandbox_router.py` keeps its own identical catch.
        raise HTTPException(
            status_code=404, detail={"code": "orchestration.preview_session_not_found"}
        ) from error
    except AgentNotFoundError as error:
        raise HTTPException(
            status_code=404, detail={"code": "orchestration.primary_agent_not_found"}
        ) from error

    return _to_envelope(result)


# ---------------------------------------------------------------------------
# Pipeline graph/condition validation — `POST /v1/orchestration/pipelines/validate` and
# `.../validate-condition`. The same rule sets `TR_PipelineVersions_publishGraphValid`
# (SQL, enforced at publish) and `pipeline-graph.ts`'s `analyzePipelineGraph` (TS, the
# live canvas) apply — this endpoint is the THIRD of the three deliberately-mirrored
# implementations `domain/pipeline.py::validate_definition`/`domain/condition_expr.py`
# already are, exposed over HTTP so the web canvas never has to re-implement either
# grammar to get a server-checked answer.
# ---------------------------------------------------------------------------


class PipelineNodeIn(BaseModel):
    key: str
    kind: str
    agent_id: str | None = Field(default=None, alias="agentId")
    uses_turn_bound_agent: bool = Field(default=False, alias="usesTurnBoundAgent")
    agent_version_pin_id: str | None = Field(default=None, alias="agentVersionPinId")
    input_context_mode: str = Field(default="UserTurnOnly", alias="inputContextMode")
    merge_policy_override: str | None = Field(default=None, alias="mergePolicyOverride")
    conflict_resolution_override: str | None = Field(
        default=None, alias="conflictResolutionOverride"
    )
    is_owning_entity: bool = Field(default=False, alias="isOwningEntity")
    on_error_policy: str = Field(default="FailTurn", alias="onErrorPolicy")


class PipelineEdgeIn(BaseModel):
    from_node_key: str = Field(alias="fromNodeKey")
    to_node_key: str = Field(alias="toNodeKey")
    kind: str
    ordinal: int = 0
    max_iterations: int | None = Field(default=None, alias="maxIterations")
    condition_expression: str | None = Field(default=None, alias="conditionExpression")


class ValidatePipelineIn(BaseModel):
    entry_node_key: str = Field(alias="entryNodeKey")
    nodes: list[PipelineNodeIn]
    edges: list[PipelineEdgeIn]
    max_total_hops: int = Field(default=10, alias="maxTotalHops")
    cost_ceiling_tokens: int = Field(default=1_000_000, alias="costCeilingTokens")
    cost_ceiling_micro_aed: int = Field(default=100_000_000, alias="costCeilingMicroAed")
    default_merge_policy: str = Field(default="DeduplicateOverlap", alias="defaultMergePolicy")
    default_conflict_resolution: str = Field(
        default="HighestConfidence", alias="defaultConflictResolution"
    )
    #: Every currently-Published agent id — an unpublished reference is
    #: `agent_not_published`, one of `validate_definition`'s own blocking findings.
    published_agent_ids: list[str] = Field(default_factory=list, alias="publishedAgentIds")


class ValidationIssueOut(BaseModel):
    code: str
    node_keys: list[str] = Field(default_factory=list, serialization_alias="nodeKeys")
    edge_keys: list[str] = Field(default_factory=list, serialization_alias="edgeKeys")
    message: str


class ValidatePipelineOut(BaseModel):
    #: `validate_definition` mirrors `TR_PipelineVersions_publishGraphValid` — a purely
    #: publish-blocking gate with no advisory tier (that distinction is the web canvas's
    #: own `analyzePipelineGraph` concept, layered on top of, not instead of, this check).
    #: Any issue here means the graph cannot be published/run.
    valid: bool
    issues: list[ValidationIssueOut]


def _build_pipeline_definition_for_validation(body: ValidatePipelineIn) -> PipelineDefinition:
    nodes = {
        n.key: PipelineNodeDef(
            key=n.key,
            kind=PipelineNodeKind(n.kind),
            title=n.key,
            agent_id=n.agent_id,
            uses_turn_bound_agent=n.uses_turn_bound_agent,
            agent_version_pin_id=n.agent_version_pin_id,
            input_context_mode=InputContextMode(n.input_context_mode),
            merge_policy_override=MergePolicy(n.merge_policy_override)
            if n.merge_policy_override
            else None,
            conflict_resolution_override=ConflictResolution(n.conflict_resolution_override)
            if n.conflict_resolution_override
            else None,
            is_owning_entity=n.is_owning_entity,
            on_error_policy=NodeErrorPolicy(n.on_error_policy),
        )
        for n in body.nodes
    }
    edges_from: dict[str, list[PipelineEdgeDef]] = {}
    edges_into: dict[str, list[PipelineEdgeDef]] = {}
    for e in body.edges:
        edge_def = PipelineEdgeDef(
            from_node_key=e.from_node_key,
            to_node_key=e.to_node_key,
            kind=PipelineEdgeKind(e.kind),
            ordinal=e.ordinal,
            max_iterations=e.max_iterations,
            condition_expression=e.condition_expression,
        )
        edges_from.setdefault(e.from_node_key, []).append(edge_def)
        edges_into.setdefault(e.to_node_key, []).append(edge_def)
    for bucket in (edges_from, edges_into):
        for lst in bucket.values():
            lst.sort(key=lambda edge: edge.ordinal)

    return PipelineDefinition(
        pipeline_version_id="preview",
        pipeline_design_id="preview",
        label="preview",
        entry_node_key=body.entry_node_key,
        max_total_hops=body.max_total_hops,
        cost_ceiling_tokens=body.cost_ceiling_tokens,
        cost_ceiling_micro_aed=body.cost_ceiling_micro_aed,
        default_merge_policy=MergePolicy(body.default_merge_policy),
        default_conflict_resolution=ConflictResolution(body.default_conflict_resolution),
        routing_strategy="IntentClassifier",
        min_routing_confidence=0.0,
        fallback_agent_id=None,
        nodes=nodes,
        edges_from={k: tuple(v) for k, v in edges_from.items()},
        edges_into={k: tuple(v) for k, v in edges_into.items()},
    )


@router.post("/pipelines/validate", response_model=ValidatePipelineOut)
async def validate_pipeline_graph(body: ValidatePipelineIn) -> ValidatePipelineOut:
    """The same `validate_definition` the graph interpreter itself would run against — a
    designer's canvas gets a server-checked answer before ever attempting to Publish, using
    the identical rule set `TR_PipelineVersions_publishGraphValid` enforces at that point."""
    try:
        definition = _build_pipeline_definition_for_validation(body)
    except ValueError as error:
        return ValidatePipelineOut(
            valid=False,
            issues=[
                ValidationIssueOut(code="orchestration.pipeline.malformed_graph", message=str(error))
            ],
        )
    issues = validate_definition(
        definition, published_agent_ids=frozenset(body.published_agent_ids)
    )
    return ValidatePipelineOut(
        valid=len(issues) == 0,
        issues=[
            ValidationIssueOut(
                code=i.code,
                node_keys=list(i.node_keys),
                edge_keys=list(i.edge_keys),
                message=i.message,
            )
            for i in issues
        ],
    )


class ValidateConditionIn(BaseModel):
    expression: str
    #: The pipeline version's real node keys — a `node.<key>.*` field template validates
    #: only against a key that genuinely exists in this graph.
    known_node_keys: list[str] = Field(default_factory=list, alias="knownNodeKeys")


class ValidateConditionOut(BaseModel):
    valid: bool
    normalized: str | None = None
    issues: list[str]


@router.post("/pipelines/validate-condition", response_model=ValidateConditionOut)
async def validate_pipeline_condition(body: ValidateConditionIn) -> ValidateConditionOut:
    """Called on blur by the edge inspector, and again by the publish gate — same grammar
    (`domain/condition_expr.py`), so a condition the designer accepted can never be one the
    interpreter later refuses."""
    issues = condition_expr.validate(
        body.expression, known_node_keys=frozenset(body.known_node_keys)
    )
    if issues:
        return ValidateConditionOut(
            valid=False, normalized=None, issues=[i.message for i in issues]
        )
    ast = condition_expr.parse(body.expression)
    return ValidateConditionOut(valid=True, normalized=condition_expr.describe(ast), issues=[])
