"""`IOrchestrator` — the port `ConversationPipeline` depends on for one
turn's graph execution (FR-CONFIG-2's `agent.runtime` choice between
LangGraph and pydantic-ai). Protocol classes + plain dataclasses only; no
implementation here — mirrors the pattern in `ports/llm.py`/`ports/avatar.py`.

Phase 9 (BL-036) widens `run_turn` from a single primary/fallback/retry/
tools/residency call to `(graph: GraphDefinition, ctx: TurnContext) ->
GraphRunResult` — the interpreter now owns walking the whole
`reasoning.graph`, not just one LLM call. Every type `run_turn`'s signature
touches lives **here**, in `ports`, not in `avatar_agent.orchestration.graph`
— exactly the same reason `ports/llm.py`'s `FailoverResult` docstring gives:
the `layers` import-linter contract places `orchestration` *above* `ports`,
so `IOrchestrator` (a port) referencing a concrete `orchestration` type
would be a lower layer importing a higher one.
`avatar_agent.orchestration.graph.ir` re-exports everything below for
convenience within the orchestration package.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass, field
from typing import Any, Literal, Protocol
from uuid import UUID

from avatar_agent.contracts.internal_api import AlertType, HopItem
from avatar_agent.contracts.runtime_config import GraphNode, InjectStage, ReasoningBlock, RetrievalPipelineConfig, RetryPolicy
from avatar_agent.ports.embedding import IEmbeddingProvider
from avatar_agent.ports.llm import ChatMessage, ILLMProvider, ResidencyPayload, ToolSpec
from avatar_agent.ports.secrets import SecretStorePort
from avatar_agent.ports.tools import IToolExecutor, ToolDefinition

# `ReasoningBlock` *is* the graph definition (the Pydantic mirror of
# `reasoning.graph` the control plane hands the agent) — aliased under the
# name the interpreter/plan-doc refer to it by.
GraphDefinition = ReasoningBlock

NodeLane = Literal["foreground", "background"]

NodeStatus = Literal["pending", "running", "complete", "timed_out", "failed", "cancelled"]
"""A3.4's node execution state machine. `timed_out` is unreachable this
phase (no deadline enforcement — Phase 10) and exists for forward
compatibility only.
"""


class IHopRecorder(Protocol):
    """The subset of `telemetry.hops.HopRecorder`'s interface
    `TurnContext` needs — declared here (not imported from `telemetry`) to
    keep this port's dependency surface minimal and structural, the same
    way `IOrchestrator` itself is satisfied by `LangGraphOrchestrator`/
    `PydanticAiOrchestrator` without either importing this Protocol.
    """

    def record(self, item: HopItem) -> None: ...

    async def flush(self) -> None: ...


# --- Phase 12b (BL-045/047): knowledge search / gap ports ------------------
# Declared here (not imported from `telemetry`), same reasoning as
# `IHopRecorder` above — this port's dependency surface stays minimal and
# structural. `ControlPlaneClient` (the live turn's implementation) and
# `services/ai_service.py`'s standalone outbound HTTP client (the Playground
# preview's implementation) both satisfy these Protocols structurally,
# without importing them.


@dataclass(frozen=True)
class MetadataFilterQuery:
    """One `field`/`op`/`value` condition, sent to Nest's
    `POST /internal/knowledge/search` only when `metadata_filter.enabled` is
    `True` (see `KnowledgeSearchRequest.filter`)."""

    field: str
    op: Literal["eq", "neq", "contains"]
    value: str


@dataclass(frozen=True)
class KnowledgeSearchRequest:
    """The exact request body `POST /internal/knowledge/search` expects
    (already implemented and tested on the NestJS side — see the plan doc's
    Phase 12b section) — field names match the wire JSON 1:1."""

    tenant_id: UUID
    source_refs: Sequence[str]
    query_text: str
    query_embedding: Sequence[float]
    vector_weight: float
    keyword_weight: float
    candidates: int
    filter: MetadataFilterQuery | None = None


@dataclass(frozen=True)
class KnowledgeSearchCandidate:
    """One candidate row from `POST /internal/knowledge/search`'s response —
    field names match the wire JSON 1:1 (note: `text`, not `text_excerpt` —
    the retrieval pipeline's own stage-result models rename it on the way
    out, see `orchestration/retrieval/pipeline.py`)."""

    chunk_id: str
    source_id: str
    source_name: str
    text: str
    vector_score: float
    keyword_score: float
    blend_score: float
    passed_filter: bool


@dataclass(frozen=True)
class KnowledgeSearchResponse:
    candidates: Sequence[KnowledgeSearchCandidate] = ()


def knowledge_search_request_payload(request: KnowledgeSearchRequest) -> dict[str, object]:
    """Builds the exact JSON body `POST /internal/knowledge/search` expects.

    Shared (not duplicated) between the two Python callers that speak this
    wire format from two different processes — `telemetry.control_plane
    .ControlPlaneClient` (the live turn, LiveKit worker process) and
    `services/ai_service.py`'s standalone outbound HTTP client (the
    Playground preview, a separate process with no `ControlPlaneClient`
    instance) — so the two can never drift on request shape. A cleaner seam
    than duplicating this marshalling twice in the same codebase; documented
    as a deliberate deviation from the task's literal per-class method
    description.
    """
    payload: dict[str, object] = {
        "tenant_id": str(request.tenant_id),
        "source_refs": list(request.source_refs),
        "query_text": request.query_text,
        "query_embedding": list(request.query_embedding),
        "vector_weight": request.vector_weight,
        "keyword_weight": request.keyword_weight,
        "candidates": request.candidates,
    }
    if request.filter is not None:
        payload["filter"] = {"field": request.filter.field, "op": request.filter.op, "value": request.filter.value}
    return payload


def knowledge_search_response_from_json(body: dict[str, object]) -> KnowledgeSearchResponse:
    """Parses `POST /internal/knowledge/search`'s response body — the
    counterpart to `knowledge_search_request_payload`, same sharing
    rationale."""
    raw_candidates = body.get("candidates")
    items: list[Any] = raw_candidates if isinstance(raw_candidates, list) else []
    candidates = tuple(
        KnowledgeSearchCandidate(
            chunk_id=c["chunk_id"],
            source_id=c["source_id"],
            source_name=c["source_name"],
            text=c["text"],
            vector_score=c["vector_score"],
            keyword_score=c["keyword_score"],
            blend_score=c["blend_score"],
            passed_filter=c["passed_filter"],
        )
        for c in items
    )
    return KnowledgeSearchResponse(candidates=candidates)


class IKnowledgeSearchPort(Protocol):
    """Hybrid vector+keyword search against a tenant's knowledge index
    (R-R4) — the real implementation is `POST /internal/knowledge/search`
    (Postgres/pgvector access stays Nest-side per ADR-001; Python never
    touches Postgres directly)."""

    async def search(self, request: KnowledgeSearchRequest) -> KnowledgeSearchResponse: ...


class IKnowledgeGapPort(Protocol):
    """Records a `KnowledgeGap` row (R-R7) when a retrieval turns up nothing
    above threshold — the real implementation is
    `POST /internal/knowledge/gaps`. Only the live Retrieve node executor
    ever calls this; the Playground preview path is never given a real
    implementation (see `RetrievalPipelineInput.gap_recorder`'s docstring)."""

    async def record_gap(self, *, tenant_id: UUID, source_id: str | None, query: str, best_score: float | None) -> None: ...


class _NullKnowledgeSearchPort:
    """Default `IKnowledgeSearchPort` for a `TurnContext` that never
    exercises retrieval (every non-retrieve-node test in this codebase) —
    returns zero candidates rather than forcing every unrelated node-executor
    test fixture to supply a real implementation it will never call.
    Deliberate simplification over making this field required everywhere;
    see this phase's final report."""

    async def search(self, request: KnowledgeSearchRequest) -> KnowledgeSearchResponse:
        return KnowledgeSearchResponse(candidates=())


class _NullKnowledgeGapPort:
    """Default `IKnowledgeGapPort` — same reasoning as
    `_NullKnowledgeSearchPort`."""

    async def record_gap(self, *, tenant_id: UUID, source_id: str | None, query: str, best_score: float | None) -> None:
        return None


# --- Phase 13 (BL-049/050/051): skill-body lazy-fetch port ------------------
# Declared here, same reasoning as `IKnowledgeSearchPort`/`IHopRecorder`
# above — this port's dependency surface stays minimal and structural.
# `ControlPlaneSkillBodyAdapter` (the live turn's implementation) satisfies
# this Protocol structurally, without importing it.


@dataclass(frozen=True)
class SkillToolDefinition:
    """One of a skill's own resolved tools — mirrors `ToolDefinitionDto`'s
    wire shape 1:1 (field names match the JSON `tool_definitions[]` entries
    `GET /internal/skills/{id}/versions/{version}/body` returns)."""

    api_ref: str
    name: str
    description: str | None
    method: str
    url: str
    credential_ref: str | None
    args_schema: dict[str, object]


@dataclass(frozen=True)
class SkillKnowledgeFilters:
    """A skill's own knowledge-retrieval scoping (A5.5) — mirrors the wire
    shape's `knowledge_filters` object 1:1."""

    source_refs: Sequence[str] = ()
    top_k: int | None = None
    min_score: float | None = None


@dataclass(frozen=True)
class SkillBody:
    """The full body `GET /internal/skills/{id}/versions/{version}/body`
    returns (R-S1's progressive disclosure — fetched lazily, only once a
    `skill`-type node's trigger fires). `credential_ref` on each
    `SkillToolDefinition` is resolved to a real `api_key` by
    `SkillNodeExecutor` itself (via `TurnContext.secrets`), the same
    resolve-at-use-time treatment `entrypoint._resolve_tools` gives
    `agent.tools[]` at session-start — the difference here being *when*:
    a skill's own tools are resolved lazily, on first trigger, not
    upfront for every session (that would defeat progressive disclosure's
    whole cost-avoidance point)."""

    skill_id: str
    version: int
    name: str
    description: str
    instructions: str
    trigger_mode: Literal["model", "router"]
    tool_definitions: Sequence[SkillToolDefinition]
    knowledge_filters: SkillKnowledgeFilters
    budget_ms: int


class ISkillBodyPort(Protocol):
    """Lazily fetches a skill's full body — the real implementation is
    `GET /internal/skills/{id}/versions/{version}/body`
    (`InternalTokenGuard`-guarded, same as every other `/internal` route).
    """

    async def get_body(self, skill_id: str, version: int) -> SkillBody: ...


# --- Phase 14 (BL-052..057): HITL decision port ----------------------------
# Declared here, same reasoning as `ISkillBodyPort`/`IKnowledgeSearchPort`
# above — this port's dependency surface stays minimal and structural.
# `ControlPlaneHitlDecisionAdapter` (the live turn's implementation)
# satisfies this Protocol structurally, without importing it.


@dataclass(frozen=True)
class HitlProposedAction:
    """Mirrors `HitlProposedActionSchema`'s wire shape 1:1
    (`packages/contracts/src/hitl/schemas.ts`) — what the reviewer sees
    (R-H6): the transcript so far, the proposed action's exact arguments,
    the caller's identity if known, retrieved sources, and the model's
    stated reasoning. `HitlNodeExecutor` only ever populates `kind`/
    `summary` itself (see that module's docstring for why — no natural
    tool-call/spoken-text payload is available at a bare `hitl`-type node
    this phase); the rest exist for wire-shape completeness and a future
    executor with richer context at its own call site."""

    kind: Literal["tool_call", "spoken_text"]
    summary: str
    arguments: dict[str, object] | None = None
    transcript_excerpt: Sequence[str] | None = None
    caller_identity: str | None = None
    retrieved_sources: Sequence[str] | None = None
    model_reasoning: str | None = None


@dataclass(frozen=True)
class HitlDecisionCreated:
    """`POST /internal/hitl-decisions`'s response — the gate's own
    hold-treatment text and SLA, already resolved server-side from the
    `HitlGate` row (identified by `gate_id`) so the agent never needs its
    own copy of gate config."""

    id: str
    hold_treatment_text: str
    sla_seconds: int


@dataclass(frozen=True)
class HitlDecisionRecord:
    """`GET /internal/hitl-decisions/{id}`'s response — mirrors
    `HitlDecisionSchema` (`packages/contracts/src/hitl/schemas.ts`) field
    for field. `HitlNodeExecutor` only reads `decision`/`edited_arguments`;
    the rest is carried through for parity with the wire contract and any
    future caller (e.g. a richer audit-trail use) that needs it."""

    id: str
    tenant_id: str
    session_id: str
    gate_id: str
    utterance_seq: int
    proposed_action: HitlProposedAction
    reviewer_id: str | None
    decision: Literal["pending", "approved", "denied", "edited_approved", "timed_out", "escalated", "deferred"]
    edited_arguments: dict[str, object] | None
    justification_note: str | None
    decided_at: str | None
    latency_ms: int | None
    outcome_notified_at: str | None
    created_at: str


class IHitlDecisionPort(Protocol):
    """Creates and polls a `HitlDecision` row for a blocking/pre-speech
    HITL gate (Phase 14, BL-052..057). The real implementation is
    `POST /internal/hitl-decisions` / `GET /internal/hitl-decisions/{id}`
    (`InternalTokenGuard`-guarded, same as every other `/internal` route).
    """

    async def create_decision(
        self, *, tenant_id: UUID, session_id: UUID, gate_id: str, utterance_seq: int, proposed_action: HitlProposedAction
    ) -> HitlDecisionCreated: ...

    async def get_decision(self, decision_id: str) -> HitlDecisionRecord: ...


# --- Phase 15 (BL-058): sub-agent persona lazy-fetch port ------------------
# Declared here, same reasoning as `ISkillBodyPort`/`IHitlDecisionPort`
# above — this port's dependency surface stays minimal and structural.
# `ControlPlaneSubAgentPersonaAdapter` (the live turn's implementation)
# satisfies this Protocol structurally, without importing it.


@dataclass(frozen=True)
class SubAgentToolDefinition:
    """One of a sub-agent's own resolved tools — mirrors `ToolDefinitionDto`'s
    wire shape 1:1 (field names match the JSON `tool_definitions[]` entries
    `GET /internal/tenants/{tenantId}/subagent-persona` returns), the same
    duplication precedent `SkillToolDefinition` already set for
    `SkillBody.tool_definitions` (see that dataclass's own docstring for the
    rationale)."""

    api_ref: str
    name: str
    description: str | None
    method: str
    url: str
    credential_ref: str | None
    args_schema: dict[str, object]


@dataclass(frozen=True)
class SubAgentPersona:
    """The full persona `GET /internal/tenants/{tenantId}/subagent-persona`
    returns (Phase 15, BL-058) — fetched lazily, only once a `subagent`-type
    node's target tenant is actually reached this session.
    `credential_ref` on each `SubAgentToolDefinition` is resolved to a real
    `api_key` by `SubAgentNodeExecutor` itself (via `TurnContext.secrets`),
    the same resolve-at-use-time treatment `SkillNodeExecutor` gives a
    skill's own tools (see `SkillBody`'s docstring)."""

    tenant_id: str
    system_prompt: str
    tool_definitions: Sequence[SubAgentToolDefinition]


class ISubAgentPersonaPort(Protocol):
    """Lazily fetches another tenant's published persona for one-turn
    delegation (Phase 15, BL-058) — the real implementation is
    `GET /internal/tenants/{tenantId}/subagent-persona`
    (`InternalTokenGuard`-guarded, same as every other `/internal` route).
    Returns 404 (surfaced as an exception to the caller, same treatment
    `ISkillBodyPort.get_body` gets) when the target tenant has no published
    config.
    """

    async def get_persona(self, target_tenant_id: str) -> SubAgentPersona: ...


# --- Phase 15 (BL-059): operational-alert port ------------------------------
# Declared here, same reasoning as `ISkillBodyPort`/`IHitlDecisionPort`
# above. `pipeline.py`'s own STT/LLM/TTS failover paths already call
# `ControlPlaneClient.send_alert` directly (it's the composition root, not a
# node executor) — this Protocol is what lets the Handoff node executor fire
# the same `POST /internal/alerts` endpoint without a node executor reaching
# into `telemetry` for a concrete client type. `ControlPlaneAlertAdapter`
# (the live turn's implementation) satisfies this Protocol structurally,
# without importing it.


class IAlertPort(Protocol):
    """Fires an operational alert via `POST /internal/alerts` (already
    existed before Phase 15; this phase's Handoff node reuses it verbatim
    with the new `AlertType` value `handoff_requested` — no new endpoint)."""

    async def send_alert(self, *, tenant_id: UUID, alert_type: AlertType, message: str) -> None: ...


def _default_knowledge_pipeline() -> RetrievalPipelineConfig:
    """Default `TurnContext.knowledge_pipeline` for tests/callers that never
    exercise retrieval. `InjectStage.citation_format` has no schema default
    (mirrors the TS side exactly, see `contracts/runtime_config.py`), so a
    bare `RetrievalPipelineConfig()` is not constructible — this supplies
    the one required leaf explicitly."""
    return RetrievalPipelineConfig(inject=InjectStage(citation_format="none"))


@dataclass(frozen=True)
class ResolvedLlmNode:
    """One `llm`-type node's resolved provider(s) + retry policy — built once
    per turn by `entrypoint.build_pipeline` (mirrors how a single
    primary/fallback pair was resolved once per session before Phase 9).
    """

    primary: ILLMProvider
    fallback: ILLMProvider | None
    retry: RetryPolicy


@dataclass
class NodeResult:
    """One node's execution outcome (R-G9 — recorded on the session as a
    `hop="node"` row, node-level session trace, BL-039). Deliberately does
    not carry full input/output payloads — see the plan doc's "Scoped down
    from R-G9's full..." note.
    """

    node_id: str
    node_type: str
    lane: NodeLane
    status: NodeStatus
    total_ms: int
    output_text: str | None = None
    error_code: str | None = None
    # Only meaningful for `llm`-type nodes — aggregated by the interpreter
    # into `GraphRunResult` for backward-compatible `hop="llm"` reporting.
    provider_key: str | None = None
    used_fallback: bool = False
    first_token_ms: int | None = None


@dataclass
class TurnContext:
    """Everything a node executor needs for one utterance's graph walk.
    Built once per `_process_utterance` call (mirrors the arguments
    `IOrchestrator.run_turn` took before Phase 9 — `residency`/`tools` —
    plus the new graph-era additions: resolved LLM providers per node, turn
    state for Router, and the `speak` callback).
    """

    session_id: UUID
    tenant_id: UUID
    utterance_seq: int
    llm_by_node: dict[str, ResolvedLlmNode]
    tool_definitions_by_api_ref: dict[str, ToolDefinition]
    tools_by_name: dict[str, ToolDefinition]
    tool_specs: Sequence[ToolSpec]
    tool_executor: IToolExecutor
    residency: ResidencyPayload
    turn_state: dict[str, object]
    speak: Callable[[str], Awaitable[None]]
    hop_recorder: IHopRecorder
    spoken: bool = False
    # Phase 11 (BL-042/043) — the whole graph, keyed by node id. Populated
    # once by `GraphInterpreter.run()` at the top of the turn (previously a
    # local variable there). This is what lets a Parallel/Loop node executor
    # resolve its branch/body references without widening the
    # `NodeExecutor.execute(node, ctx)` Protocol every existing executor
    # already implements.
    nodes_by_id: dict[str, GraphNode] = field(default_factory=dict)
    # Phase 12b (BL-045/047) — the Retrieve node's rewrite stage has no LLM
    # node of its own; this is the *first* `llm`-type node's resolved
    # primary/fallback/retry (the same "first LLM node = primary" convention
    # `entrypoint._resolve_summary_llm` already uses for FR-CALL-4's summary
    # call). `None` when the graph has no LLM node at all (an edge case) —
    # the rewrite stage then silently no-ops rather than failing the node.
    default_llm: ResolvedLlmNode | None = None
    # Phase 12b — the tenant's six-stage retrieval pipeline config, resolved
    # once per turn by `entrypoint.build_pipeline` from `cfg.knowledge
    # .pipeline` (the same "pre-resolved once per session" convention
    # `llm_by_node`/`tool_definitions_by_api_ref` already follow, rather than
    # a node executor reaching back into global session state itself).
    # Defaults to a retrieval-inert config so the many existing tests that
    # never exercise a Retrieve node don't need to supply one.
    knowledge_pipeline: RetrievalPipelineConfig = field(default_factory=_default_knowledge_pipeline)
    # Phase 12b — hybrid-search / knowledge-gap ports (see
    # `IKnowledgeSearchPort`/`IKnowledgeGapPort` above). Default to no-op
    # null-object implementations for the same reason `knowledge_pipeline`
    # defaults — only the Retrieve node executor (and its own tests) ever
    # need a real implementation.
    knowledge_search: IKnowledgeSearchPort = field(default_factory=_NullKnowledgeSearchPort)
    knowledge_gap: IKnowledgeGapPort = field(default_factory=_NullKnowledgeGapPort)
    # Phase 12b — the platform-wide single embedding model (Phase 12a's
    # "only one model is selectable this phase" decision), resolved ONCE per
    # session by `entrypoint.build_pipeline` via `registry.resolve_embedding`
    # -- same "pre-resolved once per session" convention `llm_by_node`
    # follows. Resolved in `entrypoint` (not here in `orchestration`)
    # deliberately: `.importlinter`'s `orchestration-uses-ports` contract
    # forbids `avatar_agent.orchestration` from reaching
    # `avatar_agent.adapters` even indirectly, and `registry.resolve_embedding`
    # transitively imports vendor adapter modules (confirmed by running
    # `import-linter` against a first draft that called `resolve_embedding`
    # directly from this package -- see this task's final report). `None`
    # when resolution failed for this session (defensive, though the
    # hardcoded platform-default config is practically infallible) -- the
    # hybrid search stage then treats retrieval as unavailable, same as any
    # other stage failure (R-R3).
    embedding_provider: IEmbeddingProvider | None = None
    # Phase 13 (BL-049/050/051) — the Skill node's lazy body fetch + its own
    # tool credential resolution. `skill_body_port`/`secrets` default to
    # `None` for the many existing tests that never exercise a Skill node
    # (mirrors `knowledge_search`/`knowledge_gap`'s own "only the relevant
    # node executor's tests ever need a real implementation" convention,
    # though here the safe default is `None` rather than a null-object,
    # since there is no meaningful "always empty" skill body to fabricate —
    # `SkillNodeExecutor` treats `None` as `SKILL_NO_LLM_AVAILABLE`-class
    # unavailability, not a crash).
    skill_body_port: ISkillBodyPort | None = None
    secrets: SecretStorePort | None = None
    # Phase 14 (BL-052..057) — the Hitl node's create/poll port (see
    # `IHitlDecisionPort` above). `None` for the many existing tests that
    # never exercise a Hitl node — same "`None` means recognized
    # unavailability, not a crash" treatment `skill_body_port` already
    # uses; `HitlNodeExecutor` treats a `None` port as
    # `HITL_DECISION_PORT_UNAVAILABLE`, a normal `on_error` outcome.
    hitl_decision_port: IHitlDecisionPort | None = None
    # Phase 13 — per-**session** cache (this dict is created once by
    # `entrypoint.build_pipeline` and threaded, by reference, into every
    # turn's fresh `TurnContext` — never recreated per turn), keyed by
    # `f"{tenant_id}:{skill_id}@{version}"` so a cache collision across
    # tenants/sessions is not just unlikely but structurally impossible
    # (each session's pipeline owns its own dict instance; the tenant_id
    # prefix is additional defense-in-depth within that instance). "Cached
    # in-process for that session once triggered" (`ARCHITECTURE_NOTES.md`
    # §5.3) — never re-fetched on a second trigger of the same skill+version
    # within the same session.
    skill_body_cache: dict[str, SkillBody] = field(default_factory=dict)
    # Phase 15 (BL-058) — the Sub-agent node's lazy persona fetch + its own
    # in-process per-session cache, same "created once by
    # `entrypoint.build_pipeline`/`ConversationPipeline.__init__`, threaded
    # by reference into every turn's fresh `TurnContext`" convention
    # `skill_body_port`/`skill_body_cache` already establish above. Keyed by
    # `f"{tenant_id}:{target_tenant_id}"` — same defense-in-depth reasoning
    # `skill_body_cache`'s own key format documents (a cache collision
    # across sessions/tenants is already structurally impossible, since each
    # session owns its own dict instance; the prefix is additional
    # belt-and-suspenders).
    subagent_persona_port: ISubAgentPersonaPort | None = None
    subagent_persona_cache: dict[str, SubAgentPersona] = field(default_factory=dict)
    # Phase 15 (BL-059) — the Handoff node's alert-firing port (see
    # `IAlertPort` above). `None` for the many existing tests that never
    # exercise a Handoff node — same "`None` means recognized unavailability,
    # not a crash" treatment `skill_body_port`/`hitl_decision_port` already
    # use.
    alert_port: IAlertPort | None = None
    # Phase 15 (BL-060) — the State node's session-scoped, cross-turn
    # variable store. Unlike `turn_state` (rebuilt fresh every
    # `_process_utterance` call, see that field's own docstring), this dict
    # is created ONCE by `ConversationPipeline.__init__` and threaded **by
    # reference** into every turn's fresh `TurnContext` — the exact same
    # "created once per session, threaded by reference" convention
    # `skill_body_cache` already establishes above, repurposed here for a
    # plain key/value store instead of a fetch cache. This is what makes a
    # State-node write in turn N visible to a State-node read in turn N+1
    # within the same session — `ARCHITECTURE_NOTES.md` §3.2's "session-
    # scoped... spanning the whole session" requirement — while staying
    # in-memory-only, no Postgres write path (BACKLOG BL-060, deliberate).
    session_state: dict[str, object] = field(default_factory=dict)

    def apply_tool_messages(self, messages: Sequence[ChatMessage]) -> None:
        """Appends tool-result messages onto `residency` (mirrors the
        pre-Phase-9 pipeline's `_apply_tool_results` — tool-result messages
        are not user input the residency filter's gating applies to).
        """
        self.residency = ResidencyPayload(
            system_prompt=self.residency.system_prompt,
            messages=tuple(self.residency.messages) + tuple(messages),
            retrieved_chunks=self.residency.retrieved_chunks,
        )

    def apply_retrieved_chunks(self, chunks: Sequence[str]) -> None:
        """Appends Retrieve-node-injected text chunks onto `residency`
        (Phase 12b) — mirrors `apply_tool_messages` exactly: rebuilds
        `residency` immutably, appending to `retrieved_chunks` rather than
        replacing it (a graph with more than one Retrieve node on the
        foreground path should accumulate, not clobber, each one's output).
        """
        self.residency = ResidencyPayload(
            system_prompt=self.residency.system_prompt,
            messages=self.residency.messages,
            retrieved_chunks=tuple(self.residency.retrieved_chunks) + tuple(chunks),
        )


@dataclass
class GraphRunResult:
    """`IOrchestrator.run_turn`'s return value (Phase 9 replaces
    `FailoverResult`). `reply_text`/`provider_key`/`used_fallback`/
    `first_token_ms` come from the last `llm`-type node executed on the
    foreground path (`None`/`False` when no LLM node ran at all, e.g. a
    static-text Router-to-Speak branch) — kept for `pipeline.py`'s existing
    `hop="llm"` reporting and failover-alert logic, unchanged in shape.
    """

    reply_text: str | None
    provider_key: str | None
    used_fallback: bool
    first_token_ms: int | None
    spoken: bool
    node_trace: list[NodeResult] = field(default_factory=list)


class IOrchestrator(Protocol):
    """Runs one utterance's turn through the concrete orchestration graph."""

    async def run_turn(self, graph: GraphDefinition, ctx: TurnContext) -> GraphRunResult:
        """Runs one turn through the concrete orchestration graph.

        @raises avatar_agent.orchestration.failover.LlmUnavailableError:
            when an `llm`-type node's primary and fallback legs are both exhausted.
        """
        ...
