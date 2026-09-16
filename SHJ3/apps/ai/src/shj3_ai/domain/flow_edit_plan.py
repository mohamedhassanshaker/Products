"""
Pure domain logic for the AI flow-editing assistant's proposed plan (the Flow Designer "AI
sidebar" feature). An LLM never mutates a flow directly — it proposes a structured plan of
operations here, which a human reviews before any of it is applied (`apps/web`'s
`applyFlowEditPlanAction`, which owns actually writing to the real flow, through the exact
same real Server Actions a human's own manual edit already goes through).

This module owns two things: the operation shapes themselves (mirroring `modules/flows/
domain/flow-node.ts`'s `FlowNodeFields` / `flow-edge.ts`'s `FlowEdgeFields` on the TypeScript
side, minus purely positional/derived fields neither the model has any way to reason about —
`canvasX`/`canvasY`, an edge's `ordinal` — the web side fills both in when applying), and
`parse_flow_edit_plan()`, which turns the model's raw JSON text into a validated list of
these operations, dropping (with a warning, never a crash) anything malformed or referencing
an unknown node/edge id.

## Why this parser is a best-effort pre-filter, not the authoritative gate

The authoritative validation for every one of these fields already exists, on the TypeScript
side, in the exact same real Server Actions a human's own edit already goes through
(`createFlowNodeAction`/`updateFlowNodeAction`/... in `agents/actions.ts`). This parser's job
is narrower: catch gross malformation early (bad JSON, an unrecognised operation kind, a
dangling id reference) so the human review step sees a clean, sensible plan — not to
re-implement `validateFlowNodeFields()`'s full per-type completeness rule set a second time.

## `localRef` — how a newly-proposed node is referenced before it has a real id

The model has no way to invent a real database id, and nothing here trusts it to try: a
`CreateNode` operation carries a `local_ref` string the MODEL chose (any short label, e.g.
`"greeting_followup"`) purely to let other operations IN THE SAME PLAN point at it (an edge
from an existing node to this new one, say). This parser — never the model — assigns the
real placeholder id (`"new-1"`, `"new-2"`, ...) each `CreateNode` operation carries onward,
and resolves every other operation's node-id-shaped field through the `local_ref -> new-N`
map before returning, so nothing downstream ever sees a raw, model-chosen string used as an
id.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, replace
from enum import StrEnum
from typing import Any

# Mirrors `FLOW_NODE_TYPES` (`modules/flows/domain/flow-node.ts`) exactly.
_NODE_TYPES = frozenset({"Message", "Question", "ToolCall", "Handover", "Condition"})
_OPTION_SOURCE_KINDS = frozenset({"Static", "GraphEntityLabel", "ToolResult"})
_HANDOVER_REASONS = frozenset({"ToolFailure", "LowConfidence"})
_REQUIRED_ASSURANCE_LEVELS = frozenset(
    {"Anonymous", "Verified", "VerifiedPlusOtp", "VerifiedPlusDocument"}
)


class OperationKind(StrEnum):
    CREATE_NODE = "CreateNode"
    UPDATE_NODE = "UpdateNode"
    DELETE_NODE = "DeleteNode"
    CREATE_EDGE = "CreateEdge"
    UPDATE_EDGE = "UpdateEdge"
    DELETE_EDGE = "DeleteEdge"
    SET_ENTRY_NODE = "SetEntryNode"
    SET_ESCAPE_NODE = "SetEscapeNode"


@dataclass(frozen=True, slots=True)
class NodeFieldsPatch:
    """The same per-type `FlowNodeFields` shape a `CreateNode`/`UpdateNode` operation
    carries — every field optional here (a `CreateNode` still requires its type's own real
    fields per `_validate_node_type_completeness`; an `UpdateNode` is a genuine partial
    patch, exactly like the real `UpdateFlowNodeInput` it will become on the web side)."""

    title: str | None = None
    message_text: str | None = None
    quick_action_set_key: str | None = None
    slot_name: str | None = None
    option_source_kind: str | None = None
    option_source_ref: str | None = None
    static_options_json: str | None = None
    tool_binding_id: str | None = None
    retry_count: int | None = None
    retry_on_timeout: bool | None = None
    timeout_ms: int | None = None
    on_failure_node_id: str | None = None
    handover_reason: str | None = None
    condition_expression: str | None = None
    required_assurance: str | None = None


@dataclass(frozen=True, slots=True)
class CreateNodeOperation:
    kind: OperationKind
    placeholder_id: str
    node_type: str
    summary: str
    fields: NodeFieldsPatch


@dataclass(frozen=True, slots=True)
class UpdateNodeOperation:
    kind: OperationKind
    node_id: str
    summary: str
    fields: NodeFieldsPatch


@dataclass(frozen=True, slots=True)
class DeleteNodeOperation:
    kind: OperationKind
    node_id: str
    summary: str


@dataclass(frozen=True, slots=True)
class CreateEdgeOperation:
    kind: OperationKind
    from_node_id: str
    to_node_id: str
    summary: str
    label: str | None = None
    condition_expression: str | None = None
    is_default_branch: bool = False


@dataclass(frozen=True, slots=True)
class UpdateEdgeOperation:
    kind: OperationKind
    edge_id: str
    summary: str
    label: str | None = None
    condition_expression: str | None = None
    is_default_branch: bool | None = None


@dataclass(frozen=True, slots=True)
class DeleteEdgeOperation:
    kind: OperationKind
    edge_id: str
    summary: str


@dataclass(frozen=True, slots=True)
class SetEntryNodeOperation:
    kind: OperationKind
    node_id: str
    summary: str


@dataclass(frozen=True, slots=True)
class SetEscapeNodeOperation:
    kind: OperationKind
    node_id: str
    summary: str


FlowEditOperation = (
    CreateNodeOperation
    | UpdateNodeOperation
    | DeleteNodeOperation
    | CreateEdgeOperation
    | UpdateEdgeOperation
    | DeleteEdgeOperation
    | SetEntryNodeOperation
    | SetEscapeNodeOperation
)


@dataclass(frozen=True, slots=True)
class FlowEditPlan:
    plan_summary: str
    operations: tuple[FlowEditOperation, ...]
    warnings: tuple[str, ...]


def _node_fields_patch(raw: dict[str, Any]) -> NodeFieldsPatch:
    return NodeFieldsPatch(
        title=_str_or_none(raw.get("title")),
        message_text=_str_or_none(raw.get("messageText")),
        quick_action_set_key=_str_or_none(raw.get("quickActionSetKey")),
        slot_name=_str_or_none(raw.get("slotName")),
        option_source_kind=_enum_or_none(raw.get("optionSourceKind"), _OPTION_SOURCE_KINDS),
        option_source_ref=_str_or_none(raw.get("optionSourceRef")),
        static_options_json=_str_or_none(raw.get("staticOptionsJson")),
        tool_binding_id=_str_or_none(raw.get("toolBindingId")),
        retry_count=_int_or_none(raw.get("retryCount")),
        retry_on_timeout=raw.get("retryOnTimeout") if isinstance(raw.get("retryOnTimeout"), bool) else None,
        timeout_ms=_int_or_none(raw.get("timeoutMs")),
        on_failure_node_id=_str_or_none(raw.get("onFailureNodeId")),
        handover_reason=_enum_or_none(raw.get("handoverReason"), _HANDOVER_REASONS),
        condition_expression=_str_or_none(raw.get("conditionExpression")),
        required_assurance=_enum_or_none(raw.get("requiredAssurance"), _REQUIRED_ASSURANCE_LEVELS),
    )


def _str_or_none(value: Any) -> str | None:
    return value if isinstance(value, str) and value.strip() != "" else None


def _int_or_none(value: Any) -> int | None:
    return value if isinstance(value, int) and not isinstance(value, bool) else None


def _enum_or_none(value: Any, allowed: frozenset[str]) -> str | None:
    return value if isinstance(value, str) and value in allowed else None


def _node_type_is_complete(node_type: str, fields: NodeFieldsPatch) -> bool:
    """Mirrors `validateFlowNodeFields()`'s per-type completeness rules (`modules/flows/
    domain/flow-node.ts`) — the minimum a `CreateNode` must carry to be worth proposing at
    all. Deliberately not the full rule set (e.g. retry_count's 0-3 range) — see this
    module's own doc comment on why this parser is a pre-filter, not the authoritative
    gate."""
    if node_type == "Message":
        return fields.message_text is not None
    if node_type == "Question":
        return fields.slot_name is not None and fields.option_source_kind is not None
    if node_type == "ToolCall":
        return (
            fields.tool_binding_id is not None
            and fields.retry_count is not None
            and fields.on_failure_node_id is not None
        )
    if node_type == "Handover":
        return fields.handover_reason is not None
    if node_type == "Condition":
        return fields.condition_expression is not None
    return False


class _RefResolver:
    """Assigns real placeholder ids (`"new-1"`, `"new-2"`, ...) to each `CreateNode`
    operation's model-chosen `local_ref`, and resolves every other operation's node-id-shaped
    field through that map — see this module's own doc comment ("`localRef`") for the full
    reasoning. A reference that resolves to neither a known `local_ref` nor a real existing
    node id is reported to the caller as `None`, never guessed at."""

    def __init__(self, existing_node_ids: frozenset[str]) -> None:
        self._existing_node_ids = existing_node_ids
        self._local_ref_to_placeholder: dict[str, str] = {}
        self._next_placeholder = 1

    def assign_placeholder(self, local_ref: str) -> str:
        placeholder_id = f"new-{self._next_placeholder}"
        self._next_placeholder += 1
        self._local_ref_to_placeholder[local_ref] = placeholder_id
        return placeholder_id

    def resolve(self, node_id: str | None) -> str | None:
        if node_id is None:
            return None
        if node_id in self._existing_node_ids:
            return node_id
        return self._local_ref_to_placeholder.get(node_id)


def parse_flow_edit_plan(
    raw_text: str,
    existing_node_ids: frozenset[str],
    existing_edge_ids: frozenset[str],
) -> FlowEditPlan:
    warnings: list[str] = []

    try:
        raw = json.loads(raw_text)
    except (json.JSONDecodeError, TypeError):
        return FlowEditPlan(
            plan_summary="",
            operations=(),
            warnings=("The model's response was not valid JSON — no operations proposed.",),
        )
    if not isinstance(raw, dict):
        return FlowEditPlan(
            plan_summary="",
            operations=(),
            warnings=("The model's response was not a JSON object — no operations proposed.",),
        )

    plan_summary = raw.get("planSummary")
    plan_summary = plan_summary if isinstance(plan_summary, str) else ""
    raw_operations = raw.get("operations")
    raw_operations = raw_operations if isinstance(raw_operations, list) else []

    resolver = _RefResolver(existing_node_ids)
    # Pass 1: register every CreateNode's local_ref BEFORE resolving any reference — an edge
    # earlier in the array may legitimately point at a node created later in the same array
    # (the model has no obligation to order its own operations topologically).
    local_refs: dict[int, str] = {}
    for index, raw_op in enumerate(raw_operations):
        if not isinstance(raw_op, dict) or raw_op.get("kind") != "CreateNode":
            continue
        local_ref = raw_op.get("localRef")
        if not isinstance(local_ref, str) or local_ref.strip() == "":
            continue
        local_refs[index] = resolver.assign_placeholder(local_ref)

    operations: list[FlowEditOperation] = []
    for index, raw_op in enumerate(raw_operations):
        if not isinstance(raw_op, dict):
            warnings.append(f"Operation {index + 1} was not a JSON object — dropped.")
            continue
        kind = raw_op.get("kind")
        summary = raw_op.get("summary")
        summary = summary if isinstance(summary, str) and summary.strip() != "" else ""

        if kind == "CreateNode":
            node_type = raw_op.get("nodeType")
            placeholder_id = local_refs.get(index)
            if placeholder_id is None:
                warnings.append(
                    f"Operation {index + 1} (CreateNode) had no usable localRef — dropped."
                )
                continue
            if not isinstance(node_type, str) or node_type not in _NODE_TYPES:
                warnings.append(
                    f"Operation {index + 1} (CreateNode) named an unrecognised node type — dropped."
                )
                continue
            fields = _node_fields_patch(raw_op)
            if not _node_type_is_complete(node_type, fields):
                warnings.append(
                    f"Operation {index + 1} (CreateNode, {node_type}) was missing required "
                    "fields for that node type — dropped."
                )
                continue
            resolved_on_failure = (
                resolver.resolve(fields.on_failure_node_id)
                if fields.on_failure_node_id is not None
                else None
            )
            if fields.on_failure_node_id is not None and resolved_on_failure is None:
                warnings.append(
                    f"Operation {index + 1} (CreateNode) referenced an unknown on-failure "
                    "node — dropped."
                )
                continue
            operations.append(
                CreateNodeOperation(
                    kind=OperationKind.CREATE_NODE,
                    placeholder_id=placeholder_id,
                    node_type=node_type,
                    summary=summary,
                    fields=replace(fields, on_failure_node_id=resolved_on_failure),
                )
            )
        elif kind == "UpdateNode":
            node_id = raw_op.get("nodeId")
            if not isinstance(node_id, str) or node_id not in existing_node_ids:
                warnings.append(
                    f"Operation {index + 1} (UpdateNode) referenced an unknown node — dropped."
                )
                continue
            operations.append(
                UpdateNodeOperation(
                    kind=OperationKind.UPDATE_NODE,
                    node_id=node_id,
                    summary=summary,
                    fields=_node_fields_patch(raw_op),
                )
            )
        elif kind == "DeleteNode":
            node_id = raw_op.get("nodeId")
            if not isinstance(node_id, str) or node_id not in existing_node_ids:
                warnings.append(
                    f"Operation {index + 1} (DeleteNode) referenced an unknown node — dropped."
                )
                continue
            operations.append(
                DeleteNodeOperation(kind=OperationKind.DELETE_NODE, node_id=node_id, summary=summary)
            )
        elif kind == "CreateEdge":
            from_node_id = resolver.resolve(raw_op.get("fromNodeId"))
            to_node_id = resolver.resolve(raw_op.get("toNodeId"))
            if from_node_id is None or to_node_id is None:
                warnings.append(
                    f"Operation {index + 1} (CreateEdge) referenced an unknown node — dropped."
                )
                continue
            operations.append(
                CreateEdgeOperation(
                    kind=OperationKind.CREATE_EDGE,
                    from_node_id=from_node_id,
                    to_node_id=to_node_id,
                    summary=summary,
                    label=_str_or_none(raw_op.get("label")),
                    condition_expression=_str_or_none(raw_op.get("conditionExpression")),
                    is_default_branch=raw_op.get("isDefaultBranch") is True,
                )
            )
        elif kind == "UpdateEdge":
            edge_id = raw_op.get("edgeId")
            if not isinstance(edge_id, str) or edge_id not in existing_edge_ids:
                warnings.append(
                    f"Operation {index + 1} (UpdateEdge) referenced an unknown edge — dropped."
                )
                continue
            is_default_branch = raw_op.get("isDefaultBranch")
            operations.append(
                UpdateEdgeOperation(
                    kind=OperationKind.UPDATE_EDGE,
                    edge_id=edge_id,
                    summary=summary,
                    label=_str_or_none(raw_op.get("label")),
                    condition_expression=_str_or_none(raw_op.get("conditionExpression")),
                    is_default_branch=is_default_branch if isinstance(is_default_branch, bool) else None,
                )
            )
        elif kind == "DeleteEdge":
            edge_id = raw_op.get("edgeId")
            if not isinstance(edge_id, str) or edge_id not in existing_edge_ids:
                warnings.append(
                    f"Operation {index + 1} (DeleteEdge) referenced an unknown edge — dropped."
                )
                continue
            operations.append(
                DeleteEdgeOperation(kind=OperationKind.DELETE_EDGE, edge_id=edge_id, summary=summary)
            )
        elif kind in ("SetEntryNode", "SetEscapeNode"):
            node_id = resolver.resolve(raw_op.get("nodeId"))
            if node_id is None:
                warnings.append(f"Operation {index + 1} ({kind}) referenced an unknown node — dropped.")
                continue
            op_kind = OperationKind.SET_ENTRY_NODE if kind == "SetEntryNode" else OperationKind.SET_ESCAPE_NODE
            op_cls = SetEntryNodeOperation if kind == "SetEntryNode" else SetEscapeNodeOperation
            operations.append(op_cls(kind=op_kind, node_id=node_id, summary=summary))
        else:
            warnings.append(f"Operation {index + 1} named an unrecognised kind ({kind!r}) — dropped.")

    return FlowEditPlan(
        plan_summary=plan_summary, operations=tuple(operations), warnings=tuple(warnings)
    )
