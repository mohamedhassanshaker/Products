"""`ProposeFlowEdit` — the Flow Designer "AI sidebar" feature's one LLM call.

Takes a staff user's business-language instruction plus the current flow's real snapshot
(sent by `apps/web`, which already holds it — `shj3-ai` has no write access to `FlowNodes`/
`FlowEdges` and no authoring-shaped read of them either, see `docs/data-model.md` §5's grant
enumeration) and returns a structured `FlowEditPlan` (`domain/flow_edit_plan.py`) for a human
to review. **This use case never executes anything itself** — computing and returning a plan
is its entire job, the same "compute and return, never persist" shape `ConnectAndDiscoverMcp`/
`tools_router.py` already establish for a stateless `shj3-ai` endpoint.

One `complete()` call, no ReAct loop: nothing in this codebase feeds a tool result back to
the model for further reasoning within one call (confirmed directly against
`litellm_chat_model.py` before this file was written — it only ever captures a response's
FIRST tool call), and none is needed here since nothing executes until a human approves —
this is a structured-output problem, not a tool-calling one.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass

from shj3_ai.application.fallback_chat import InvokeWithFallback
from shj3_ai.domain.flow_edit_plan import FlowEditPlan, parse_flow_edit_plan
from shj3_ai.ports.chat_model import ChatMessage, ChatRequest

# Mirrors `AgentVersion.primaryModel`/`fallbackModel`'s own opaque-string convention
# (`litellm_chat_model.py`'s module doc comment) — every tenant shares one model for this
# assistant today; no per-tenant/per-agent override exists yet (a real, deliberate wave-1
# scope cut, not an oversight — no `AgentVersion` naturally owns "the flow assistant's
# model," since this is a backoffice authoring tool, not a citizen-facing agent).
_MODEL_ENV_VAR = "SHJ3_FLOW_EDIT_MODEL"
_FALLBACK_MODEL_ENV_VAR = "SHJ3_FLOW_EDIT_FALLBACK_MODEL"
_DEFAULT_MODEL = "anthropic/claude-sonnet-5"

_TEMPERATURE = 0.2
"""Low, not zero — structured-output reliability benefits from low temperature, but the
model still has genuine judgment calls to make (how to phrase a node's message text, which
node type best fits a vague instruction)."""
_MAX_OUTPUT_TOKENS = 6000
"""Raised from 1500 (itself lowered from an original 4000 to fit a tight OpenRouter credit
balance — see git history) once this assistant was taught to derive a whole flow (a menu,
several topic nodes, an escalation node, all wired with edges) from a pasted business
document, not just small incremental edits. That whole-flow-derivation case is a
meaningfully larger JSON payload than 4000 was ever sized for, let alone 1500. This is a
deliberate, informed choice, accepted with the real risk of a 402 "insufficient credits"
error if the account's balance is low at call time — not a value to silently lower again
without recording why, the way the original 4000 -> 1500 drop was."""


@dataclass(frozen=True, slots=True)
class FlowNodeSnapshot:
    """The subset of a real `FlowNodeRow` (`modules/flows/ports/flow-repository.ts`, web
    side) the model needs to reason about the current flow — sent by `apps/web`, which
    already holds it in memory. Field names mirror the TypeScript row exactly (camelCase
    preserved through the wire model, `flow_authoring_router.py`), so the same JSON shape a
    `CreateNode`/`UpdateNode` operation targets is what the model already sees describing
    the flow's EXISTING nodes — one shape, not two."""

    id: str
    type: str
    title: str
    message_text: str | None
    slot_name: str | None
    option_source_kind: str | None
    tool_binding_id: str | None
    handover_reason: str | None
    condition_expression: str | None


@dataclass(frozen=True, slots=True)
class FlowEdgeSnapshot:
    id: str
    from_node_id: str
    to_node_id: str
    label: str | None
    is_default_branch: bool


@dataclass(frozen=True, slots=True)
class ConversationTurn:
    role: str  # "user" | "assistant"
    text: str


@dataclass(frozen=True, slots=True)
class ProposeFlowEditInput:
    instruction: str
    conversation_history: tuple[ConversationTurn, ...]
    nodes: tuple[FlowNodeSnapshot, ...]
    edges: tuple[FlowEdgeSnapshot, ...]
    # Caller-supplied override from the tenant's `FlowAssistantConfig` (`apps/web`'s AI
    # settings screen) — preferred over the env vars below when present. Optional so an
    # older caller (or a tenant that never opened that screen) still gets the exact
    # env-var/default behavior this file always had.
    model: str | None = None
    fallback_model: str | None = None


@dataclass(frozen=True, slots=True)
class ProposeFlowEditResult:
    plan: FlowEditPlan
    used_fallback: bool


_SYSTEM_PROMPT_TEMPLATE = """\
You are a flow-authoring assistant for a government-services conversation-flow designer. \
A staff user describes a change in plain business language; you propose a structured JSON \
plan of edits for a HUMAN to review — you never execute anything yourself, and the human \
may accept or reject any part of your plan.

Respond with ONLY a single JSON object, no prose outside it, matching this shape exactly:

{{
  "planSummary": "one short sentence describing the whole plan",
  "operations": [ ...an array of operation objects, each one of the kinds below... ]
}}

Every operation object has a "kind" field (one of the 8 values below) and a "summary" field \
(a short, human-readable one-line rationale for that specific operation). The remaining \
fields depend on "kind":

- "CreateNode": propose a brand-new node. Fields: "localRef" (a short string YOU choose to \
refer to this new node from other operations in this same plan — it is never a real id), \
"nodeType" (one of "Message", "Question", "ToolCall", "Handover", "Condition"), plus the \
fields that node type requires (see below).
- "UpdateNode": edit an EXISTING node. Fields: "nodeId" (a real id from the current flow \
below), plus any of the same per-type fields you want to change.
- "DeleteNode": Fields: "nodeId" (a real id).
- "CreateEdge": connect two nodes. Fields: "fromNodeId", "toNodeId" (each either a real id \
or a "localRef" you defined earlier in this same plan), optional "label", optional \
"conditionExpression", optional "isDefaultBranch" (true/false).
- "UpdateEdge": Fields: "edgeId" (a real id), plus any fields to change.
- "DeleteEdge": Fields: "edgeId" (a real id).
- "SetEntryNode": Fields: "nodeId" (real id or localRef).
- "SetEscapeNode": Fields: "nodeId" (real id or localRef) — this should usually be a \
"Condition" node, since the flow needs a real way for a citizen to break out into free-text \
conversation.

Per-node-type required fields for "CreateNode" (an "UpdateNode" may set any subset of these):
- "Message": "title", "messageText" (required), optional "quickActionSetKey".
- "Question": "title", "slotName" (required — the variable name this answer is stored \
under), "optionSourceKind" (required, one of "Static", "GraphEntityLabel", "ToolResult"), \
"staticOptionsJson" (a JSON array string, only when optionSourceKind is "Static"), \
"optionSourceRef" (only when optionSourceKind is "GraphEntityLabel" or "ToolResult").
- "ToolCall": "title", "toolBindingId" (required — must be one of the real bound tool ids \
listed below), "retryCount" (required, integer 0-3), "onFailureNodeId" (required — a real \
id or localRef of the node to continue at if this tool call ultimately fails), optional \
"retryOnTimeout" (true/false), optional "timeoutMs".
- "Handover": "title", "handoverReason" (required, one of "ToolFailure", "LowConfidence").
- "Condition": "title", "conditionExpression" (required — a real expression over the \
flow's slots, e.g. "amount > 500").

Every node type may also optionally set "requiredAssurance" (one of "Anonymous", \
"Verified", "VerifiedPlusOtp", "VerifiedPlusDocument").

The current flow's real nodes:
{nodes_json}

The current flow's real edges:
{edges_json}

Real bound tools available for a ToolCall node's "toolBindingId":
{tool_binding_ids_json}

The instruction is not always a short imperative edit command — it may instead be a whole \
business-scenario or reference document: a topic menu, a list of FAQ question/answer pairs, \
an escalation policy, or similar. That is a valid, different kind of request, not something \
to decline. When you see one, derive a compact, sensible flow from it rather than returning \
an empty plan: one "Question" node for a main menu ("optionSourceKind": "Static", one \
option per top-level topic), one "Message" node per key topic or answer, and a "Handover" \
node (or a "Condition" node routing to one) for any escalation path the document describes, \
wired together with "CreateEdge" operations from the menu to each topic and from each topic \
back to the menu or onward to escalation. Keep it compact — a handful of the most important \
topics, not one node per line of the source document — and never invent a tool/policy id or \
a node type's required field just to cover more of the document; every "never invent" rule \
above still applies in full.

If the source document contains more reference/FAQ detail than a flow should reasonably \
hardcode, still propose the compact flow above, and say so in "planSummary" — name what you \
built, and note that the fuller reference detail would be better retrieved from a Knowledge \
source bound to a lookup tool than duplicated as flow nodes.

If the instruction is unclear, ambiguous, or nothing needs to change even under the reading \
above, return a plan with an empty "operations" array and explain why in "planSummary" — do \
not invent changes the instruction did not ask for.
"""


def _build_system_prompt(input: ProposeFlowEditInput) -> str:
    nodes_json = json.dumps(
        [
            {
                "id": n.id,
                "type": n.type,
                "title": n.title,
                "messageText": n.message_text,
                "slotName": n.slot_name,
                "optionSourceKind": n.option_source_kind,
                "toolBindingId": n.tool_binding_id,
                "handoverReason": n.handover_reason,
                "conditionExpression": n.condition_expression,
            }
            for n in input.nodes
        ]
    )
    edges_json = json.dumps(
        [
            {
                "id": e.id,
                "fromNodeId": e.from_node_id,
                "toNodeId": e.to_node_id,
                "label": e.label,
                "isDefaultBranch": e.is_default_branch,
            }
            for e in input.edges
        ]
    )
    tool_binding_ids_json = json.dumps(
        sorted({n.tool_binding_id for n in input.nodes if n.tool_binding_id is not None})
    )
    return _SYSTEM_PROMPT_TEMPLATE.format(
        nodes_json=nodes_json, edges_json=edges_json, tool_binding_ids_json=tool_binding_ids_json
    )


class ProposeFlowEdit:
    __slots__ = ("_invoker",)

    def __init__(self, invoker: InvokeWithFallback) -> None:
        self._invoker = invoker

    async def execute(self, input: ProposeFlowEditInput) -> ProposeFlowEditResult:
        messages = [ChatMessage(role="system", content=_build_system_prompt(input))]
        for turn in input.conversation_history:
            messages.append(ChatMessage(role=turn.role, content=turn.text))
        messages.append(ChatMessage(role="user", content=input.instruction))

        request = ChatRequest(
            model=input.model or os.environ.get(_MODEL_ENV_VAR, _DEFAULT_MODEL),
            messages=messages,
            temperature=_TEMPERATURE,
            max_output_tokens=_MAX_OUTPUT_TOKENS,
            response_format="json_object",
        )
        fallback_model = input.fallback_model or os.environ.get(_FALLBACK_MODEL_ENV_VAR) or None

        outcome = await self._invoker.execute(request, fallback_model=fallback_model)

        existing_node_ids = frozenset(n.id for n in input.nodes)
        existing_edge_ids = frozenset(e.id for e in input.edges)
        plan = parse_flow_edit_plan(outcome.response.text, existing_node_ids, existing_edge_ids)

        return ProposeFlowEditResult(plan=plan, used_fallback=outcome.cost.used_fallback)
