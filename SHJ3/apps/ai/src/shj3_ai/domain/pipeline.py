"""
Pure pipeline-graph logic — the Pipeline Designer's execution model.

Nothing here touches a port, a model client or SQL: `PipelineDefinition` is built once,
at read time, from real `PipelineNodes`/`PipelineEdges` rows (the adapter's job), and
`application/execute_pipeline.py` is the only effectful caller. Everything below is
deterministic given its inputs, matching `domain/orchestration.py`'s own reason for
staying pure — a graph-walking interpreter has far more to get wrong than the old flat
`if/elif/else` dispatcher it replaces, so as much of it as possible needs to be testable
without a fake model or a real database.

Two families of pure functions live here:
  - **Structural analysis** (`forward_edges_from`, `topological_order`, `loop_region`,
    `validate_definition`, ...) — read-only queries over an already-built
    `PipelineDefinition`, usable both by the runtime interpreter and by the
    `/v1/orchestration/pipelines/validate` endpoint (the same rule set the SQL publish
    trigger `TR_PipelineVersions_publishGraphValid` independently enforces, so the two
    can never quietly disagree about what a legal pipeline is).
  - **Run-state transitions** (`PipelineRunState`, `next_ready_set`, `decide_loop_back`) —
    the actual interpreter loop's decision logic, factored out of
    `ExecutePipeline.execute()` so the scheduling algorithm itself is unit-testable
    against literal state, not just observable through a full, effectful turn.
"""

from __future__ import annotations

import heapq
from collections import deque
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from decimal import Decimal
from enum import StrEnum

from shj3_ai.domain.condition_expr import ConditionAst, ConditionContext, evaluate
from shj3_ai.domain.orchestration import ConflictResolution, MergePolicy, TraceStepStatus

# ---------------------------------------------------------------------------
# Closed vocabularies — `CK_PipelineNodes_kind`, `CK_PipelineEdges_kind`,
# `CK_PipelineNodes_inputContextMode`, `CK_PipelineNodes_onErrorPolicy`.
# ---------------------------------------------------------------------------


class PipelineNodeKind(StrEnum):
    START = "Start"
    AGENT = "Agent"
    SUPERVISOR = "Supervisor"
    RESPONSE = "Response"


class PipelineEdgeKind(StrEnum):
    SEQUENTIAL = "Sequential"
    PARALLEL = "Parallel"
    LOOP_BACK = "LoopBack"


class InputContextMode(StrEnum):
    USER_TURN_ONLY = "UserTurnOnly"
    UPSTREAM_REPLIES_FULL = "UpstreamRepliesFull"
    UPSTREAM_REPLIES_SUMMARY = "UpstreamRepliesSummary"


class NodeErrorPolicy(StrEnum):
    FAIL_TURN = "FailTurn"
    SKIP_NODE = "SkipNode"
    ROUTE_TO_FALLBACK_AGENT = "RouteToFallbackAgent"


# ---------------------------------------------------------------------------
# The definition — built once, at read time, by the adapter. SQL ids are resolved
# to `key` before this dataclass exists; nothing downstream ever sees a SQL id
# (`FlowEdgeDef`'s own established convention on the web side).
# ---------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class PipelineNodeDef:
    key: str
    kind: PipelineNodeKind
    title: str
    agent_id: str | None = None
    uses_turn_bound_agent: bool = False
    agent_version_pin_id: str | None = None
    input_context_mode: InputContextMode = InputContextMode.USER_TURN_ONLY
    merge_policy_override: MergePolicy | None = None
    conflict_resolution_override: ConflictResolution | None = None
    is_owning_entity: bool = False
    cost_ceiling_tokens_override: int | None = None
    cost_ceiling_micro_aed_override: int | None = None
    timeout_ms_override: int | None = None
    on_error_policy: NodeErrorPolicy = NodeErrorPolicy.FAIL_TURN


@dataclass(frozen=True, slots=True)
class PipelineEdgeDef:
    from_node_key: str
    to_node_key: str
    kind: PipelineEdgeKind
    ordinal: int
    label: str | None = None
    max_iterations: int | None = None
    condition_expression: str | None = None

    @property
    def edge_key(self) -> str:
        return f"{self.from_node_key}->{self.to_node_key}"


@dataclass(frozen=True, slots=True)
class PipelineDefinition:
    pipeline_version_id: str
    pipeline_design_id: str
    label: str
    entry_node_key: str
    max_total_hops: int
    cost_ceiling_tokens: int
    cost_ceiling_micro_aed: int
    default_merge_policy: MergePolicy
    default_conflict_resolution: ConflictResolution
    routing_strategy: str
    min_routing_confidence: float
    fallback_agent_id: str | None
    nodes: Mapping[str, PipelineNodeDef]
    #: Ordinal-sorted at read time — the interpreter never sorts.
    edges_from: Mapping[str, tuple[PipelineEdgeDef, ...]]
    edges_into: Mapping[str, tuple[PipelineEdgeDef, ...]]


class PipelineCycleError(Exception):
    """Raised by `topological_order` when the FORWARD (non-`LoopBack`) subgraph itself
    contains a cycle — a genuine authoring error, and the offline-testable twin of
    `TR_PipelineVersions_publishGraphValid`'s own recursive-CTE cycle check."""

    def __init__(self, cyclic_node_keys: Sequence[str]) -> None:
        self.cyclic_node_keys = tuple(cyclic_node_keys)
        super().__init__(
            f"Pipeline graph has a cycle outside any LoopBack edge: {self.cyclic_node_keys}"
        )


# ---------------------------------------------------------------------------
# Structural queries.
# ---------------------------------------------------------------------------


def forward_edges_from(defn: PipelineDefinition, key: str) -> tuple[PipelineEdgeDef, ...]:
    """Every outgoing edge from `key` that is not a loop-back — the edges a normal,
    non-repeating pass through the graph actually walks."""
    return tuple(e for e in defn.edges_from.get(key, ()) if e.kind != PipelineEdgeKind.LOOP_BACK)


def forward_edges_into(defn: PipelineDefinition, key: str) -> tuple[PipelineEdgeDef, ...]:
    return tuple(e for e in defn.edges_into.get(key, ()) if e.kind != PipelineEdgeKind.LOOP_BACK)


def loop_edges_from(defn: PipelineDefinition, key: str) -> tuple[PipelineEdgeDef, ...]:
    return tuple(e for e in defn.edges_from.get(key, ()) if e.kind == PipelineEdgeKind.LOOP_BACK)


def forward_indegree(defn: PipelineDefinition, key: str) -> int:
    return len(forward_edges_into(defn, key))


def _forward_reachable(defn: PipelineDefinition, start: str) -> set[str]:
    """Every node reachable FROM `start` over forward edges, inclusive of `start`."""
    seen = {start}
    queue: deque[str] = deque([start])
    while queue:
        key = queue.popleft()
        for edge in forward_edges_from(defn, key):
            if edge.to_node_key not in seen:
                seen.add(edge.to_node_key)
                queue.append(edge.to_node_key)
    return seen


def _forward_reachable_reverse(defn: PipelineDefinition, target: str) -> set[str]:
    """Every node that can reach `target` over forward edges, inclusive of `target` —
    BFS over the reversed forward-edge graph."""
    seen = {target}
    queue: deque[str] = deque([target])
    while queue:
        key = queue.popleft()
        for edge in forward_edges_into(defn, key):
            if edge.from_node_key not in seen:
                seen.add(edge.from_node_key)
                queue.append(edge.from_node_key)
    return seen


def topological_order(defn: PipelineDefinition) -> tuple[str, ...]:
    """Kahn's algorithm over FORWARD edges only, ties broken lexicographically by node
    key for a deterministic result. Raises `PipelineCycleError` if the forward subgraph
    itself is cyclic."""
    remaining = {key: forward_indegree(defn, key) for key in defn.nodes}
    heap = sorted(k for k, d in remaining.items() if d == 0)
    heapq.heapify(heap)
    order: list[str] = []
    while heap:
        key = heapq.heappop(heap)
        order.append(key)
        for edge in forward_edges_from(defn, key):
            remaining[edge.to_node_key] -= 1
            if remaining[edge.to_node_key] == 0:
                heapq.heappush(heap, edge.to_node_key)
    if len(order) != len(defn.nodes):
        cyclic = sorted(set(defn.nodes) - set(order))
        raise PipelineCycleError(cyclic)
    return tuple(order)


def topological_depth(defn: PipelineDefinition) -> Mapping[str, int]:
    """Longest-path-from-entry depth over forward edges — the layout column
    `OrchestrationTraceSteps.depth` records. A node unreachable from the entry node has
    no entry in the returned mapping; this function itself never raises for that case
    (only `PipelineCycleError` propagates, for a genuinely cyclic forward subgraph)."""
    order = topological_order(defn)
    depth: dict[str, int] = {}
    if defn.entry_node_key in order:
        depth[defn.entry_node_key] = 0
    for key in order:
        if key not in depth:
            continue
        for edge in forward_edges_from(defn, key):
            candidate = depth[key] + 1
            if edge.to_node_key not in depth or candidate > depth[edge.to_node_key]:
                depth[edge.to_node_key] = candidate
    return depth


def loop_region(defn: PipelineDefinition, edge: PipelineEdgeDef) -> frozenset[str]:
    """Every node on some forward path from `edge.to_node_key` (the loop's target) to
    `edge.from_node_key` (the loop's source), inclusive of both endpoints — the unit a
    loop-back edge's own iteration counter is scoped to, replacing today's turn-wide
    `loop_detected()` heuristic entirely.

    If the edge doesn't actually close a loop (the target cannot reach the source over
    forward edges — `validate_definition` flags this as
    `orchestration.pipeline.loop_edge_does_not_close_a_loop`), this returns just the two
    endpoints rather than raising, so a misconfigured edge still has *some* defined
    region instead of crashing mid-execution."""
    forward_from_target = _forward_reachable(defn, edge.to_node_key)
    if edge.from_node_key not in forward_from_target:
        return frozenset({edge.from_node_key, edge.to_node_key})
    can_reach_source = _forward_reachable_reverse(defn, edge.from_node_key)
    return frozenset(forward_from_target & can_reach_source) | {
        edge.from_node_key,
        edge.to_node_key,
    }


@dataclass(frozen=True, slots=True)
class PipelineValidationIssue:
    code: str
    node_keys: tuple[str, ...] = ()
    edge_keys: tuple[str, ...] = ()
    message: str = ""


def validate_definition(
    defn: PipelineDefinition,
    *,
    published_agent_ids: frozenset[str] | None = None,
) -> tuple[PipelineValidationIssue, ...]:
    """The runtime twin of `TR_PipelineVersions_publishGraphValid` — same rule set
    (entry/terminal/orphan/cycle/loop-ancestor), same issue-code vocabulary, so the SQL
    trigger and this function can never quietly disagree about what a legal pipeline is.

    Deliberately does NOT check `agent_version_pin_id` against a Published-version set —
    that id space (`AgentVersions.id`, not `Agents.id`) isn't this function's to resolve,
    and pin validity is enforced by the trigger's own rule (g) and the web-side publish
    use case instead. Callers that can supply `published_agent_ids` get the plain
    `agent_id` check for free; callers that can't (e.g. a first structural pass run
    before the agent registry is loaded) simply omit it."""
    issues: list[PipelineValidationIssue] = []

    entry = defn.nodes.get(defn.entry_node_key)
    if entry is None or entry.kind != PipelineNodeKind.START:
        issues.append(
            PipelineValidationIssue(
                code="orchestration.pipeline.entry_node_required",
                node_keys=(defn.entry_node_key,) if entry is not None else (),
                message="The pipeline's entry node must be a real Start node.",
            )
        )

    if not any(n.kind == PipelineNodeKind.RESPONSE for n in defn.nodes.values()):
        issues.append(
            PipelineValidationIssue(
                code="orchestration.pipeline.terminal_node_required",
                message="A pipeline must have at least one Response node.",
            )
        )

    for key, node in defn.nodes.items():
        if node.kind != PipelineNodeKind.START and not forward_edges_into(defn, key):
            issues.append(
                PipelineValidationIssue(
                    code="orchestration.pipeline.orphan_node",
                    node_keys=(key,),
                    message=f"'{key}' has no inbound connection.",
                )
            )
        if node.kind != PipelineNodeKind.RESPONSE and not forward_edges_from(defn, key):
            issues.append(
                PipelineValidationIssue(
                    code="orchestration.pipeline.orphan_node",
                    node_keys=(key,),
                    message=f"'{key}' has no outbound connection.",
                )
            )

    order: tuple[str, ...] = ()
    try:
        order = topological_order(defn)
    except PipelineCycleError as exc:
        issues.append(
            PipelineValidationIssue(
                code="orchestration.pipeline.cycle_outside_loop_edge",
                node_keys=tuple(sorted(exc.cyclic_node_keys)),
                message="The pipeline contains a cycle not marked as a loop-back.",
            )
        )

    if order and entry is not None and entry.kind == PipelineNodeKind.START:
        reachable = _forward_reachable(defn, defn.entry_node_key)
        unreachable = sorted(set(defn.nodes) - reachable)
        if unreachable:
            issues.append(
                PipelineValidationIssue(
                    code="orchestration.pipeline.unreachable_node",
                    node_keys=tuple(unreachable),
                    message="Not every node is reachable from the entry node.",
                )
            )

    for key in defn.nodes:
        for edge in loop_edges_from(defn, key):
            if edge.from_node_key not in _forward_reachable(defn, edge.to_node_key):
                issues.append(
                    PipelineValidationIssue(
                        code="orchestration.pipeline.loop_edge_does_not_close_a_loop",
                        edge_keys=(edge.edge_key,),
                        message=f"'{edge.edge_key}' does not point back to an ancestor node.",
                    )
                )

    if published_agent_ids is not None:
        for key, node in defn.nodes.items():
            if node.agent_id is not None and node.agent_id not in published_agent_ids:
                issues.append(
                    PipelineValidationIssue(
                        code="orchestration.pipeline.agent_not_published",
                        node_keys=(key,),
                        message=f"'{key}' references an agent that is not currently Published.",
                    )
                )

    return tuple(issues)


# ---------------------------------------------------------------------------
# Run state and the interpreter's scheduling decisions.
# ---------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class NodeOutput:
    """One node's completed invocation this turn — the unit `PipelineRunState` folds
    in and the interpreter turns into an `OrchestrationTraceStep` row."""

    node_key: str
    agent_id: str | None
    text: str
    confidence: Decimal
    is_owning_entity: bool
    status: TraceStepStatus
    via_edge_key: str | None
    branch_id: str
    loop_iteration: int = 0


class ReadyKind(StrEnum):
    SEQUENTIAL = "Sequential"
    PARALLEL = "Parallel"


@dataclass(frozen=True, slots=True)
class ReadySet:
    kind: ReadyKind
    nodes: tuple[PipelineNodeDef, ...]


@dataclass(slots=True)
class PipelineRunState:
    """Mutable execution state for one turn's walk of `definition`. `apply_output` and
    `take_loop` are this class's only two mutators — every other read
    (`next_ready_set`, `decide_loop_back`) is a pure function over an instance of this
    class, so the interpreter's actual decision-making is testable against literal
    state without running a turn."""

    definition: PipelineDefinition
    node_outputs: dict[str, NodeOutput] = field(default_factory=dict)
    #: Forward edges only — a loop-back edge is never "satisfied" this way.
    satisfied_edges: set[str] = field(default_factory=set)
    #: `edge_key -> number of times taken`.
    loop_iterations: dict[str, int] = field(default_factory=dict)
    branch_of_node: dict[str, str] = field(default_factory=dict)
    hop_count: int = 0
    ready_set_index: int = 0
    #: Node keys re-triggered by a loop-back edge just being taken — checked by
    #: `next_ready_set` BEFORE the normal forward-indegree readiness rule, since a loop
    #: target's original forward inbound edge(s) stay satisfied from its first pass and
    #: would never naturally re-fire it otherwise.
    pending_reentry: set[str] = field(default_factory=set)

    def apply_output(self, output: NodeOutput) -> None:
        self.node_outputs[output.node_key] = output
        self.branch_of_node[output.node_key] = output.branch_id
        self.pending_reentry.discard(output.node_key)
        for edge in forward_edges_from(self.definition, output.node_key):
            self.satisfied_edges.add(edge.edge_key)

    def take_loop(self, edge: PipelineEdgeDef) -> None:
        """Bumps the loop edge's own counter, clears every node/edge inside
        `loop_region` (so the region can genuinely re-run rather than being treated as
        already-satisfied), and marks the loop's target for re-entry on the very next
        `next_ready_set` call."""
        self.loop_iterations[edge.edge_key] = self.loop_iterations.get(edge.edge_key, 0) + 1
        for key in loop_region(self.definition, edge):
            self.node_outputs.pop(key, None)
            self.branch_of_node.pop(key, None)
            for e in forward_edges_from(self.definition, key):
                self.satisfied_edges.discard(e.edge_key)
        self.pending_reentry.add(edge.to_node_key)


def next_ready_set(state: PipelineRunState) -> ReadySet | None:
    """A node is ready when every forward edge into it is satisfied and it hasn't
    produced output on this pass. Returned nodes are sorted by `(incoming edge
    ordinal, node key)` — NEVER by completion order, so identical inputs always produce
    identical trace ordinals. `kind` is `PARALLEL` iff more than one node is ready at
    once, which (given `TR_PipelineEdges_homogeneousFanOut`, which makes a multi-way
    `Sequential` fan-out unrepresentable) is by construction always a real concurrency
    opportunity — either a genuine `Parallel` fan-out, or two independent branches that
    both happened to become ready on the same pass, which is equally safe to run
    concurrently."""
    if state.pending_reentry:
        # A loop re-entry always re-triggers exactly its own target, on its own pass —
        # it never fans out, regardless of how many other edges also target that node.
        key = min(state.pending_reentry)
        state.pending_reentry.discard(key)
        return ReadySet(kind=ReadyKind.SEQUENTIAL, nodes=(state.definition.nodes[key],))

    defn = state.definition
    candidates = [
        node
        for key, node in defn.nodes.items()
        if key not in state.node_outputs
        and all(e.edge_key in state.satisfied_edges for e in forward_edges_into(defn, key))
    ]
    if not candidates:
        return None
    candidates.sort(
        key=lambda n: (
            min((e.ordinal for e in forward_edges_into(defn, n.key)), default=0),
            n.key,
        )
    )
    if len(candidates) == 1:
        return ReadySet(kind=ReadyKind.SEQUENTIAL, nodes=(candidates[0],))
    return ReadySet(kind=ReadyKind.PARALLEL, nodes=tuple(candidates))


class LoopDecision(StrEnum):
    TAKE = "Take"
    EXIT_MAX_ITERATIONS = "ExitMaxIterations"
    EXIT_CONDITION_FALSE = "ExitConditionFalse"
    EXIT_CONDITION_ERROR = "ExitConditionError"


def decide_loop_back(
    state: PipelineRunState,
    node_key: str,
    ctx: ConditionContext,
    compiled: Mapping[str, ConditionAst],
) -> tuple[PipelineEdgeDef, LoopDecision] | None:
    """At most one loop-back edge is taken per node per pass — the first one out of
    `node_key`, in `ordinal` order, whatever its own decision turns out to be.

    Per edge: (1) `taken >= max_iterations` -> `EXIT_MAX_ITERATIONS`, checked FIRST and
    unconditionally — the hard backstop a condition can never extend past, which is the
    entire point of `maxIterations` being mandatory rather than optional; (2) no
    condition -> `TAKE` (the loop repeats exactly `max_iterations` times); (3) a
    condition is present -> evaluate it: `True` -> `TAKE`, `False` ->
    `EXIT_CONDITION_FALSE`.

    `compiled` holds one already-`parse`d `ConditionAst` per loop-back edge whose
    `condition_expression` parsed successfully once, at run start — an edge with a
    condition but NO entry in `compiled` means parsing failed up front, decided
    `EXIT_CONDITION_ERROR` HERE, never by `evaluate()` raising (it never does)."""
    for edge in loop_edges_from(state.definition, node_key):
        taken = state.loop_iterations.get(edge.edge_key, 0)
        if edge.max_iterations is not None and taken >= edge.max_iterations:
            return edge, LoopDecision.EXIT_MAX_ITERATIONS
        if edge.condition_expression is None:
            return edge, LoopDecision.TAKE
        ast = compiled.get(edge.edge_key)
        if ast is None:
            return edge, LoopDecision.EXIT_CONDITION_ERROR
        if evaluate(ast, ctx):
            return edge, LoopDecision.TAKE
        return edge, LoopDecision.EXIT_CONDITION_FALSE
    return None
