"""The B-5/B-6 turn pipeline's tenant-scoped API — `POST /v1/conversations/{id}/turns`
(api.md §5.1). Mirrors `knowledge_router.py`'s conventions exactly: every route
behind `TenantContextDep`, ports constructed fresh per request from the
environment, Pydantic models with camelCase aliases both ways.

**Real, incremental streaming (B-6).** `Accept: application/json` is
untouched: `_run_turn()` still awaits `ProcessTurn.execute()` to completion
and returns the buffered envelope, exactly as before. `Accept:
text/event-stream` no longer works that way — it used to run the whole
pipeline to completion first and only then replay its finished `TurnResult`
as a fake "stream" (chunking the final text into words after the fact). Now:
an `asyncio.Queue` is created, `process_turn.execute(command, on_event=...)`
is launched as its own concurrent `asyncio.Task` whose `on_event` callback
does `await queue.put((name, data))` the instant `ProcessTurn` itself emits
each event (see that module's own docstring for exactly which stage
transitions this covers, and its one deliberately scoped-out case: token-
level streaming is real only for the Sequential-mode primary agent invoke —
the common widget path — with every other shape emitting one event per
completed step), and this generator's own `await queue.get()` calls are
genuine waits on the real pipeline's real timing — real backpressure from a
live task, not a replay synthesized after the fact. A `:heartbeat` comment
(api.md §5.2) is emitted whenever 15 real seconds pass with no event, via
`asyncio.wait_for(queue.get(), timeout=15)`, so an idle gap during a long
tool call or a slow provider response does not get an intermediary proxy to
close the connection.
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from shj3_ai.adapters.inbound.tenant_auth import TenantContextDep
from shj3_ai.adapters.outbound.cache.redis_circuit_breaker import RedisCircuitBreaker
from shj3_ai.adapters.outbound.cache.redis_flow_state_store import RedisFlowStateStore
from shj3_ai.adapters.outbound.chat.deterministic_chat_model import chat_model_from_environment
from shj3_ai.adapters.outbound.embedding.openai_embedder import embedder_from_environment
from shj3_ai.adapters.outbound.graph.graph_provisioner import Neo4jStatementExecutor
from shj3_ai.adapters.outbound.graph.graph_store import Neo4jGraphStore
from shj3_ai.adapters.outbound.rerank.cohere_reranker import reranker_from_environment
from shj3_ai.adapters.outbound.sql.flow_repository import SqlAlchemyFlowReader
from shj3_ai.adapters.outbound.sql.knowledge_repository import SqlAlchemyKnowledgeReader
from shj3_ai.adapters.outbound.sql.orchestration_repository import SqlAlchemyOrchestrationRepository
from shj3_ai.adapters.outbound.sql.pipeline_repository import SqlAlchemyPipelineReader
from shj3_ai.adapters.outbound.tools.skill_invoker import SkillInvoker
from shj3_ai.adapters.outbound.vector.qdrant_vector_store import (
    QdrantVectorStore,
    vector_client_from_environment,
)
from shj3_ai.application.execute_flow import ExecuteFlowStep
from shj3_ai.application.execute_pipeline import ExecutePipeline
from shj3_ai.application.fallback_chat import InvokeWithFallback
from shj3_ai.application.hybrid_retrieve import HybridRetrieve
from shj3_ai.application.process_turn import (
    AgentNotFoundError,
    ConversationNotFoundError,
    ProcessTurn,
    ProcessTurnCommand,
    TurnResult,
)
from shj3_ai.domain.orchestration import Budget
from shj3_ai.runtime_state import track_turn

router = APIRouter(prefix="/v1/conversations", tags=["conversations"])


# ---------------------------------------------------------------------------
# Per-request port construction — matches `knowledge_router.py`'s convention.
# ---------------------------------------------------------------------------


def _config_reader(context: TenantContextDep) -> SqlAlchemyOrchestrationRepository:
    return SqlAlchemyOrchestrationRepository(context.tenant)


ConfigReaderDep = Annotated[SqlAlchemyOrchestrationRepository, Depends(_config_reader)]


def _process_turn(context: TenantContextDep, config: ConfigReaderDep) -> ProcessTurn:
    tenant = context.tenant
    store = config  # same class, structurally both ports (see its own docstring)
    breaker = RedisCircuitBreaker(tenant)
    tool_invoker = SkillInvoker(breaker, config, tenant)
    flow_reader = SqlAlchemyFlowReader(tenant)
    flow_state_store = RedisFlowStateStore(tenant)
    flow_executor = ExecuteFlowStep(tool_invoker)
    chat_invoker = InvokeWithFallback(chat_model_from_environment())

    # Retrieval is optional: a turn that never needs RAG grounding (a pure
    # flow/tool-call journey) does not pay for a Neo4j/Qdrant round trip.
    # Wired here for real whenever knowledge collections are configured —
    # `ProcessTurn` itself degrades gracefully (no retrieval step at all,
    # `grounding_confidence=None`) when this is `None`.
    sql_reader = SqlAlchemyKnowledgeReader(tenant)
    # 3072 = ADR-0004's fixed default (`text-embedding-3-large`'s own
    # dimension) — `knowledge_router.retrieval_query` instead reads the exact
    # per-collection dimension from `RetrievalConfig` first, but doing that
    # here would require this dependency function to also depend on the
    # request body (FastAPI can do this, at the cost of parsing the body
    # twice), for a collection-level override no seeded tenant in this
    # environment actually uses. Flagged rather than silently assumed
    # equivalent to the knowledge module's own, more precise resolution.
    retrieval = HybridRetrieve(
        Neo4jGraphStore(Neo4jStatementExecutor.from_environment(), tenant),
        QdrantVectorStore(vector_client_from_environment(), tenant),
        embedder_from_environment(3072),
        reranker_from_environment(),
        sql_reader,
    )

    return ProcessTurn(
        config=config,
        store=store,
        chat_invoker=chat_invoker,
        breaker=breaker,
        tool_invoker=tool_invoker,
        flow_reader=flow_reader,
        flow_state_store=flow_state_store,
        flow_executor=flow_executor,
        # B-8: same `SqlAlchemyOrchestrationRepository` instance — it
        # structurally implements `IdentityReader` too (see that adapter's own
        # docstring), so no separate construction is needed here.
        identity_reader=config,
        retrieval=retrieval,
        # Cheap to construct unconditionally (no I/O until a method is
        # actually called) — `ProcessTurn` itself only ever reaches for these
        # when `RouterConfigs.activePipelineVersionId` is set, so this is a
        # no-op for every tenant that has never activated a pipeline.
        pipelines=SqlAlchemyPipelineReader(tenant),
        pipeline_executor=ExecutePipeline(
            config=config, chat_invoker=chat_invoker, tool_invoker=tool_invoker
        ),
    )


ProcessTurnDep = Annotated[ProcessTurn, Depends(_process_turn)]


# ---------------------------------------------------------------------------
# Wire models — api.md §5.1/§5.3, camelCase both ways.
# ---------------------------------------------------------------------------


class AgentBindingIn(BaseModel):
    agent_id: str = Field(alias="agentId")


class BudgetIn(BaseModel):
    max_hops: int | None = Field(default=None, alias="maxHops")
    max_tool_calls: int | None = Field(default=None, alias="maxToolCalls")
    max_cost_aed: float | None = Field(default=None, alias="maxCostAed")
    max_tokens: int | None = Field(default=None, alias="maxTokens")


class ProcessTurnRequestIn(BaseModel):
    turn_id: str = Field(alias="turnId")
    content: str
    channel: str = "web"
    locale: str = "en"
    agent_binding: AgentBindingIn = Field(alias="agentBinding")
    budget: BudgetIn | None = None
    diagnostics: bool = False
    knowledge_collection_ids: list[str] | None = Field(default=None, alias="knowledgeCollectionIds")


class MessageOut(BaseModel):
    role: str = "assistant"
    content: str
    suggestions: list[str] = Field(default_factory=list)


class FlowStateOut(BaseModel):
    flow_version_id: str | None = Field(serialization_alias="flowVersionId")
    node_key: str | None = Field(serialization_alias="nodeKey")
    slots: dict[str, str]
    awaiting_slot: str | None = Field(serialization_alias="awaitingSlot")


class TraceStepOut(BaseModel):
    ordinal: int
    kind: str
    label: str
    status: str
    duration_ms: int = Field(serialization_alias="durationMs")
    agent_id: str | None = Field(default=None, serialization_alias="agentId")
    tool_binding_id: str | None = Field(default=None, serialization_alias="toolBindingId")
    confidence: float | None = None
    error_code: str | None = Field(default=None, serialization_alias="errorCode")
    is_secondary_agent: bool = Field(serialization_alias="isSecondaryAgent")
    #: Purely additive — unset for every legacy-mode step. Populated only by
    #: `ExecutePipeline`'s graph interpreter (`execute_pipeline.py`).
    pipeline_node_key: str | None = Field(default=None, serialization_alias="pipelineNodeKey")
    from_node_key: str | None = Field(default=None, serialization_alias="fromNodeKey")
    edge_kind: str | None = Field(default=None, serialization_alias="edgeKind")
    branch_id: str | None = Field(default=None, serialization_alias="branchId")
    loop_iteration: int | None = Field(default=None, serialization_alias="loopIteration")
    depth: int | None = None


class TraceOut(BaseModel):
    trace_id: str = Field(serialization_alias="traceId")
    mode: str
    hops: list[TraceStepOut]
    degraded: list[str]
    escape_triggered: bool = Field(serialization_alias="escapeTriggered")
    used_fallback_model: bool = Field(serialization_alias="usedFallbackModel")
    #: Purely additive — unset whenever `mode != "Pipeline"`.
    pipeline_version_id: str | None = Field(default=None, serialization_alias="pipelineVersionId")
    pipeline_label: str | None = Field(default=None, serialization_alias="pipelineLabel")
    terminal_node_key: str | None = Field(default=None, serialization_alias="terminalNodeKey")


class UsageOut(BaseModel):
    tokens_in: int = Field(serialization_alias="tokensIn")
    tokens_out: int = Field(serialization_alias="tokensOut")
    cost_aed: float = Field(serialization_alias="costAed")
    model_calls: int = Field(serialization_alias="modelCalls")
    tool_calls: int = Field(serialization_alias="toolCalls")


class TurnEnvelopeOut(BaseModel):
    turn_id: str = Field(serialization_alias="turnId")
    conversation_id: str = Field(serialization_alias="conversationId")
    status: str
    message: MessageOut
    flow_state: FlowStateOut | None = Field(default=None, serialization_alias="flowState")
    trace: TraceOut
    usage: UsageOut
    grounding_confidence: float | None = Field(
        default=None, serialization_alias="groundingConfidence"
    )


def _to_envelope(result: TurnResult) -> TurnEnvelopeOut:
    return TurnEnvelopeOut(
        turn_id=result.turn_id,
        conversation_id=result.conversation_id,
        status=result.status.value,
        message=MessageOut(content=result.message_text),
        flow_state=FlowStateOut(
            flow_version_id=result.flow_state.flow_version_id,
            node_key=result.flow_state.node_key,
            slots=result.flow_state.slots,
            awaiting_slot=result.flow_state.awaiting_slot,
        )
        if result.flow_state
        else None,
        trace=TraceOut(
            trace_id=result.trace_id,
            mode=result.execution_mode,
            hops=[
                TraceStepOut(
                    ordinal=s.ordinal,
                    kind=s.kind.value,
                    label=s.label,
                    status=s.status.value,
                    duration_ms=s.duration_ms,
                    agent_id=s.agent_id,
                    tool_binding_id=s.tool_binding_id,
                    confidence=float(s.confidence) if s.confidence is not None else None,
                    error_code=s.error_code,
                    is_secondary_agent=s.is_secondary_agent,
                    pipeline_node_key=s.pipeline_node_key,
                    from_node_key=s.from_node_key,
                    edge_kind=s.edge_kind,
                    branch_id=s.branch_id,
                    loop_iteration=s.loop_iteration,
                    depth=s.depth,
                )
                for s in result.steps
            ],
            degraded=list(result.degraded),
            escape_triggered=result.escape_triggered,
            used_fallback_model=result.used_fallback_model,
            pipeline_version_id=result.pipeline_version_id,
            pipeline_label=result.pipeline_label,
            terminal_node_key=result.terminal_node_key,
        ),
        usage=UsageOut(
            tokens_in=result.usage.tokens_in,
            tokens_out=result.usage.tokens_out,
            cost_aed=result.usage.cost_micro_aed / 1_000_000,
            model_calls=result.usage.model_calls,
            tool_calls=result.usage.tool_calls,
        ),
        grounding_confidence=result.grounding_confidence,
    )


async def _build_command(
    config_reader: SqlAlchemyOrchestrationRepository,
    conversation_id: str,
    body: ProcessTurnRequestIn,
) -> ProcessTurnCommand:
    """Shared by both the JSON and SSE branches of `post_turn` — the command
    a turn runs against does not depend on how its result will be delivered."""
    prior = await config_reader.get_prior_turns(conversation_id, limit=1000)
    budget = None
    if body.budget is not None and (body.budget.max_hops or body.budget.max_tokens):
        # A per-turn override narrower than `RouterConfig`'s own ceilings is
        # honoured; a caller cannot use this to *widen* the configured
        # ceiling beyond what the tenant's admin set (api.md §5.1's `budget`
        # is a citizen-session request, not a privilege escalation surface).
        router_config = await config_reader.get_router_config()
        budget = Budget(
            max_hops=min(body.budget.max_hops or router_config.max_hops, router_config.max_hops),
            max_loop_iterations=router_config.max_loop_iterations,
            cost_ceiling_tokens=min(
                body.budget.max_tokens or router_config.cost_ceiling_tokens,
                router_config.cost_ceiling_tokens,
            ),
            cost_ceiling_micro_aed=router_config.cost_ceiling_micro_aed,
        )
    return ProcessTurnCommand(
        conversation_id=conversation_id,
        turn_id=body.turn_id,
        content=body.content,
        channel=body.channel,
        locale=body.locale,
        agent_id=body.agent_binding.agent_id,
        turn_ordinal=len(prior) + 1,
        budget_override=budget,
        knowledge_collection_ids=body.knowledge_collection_ids,
    )


async def _run_turn(
    process_turn: ProcessTurn,
    config_reader: SqlAlchemyOrchestrationRepository,
    conversation_id: str,
    body: ProcessTurnRequestIn,
) -> TurnResult:
    """The `Accept: application/json` path — unchanged by B-6: still awaits
    the whole pipeline to completion and returns one buffered envelope."""
    command = await _build_command(config_reader, conversation_id, body)
    try:
        with track_turn():
            return await process_turn.execute(command)
    except ConversationNotFoundError as error:
        raise HTTPException(status_code=404, detail={"code": "conversation.not_found"}) from error
    except AgentNotFoundError as error:
        raise HTTPException(status_code=404, detail={"code": "agent.not_found"}) from error


@router.post("/{conversation_id}/turns", response_model=TurnEnvelopeOut)
async def post_turn(
    conversation_id: str,
    body: ProcessTurnRequestIn,
    request: Request,
    process_turn: ProcessTurnDep,
    config_reader: ConfigReaderDep,
    _context: TenantContextDep,
) -> TurnEnvelopeOut | StreamingResponse:
    accept = request.headers.get("accept", "")
    if "application/json" in accept:
        result = await _run_turn(process_turn, config_reader, conversation_id, body)
        return _to_envelope(result)

    # The SSE branch can no longer run the turn to completion before
    # deciding how to respond (that would put us right back at
    # buffered-then-flushed) — so the command is built first, and the
    # conversation/agent existence check `ProcessTurn.execute()` itself would
    # perform moments later is done here too, deliberately redundant with it.
    # api.md §5.1's `404 conversation.not_found`/`agent.not_found` is a real
    # HTTP status line; once `StreamingResponse` starts, that status line is
    # already committed to `200` (api.md §5.2: "an error therefore arrives as
    # an `error` **event**, not a status code") — so this is the one check
    # that must happen *before* the stream opens, not inside it.
    command = await _build_command(config_reader, conversation_id, body)
    if await config_reader.get_conversation(conversation_id) is None:
        raise HTTPException(status_code=404, detail={"code": "conversation.not_found"})
    if await config_reader.get_current_agent_version(command.agent_id) is None:
        raise HTTPException(status_code=404, detail={"code": "agent.not_found"})

    return StreamingResponse(
        _sse_stream(process_turn, command),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-store",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


_HEARTBEAT_INTERVAL_SECONDS = 15.0

#: The queue carries `(event_name, payload)` pairs as `ProcessTurn` produces
#: them, or `None` — the sentinel `_run_process_turn`'s own `finally` always
#: puts, success or failure, so `_sse_stream`'s consumer loop always
#: terminates rather than waiting on a queue nobody will ever finish filling.
_QueueItem = tuple[str, dict[str, object]] | None


async def _sse_stream(process_turn: ProcessTurn, command: ProcessTurnCommand) -> AsyncIterator[str]:
    """Real SSE delivery (B-6): `process_turn.execute()` runs concurrently as
    its own `asyncio.Task`, forwarding every stage-transition/token event it
    produces into `queue` the instant it happens; this generator's own
    `await queue.get()` calls are genuine waits on the real pipeline's real
    timing, not a replay of an already-finished `TurnResult` (contrast with
    B-5's original `_sse_events`, which this supersedes). `turn_started` is
    still emitted here, immediately, before the task has had a chance to run
    — matching api.md §5.2 rule 1 ("the first event is always
    `turn_started`") without needing `ProcessTurn` itself to know its own
    turn/conversation id are already known to the caller.
    """
    queue: asyncio.Queue[_QueueItem] = asyncio.Queue()
    event_id = 0

    def _frame(name: str, data: dict[str, object]) -> str:
        nonlocal event_id
        event_id += 1
        return f"id: {event_id}\nevent: {name}\ndata: {json.dumps(data)}\n\n"

    async def _on_event(name: str, data: dict[str, object]) -> None:
        await queue.put((name, data))

    async def _run_process_turn() -> None:
        try:
            with track_turn():
                await process_turn.execute(command, on_event=_on_event)
            # `ProcessTurn.execute()` already emitted its own `trace_update`
            # and exactly one of `done`/`error` via `on_event` before
            # returning (see that module's `_finish`) — nothing further to
            # enqueue here for the happy/handled-failure paths.
        except Exception as error:
            # `ProcessTurn.execute()` turns every *anticipated* termination
            # (blocked, refused, a ceiling hit) into a normal `TurnResult`
            # whose own `error`/`done` event it emits itself — this branch
            # only ever fires for a genuinely unhandled failure (an uncaught
            # `ChatModelUnavailableError` with no configured fallback,
            # `ConversationNotFoundError`/`AgentNotFoundError` racing a
            # concurrent delete after `post_turn`'s own pre-check above
            # passed, or a real bug). api.md §5.2 rule 1 still requires
            # exactly one terminal event — this is that fallback, not a
            # silent stream close.
            await queue.put(
                (
                    "error",
                    {
                        "type": "https://api.shj3.gov.ae/problems/upstream.invalid_response",
                        "title": "Turn processing failed",
                        "status": 200,
                        "code": "upstream.invalid_response",
                        "detail": str(error),
                    },
                )
            )
        finally:
            await queue.put(None)

    # A reference must be kept for the task's whole lifetime — an
    # `asyncio.Task` with no other reference can be garbage-collected
    # mid-execution (a real, documented `asyncio` gotcha, not just a lint
    # nag). This generator's own frame stays alive for exactly as long as
    # the task needs to run, so a plain local binding is enough.
    background_task = asyncio.create_task(_run_process_turn())
    yield _frame(
        "turn_started", {"turnId": command.turn_id, "conversationId": command.conversation_id}
    )

    while True:
        try:
            item = await asyncio.wait_for(queue.get(), timeout=_HEARTBEAT_INTERVAL_SECONDS)
        except TimeoutError:
            # api.md §5.2: "a `:heartbeat` comment every 15 seconds stops
            # intermediaries closing an idle stream during a long tool call."
            # An SSE comment line, not an event — no `id`/`event`/`data`.
            yield ":heartbeat\n\n"
            continue
        if item is None:
            break
        name, data = item
        yield _frame(name, data)

    # By the time `None` (the sentinel) has been read, `_run_process_turn`'s
    # own `finally` has already run — this `await` is a formality that lets
    # the task's frame be released promptly rather than waiting for garbage
    # collection, and would re-raise here only if something inside
    # `_run_process_turn` itself violated its own try/except/finally shape.
    await background_task
