"""Pydantic mirror of ``packages/contracts/src/agent-config/schema.ts`` (LLD §6.1/§6.3).

This module is one half of ADR-001's single most important cross-language
contract: the TypeBox schema on the control-plane side and this Pydantic
model must accept/reject exactly the same documents. The CI contract test
(``apps/agent/tests/contracts/test_agent_config_contract.py``) proves this
by running a shared fixture corpus through both validators.

``AgentRuntimeConfig`` additionally carries the session-resolution fields
(``session_id``, ``room_name``, ``endpoints``) that only exist once a
session has been issued — it is the exact shape returned by
``GET /internal/sessions/{id}/runtime-config`` (LLD §5.9/§6.3), not the raw
YAML the control plane stores.
"""

from __future__ import annotations

import re
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, HttpUrl, field_validator, model_validator

# Catalog literals (LLD §6.1) — kept as `Literal` unions, exactly mirroring
# the TypeBox `T.Union([T.Literal(...), ...])` definitions so an unknown
# provider key is rejected identically on both sides.
TransportProviderKey = Literal["livekit"]
SttProviderKey = Literal["deepgram", "faster-whisper"]
LlmProviderKey = Literal["openai", "anthropic", "google"]
TtsProviderKey = Literal["fish-speech", "elevenlabs"]
AvatarProviderKey = Literal["bithuman", "alibaba-liveavatar"]
AgentRuntimeKey = Literal["langgraph", "pydantic-ai"]
ResidencyMode = Literal["prompt_text_only", "prompt_and_transcript", "none"]

_BCP47_PATTERN = re.compile(r"^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$")
_ROOM_NAMESPACE_PATTERN = re.compile(r"^[a-z][a-z0-9-]{1,47}$")


class TransportLeg(BaseModel):
    """`transport` block (LLD §6.1)."""

    model_config = ConfigDict(extra="forbid")

    provider: TransportProviderKey
    credential_ref: str | None = Field(default=None, min_length=1, max_length=256)
    room_namespace: str

    @field_validator("room_namespace")
    @classmethod
    def _room_namespace_shape(cls, value: str) -> str:
        if not _ROOM_NAMESPACE_PATTERN.match(value):
            raise ValueError("room_namespace must match ^[a-z][a-z0-9-]{1,47}$")
        return value


class SttLeg(BaseModel):
    """`stt` block (FR-STT-1/2)."""

    model_config = ConfigDict(extra="forbid")

    provider: SttProviderKey
    credential_ref: str | None = Field(default=None, min_length=1, max_length=256)
    language: str = "en-US"
    model: str | None = Field(default=None, max_length=128)

    @field_validator("language")
    @classmethod
    def _bcp47(cls, value: str) -> str:
        if not _BCP47_PATTERN.match(value):
            raise ValueError("language must be a BCP-47 tag (e.g. en-US)")
        return value


class LlmLeg(BaseModel):
    """One LLM leg — primary or fallback (FR-LLM-1)."""

    model_config = ConfigDict(extra="forbid")

    provider: LlmProviderKey
    credential_ref: str | None = Field(default=None, min_length=1, max_length=256)
    model: str = Field(min_length=1, max_length=128)


class RetryPolicy(BaseModel):
    """An `llm`-type graph node's `retry` field (FR-LLM-2). Phase 9
    (BL-035) moved this from the top-level `llm` block to sit inside each
    `llm`-type `reasoning.graph[]` node; still imported standalone by
    `failover.py`/`graph_langgraph.py`/`graph_pydantic_ai.py`.
    """

    model_config = ConfigDict(extra="forbid")

    max_attempts: int = Field(default=3, ge=1, le=5)
    backoff_ms: list[int] = Field(default=[200, 400, 800], min_length=1, max_length=5)

    @model_validator(mode="after")
    def _backoff_matches_attempts(self) -> RetryPolicy:
        if len(self.backoff_ms) != self.max_attempts:
            raise ValueError("backoff_ms length must equal max_attempts")
        for ms in self.backoff_ms:
            if ms < 0 or ms > 60000:
                raise ValueError("backoff_ms entries must be within [0, 60000]")
        return self


# --- Phase 9 (BL-035): reasoning.graph — Pydantic mirror of
# `packages/contracts/src/agent-config/reasoning-graph.schema.ts`. Only the
# six node types this phase's exit condition needs are modeled
# (LLM/Tool/Retrieve-stub/Router/Speak/End) — see that file's docstring for
# why Parallel/Loop/Skill/Sub-agent/HITL/Handoff/State aren't here yet.

NodeLane = Literal["foreground", "background"]

_NODE_ID_PATTERN = re.compile(r"^[a-zA-Z0-9_-]+$")


class NodeEdge(BaseModel):
    """R-G7 — every node's `on_error`/`on_deadline` edge. `on_deadline` is
    carried through unread by the interpreter this phase (deadline
    enforcement is Phase 10).
    """

    model_config = ConfigDict(extra="forbid")

    action: Literal["goto", "end_turn", "degrade"]
    target_node_id: str | None = None


class _GraphNodeBase(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=120)
    lane: NodeLane
    on_error: NodeEdge
    on_deadline: NodeEdge

    @field_validator("id")
    @classmethod
    def _id_shape(cls, value: str) -> str:
        if not _NODE_ID_PATTERN.match(value):
            raise ValueError("node id must match ^[a-zA-Z0-9_-]+$")
        return value


class LlmNode(_GraphNodeBase):
    """LLM node — carries the same provider/model/fallback/retry shape the
    old top-level `llm` block had (R-G1).
    """

    type: Literal["llm"] = "llm"
    provider: LlmProviderKey
    credential_ref: str | None = Field(default=None, min_length=1, max_length=256)
    model: str = Field(min_length=1, max_length=128)
    fallback: LlmLeg | None = None
    retry: RetryPolicy = Field(default_factory=RetryPolicy)
    next_node_id: str | None = None


class ToolNode(_GraphNodeBase):
    """Tool node — invokes a registered `ToolDefinition` by `api_ref`."""

    type: Literal["tool"] = "tool"
    api_ref: str = Field(min_length=1, max_length=64)
    argument_mapping: dict[str, str] = Field(default_factory=dict)
    timeout_ms: int | None = Field(default=None, ge=100, le=60000)
    next_node_id: str | None = None


class RetrieveNode(_GraphNodeBase):
    """Retrieve node — **real, Phase 12b** (BL-045/047,
    `ARCHITECTURE_NOTES.md` §3.2/§4.4). `source_refs`/`top_k` were stubbed in
    Phase 9; `budget_ms` is new this phase — the node's own overall
    retrieval-latency ceiling (A3.2's "latency budget" column), analogous to
    `ToolNode.timeout_ms`'s worst-case-bound precedent, not a
    typical-latency estimate. The node inherits the tenant's
    `knowledge.pipeline` wholesale (see the plan doc's Phase 12b "Decisions
    made this phase" #1 for why there is no per-node pipeline override this
    phase) — `budget_ms` is what the V-10 validator below checks
    `knowledge.pipeline`'s summed per-stage `budget_ms` fields against.
    """

    type: Literal["retrieve"] = "retrieve"
    source_refs: list[str] = Field(default_factory=list)
    top_k: int = Field(default=5, ge=1, le=20)
    budget_ms: int = Field(default=400, ge=1, le=60000)
    next_node_id: str | None = None


# --- Phase 12b (BL-045/047): `knowledge.pipeline` — the six-stage retrieval
# pipeline config. One pipeline per tenant, referenced wholesale by every
# `retrieve`-type graph node (see `RetrieveNode`'s doc comment). Mirrors
# `packages/contracts/src/agent-config/reasoning-graph.schema.ts`'s
# `RetrievalPipelineConfigSchema` field-for-field. Every stage that does real
# work carries its own `budget_ms` (R-R3) — Rerank does not, since it is a
# deferred (BL-070) no-op passthrough this phase, never actually invoked.


class RewriteStage(BaseModel):
    """① Rewrite — optional LLM call using the last-N turns of conversation
    context (R-R5)."""

    model_config = ConfigDict(extra="forbid")

    enabled: bool = True
    context_turns: int = Field(default=3, ge=1, le=10)
    budget_ms: int = Field(default=150, ge=0, le=10000)


class HybridSearchStage(BaseModel):
    """② Hybrid search — always on, no toggle (per the wireframe); vector +
    keyword (BM25/`ts_rank`) blend (R-R4)."""

    model_config = ConfigDict(extra="forbid")

    vector_weight: float = Field(default=0.6, ge=0, le=1)
    keyword_weight: float = Field(default=0.4, ge=0, le=1)
    candidates: int = Field(default=20, ge=1, le=100)
    budget_ms: int = Field(default=100, ge=0, le=10000)


class MetadataFilterCondition(BaseModel):
    """③ A single field/op/value condition against `KnowledgeChunk.metadata`."""

    model_config = ConfigDict(extra="forbid")

    field: str = Field(min_length=1, max_length=64, pattern=r"^[a-zA-Z0-9_]+$")
    op: Literal["eq", "neq", "contains"]
    value: str = Field(min_length=1, max_length=500)


class MetadataFilterStage(BaseModel):
    model_config = ConfigDict(extra="forbid")

    enabled: bool = False
    condition: MetadataFilterCondition | None = None
    budget_ms: int = Field(default=20, ge=0, le=10000)


class RerankStage(BaseModel):
    """④ Rerank — **explicitly deferred (BL-070)**. `enabled` is a fixed
    `False` literal (not a plain bool an admin could flip to `true` and have
    nothing happen). No `budget_ms` — never actually invoked, so nothing to
    budget.
    """

    model_config = ConfigDict(extra="forbid")

    enabled: Literal[False] = False
    keep_top: int | None = Field(default=None, ge=1, le=50)


class ThresholdStage(BaseModel):
    """⑤ Threshold — chunks below `min_score` are dropped, never passed with
    a low score (R-R7)."""

    model_config = ConfigDict(extra="forbid")

    min_score: float = Field(default=0.5, ge=0, le=1)
    budget_ms: int = Field(default=10, ge=0, le=10000)


CitationFormat = Literal["numbered", "inline", "none"]


class InjectStage(BaseModel):
    """⑥ Inject — token-capped, citation-formatted (R-R8)."""

    model_config = ConfigDict(extra="forbid")

    token_cap: int = Field(default=1200, ge=1, le=8000)
    citation_format: CitationFormat
    budget_ms: int = Field(default=30, ge=0, le=10000)


class RetrievalPipelineConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    rewrite: RewriteStage = Field(default_factory=RewriteStage)
    hybrid_search: HybridSearchStage = Field(default_factory=HybridSearchStage)
    metadata_filter: MetadataFilterStage = Field(default_factory=MetadataFilterStage)
    rerank: RerankStage = Field(default_factory=RerankStage)
    threshold: ThresholdStage = Field(default_factory=ThresholdStage)
    inject: InjectStage


class KnowledgeConfig(BaseModel):
    """`knowledge` top-level block (Phase 12b). No `sources[]` —
    `KnowledgeSource` is a separately-managed, DB-backed entity (12a),
    referenced by id via `RetrieveNode.source_refs`, never inlined (mirrors
    `agent.tools[]`/`ToolDefinition`)."""

    model_config = ConfigDict(extra="forbid")

    pipeline: RetrievalPipelineConfig


class RouterBranch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    condition: str = Field(min_length=1, max_length=300)
    next_node_id: str = Field(min_length=1, max_length=64)


class RouterNode(_GraphNodeBase):
    """Router node — branches on the allow-listed condition grammar in
    `orchestration/graph/condition_grammar.py` (never `eval`'d).
    """

    type: Literal["router"] = "router"
    branches: list[RouterBranch] = Field(min_length=1)
    default_next_node_id: str = Field(min_length=1, max_length=64)


class SpeakNode(_GraphNodeBase):
    """Speak node — `text` is required only in `literal` mode (checked by
    the model validator below, not the field itself).
    """

    type: Literal["speak"] = "speak"
    mode: Literal["llm_output", "literal"]
    text: str | None = Field(default=None, max_length=2000)
    interruptible: bool = True
    next_node_id: str | None = None


class EndNode(_GraphNodeBase):
    """End node — terminates the turn."""

    type: Literal["end"] = "end"


# --- Phase 11 (BL-042/043): Parallel/Loop — Pydantic mirror of
# `packages/contracts/src/agent-config/reasoning-graph.schema.ts`'s
# `ParallelNodeSchema`/`LoopNodeSchema`. See that file's module docstring for
# the branch/body representation decision (single node-id references into
# this same flat `graph` list, mirroring `RouterBranch.next_node_id` — not
# inlined sub-graphs).

JoinPolicy = Literal["all", "first_success", "quorum", "all_settled"]
"""`best_of` (BL-069) is deliberately omitted, not kept as a
recognized-but-unimplemented literal — see the plan doc's Phase 11 section.
"""


class SkillRef(BaseModel):
    """One `skills[]` entry (Phase 13, BL-049/050/051) — the agent-level
    "attached" skill list, the top-level analog of `agent.tools[]`.
    `version: 'latest'` is resolved to a concrete published version number
    once, at session-start, by `GetRuntimeConfigUseCase` — see `SkillNode`'s
    docstring below for the identical resolution split.
    """

    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1, max_length=64)
    version: int | Literal["latest"] = "latest"


class SkillSummary(BaseModel):
    """The ~15-token, description-only blurb R-S1's progressive disclosure
    allows into the base prompt — enrichment of `SkillRef`'s bare
    `{id, version}`, the same relationship `ToolDefinitionDto` has to
    `ToolConfig`. Deliberately **not** a `skills` field on
    `AgentRuntimeConfig` (which would require overriding `AgentConfig.skills`'s
    own `list[SkillRef]` type across the subclass boundary — mypy's
    override-compatibility check would reject that) — see
    `AgentRuntimeConfig.skill_summaries` below and the plan doc's Phase 13
    "Decisions made this phase" for the full rationale. `version` here is
    always a concrete resolved number, never the literal `"latest"`.
    """

    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1, max_length=64)
    version: int = Field(ge=1)
    name: str = Field(min_length=1, max_length=80)
    description: str = Field(min_length=1, max_length=500)


class ParallelBranch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1, max_length=64)
    entry_node_id: str = Field(min_length=1, max_length=64)
    budget_ms: int | None = Field(default=None, ge=1, le=60000)


class ParallelNode(_GraphNodeBase):
    """Parallel node — fans out to `branches`, joins per `join_policy`.
    Branches are internal (single-entry references into the shared graph);
    the outer walk only ever continues via `next_node_id`.
    """

    type: Literal["parallel"] = "parallel"
    branches: list[ParallelBranch] = Field(min_length=1)
    join_policy: JoinPolicy
    quorum_n: int | None = Field(default=None, ge=1)
    on_branch_error: Literal["continue_partial", "fail"]
    next_node_id: str | None = None


class LoopNode(_GraphNodeBase):
    """Loop node — repeats `body_entry_node_id`'s chain until `condition`
    holds (reuses the Router condition grammar verbatim). All three guards
    are schema-required with deliberately unconstrained numeric ranges — V-2
    (`graph-rules.ts` / this module's `ReasoningBlock` validator below) is
    what enforces "positive"; `max_cost`'s unit is abstract cost units, one
    unit = one node executed during a single loop-body pass (see the plan
    doc's Phase 11 section for why — no per-call dollar-cost concept exists
    anywhere else in this codebase to reuse instead).
    """

    type: Literal["loop"] = "loop"
    body_entry_node_id: str = Field(min_length=1, max_length=64)
    condition: str = Field(min_length=1, max_length=300)
    # Upper bounds are a security hardening (defense-in-depth alongside V-2's
    # lower-bound check) — see `LoopNodeSchema`'s doc comment in
    # `reasoning-graph.schema.ts` for the full rationale.
    max_iterations: int = Field(le=1000)
    max_duration_ms: int = Field(le=60000)
    max_cost: float = Field(le=100000)
    next_node_id: str | None = None


class SkillNode(_GraphNodeBase):
    """Skill node (Phase 13, BL-049/050/051; `ARCHITECTURE_NOTES.md`
    §5.3/§3.2) — references a `Skill`/`SkillVersion` by id, never inlines
    its body (mirrors `ToolNode.api_ref`'s by-reference convention).

    `version` accepts the literal `"latest"` at authoring time (the same
    admin-facing "always the newest published version" choice
    `SkillRef.version` allows) — `GetRuntimeConfigUseCase` resolves this to
    a concrete published version number once, at session-start read time,
    so a live session's config never actually carries the string
    `"latest"` through to the interpreter; `SkillNodeExecutor` treats an
    unresolved `"latest"` reaching it as a defensive, should-never-happen
    condition (`on_error`), not a normal code path.

    `budget_ms` is this node's own declared latency budget (R-S5),
    independent of `SkillVersion.budgetMs` — the same "node carries its own
    scalar cost field" precedent `RetrieveNode.budget_ms` already set,
    since the TypeScript `critical-path.ts` has no DB access at compute
    time to resolve the skill's own stored budget.
    """

    type: Literal["skill"] = "skill"
    skill_id: str = Field(min_length=1, max_length=64)
    version: int | Literal["latest"] = "latest"
    budget_ms: int = Field(default=1500, ge=1, le=60000)
    next_node_id: str | None = None


class HitlNode(_GraphNodeBase):
    """Hitl node (Phase 14, BL-052..057; `ARCHITECTURE_NOTES.md` §6;
    `AgentBuilder_Reasoning_Skills_RAG_Orchestration_HITL.md` §A8) —
    references a `HitlGate` by id, never inlines it (mirrors
    `ToolNode.api_ref`/`SkillNode.skill_id`'s by-reference convention;
    `ARCHITECTURE_NOTES.md` §6.1's "`HitlGate` rows are referenced by **id**
    from `hitl.gates[]`").

    Carries none of the gate's own R-H1 mandatory fields (trigger
    condition, gate type, reviewer group, SLA, hold treatment, timeout
    behaviour) — those all live on the `HitlGate` row itself, resolved
    server-side at decision-creation time
    (`POST /internal/hitl-decisions` already returns `hold_treatment_text`/
    `sla_seconds` resolved from the gate) — the same "graph node is a thin
    reference, the referenced entity carries the config" split
    `SkillNode`/`ToolNode` already use.
    """

    type: Literal["hitl"] = "hitl"
    gate_id: str = Field(min_length=1, max_length=64)
    next_node_id: str | None = None


# --- Phase 15 (BL-058/059/060): Sub-agent/Handoff/State — the final three of
# the full 13-type A3.2 set. Pydantic mirror of
# `packages/contracts/src/agent-config/reasoning-graph.schema.ts`'s
# `SubAgentNodeSchema`/`HandoffNodeSchema`/`StateNodeSchema`.


class SubAgentNode(_GraphNodeBase):
    """Sub-agent node (Phase 15, BL-058; `ARCHITECTURE_NOTES.md` §3.2) —
    references another tenant's published config by `target_tenant_id`,
    never inlines it (mirrors `ToolNode.api_ref`/`SkillNode.skill_id`'s
    by-reference convention). Since this codebase has no separate "Agent"
    entity (a tenant *is* the agent, 1:1, via `DeploymentConfig`), "delegate
    to another agent" means delegate to another tenant's published config by
    tenant id.

    v1 delegation is deliberately **one bounded LLM turn** using the target
    tenant's persona/tools, never a nested graph/interpreter invocation —
    the exact same simplification Phase 13 made for `SkillNode` (see that
    class's docstring, decision #1). `budget_ms` bounds that one turn,
    mirroring `SkillNode.budget_ms`'s own "node carries its own scalar cost
    field" precedent.

    `handback_policy` governs what happens to the delegated turn's own
    output: `speak_and_return` speaks it to the caller directly (via
    `ctx.speak`, same as a Speak node); `silent_return` never speaks it,
    only writes it into `turn_state` for the parent graph to use downstream
    (same `turn_state[node.id]` convention every other node's output
    already follows).
    """

    type: Literal["subagent"] = "subagent"
    target_tenant_id: UUID
    handback_policy: Literal["speak_and_return", "silent_return"]
    budget_ms: int = Field(default=4000, ge=1, le=60000)
    next_node_id: str | None = None


class HandoffNode(_GraphNodeBase):
    """Handoff node (Phase 15, BL-059; `ARCHITECTURE_NOTES.md` §3.2) —
    "transfer to a human." v1 ships intent only: record the handoff (an
    alert, `AlertType` `handoff_requested`), transition session-scoped
    state — real PSTN/SIP transfer mechanics are out of scope (BL-059).

    Deliberately has **no `next_node_id`** — terminal, exactly like `EndNode`
    (once control leaves the AI there is nothing left for this turn's graph
    walk to do). `destination`/`context_summary` are free-text (no reviewer-
    group/queue entity exists yet to reference by id) — what the alert
    message is built from.
    """

    type: Literal["handoff"] = "handoff"
    destination: str = Field(min_length=1, max_length=200)
    context_summary: str = Field(max_length=2000)


class StateNode(_GraphNodeBase):
    """State node (Phase 15, BL-060; `ARCHITECTURE_NOTES.md` §3.2) —
    session-scoped variable read/write, **in-memory only**, spanning the
    whole session (multiple turns), not just the current turn's
    `turn_state` (which resets every turn). No Postgres write path exists
    or is planned for v1 (BACKLOG BL-060) — no clear v1 consumer justifies
    the write load of persisting every State write.

    `value` supports the same `$`-prefixed reference syntax `ToolNode
    .argument_mapping` already uses (e.g. `$<node_id>` referencing another
    node's own output), so a write can capture another node's output, not
    just a literal string — resolved by the same helper
    `nodes/tool.py`'s `_resolve_arguments` already implements, reused (not
    reimplemented) by `StateNodeExecutor`.

    `value` is required only when `mode: 'write'` — a cross-field rule
    enforced server-side, in `apps/api`'s Gate A structural check
    (`graph-structure.ts`'s `checkStateValue`), not here (mirrors
    `SpeakNode.text`'s identical "required only in one mode, checked
    elsewhere, not a field-level constraint" precedent above).
    """

    type: Literal["state"] = "state"
    mode: Literal["read", "write"]
    variable: str = Field(min_length=1, max_length=80, pattern=r"^[a-zA-Z0-9_]+$")
    value: str | None = Field(default=None, max_length=2000)
    next_node_id: str | None = None


GraphNode = Annotated[
    LlmNode
    | ToolNode
    | RetrieveNode
    | RouterNode
    | SpeakNode
    | EndNode
    | ParallelNode
    | LoopNode
    | SkillNode
    | HitlNode
    | SubAgentNode
    | HandoffNode
    | StateNode,
    Field(discriminator="type"),
]


class ReasoningBlock(BaseModel):
    """`reasoning` block (Phase 9, BL-035) — replaces the old top-level
    `llm` block. `entry_node_id` is the foreground walk's start node;
    `background_entry_node_ids` are separate entry points for nodes that
    run detached after the foreground path speaks (see the plan doc's
    "Decisions made this phase").
    """

    model_config = ConfigDict(extra="forbid")

    graph: list[GraphNode] = Field(min_length=1)
    entry_node_id: str = Field(min_length=1, max_length=64)
    background_entry_node_ids: list[str] = Field(default_factory=list)
    turn_budget_ms: int = Field(default=3000, ge=100, le=60000)

    @model_validator(mode="after")
    def _graph_references_resolve(self) -> ReasoningBlock:
        """Gate A structural (referential-integrity) check — mirrors
        `apps/api/src/modules/deployment-config/domain/graph-structure.ts`
        exactly (node ids unique; `entry_node_id`, every `next_node_id`/
        branch target/`background_entry_node_ids` entry, and every
        `on_error`/`on_deadline` `goto` target resolve to a real node).
        Phase 11 (BL-042/043) extends this for Parallel/Loop's own
        references, plus V-2 (loop guards) and V-4 (no cycles) — mirrored
        here (not just in `graph-rules.ts`) for the same reason this whole
        method mirrors `graph-structure.ts`: the cross-language contract
        test runs one fixture corpus through both validators and requires
        agreement.
        """
        ids = [node.id for node in self.graph]
        if len(ids) != len(set(ids)):
            raise ValueError("reasoning.graph node ids must be unique")
        id_set = set(ids)
        if self.entry_node_id not in id_set:
            raise ValueError(f"entry_node_id '{self.entry_node_id}' does not reference a node in this graph")
        for bg_id in self.background_entry_node_ids:
            if bg_id not in id_set:
                raise ValueError(f"background_entry_node_ids entry '{bg_id}' does not reference a node in this graph")
        for node in self.graph:
            for edge in (node.on_error, node.on_deadline):
                if edge.target_node_id is not None and edge.target_node_id not in id_set:
                    raise ValueError(
                        f"node '{node.id}' edge target '{edge.target_node_id}' does not reference a node in this graph"
                    )
            if isinstance(node, RouterNode):
                for branch in node.branches:
                    if branch.next_node_id not in id_set:
                        raise ValueError(f"router node '{node.id}' branch target '{branch.next_node_id}' does not resolve")
                if node.default_next_node_id not in id_set:
                    raise ValueError(f"router node '{node.id}' default_next_node_id does not resolve")
            elif isinstance(node, ParallelNode):
                for parallel_branch in node.branches:
                    if parallel_branch.entry_node_id not in id_set:
                        raise ValueError(
                            f"parallel node '{node.id}' branch '{parallel_branch.id}' entry_node_id does not resolve"
                        )
                if node.next_node_id is not None and node.next_node_id not in id_set:
                    raise ValueError(f"node '{node.id}' next_node_id does not resolve")
                if node.join_policy == "quorum" and (node.quorum_n is None or not (1 <= node.quorum_n <= len(node.branches))):
                    raise ValueError(
                        f"parallel node '{node.id}' with join_policy 'quorum' must set quorum_n between 1 and its branch count"
                    )
            elif isinstance(node, LoopNode):
                if node.body_entry_node_id not in id_set:
                    raise ValueError(f"loop node '{node.id}' body_entry_node_id does not resolve")
                if node.next_node_id is not None and node.next_node_id not in id_set:
                    raise ValueError(f"node '{node.id}' next_node_id does not resolve")
            elif isinstance(
                node, (LlmNode, ToolNode, RetrieveNode, SpeakNode, SkillNode, HitlNode, SubAgentNode, StateNode)
            ):
                if node.next_node_id is not None and node.next_node_id not in id_set:
                    raise ValueError(f"node '{node.id}' next_node_id does not resolve")
            # `HandoffNode` (like `EndNode`) has no `next_node_id` at all —
            # deliberately excluded from this check, not an oversight (see
            # `HandoffNode`'s docstring).

        # V-2 (R-G4) — every Loop node's three guards must be positive.
        # "Present" is already guaranteed by ordinary Pydantic requiredness
        # (the fields are non-optional, just range-unconstrained at the
        # field-declaration level — see `LoopNode`'s docstring).
        for node in self.graph:
            if not isinstance(node, LoopNode):
                continue
            if node.max_iterations < 1:
                raise ValueError(f"loop node '{node.id}' max_iterations must be >= 1")
            if node.max_duration_ms < 1:
                raise ValueError(f"loop node '{node.id}' max_duration_ms must be >= 1")
            if node.max_cost < 0:
                raise ValueError(f"loop node '{node.id}' max_cost must be >= 0")

        # V-4 (R-G5) — no graph cycles, full stop. See `graph-rules.ts`'s
        # `validateNoCycles` docstring for why this collapses "no cycles
        # outside Loop" and "no cycles, period" under this schema's chosen
        # branch/body representation (single node-id references, repetition
        # expressed as repeated interpreter-level invocation rather than a
        # graph-level back-edge).
        nodes_by_id = {node.id: node for node in self.graph}
        state: dict[str, str] = {}

        def next_hop_ids(node: GraphNode) -> list[str]:
            if isinstance(node, RouterNode):
                return [*(b.next_node_id for b in node.branches), node.default_next_node_id]
            if isinstance(node, ParallelNode):
                return [*(b.entry_node_id for b in node.branches), *([node.next_node_id] if node.next_node_id else [])]
            if isinstance(node, LoopNode):
                return [node.body_entry_node_id, *([node.next_node_id] if node.next_node_id else [])]
            if isinstance(node, (EndNode, HandoffNode)):
                return []
            return [node.next_node_id] if node.next_node_id else []

        def visit(node_id: str) -> bool:
            current = state.get(node_id)
            if current == "visiting":
                return True
            if current == "done":
                return False
            node = nodes_by_id.get(node_id)
            if node is None:
                return False
            state[node_id] = "visiting"
            for next_id in next_hop_ids(node):
                if visit(next_id):
                    return True
            state[node_id] = "done"
            return False

        for node_id in nodes_by_id:
            if visit(node_id):
                raise ValueError("reasoning.graph has a cycle outside of a Loop node, which is not allowed (R-G5)")

        return self


class TtsLeg(BaseModel):
    """`tts` block (FR-TTS-1/2)."""

    model_config = ConfigDict(extra="forbid")

    provider: TtsProviderKey
    credential_ref: str | None = Field(default=None, min_length=1, max_length=256)
    voice_id: str = Field(min_length=1, max_length=128)


class AvatarLeg(BaseModel):
    """`avatar` block (FR-AVATAR-1/2)."""

    model_config = ConfigDict(extra="forbid")

    provider: AvatarProviderKey
    credential_ref: str | None = Field(default=None, min_length=1, max_length=256)
    avatar_id: str = Field(min_length=1, max_length=128)


class ToolConfig(BaseModel):
    """One `agent.tools[]` entry (FR-AGENT-2)."""

    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=80)
    api_ref: str = Field(min_length=1, max_length=64)
    enabled: bool = True


class MemoryConfig(BaseModel):
    """`agent.memory` (FR-AGENT-3)."""

    model_config = ConfigDict(extra="forbid")

    enabled: bool = True
    window_turns: int = Field(default=16, ge=0, le=64)


class AgentBlock(BaseModel):
    """`agent` block (FR-AGENT-*).

    Phase 12b (BL-045/047) removes the old RAG enable-flag / free-text
    index-reference sub-block entirely — superseded by the top-level
    `knowledge: KnowledgeConfig` block + `RetrieveNode.source_refs` (see the
    plan doc's Phase 12b "Decisions made this phase" #3 and "Cleanup" scope
    item).
    """

    model_config = ConfigDict(extra="forbid")

    runtime: AgentRuntimeKey
    system_prompt: str = Field(max_length=32768)
    tools: list[ToolConfig] = Field(default_factory=list)
    memory: MemoryConfig = Field(default_factory=MemoryConfig)

    @field_validator("system_prompt")
    @classmethod
    def _prompt_byte_length(cls, value: str) -> str:
        # Mirrors the TS side's explicit byte re-check (TypeBox's maxLength
        # counts UTF-16 units, which under-counts real wire size for any
        # multi-byte character — LLD §6.1 note).
        if len(value.encode("utf-8")) > 32768:
            raise ValueError("system_prompt must be at most 32768 bytes")
        return value


class PrivacyBlock(BaseModel):
    """`privacy` block (FR-PRIV-1/2)."""

    model_config = ConfigDict(extra="forbid")

    send_to_remote_llm: ResidencyMode
    retain_transcripts_days: int = Field(default=90, ge=1, le=730)
    recordings_enabled: bool = False


class AlertsBlock(BaseModel):
    """`alerts` block (FR-ALERT-3)."""

    model_config = ConfigDict(extra="forbid")

    degraded_mode_message: str = Field(min_length=1, max_length=500)


class DeploymentBlock(BaseModel):
    """`deployment` block — `tenant_id` is server-owned."""

    model_config = ConfigDict(extra="forbid")

    tenant_id: UUID
    name: str = Field(min_length=1, max_length=80)


class BargeIn(BaseModel):
    """`dynamics.barge_in` (Phase 16, BL-062)."""

    model_config = ConfigDict(extra="forbid")

    enabled: bool = True
    sensitivity: Literal["low", "medium", "high"] = "medium"


class NoInput(BaseModel):
    """`dynamics.no_input` (Phase 16, BL-062)."""

    model_config = ConfigDict(extra="forbid")

    timeout_ms: int = Field(default=8000, ge=1000, le=60000)
    max_reprompts: int = Field(default=2, ge=0, le=5)


class CallLimits(BaseModel):
    """`dynamics.call_limits` (Phase 16, BL-062) — a per-turn cap, distinct from `Session.max_duration_seconds` (unrelated, whole-call)."""

    model_config = ConfigDict(extra="forbid")

    max_turn_tokens: int = Field(default=200, ge=1, le=8000)
    max_turn_seconds: int = Field(default=20, ge=1, le=120)


class DynamicsBlock(BaseModel):
    """`dynamics` block (Phase 16, BL-062; `docs/v2/BACKLOG.md`).

    **Config surface only — no runtime behavior wired yet.** Confirmed
    before adding this mirror: none of barge-in/endpointing/verbosity/
    no-input/call-limits affect anything in this process today (endpoint
    detection is a hardcoded LiveKit-VAD default with zero admin control;
    there is no caller-interrupt/barge-in handling at all). This model
    exists so a published config carrying a `dynamics` block round-trips
    through this process without tripping `extra="forbid"` on `AgentConfig`
    below — required by this file's own "field-for-field identical to
    `AgentConfigSchema`" contract, not because anything here reads these
    values yet. A future phase that wires real behavior extends this
    model's *consumers*, not its shape.
    """

    model_config = ConfigDict(extra="forbid")

    barge_in: BargeIn = Field(default_factory=BargeIn)
    endpointing_silence_ms: int = Field(default=700, ge=100, le=5000)
    verbosity: Literal["concise", "balanced", "detailed"] = "balanced"
    no_input: NoInput = Field(default_factory=NoInput)
    call_limits: CallLimits = Field(default_factory=CallLimits)


class AgentConfig(BaseModel):
    """The canonical YAML config (spec FR-CONFIG-2, LLD §6.1) — Pydantic mirror.

    Field-for-field identical to `AgentConfigSchema` in
    `packages/contracts/src/agent-config/schema.ts`. Any divergence is caught
    by the fixture-corpus contract test.
    """

    model_config = ConfigDict(extra="forbid")

    version: Literal[1]
    deployment: DeploymentBlock
    transport: TransportLeg
    stt: SttLeg
    reasoning: ReasoningBlock
    tts: TtsLeg
    avatar: AvatarLeg
    agent: AgentBlock
    # Phase 12b (BL-045/047) — replaces the old agent-level RAG enable-flag
    # plus free-text index-reference pair (removed this phase; superseded
    # entirely by `RetrieveNode.source_refs` + this pipeline config).
    knowledge: KnowledgeConfig
    # Phase 13 (BL-049/050/051) — the agent-level "attached" skill list
    # (top-level analog of `agent.tools[]`); see `SkillRef`'s docstring.
    skills: list[SkillRef] = Field(default_factory=list)
    privacy: PrivacyBlock
    alerts: AlertsBlock
    # Phase 16 (BL-062) — optional even once published (see `DynamicsBlock`'s
    # own docstring for why: unlike every other block here, tuning barge-in
    # sensitivity or a no-input reprompt count is a genuine refinement this
    # agent works correctly without).
    dynamics: DynamicsBlock | None = None

    @model_validator(mode="after")
    def _retrieval_stage_budgets_fit_node_budget(self) -> AgentConfig:
        """V-10 (Phase 12b, BL-045/047) — mirrors
        `apps/api/src/modules/deployment-config/domain/graph-rules.ts`'s
        `validateRetrievalBudgets` exactly: every `retrieve`-type node's own
        `budget_ms` must be enough to cover the tenant's `knowledge.pipeline`'s
        summed per-stage `budget_ms` fields (rewrite + hybrid_search +
        metadata_filter + threshold + inject — rerank excluded, it has no
        `budget_ms`, a deferred no-op this phase). Lives on `AgentConfig`
        (not `ReasoningBlock`) because it needs both sibling top-level
        fields, `self.reasoning` and `self.knowledge.pipeline`. Unlike the TS
        side (which defensively skips a still-in-progress draft missing a
        stage budget), every Pydantic stage field always resolves to a real
        int (schema default or supplied value) once validation succeeds, so
        no such guard is needed here.
        """
        pipeline = self.knowledge.pipeline
        stage_sum = (
            pipeline.rewrite.budget_ms
            + pipeline.hybrid_search.budget_ms
            + pipeline.metadata_filter.budget_ms
            + pipeline.threshold.budget_ms
            + pipeline.inject.budget_ms
        )
        for node in self.reasoning.graph:
            if isinstance(node, RetrieveNode) and stage_sum > node.budget_ms:
                raise ValueError(
                    f"retrieve node '{node.id}' pipeline stage budgets ({stage_sum}ms) "
                    f"exceed its own budget_ms ({node.budget_ms}ms)"
                )
        return self


class ToolDefinitionDto(BaseModel):
    """One resolved `ToolDefinition` row (LLD §4.3), enriched onto the
    runtime config for every `agent.tools[]` entry the tenant marked
    `enabled` — mirrors `ToolDefinitionDtoSchema` in
    `packages/contracts/src/internal/schemas.ts`.

    QA fix (phase4-agent-python D-2): `agent.tools[]` (`ToolConfig`, above)
    only ever carries `{name, api_ref, enabled}` — a bare reference, never
    enough to actually call the tool. This is what `entrypoint.build_pipeline`
    reads to build real `orchestration.tools.ToolDefinition`/`ToolSpec`
    instances instead of hardcoding `tools=[]`/`tool_specs=[]`.
    """

    model_config = ConfigDict(extra="forbid")

    api_ref: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=80)
    description: str | None = None
    method: str = Field(min_length=1, max_length=16)
    url: HttpUrl
    credential_ref: str | None = Field(default=None, min_length=1, max_length=256)
    args_schema: dict[str, object] = Field(default_factory=dict)


class AgentRuntimeConfig(AgentConfig):
    """`GET /internal/sessions/{id}/runtime-config` response (LLD §6.3).

    The YAML config **plus** the session-resolution fields. `extra="forbid"`
    (inherited) means a control-plane change that adds a field fails this
    parse loudly in CI rather than silently at 3 a.m. — the whole point of
    the cross-language contract.
    """

    model_config = ConfigDict(extra="forbid")

    session_id: UUID
    room_name: str
    # provider_key -> endpoint_url, resolved from ProviderCredential by the
    # control plane. Never contains a raw secret (LLD §5.9 — "credential_ref
    # only"); the agent resolves the actual secret from its own
    # `SecretStorePort` mount using `credential_ref`. Deliberately `str`, not
    # `HttpUrl`: bitHuman's adapter addresses a local model directory via a
    # `file://` endpoint_url (`_resolve_model_path` in
    # `adapters/avatar/bithuman.py`), which `HttpUrl` rejects outright — every
    # consumer (`registry._endpoint_for`) already treats this as plain text.
    endpoints: dict[str, str] = Field(default_factory=dict)
    tool_definitions: list[ToolDefinitionDto] = Field(default_factory=list)
    # Phase 13 (BL-049/050/051) — resolved skill description blurbs; see
    # `SkillSummary`'s docstring for why this is a new field rather than an
    # override of the inherited `skills: list[SkillRef]`.
    skill_summaries: list[SkillSummary] = Field(default_factory=list)
