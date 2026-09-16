"""
Pure orchestration logic — B4's execution modes, ceilings and merge policy.

Nothing here touches a port, a model client or SQL. `application/process_turn.py`
and its three mode executors are the only callers; this module supplies the parts
of B4 that are pure computation over already-produced values (ceiling checks,
merge/dedup, trace-step shaping) so that behaviour is directly unit-testable
without a fake model or a real database.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal
from enum import StrEnum

# ---------------------------------------------------------------------------
# Execution modes — `CK_RouterConfigs_executionMode`.
# ---------------------------------------------------------------------------


class ExecutionMode(StrEnum):
    SEQUENTIAL = "Sequential"
    PARALLEL = "Parallel"
    SUPERVISOR_WORKER = "SupervisorWorker"
    #: A graph-executed turn (`RouterConfigs.activePipelineVersionId` set) —
    #: `CK_OrchestrationTraces_executionMode` accepts this alongside the three
    #: legacy values.
    PIPELINE = "Pipeline"


# ---------------------------------------------------------------------------
# Trace step kinds — the closed set `OrchestrationTraceSteps.kind` and every SSE
# event this wave emits both draw from.
# ---------------------------------------------------------------------------


class TraceStepKind(StrEnum):
    GUARDRAIL_PRE = "GuardrailPre"
    ROUTE = "Route"
    AGENT_INVOKE = "AgentInvoke"
    TOOL_CALL = "ToolCall"
    RETRIEVAL = "Retrieval"
    MERGE = "Merge"
    GUARDRAIL_POST = "GuardrailPost"
    HANDOVER = "Handover"
    FLOW_ESCAPE = "FlowEscape"
    #: Added by the Pipeline Designer's graph interpreter — one `FanOut` step per parallel
    #: fan-out point, one `LoopBack` step per loop decision (taken or not).
    FAN_OUT = "FanOut"
    LOOP_BACK = "LoopBack"


class TraceStepStatus(StrEnum):
    OK = "Ok"
    FAILED = "Failed"
    TIMEOUT = "Timeout"
    BLOCKED = "Blocked"
    SKIPPED = "Skipped"


@dataclass(frozen=True, slots=True)
class TraceStep:
    """One row this turn will write to `OrchestrationTraceSteps`.

    The six `pipeline_*`/`branch_id`/`loop_iteration`/`depth` fields are purely additive —
    every existing construction site keeps compiling unchanged — and are populated only by
    `application/execute_pipeline.py`'s graph interpreter, never by the legacy flat
    dispatcher. `pipeline_node_key`/`from_node_key` are the real, stable node keys (never a
    SQL id — the persistence adapter resolves key -> id at write time, the same
    resolve-at-the-boundary convention `domain/pipeline.py`'s own `PipelineNodeDef`
    establishes)."""

    ordinal: int
    kind: TraceStepKind
    label: str
    status: TraceStepStatus
    duration_ms: int
    agent_id: str | None = None
    tool_binding_id: str | None = None
    arguments_masked: str | None = None
    result_summary: str | None = None
    confidence: Decimal | None = None
    error_code: str | None = None
    is_secondary_agent: bool = False
    pipeline_node_key: str | None = None
    from_node_key: str | None = None
    edge_kind: str | None = None
    branch_id: str | None = None
    loop_iteration: int | None = None
    depth: int | None = None


# ---------------------------------------------------------------------------
# Budgets and ceilings — FR-ORCH-07, FR-ORCH-08.
# ---------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class Budget:
    """Resolved from `RouterConfig` (+ the caller's own per-turn override, api.md
    §5.1's `budget` object) before a turn begins — this module never reads config
    itself."""

    max_hops: int
    max_loop_iterations: int
    cost_ceiling_tokens: int
    cost_ceiling_micro_aed: int

    @staticmethod
    def from_pipeline(
        max_total_hops: int, cost_ceiling_tokens: int, cost_ceiling_micro_aed: int
    ) -> Budget:
        """A pipeline version has no `max_loop_iterations` of its own — that is now a
        per-`PipelineEdge.maxIterations` concern (`decide_loop_back`'s own hard backstop),
        not a turn-wide count. `1` here is a harmless placeholder never actually consulted
        by pipeline-mode execution, kept only so this dataclass's shape stays uniform for
        the legacy `hop_ceiling_reached`/`cost_ceiling_reached` functions it is still passed
        to."""
        return Budget(
            max_hops=max_total_hops,
            max_loop_iterations=1,
            cost_ceiling_tokens=cost_ceiling_tokens,
            cost_ceiling_micro_aed=cost_ceiling_micro_aed,
        )

    def narrowed_by(self, router_max_tokens: int, router_max_micro_aed: int) -> Budget:
        """The `min(RouterConfigs.*, PipelineVersion.*)` cost-ceiling rule: a tenant-wide
        cap an Agent Designer's own published pipeline can tighten, never exceed."""
        return Budget(
            max_hops=self.max_hops,
            max_loop_iterations=self.max_loop_iterations,
            cost_ceiling_tokens=min(self.cost_ceiling_tokens, router_max_tokens),
            cost_ceiling_micro_aed=min(self.cost_ceiling_micro_aed, router_max_micro_aed),
        )


@dataclass(slots=True)
class CostLedger:
    """Per-turn running total. One instance per `ProcessTurn.execute()` call —
    never shared across turns, which is what makes 'per-call token/cost
    accounting' auditable rather than aggregated after the fact."""

    total_input_tokens: int = 0
    total_output_tokens: int = 0
    total_cost_micro_aed: int = 0
    calls: list[ModelCallCost] = field(default_factory=list)

    def record(self, call: ModelCallCost) -> None:
        self.calls.append(call)
        self.total_input_tokens += call.input_tokens
        self.total_output_tokens += call.output_tokens
        self.total_cost_micro_aed += call.cost_micro_aed

    @property
    def total_tokens(self) -> int:
        return self.total_input_tokens + self.total_output_tokens


@dataclass(frozen=True, slots=True)
class ModelCallCost:
    """One real model call's accounting row — the unit `ConversationTurns.inputTokens`
    /`outputTokens` and `OrchestrationTraces.totalCostMicroAed` are built from.
    `used_fallback` is what makes the fallback path distinctly recorded on the
    trace (FR-AGENT-12), not merely inferred from which model name appears."""

    model: str
    input_tokens: int
    output_tokens: int
    cost_micro_aed: int
    used_fallback: bool
    duration_ms: int


@dataclass(frozen=True, slots=True)
class RoutingCandidate:
    agent_id: str
    agent_version_id: str
    name: str
    system_prompt: str


@dataclass(frozen=True, slots=True)
class RoutingDecision:
    primary: RoutingCandidate
    confidence: float
    secondary: tuple[RoutingCandidate, ...]


def score_agent_confidence(system_prompt: str, user_text: str) -> float:
    """`routing_strategy: "IntentClassifier"` (`CK_RouterConfigs_routingStrategy`) —
    a real, deterministic intent-classification proxy: the fraction of the
    user turn's own significant words (length > 3, so "the"/"and"/"pay" don't
    dominate) that also appear in the candidate agent's system prompt. Cheap,
    offline-testable, and genuinely sensitive to which agent's own domain
    vocabulary the turn matches — not a stand-in that always returns the same
    number regardless of input, which would make FR-ORCH's confidence-floor
    behaviour untestable.

    Public (promoted from `_keyword_overlap_score`) so the Pipeline Designer's graph
    interpreter (`application/execute_pipeline.py`) can score any node's own resolved
    agent against the turn, not just `route()`'s own primary/secondary candidates —
    the SAME scoring function, reused rather than re-derived."""
    prompt_words = {w.lower() for w in system_prompt.split() if len(w) > 3}
    turn_words = [w.strip(".,?!").lower() for w in user_text.split() if len(w) > 3]
    if not turn_words:
        return 0.5
    matches = sum(1 for w in turn_words if w in prompt_words)
    return min(1.0, 0.35 + (matches / len(turn_words)))


def route(
    user_text: str,
    primary: RoutingCandidate,
    other_candidates: list[RoutingCandidate],
    *,
    execution_mode: ExecutionMode,
    max_secondary: int,
) -> RoutingDecision:
    """Deterministic given its inputs. `primary` is always `agentBinding`'s own
    agent (api.md §5.1: resolved by the caller, never re-derived here) — this
    function's real job is (a) scoring that binding's own confidence against
    the turn, so a low-confidence bound agent is still visible on the trace,
    and (b) selecting up to `max_secondary` further agents for the modes that
    use more than one (Parallel, SupervisorWorker), ranked by the same scoring
    function against every other in-scope candidate."""
    confidence = score_agent_confidence(primary.system_prompt, user_text)
    secondary: tuple[RoutingCandidate, ...] = ()
    if execution_mode != ExecutionMode.SEQUENTIAL and max_secondary > 0 and other_candidates:
        ranked = sorted(
            other_candidates,
            key=lambda c: score_agent_confidence(c.system_prompt, user_text),
            reverse=True,
        )
        secondary = tuple(ranked[:max_secondary])
    return RoutingDecision(primary=primary, confidence=confidence, secondary=secondary)


def filter_candidates_by_scope(
    candidates: list[RoutingCandidate],
    *,
    scope: str,
    scope_list: tuple[str, ...],
) -> list[RoutingCandidate]:
    """`RouterConfig.agentSelectionScope` applied to an already-`Published`, already
    primary-excluded candidate pool, before `route()` ever sees it.

    Fixes a real, previously-shipped bug: `"ExplicitList"`/`"ChannelBound"` were stored
    and readable (`CK_RouterConfigs_agentSelectionScope`) but had zero effect on routing —
    `list_published_agents()` (`ports/config_reader.py`) is documented as implementing
    only the `"AllPublished"` case, and nothing else ever filtered its result. An admin
    configuring "combine these 3 specific agents" via `agentScopeListJson` was silently
    getting every published agent instead.

    `"AllPublished"` and `"ChannelBound"` both pass every candidate through unchanged —
    `"ChannelBound"` is a deliberately deferred case: enforcing it for real needs a
    channel↔agent-binding cross-reference this service has no port for at all yet (the
    current conversation's channel is not even threaded into this function), a
    materially separate change from fixing `"ExplicitList"`. Only `"ExplicitList"`
    filters, keeping candidates whose `agent_id` is in `scope_list`.

    Edge cases handled by construction, not special-cased:
      - an empty/absent `scope_list` yields zero secondary candidates — safe and inert,
        not an error: the admin configured a pipeline with no combined agents.
      - an id in `scope_list` that is no longer `Published` is already absent from
        `candidates` (always `list_published_agents()`'s own result), so the set
        intersection drops it with no extra code.
      - the primary agent's own id in `scope_list` is a no-op: `candidates` never
        contains the primary (the caller already passes `exclude_agent_id=`), so this
        can never produce a double-invoke.
    """
    if scope != "ExplicitList":
        return candidates
    allowed = set(scope_list)
    return [c for c in candidates if c.agent_id in allowed]


def hop_ceiling_reached(hop_count: int, budget: Budget) -> bool:
    """FR-ORCH-07: a turn terminates at the ceiling rather than running unbounded."""
    return hop_count >= budget.max_hops


def loop_detected(recent_agent_ids: list[str], budget: Budget) -> bool:
    """
    A loop is the same agent selected `max_loop_iterations` times in a row within
    one turn — the router repeatedly handing back to an agent that keeps
    declining or re-delegating is exactly the unbounded-ping-pong case
    FR-ORCH-07's loop ceiling exists to stop. Checked on the *trailing* run of
    identical ids, not a total count, so two different agents alternating
    (legitimate sequential hand-off) never trips it.
    """
    if budget.max_loop_iterations < 1 or len(recent_agent_ids) < budget.max_loop_iterations:
        return False
    trailing = recent_agent_ids[-budget.max_loop_iterations :]
    return len(set(trailing)) == 1


def cost_ceiling_reached(ledger: CostLedger, budget: Budget) -> bool:
    """FR-ORCH-08: enforced using the same figures every call recorded."""
    return (
        ledger.total_tokens >= budget.cost_ceiling_tokens
        or ledger.total_cost_micro_aed >= budget.cost_ceiling_micro_aed
    )


# ---------------------------------------------------------------------------
# Merge policy — FR-ORCH-04, FR-ORCH-09. `CK_RouterConfigs_responseMergePolicy`.
# ---------------------------------------------------------------------------


class MergePolicy(StrEnum):
    CONCATENATE_IN_ORDER = "ConcatenateInOrder"
    DEDUPLICATE_OVERLAP = "DeduplicateOverlap"
    SUPERVISOR_REWRITE = "SupervisorRewrite"


class ConflictResolution(StrEnum):
    HIGHEST_CONFIDENCE = "HighestConfidence"
    PREFER_OWNING_ENTITY = "PreferOwningEntity"
    SUPERVISOR_ARBITRATES = "SupervisorArbitrates"


@dataclass(frozen=True, slots=True)
class AgentReply:
    agent_id: str
    text: str
    confidence: Decimal
    is_owning_entity: bool = False


@dataclass(frozen=True, slots=True)
class MergeResult:
    merged_text: str
    discarded: tuple[AgentReply, ...]
    policy_applied: MergePolicy


def _sentence_overlaps(a: str, b: str) -> bool:
    """A cheap, deterministic overlap test: two replies "overlap" when one's
    lower-cased text is a substring of the other's, or they share the same
    first sentence. Good enough to prove `DeduplicateOverlap` actually removes a
    duplicate statement (FR-ORCH-04's own acceptance test) without pulling in an
    embedding model for what is a pure, offline-testable domain function."""
    la, lb = a.strip().lower(), b.strip().lower()
    if not la or not lb:
        return False
    if la in lb or lb in la:
        return True
    first_a = la.split(".")[0]
    first_b = lb.split(".")[0]
    return bool(first_a) and first_a == first_b


def merge_replies(
    replies: list[AgentReply],
    *,
    merge_policy: MergePolicy,
    conflict_resolution: ConflictResolution,
) -> MergeResult:
    """
    Deterministic given its inputs (FR-ORCH-09's own acceptance bar) — the same
    two replies under the same configured policy always produce the same merged
    text and the same discarded set, which is what lets a test assert on the
    output rather than merely on "a merge happened".
    """
    if not replies:
        return MergeResult(merged_text="", discarded=(), policy_applied=merge_policy)
    if len(replies) == 1:
        return MergeResult(merged_text=replies[0].text, discarded=(), policy_applied=merge_policy)

    if merge_policy == MergePolicy.CONCATENATE_IN_ORDER:
        merged = "\n\n".join(r.text for r in replies)
        return MergeResult(merged_text=merged, discarded=(), policy_applied=merge_policy)

    if merge_policy == MergePolicy.SUPERVISOR_REWRITE:
        # The supervisor's own synthesis (last reply, by convention the
        # supervisor's review step in supervisor-worker mode) is the merged
        # answer; every worker reply it drew on is recorded as discarded so the
        # trace shows what fed the rewrite without duplicating it in the reply.
        supervisor_reply = replies[-1]
        return MergeResult(
            merged_text=supervisor_reply.text,
            discarded=tuple(replies[:-1]),
            policy_applied=merge_policy,
        )

    # DeduplicateOverlap: pick a keeper for every overlapping pair using the
    # configured conflict-resolution rule, keep every reply with no overlap.
    kept: list[AgentReply] = []
    discarded: list[AgentReply] = []
    for reply in replies:
        overlapping_kept = next((k for k in kept if _sentence_overlaps(k.text, reply.text)), None)
        if overlapping_kept is None:
            kept.append(reply)
            continue
        winner = _resolve_conflict(overlapping_kept, reply, conflict_resolution)
        loser = reply if winner is overlapping_kept else overlapping_kept
        if winner is not overlapping_kept:
            kept[kept.index(overlapping_kept)] = winner
        discarded.append(loser)

    merged = "\n\n".join(r.text for r in kept)
    return MergeResult(merged_text=merged, discarded=tuple(discarded), policy_applied=merge_policy)


def _resolve_conflict(a: AgentReply, b: AgentReply, rule: ConflictResolution) -> AgentReply:
    if rule == ConflictResolution.PREFER_OWNING_ENTITY and a.is_owning_entity != b.is_owning_entity:
        return a if a.is_owning_entity else b
    # Neither/both own it (or the rule doesn't apply) — fall through to
    # confidence as the tiebreaker.
    if rule == ConflictResolution.SUPERVISOR_ARBITRATES:
        # Arbitration itself is a model call the application layer makes before
        # merge (an extra `AgentInvoke` trace step); by the time replies reach
        # this pure function one of the two has already been marked, in practice
        # by re-ordering so the arbiter's preferred reply is `a`. Domain-level
        # fallback (no arbitration signal available) is highest confidence.
        pass
    return a if a.confidence >= b.confidence else b
