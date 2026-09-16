"""The `OrchestrationStore` port — the only write path this wave uses.

Writes exactly the tables `shj3_ai_ro` holds INSERT/UPDATE on
(`prisma/sql/002_tenant_grants.sql`): `ConversationTurns`, `OrchestrationTraces`,
`OrchestrationTraceSteps`, `GroundingCitations`. Deliberately does **not** offer a
method to create or update a `Conversations` row, an `EscalationTickets` row, or a
durable `ConversationSlots` row — this principal has no grant on any of the three,
and a port that offered the method anyway would compile clean and fail only at
the database, the exact anti-pattern ADR-0005 rule 5 exists to catch early. A
turn's `Conversations` row must already exist (read via `ConfigReader`, see
`get_conversation`) before `ProcessTurn` will process a turn against it — created
by whichever surface owns conversation start (`shj3-web`, per architecture.md §7's
"Citizen opens widget" row), not this module. Handover-ticket persistence is
B-7's, named and deferred, not silently routed around here.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import Protocol

from shj3_ai.domain.orchestration import TraceStep


@dataclass(frozen=True, slots=True)
class ConversationRow:
    id: str
    channel_key: str
    locale_code: str
    primary_agent_id: str | None
    #: `Conversations.citizenIdentityId` — `None` for an anonymous session. B-8's
    #: step-up gate resolves the conversation's held assurance from this id via
    #: `IdentityReader`, never from a value cached on the conversation row itself.
    citizen_identity_id: str | None = None


@dataclass(frozen=True, slots=True)
class TurnToPersist:
    id: str
    conversation_id: str
    ordinal: int
    role: str
    content_masked: str
    content_format: str
    agent_version_id: str | None
    locale_code: str
    input_tokens: int | None
    output_tokens: int | None
    latency_ms: int | None
    was_refused: bool
    refusal_reason: str | None


@dataclass(frozen=True, slots=True)
class TraceToPersist:
    id: str
    conversation_id: str
    turn_id: str
    execution_mode: str
    routed_agent_id: str | None
    routed_agent_version_id: str | None
    routing_confidence: Decimal | None
    hop_count: int
    total_input_tokens: int
    total_output_tokens: int
    total_cost_micro_aed: int
    pending_slot_name: str | None
    escape_triggered: bool
    merge_policy_applied: str | None
    guardrail_pre_result: str
    guardrail_post_result: str
    grounding_confidence: Decimal | None
    duration_ms: int
    steps: tuple[TraceStep, ...]
    #: Purely additive — `None`/default for every legacy-mode turn, populated only when
    #: `execution_mode == "Pipeline"`. `pipeline_label` is a frozen `"v1.2"`-shaped string,
    #: deliberately duplicated text rather than a join, so a trace stays legible after its
    #: pipeline version is archived/hard-deleted — the same argument
    #: `GroundingCitation.graphPath` already makes.
    pipeline_version_id: str | None = None
    pipeline_design_id: str | None = None
    pipeline_label: str | None = None
    terminal_node_key: str | None = None
    branch_count: int = 1
    loop_iterations_total: int = 0


@dataclass(frozen=True, slots=True)
class CitationToPersist:
    id: str
    trace_id: str
    turn_id: str
    chunk_id: str
    knowledge_source_id: str
    rank: int
    vector_score: Decimal | None
    graph_score: Decimal | None
    hybrid_score: Decimal
    rerank_score: Decimal | None
    retrieved_via: str
    graph_path: str | None
    was_cited: bool


class OrchestrationStore(Protocol):
    async def get_conversation(self, conversation_id: str) -> ConversationRow | None:
        """Read-only lookup — SELECT is granted broadly; this exists on the write
        port (not `ConfigReader`) because it is the precondition every write
        method below shares, not turn-pipeline configuration."""

    async def persist_turn(self, turn: TurnToPersist) -> None: ...

    async def persist_trace(self, trace: TraceToPersist) -> None:
        """Writes the `OrchestrationTraces` row and every `OrchestrationTraceSteps`
        child row in `trace.steps`, in one unit of work."""

    async def persist_citations(self, citations: list[CitationToPersist]) -> None: ...
