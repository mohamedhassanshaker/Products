"""Backoffice "sandbox testing" — `POST /v1/sandbox/turns`.

Lets a staff Agent Designer chat with the DRAFT (unpublished) version of the
agent/flow they are currently editing, reusing the real `ProcessTurn`/
`ExecuteFlowStep` pipeline for real — without ever creating a real
`Conversations`/`ConversationTurns`/`EscalationTickets` row, and without
letting a bound `ApiConnector` tool make a genuine outbound call while under
test. Mirrors `evaluation_router.py`'s conventions exactly: behind
`TenantContextDep`, every port constructed fresh per request from the
environment, no `BackgroundTasks`/job id/`Idempotency-Key` — one ordinary,
synchronous request/response call.

Real vs. sandboxed, precisely
------------------------------
Everything that decides *how a flow/agent behaves* is real and unchanged:
`SqlAlchemyOrchestrationRepository` (policies, tool bindings, agent-version
resolution — including `get_agent_version_by_id`'s Draft-inclusive lookup,
B-9's own precedent), `SqlAlchemyFlowReader` (flow structure), `RedisCircuit
Breaker` (breaker state), `RedisFlowStateStore` (flow position — keyed by the
caller's own `sandboxSessionId` rather than a real conversation id, safe
because `FlowStateStore` is keyed by an opaque string with no FK to any SQL
table), and the real `SkillInvoker` for `Native` skill logic. Two things are
swapped for a sandbox-safe equivalent — `InMemorySandboxOrchestrationStore`
(never writes a real row) and `SandboxToolInvoker` (never lets an
`ApiConnector` binding reach a real external system); see those two modules'
own docstrings for exactly what each one guarantees.

Resolving the DRAFT flow version, precisely
---------------------------------------------
`ProcessTurn.execute()`'s default flow-resolution path
(`flow_reader.get_flow_version_for_agent`, taken only when no `FlowState` yet
exists for a conversation id) resolves via `AgentFlowBinding` to the current
*published* `FlowVersion` only — never a Draft. But once a live `FlowState`
already exists, `ProcessTurn` instead loads
`flow_reader.get_flow_version_by_id(flow_state.flow_version_id)` directly —
confirmed, by reading `SqlAlchemyFlowReader._load_version`, to be an id-based
load with no status/`is_current` check at all. So: before this endpoint's
first turn for a given `sandboxSessionId` (i.e.
`RedisFlowStateStore.get_state` returns nothing yet), `_seed_draft_flow_
state_if_absent` below loads the caller's own `flowVersionId` directly —
Draft or not — and seeds a `FlowState` at that version's entry node. Every
later turn for the same session resumes through `ProcessTurn`'s own
existing, completely unchanged id-based path; nothing in `ProcessTurn` or
`ExecuteFlowStep` was touched to make this work.

Response shape
---------------
Reuses `conversation_router.TurnEnvelopeOut`/`_to_envelope` directly, not
`evaluation_router.EvaluationTurnOut` — deliberately: sandbox testing's whole
point is letting a designer watch a Draft flow's *position* advance turn
over turn, which is exactly `TurnEnvelopeOut.flow_state`/`.trace` and which
`EvaluationTurnOut` (built for golden-set pass/fail scoring, not interactive
flow debugging) omits entirely. `TurnResult.conversation_id` is, here,
literally the caller's own `sandboxSessionId` (the command below sets
`conversation_id=body.sandbox_session_id`), so `TurnEnvelopeOut`'s
`conversationId` field is an honest fit, not a repurposed one — this is the
one case where reusing `conversation_router.py`'s shape rather than
`evaluation_router.py`'s is the real fit, so it is not duplicated here.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from shj3_ai.adapters.inbound.conversation_router import TurnEnvelopeOut, _to_envelope
from shj3_ai.adapters.inbound.tenant_auth import TenantContextDep
from shj3_ai.adapters.outbound.cache.redis_circuit_breaker import RedisCircuitBreaker
from shj3_ai.adapters.outbound.cache.redis_flow_state_store import RedisFlowStateStore
from shj3_ai.adapters.outbound.chat.deterministic_chat_model import chat_model_from_environment
from shj3_ai.adapters.outbound.sandbox.in_memory_orchestration_store import (
    InMemorySandboxOrchestrationStore,
)
from shj3_ai.adapters.outbound.sandbox.sandbox_tool_invoker import SandboxToolInvoker
from shj3_ai.adapters.outbound.sql.flow_repository import SqlAlchemyFlowReader
from shj3_ai.adapters.outbound.sql.orchestration_repository import SqlAlchemyOrchestrationRepository
from shj3_ai.adapters.outbound.tools.skill_invoker import SkillInvoker
from shj3_ai.application.execute_flow import ExecuteFlowStep
from shj3_ai.application.fallback_chat import InvokeWithFallback
from shj3_ai.application.process_turn import (
    AgentNotFoundError,
    ConversationNotFoundError,
    ProcessTurn,
    ProcessTurnCommand,
)
from shj3_ai.domain.flows import FlowState
from shj3_ai.domain.tenancy import TenantSlug
from shj3_ai.ports.circuit_breaker import CircuitBreakerPort
from shj3_ai.ports.flow_reader import FlowReader
from shj3_ai.ports.flow_state_store import FlowStateStore

router = APIRouter(prefix="/v1/sandbox", tags=["sandbox"])


# ---------------------------------------------------------------------------
# Per-request port construction, each behind its own `Depends` — matches
# `conversation_router.py`'s `ConfigReaderDep` convention exactly, and (unlike
# a single do-everything dependency) lets a test override each real-infra port
# independently with `tests/application/orchestration_fakes.py`'s existing
# fakes. `FlowReader`/`FlowStateStore` need this because this router's own
# handler reads the flow position directly (`_seed_draft_flow_state_if_
# absent` below) before `ProcessTurn` ever sees it, not only through
# `ProcessTurn` itself. `CircuitBreakerPort` needs it too — confirmed live,
# not merely assumed: `ProcessTurn.execute()` calls `self._breaker.
# is_degraded()` unconditionally on every turn's routing stage (not only
# when a `ToolCall` node/tool-calling agent actually reaches `SkillInvoker`),
# so a real `RedisCircuitBreaker` would require live Redis for every sandbox
# turn, tool call or not.
# ---------------------------------------------------------------------------


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


# ---------------------------------------------------------------------------
# Wire model — camelCase both ways, matching `evaluation_router.py`'s convention.
# ---------------------------------------------------------------------------


class SandboxTurnIn(BaseModel):
    #: Caller-minted (`apps/web`), stable for the lifetime of one sandbox chat
    #: session — doubles as the synthetic conversation id this request runs
    #: against (`FlowStateStore` key, `InMemorySandboxOrchestrationStore`'s
    #: one row id). A `sandbox:{ulid}`-shaped value is this feature's own
    #: documented convention, but this endpoint has no opinion on the exact
    #: shape.
    sandbox_session_id: str = Field(alias="sandboxSessionId")
    agent_id: str = Field(alias="agentId")
    #: The version under test — may be Draft, resolved via `ConfigReader.
    #: get_agent_version_by_id`, never `Agent.currentVersionId`. Matches B-9's
    #: `ProcessTurnCommand.agent_version_id`.
    agent_version_id: str = Field(alias="agentVersionId")
    #: The flow version under test — loaded by id (see module docstring),
    #: bypassing the published-only default resolution.
    flow_version_id: str = Field(alias="flowVersionId")
    turn_id: str = Field(alias="turnId")
    #: The caller (`apps/web`) owns turn numbering for the sandbox session it
    #: created — this endpoint has no persisted turn history of its own to
    #: derive it from (that is exactly what `InMemorySandboxOrchestrationStore`
    #: never keeps).
    turn_ordinal: int = Field(alias="turnOrdinal")
    content: str
    locale: str


# ---------------------------------------------------------------------------
# Port construction — real ports throughout except the two sandbox-safe
# swaps; ports constructed fresh per request, matching this codebase's
# established inbound-adapter convention.
# ---------------------------------------------------------------------------


def _build_process_turn(
    *,
    tenant: TenantSlug,
    config: SqlAlchemyOrchestrationRepository,
    breaker: CircuitBreakerPort,
    flow_reader: FlowReader,
    flow_state_store: FlowStateStore,
    sandbox_session_id: str,
    agent_id: str,
    locale: str,
) -> ProcessTurn:
    real_tool_invoker = SkillInvoker(breaker, config, tenant)
    tool_invoker = SandboxToolInvoker(real_tool_invoker)
    flow_executor = ExecuteFlowStep(tool_invoker)
    store = InMemorySandboxOrchestrationStore(
        sandbox_session_id=sandbox_session_id, agent_id=agent_id, locale=locale
    )
    chat_invoker = InvokeWithFallback(chat_model_from_environment())

    return ProcessTurn(
        config=config,
        store=store,
        chat_invoker=chat_invoker,
        breaker=breaker,
        tool_invoker=tool_invoker,
        flow_reader=flow_reader,
        flow_state_store=flow_state_store,
        flow_executor=flow_executor,
        # No real citizen identity ever exists in a sandbox session
        # (`InMemorySandboxOrchestrationStore`'s own `citizen_identity_id=
        # None`) — B-8's gate short-circuits to `AssuranceLevel.L0` without
        # ever calling this port, so wiring the real `SqlAlchemyOrchestration
        # Repository` here (it structurally implements `IdentityReader` too,
        # same as `conversation_router._process_turn`) costs nothing and is
        # never actually invoked.
        identity_reader=config,
        # RAG grounding needs a live Neo4j/Qdrant round trip this feature's
        # brief never asked for (no `knowledgeCollectionIds` on the request
        # body) — omitted rather than silently wired at extra cost sandbox
        # testing does not need. `ProcessTurn` degrades gracefully with
        # `retrieval=None`: no retrieval step, `grounding_confidence=None`.
        retrieval=None,
    )


async def _seed_draft_flow_state_if_absent(
    *,
    flow_reader: FlowReader,
    flow_state_store: FlowStateStore,
    sandbox_session_id: str,
    flow_version_id: str,
) -> None:
    """Before the first turn of a sandbox session, pre-seed the flow-state
    store with the exact (possibly Draft) `flowVersionId` under test —
    loaded by id, which `SqlAlchemyFlowReader.get_flow_version_by_id`
    resolves with no status/`is_current` check. Every later turn in the same
    session resumes via `ProcessTurn`'s own unchanged `flow_state.flow_
    version_id`-based path, never re-resolving "current" and never risking a
    jump onto a different, newer version mid-session."""
    if await flow_state_store.get_state(sandbox_session_id) is not None:
        return  # already seeded by an earlier turn in this same session
    definition = await flow_reader.get_flow_version_by_id(flow_version_id)
    if definition is None:
        raise HTTPException(status_code=404, detail={"code": "sandbox.flow_version_not_found"})
    await flow_state_store.set_state(
        sandbox_session_id,
        FlowState(
            flow_version_id=definition.flow_version_id,
            current_node_key=definition.entry_node_id,
        ),
    )


@router.post("/turns", response_model=TurnEnvelopeOut)
async def run_sandbox_turn(
    body: SandboxTurnIn,
    context: TenantContextDep,
    config: ConfigReaderDep,
    flow_reader: FlowReaderDep,
    flow_state_store: FlowStateStoreDep,
    breaker: CircuitBreakerDep,
) -> TurnEnvelopeOut:
    # `flow_reader`/`flow_state_store` are shared between the seeding step
    # below and `ProcessTurn` itself — both must observe the exact same live
    # flow position, not two independently-constructed views of it.
    await _seed_draft_flow_state_if_absent(
        flow_reader=flow_reader,
        flow_state_store=flow_state_store,
        sandbox_session_id=body.sandbox_session_id,
        flow_version_id=body.flow_version_id,
    )

    process_turn = _build_process_turn(
        tenant=context.tenant,
        config=config,
        breaker=breaker,
        flow_reader=flow_reader,
        flow_state_store=flow_state_store,
        sandbox_session_id=body.sandbox_session_id,
        agent_id=body.agent_id,
        locale=body.locale,
    )
    command = ProcessTurnCommand(
        conversation_id=body.sandbox_session_id,
        turn_id=body.turn_id,
        content=body.content,
        channel="sandbox",
        locale=body.locale,
        agent_id=body.agent_id,
        turn_ordinal=body.turn_ordinal,
        agent_version_id=body.agent_version_id,
    )
    try:
        result = await process_turn.execute(command)
    except ConversationNotFoundError as error:
        raise HTTPException(
            status_code=404, detail={"code": "sandbox.session_not_found"}
        ) from error
    except AgentNotFoundError as error:
        raise HTTPException(
            status_code=404, detail={"code": "sandbox.agent_version_not_found"}
        ) from error

    return _to_envelope(result)
