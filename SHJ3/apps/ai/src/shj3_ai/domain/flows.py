"""
Pure flow-engine logic — B7's five node types, retry-then-fall-through, and the
free-text escape (brief requirement R3 / FR-FLOW-07 / FR-FLOW-09).

A flow's durable *definition* (`Flow`/`FlowVersion`/`FlowNode`/`FlowEdge`) is read
through `ports/flow_reader.py`; a conversation's live *position* in that
definition (current node, filled slots, escape context) is read and written
through `ports/flow_state_store.py`. This module is the pure state machine
between the two: given a definition and a live state, what happens next.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum


class FlowNodeType(StrEnum):
    """`CK_FlowNodes_type`."""

    MESSAGE = "Message"
    QUESTION = "Question"
    TOOL_CALL = "ToolCall"
    HANDOVER = "Handover"
    CONDITION = "Condition"


@dataclass(frozen=True, slots=True)
class FlowNodeDef:
    """The subset of a `FlowNode` row the state machine needs. Extra per-kind
    fields (`toolBindingId`, `handoverReason`, ...) are read by
    `application/execute_flow_node.py`, which owns actually *doing* the node's
    effect; this dataclass only carries what routing/retry/escape logic needs."""

    id: str
    key: str
    type: FlowNodeType
    slot_name: str | None = None
    retry_count: int | None = None
    on_failure_node_key: str | None = None
    """The fall-through target's `key` — resolved from `FlowNodes.onFailureNodeId`
    (a real id) at adapter read time, the same id-to-key resolution
    `FlowEdgeDef.to_node_key` needs, so nothing downstream ever looks a node up
    by its SQL id."""
    required_assurance: str | None = None
    tool_binding_id: str | None = None
    handover_reason: str | None = None
    """`"ToolFailure"` | `"LowConfidence"` — a `Handover`-type node's own
    configured trigger reason (`FlowNodes.handoverReason`), one of the two
    reasons a flow node can itself produce (`"UserRequest"` is the third
    `EscalationTickets.reason` value, and it only ever comes from the citizen,
    never from a flow node — `FlowNode`'s own doc comment)."""


@dataclass(frozen=True, slots=True)
class FlowEdgeDef:
    """`from_node_key`/`to_node_key` — this module and `FlowState` both address
    nodes by their stable `key` (`UQ_FlowNodes_flowVersionId_key`), never by
    the SQL `id`; the adapter resolves `FlowEdge.fromNodeId`/`toNodeId` (real
    ids) into keys once, at read time, so nothing downstream needs the id at
    all."""

    from_node_key: str
    to_node_key: str
    ordinal: int
    condition_expression: str | None
    is_default_branch: bool


@dataclass(frozen=True, slots=True)
class FlowDefinition:
    flow_version_id: str
    entry_node_id: str
    escape_node_id: str | None
    free_text_escape_enabled: bool
    nodes: dict[str, FlowNodeDef]
    edges_from: dict[str, tuple[FlowEdgeDef, ...]]


@dataclass(slots=True)
class FlowState:
    """The live, per-conversation position — the Redis-backed twin of
    `data-model.md` §8 keys #1/#2 (`conv:{id}` hash's `currentNodeKey`,
    `conv:{id}:slots` hash)."""

    flow_version_id: str
    current_node_key: str
    slots: dict[str, str] = field(default_factory=dict)
    retry_counts: dict[str, int] = field(default_factory=dict)
    escape_context_json: str | None = None


class FlowStepOutcome(StrEnum):
    """What `advance()` decided happened this step — the caller (`ProcessTurn`)
    turns this into trace steps and, for `ESCAPED`, a re-routing decision."""

    ADVANCED = "advanced"
    AWAITING_INPUT = "awaiting_input"
    RETRYING = "retrying"
    FELL_THROUGH = "fell_through"
    ESCAPED = "escaped"
    COMPLETED = "completed"


@dataclass(frozen=True, slots=True)
class FlowStepResult:
    outcome: FlowStepOutcome
    next_node_key: str | None
    state: FlowState


_ESCAPE_PHRASES = (
    "another inquiry",
    "something else",
    "never mind",
    "nevermind",
    "cancel",
    "start over",
    "talk to someone",
    "speak to a human",
    "different question",
)


def is_free_text_escape(text: str) -> bool:
    """FR-FLOW-07's own worked example ("i have another inquiry") is the
    literal first entry here. A flow node that expects a slot value accepts
    any other free text as an attempted answer (this engine has no per-node
    input schema to validate against — a real NLU/slot-filling classifier is
    future work, flagged); it is *only* one of these fixed phrases that is
    unconditionally treated as "the user wants out", at every node, matching
    R3's "available at every node" requirement rather than only at nodes with
    a recognisable input shape to fail against."""
    lowered = text.strip().lower()
    return any(phrase in lowered for phrase in _ESCAPE_PHRASES)


def resolve_default_or_matching_edge(
    definition: FlowDefinition, node_key: str, condition_context: dict[str, str]
) -> FlowEdgeDef | None:
    """
    Evaluate a node's outgoing edges in `ordinal` order: the first whose
    `condition_expression` is satisfied wins; if none match, the edge marked
    `is_default_branch` (there is at most one, `UQ_FlowEdges_defaultBranch`)
    fires. `condition_expression` here is deliberately evaluated as a simple
    `key=value` equality against `condition_context` (the flow's own slot
    values plus any tool-result fields the node exposed) rather than as an
    arbitrary expression language — matching the seeded demo flow's own
    conditions and keeping this function free of an embedded expression
    evaluator, which is a real, flagged scope cut for a future richer condition
    grammar.
    """
    edges = definition.edges_from.get(node_key, ())
    default: FlowEdgeDef | None = None
    for edge in sorted(edges, key=lambda e: e.ordinal):
        if edge.is_default_branch:
            default = edge
            continue
        if edge.condition_expression is None:
            continue
        if _condition_matches(edge.condition_expression, condition_context):
            return edge
    return default


def _condition_matches(expression: str, context: dict[str, str]) -> bool:
    if "=" not in expression:
        return False
    key, _, expected = expression.partition("=")
    return context.get(key.strip()) == expected.strip()


def apply_free_text_escape(state: FlowState, escape_context: str) -> FlowState:
    """
    FR-FLOW-09: preserve `current_node_key`/`slots` untouched, record the
    citizen's own free-text turn as `escape_context_json` (context "preserved",
    not summarised or discarded) so `resume_flow` can return to exactly this
    point later. This function only produces the *state*; the caller decides
    what "escaped" means for routing (re-opening the router, per FR-ORCH-13).
    """
    return FlowState(
        flow_version_id=state.flow_version_id,
        current_node_key=state.current_node_key,
        slots=dict(state.slots),
        retry_counts=dict(state.retry_counts),
        escape_context_json=escape_context,
    )


def resume_flow(state: FlowState) -> FlowState:
    """FR-FLOW-09's other half: resuming clears the escape marker but leaves the
    node position and every filled slot exactly as they were."""
    return FlowState(
        flow_version_id=state.flow_version_id,
        current_node_key=state.current_node_key,
        slots=dict(state.slots),
        retry_counts=dict(state.retry_counts),
        escape_context_json=None,
    )


def record_tool_retry(state: FlowState, node_key: str) -> tuple[FlowState, int]:
    """Increments and returns the node's own attempt count. `execute_flow_node`
    reads the returned count against the node's `retry_count` ceiling to decide
    retry vs. fall-through (FR-FLOW-05: exactly two attempts, never three)."""
    counts = dict(state.retry_counts)
    counts[node_key] = counts.get(node_key, 0) + 1
    new_state = FlowState(
        flow_version_id=state.flow_version_id,
        current_node_key=state.current_node_key,
        slots=dict(state.slots),
        retry_counts=counts,
        escape_context_json=state.escape_context_json,
    )
    return new_state, counts[node_key]


def should_retry(node: FlowNodeDef, attempt_count: int) -> bool:
    """FR-FLOW-05: retry once on timeout, then fall through. `attempt_count` is
    1-indexed (the count *after* the failing attempt just recorded), so a
    `retry_count` of 1 (this node's own configured ceiling) permits exactly one
    retry: attempt 1 fails -> retry; attempt 2 fails -> fall through."""
    if node.retry_count is None:
        return False
    return attempt_count <= node.retry_count


def fill_slot(state: FlowState, slot_name: str, value_masked: str) -> FlowState:
    slots = dict(state.slots)
    slots[slot_name] = value_masked
    return FlowState(
        flow_version_id=state.flow_version_id,
        current_node_key=state.current_node_key,
        slots=slots,
        retry_counts=dict(state.retry_counts),
        escape_context_json=state.escape_context_json,
    )


def move_to(state: FlowState, node_key: str) -> FlowState:
    return FlowState(
        flow_version_id=state.flow_version_id,
        current_node_key=node_key,
        slots=dict(state.slots),
        retry_counts=dict(state.retry_counts),
        escape_context_json=state.escape_context_json,
    )
