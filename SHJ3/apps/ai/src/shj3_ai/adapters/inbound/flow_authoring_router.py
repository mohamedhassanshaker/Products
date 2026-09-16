"""The Flow Designer "AI sidebar" feature — `POST /v1/flows/edit-proposals`. Mirrors
`tools_router.py`'s conventions exactly: behind `TenantContextDep`, ports constructed fresh
per request from the environment, stateless — computes and returns a proposed plan, writes
nothing.

`shj3-ai` has no write access to `FlowNodes`/`FlowEdges` (`docs/data-model.md` §5's grant
enumeration lists no flow tables among the six AI-writable groups) and no authoring-shaped
read of them either (`SqlAlchemyFlowReader`'s own DTOs are execution-shaped, missing
`title`/`messageText`/etc.) — so the caller (`apps/web`'s `proposeFlowEditAction`) sends the
current flow's real node/edge snapshot in the request body, which it already holds in memory
from the Flow Designer screen's own loaded state. `tenantId`/`principalId` are read from
`TenantContextDep` purely for auth/tracing; this endpoint's own work needs neither.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from shj3_ai.adapters.inbound.tenant_auth import TenantContextDep
from shj3_ai.adapters.outbound.chat.deterministic_chat_model import chat_model_from_environment
from shj3_ai.application.fallback_chat import InvokeWithFallback
from shj3_ai.application.propose_flow_edit import (
    ConversationTurn,
    FlowEdgeSnapshot,
    FlowNodeSnapshot,
    ProposeFlowEdit,
    ProposeFlowEditInput,
)
from shj3_ai.domain.flow_edit_plan import FlowEditOperation

router = APIRouter(prefix="/v1/flows", tags=["flows"])


def _propose_flow_edit() -> ProposeFlowEdit:
    return ProposeFlowEdit(InvokeWithFallback(chat_model_from_environment()))


ProposeFlowEditDep = Annotated[ProposeFlowEdit, Depends(_propose_flow_edit)]


# ---------------------------------------------------------------------------
# Wire models — camelCase both ways, matching `tools_router.py`'s convention.
# ---------------------------------------------------------------------------


class FlowNodeSnapshotIn(BaseModel):
    id: str
    type: str
    title: str
    message_text: str | None = Field(alias="messageText", default=None)
    slot_name: str | None = Field(alias="slotName", default=None)
    option_source_kind: str | None = Field(alias="optionSourceKind", default=None)
    tool_binding_id: str | None = Field(alias="toolBindingId", default=None)
    handover_reason: str | None = Field(alias="handoverReason", default=None)
    condition_expression: str | None = Field(alias="conditionExpression", default=None)


class FlowEdgeSnapshotIn(BaseModel):
    id: str
    from_node_id: str = Field(alias="fromNodeId")
    to_node_id: str = Field(alias="toNodeId")
    label: str | None = None
    is_default_branch: bool = Field(alias="isDefaultBranch")


class ConversationTurnIn(BaseModel):
    role: str
    text: str


class ProposeFlowEditRequestIn(BaseModel):
    instruction: str
    conversation_history: list[ConversationTurnIn] = Field(
        alias="conversationHistory", default_factory=list
    )
    nodes: list[FlowNodeSnapshotIn]
    edges: list[FlowEdgeSnapshotIn]
    # The tenant's `FlowAssistantConfig` (`apps/web`'s AI settings screen), resolved by the
    # caller and sent per request — overrides `SHJ3_FLOW_EDIT_MODEL`/`_FALLBACK_MODEL_ENV_VAR`
    # when present (`propose_flow_edit.py`'s own resolution order). Optional so an older
    # caller still gets today's env-var/default behavior unchanged.
    model: str | None = None
    fallback_model: str | None = Field(alias="fallbackModel", default=None)


class FlowEditOperationOut(BaseModel):
    """One flattened wire shape for all 8 operation kinds — a discriminated union in
    TypeScript on the receiving end (`apps/web`'s `ProposedOperation`), but the simplest
    real shape to emit from Python without a matching Pydantic union per kind: every field
    below is optional, and only the ones a given `kind` actually uses are ever non-null."""

    kind: str
    summary: str
    placeholder_id: str | None = Field(serialization_alias="placeholderId", default=None)
    node_id: str | None = Field(serialization_alias="nodeId", default=None)
    edge_id: str | None = Field(serialization_alias="edgeId", default=None)
    from_node_id: str | None = Field(serialization_alias="fromNodeId", default=None)
    to_node_id: str | None = Field(serialization_alias="toNodeId", default=None)
    node_type: str | None = Field(serialization_alias="nodeType", default=None)
    title: str | None = None
    message_text: str | None = Field(serialization_alias="messageText", default=None)
    quick_action_set_key: str | None = Field(serialization_alias="quickActionSetKey", default=None)
    slot_name: str | None = Field(serialization_alias="slotName", default=None)
    option_source_kind: str | None = Field(serialization_alias="optionSourceKind", default=None)
    option_source_ref: str | None = Field(serialization_alias="optionSourceRef", default=None)
    static_options_json: str | None = Field(serialization_alias="staticOptionsJson", default=None)
    tool_binding_id: str | None = Field(serialization_alias="toolBindingId", default=None)
    retry_count: int | None = Field(serialization_alias="retryCount", default=None)
    retry_on_timeout: bool | None = Field(serialization_alias="retryOnTimeout", default=None)
    timeout_ms: int | None = Field(serialization_alias="timeoutMs", default=None)
    on_failure_node_id: str | None = Field(serialization_alias="onFailureNodeId", default=None)
    handover_reason: str | None = Field(serialization_alias="handoverReason", default=None)
    condition_expression: str | None = Field(serialization_alias="conditionExpression", default=None)
    required_assurance: str | None = Field(serialization_alias="requiredAssurance", default=None)
    label: str | None = None
    is_default_branch: bool | None = Field(serialization_alias="isDefaultBranch", default=None)


class ProposeFlowEditResponseOut(BaseModel):
    plan_summary: str = Field(serialization_alias="planSummary")
    operations: list[FlowEditOperationOut]
    warnings: list[str]
    used_fallback_model: bool = Field(serialization_alias="usedFallbackModel")


def _operation_out(op: FlowEditOperation) -> FlowEditOperationOut:
    # A plain attribute-presence walk, not `match`-per-dataclass-type, since every operation
    # dataclass already carries exactly the fields it needs and nothing else — `getattr`
    # with a default reaches every real field name whether or not this particular kind's
    # dataclass declares it.
    fields = getattr(op, "fields", None)
    return FlowEditOperationOut(
        kind=str(op.kind.value if hasattr(op.kind, "value") else op.kind),
        summary=getattr(op, "summary", ""),
        placeholder_id=getattr(op, "placeholder_id", None),
        node_id=getattr(op, "node_id", None),
        edge_id=getattr(op, "edge_id", None),
        from_node_id=getattr(op, "from_node_id", None),
        to_node_id=getattr(op, "to_node_id", None),
        node_type=getattr(op, "node_type", None),
        title=fields.title if fields is not None else None,
        message_text=fields.message_text if fields is not None else None,
        quick_action_set_key=fields.quick_action_set_key if fields is not None else None,
        slot_name=fields.slot_name if fields is not None else None,
        option_source_kind=fields.option_source_kind if fields is not None else None,
        option_source_ref=fields.option_source_ref if fields is not None else None,
        static_options_json=fields.static_options_json if fields is not None else None,
        tool_binding_id=fields.tool_binding_id if fields is not None else None,
        retry_count=fields.retry_count if fields is not None else None,
        retry_on_timeout=fields.retry_on_timeout if fields is not None else None,
        timeout_ms=fields.timeout_ms if fields is not None else None,
        on_failure_node_id=fields.on_failure_node_id if fields is not None else None,
        handover_reason=fields.handover_reason if fields is not None else getattr(op, "handover_reason", None),
        condition_expression=(
            fields.condition_expression if fields is not None else getattr(op, "condition_expression", None)
        ),
        required_assurance=fields.required_assurance if fields is not None else None,
        label=getattr(op, "label", None),
        is_default_branch=getattr(op, "is_default_branch", None),
    )


@router.post("/edit-proposals", response_model=ProposeFlowEditResponseOut)
async def propose_flow_edit(
    body: ProposeFlowEditRequestIn,
    use_case: ProposeFlowEditDep,
    context: TenantContextDep,
) -> ProposeFlowEditResponseOut:
    del context  # auth/tracing only — this route's own work needs neither field.
    result = await use_case.execute(
        ProposeFlowEditInput(
            instruction=body.instruction,
            conversation_history=tuple(
                ConversationTurn(role=t.role, text=t.text) for t in body.conversation_history
            ),
            nodes=tuple(
                FlowNodeSnapshot(
                    id=n.id,
                    type=n.type,
                    title=n.title,
                    message_text=n.message_text,
                    slot_name=n.slot_name,
                    option_source_kind=n.option_source_kind,
                    tool_binding_id=n.tool_binding_id,
                    handover_reason=n.handover_reason,
                    condition_expression=n.condition_expression,
                )
                for n in body.nodes
            ),
            edges=tuple(
                FlowEdgeSnapshot(
                    id=e.id,
                    from_node_id=e.from_node_id,
                    to_node_id=e.to_node_id,
                    label=e.label,
                    is_default_branch=e.is_default_branch,
                )
                for e in body.edges
            ),
            model=body.model,
            fallback_model=body.fallback_model,
        )
    )

    return ProposeFlowEditResponseOut(
        plan_summary=result.plan.plan_summary,
        operations=[_operation_out(op) for op in result.plan.operations],
        warnings=list(result.plan.warnings),
        used_fallback_model=result.used_fallback,
    )
