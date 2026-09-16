"""Golden-set regression evaluation's (B-9) tenant-scoped API — the `shj3-ai`
half of a feature whose batch orchestration lives on `apps/web` instead. See
`shj3_ai.domain.evaluation`'s module docstring for the real, grant-level
reason this router is two small, stateless-as-possible endpoints rather than
the `POST /v1/evaluation/runs` + `GET /v1/evaluation/runs/{runId}` job-style
pair `docs/api.md` §5.7 documents — that document's literal contract predates
this finding and has not been updated to match; flagged here plainly rather
than silently implemented against a contract this service cannot actually
fulfil (`shj3_ai_ro` has no write grant on `RegressionRuns`,
`RegressionCaseResults`, `Conversations` or `GoldenSets`).

Both endpoints below mirror `conversation_router.py`/`knowledge_router.py`'s
exact conventions: every route behind `TenantContextDep`, ports constructed
fresh per request, Pydantic models with camelCase aliases both ways, and the
same `HTTPException(status_code=..., detail={"code": ...})` error shape used
throughout this inbound layer (no problem-details `type`/`title` envelope —
that shape is reserved for the SSE `error` *event* `process_turn.py`/
`conversation_router.py` build for a stream already in flight, not for an
ordinary JSON error response).

**Endpoint 1 — `POST /v1/evaluation/turns`.** Runs exactly one turn, pinned to
a specific `agentVersionId` (B-9's `ProcessTurnCommand.agent_version_id`,
see that module's own docstring), against a `Conversation` row the caller
(`apps/web`, which holds the write grant `Conversations` needs) has already
created. This is the real orchestration pipeline — same composition as
`conversation_router.py`'s own `_process_turn` dependency, reused directly
rather than duplicated — so it writes exactly the `ConversationTurn`/
`OrchestrationTrace`/`OrchestrationTraceStep`/`GroundingCitation` rows
`shj3_ai_ro` is already granted, and nothing else.

**Endpoint 2 — `POST /v1/evaluation/score-similarity`.** Pure computation:
embeds `actual`/`expected` via the same real `embedder_from_environment()`
`conversation_router.py`'s retrieval wiring already uses, and returns their
cosine similarity (`domain.evaluation.cosine_similarity`). Touches no table
at all — no grant question, deliberately.

Neither endpoint uses `BackgroundTasks`, a job/run id, or an `Idempotency-Key`
— both are ordinary synchronous request/response calls; the async-job-with-
idempotency shape `docs/api.md` describes belongs to whichever side owns the
`RegressionRun` row, which is `apps/web`, not here.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from shj3_ai.adapters.inbound.conversation_router import ProcessTurnDep
from shj3_ai.adapters.inbound.tenant_auth import TenantContextDep
from shj3_ai.adapters.outbound.embedding.openai_embedder import embedder_from_environment
from shj3_ai.application.process_turn import (
    AgentNotFoundError,
    ConversationNotFoundError,
    ProcessTurnCommand,
    TurnStatus,
)
from shj3_ai.domain.evaluation import cosine_similarity
from shj3_ai.domain.ids import new_ulid
from shj3_ai.domain.orchestration import TraceStepKind

router = APIRouter(prefix="/v1/evaluation", tags=["evaluation"])


# ---------------------------------------------------------------------------
# 1. One pinned-version turn against an already-existing conversation.
# ---------------------------------------------------------------------------


class EvaluationTurnIn(BaseModel):
    conversation_id: str = Field(alias="conversationId")
    agent_id: str = Field(alias="agentId")
    #: The version under test — may be Draft/Testing, never resolved from
    #: `Agent.currentVersionId` (see `ProcessTurnCommand.agent_version_id`).
    agent_version_id: str = Field(alias="agentVersionId")
    prompt: str
    locale: str
    #: The web side owns turn numbering for the conversation it created;
    #: the golden-case use case sends `0` (its conversations are always
    #: single-turn), but this endpoint itself has no opinion on that.
    turn_ordinal: int = Field(alias="turnOrdinal")


class EvaluationToolCallOut(BaseModel):
    tool_binding_id: str | None = Field(serialization_alias="toolBindingId")
    status: str


class EvaluationTurnOut(BaseModel):
    status: str
    message_text: str = Field(serialization_alias="messageText")
    #: Mirrors `ProcessTurn._finish`'s own `was_refused` computation
    #: (`status in (REFUSED, BLOCKED, FAILED)`) — the one signal a
    #: `mustRefuse` golden case scores against.
    was_refused: bool = Field(serialization_alias="wasRefused")
    grounding_confidence: float | None = Field(
        default=None, serialization_alias="groundingConfidence"
    )
    #: Every `TraceStep` of kind `ToolCall`, in step order — what a golden
    #: case compares against `GoldenCases.expectedToolCallsJson` (a JSON
    #: array of tool-binding-id strings, in expected order; that shape is
    #: not defined anywhere else in this codebase today, stated here since
    #: this is the endpoint whose caller needs to know it).
    tool_calls: list[EvaluationToolCallOut] = Field(serialization_alias="toolCalls")


@router.post("/turns", response_model=EvaluationTurnOut)
async def run_evaluation_turn(
    body: EvaluationTurnIn, process_turn: ProcessTurnDep, _context: TenantContextDep
) -> EvaluationTurnOut:
    command = ProcessTurnCommand(
        conversation_id=body.conversation_id,
        turn_id=new_ulid(),
        content=body.prompt,
        channel="web",
        locale=body.locale,
        agent_id=body.agent_id,
        turn_ordinal=body.turn_ordinal,
        agent_version_id=body.agent_version_id,
    )
    try:
        # No `on_event`: this is a batch-scoring call, not a live citizen
        # stream — the caller wants one finished `TurnResult`, not SSE.
        result = await process_turn.execute(command)
    except ConversationNotFoundError as error:
        raise HTTPException(
            status_code=404, detail={"code": "evaluation.conversation_not_found"}
        ) from error
    except AgentNotFoundError as error:
        raise HTTPException(
            status_code=404, detail={"code": "evaluation.agent_version_not_found"}
        ) from error

    was_refused = result.status in (TurnStatus.REFUSED, TurnStatus.BLOCKED, TurnStatus.FAILED)
    tool_calls = [
        EvaluationToolCallOut(tool_binding_id=step.tool_binding_id, status=step.status.value)
        for step in result.steps
        if step.kind == TraceStepKind.TOOL_CALL
    ]
    return EvaluationTurnOut(
        status=result.status.value,
        message_text=result.message_text,
        was_refused=was_refused,
        grounding_confidence=result.grounding_confidence,
        tool_calls=tool_calls,
    )


# ---------------------------------------------------------------------------
# 2. Embedding-based similarity — pure computation, no table touched.
# ---------------------------------------------------------------------------

# ADR-0004's fixed default (`text-embedding-3-large`'s own dimension) —
# matching `conversation_router.py`'s own retrieval wiring, which uses the
# same constant for the identical reason: the real `OpenAiEmbedder` ignores
# it (the provider returns its model's natural width), and only the
# dependency-free `DeterministicLocalEmbedder` fallback actually needs a
# concrete number, so any fixed, correct-for-the-real-model value is enough
# for this endpoint's real caller.
_EMBEDDING_MODEL = "text-embedding-3-large"
_EMBEDDING_DIMENSION = 3072


class ScoreSimilarityIn(BaseModel):
    actual: str
    expected: str


class ScoreSimilarityOut(BaseModel):
    similarity: float


@router.post("/score-similarity", response_model=ScoreSimilarityOut)
async def score_similarity(
    body: ScoreSimilarityIn, _context: TenantContextDep
) -> ScoreSimilarityOut:
    embedder = embedder_from_environment(_EMBEDDING_DIMENSION)
    vectors = await embedder.embed([body.actual, body.expected], model=_EMBEDDING_MODEL)
    similarity = cosine_similarity(vectors[0], vectors[1])
    return ScoreSimilarityOut(similarity=similarity)
