"""`ProposeAgentCreation` — the `/agents` registry's "Create with AI" entry point's one LLM
call. Mirrors `propose_flow_edit.py`'s shape exactly (see that file's own module doc comment
for the full reasoning this one doesn't repeat): a staff user's business-language description
plus the tenant's real, existing catalogs (skills, MCP tools, API connectors, guardrail policy
keys, whether a knowledge collection exists) in, one structured `AgentCreationPlan` out.
**This use case never creates anything itself** — computing and returning a plan for a human
to review is its entire job (`apps/web`'s `applyAgentCreationPlanAction` owns the real writes).

This call's only flow-shaped output is a plain-language `flowInstruction` sentence — see
`agent_creation_plan.py`'s own doc comment for why flow-graph generation is deliberately left
to the existing, separate `ProposeFlowEdit` call rather than duplicated here.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass

from shj3_ai.application.fallback_chat import InvokeWithFallback
from shj3_ai.domain.agent_creation_plan import AgentCreationPlan, parse_agent_creation_plan
from shj3_ai.ports.chat_model import ChatMessage, ChatRequest

# Mirrors `propose_flow_edit.py`'s own env-var convention — a distinct pair of variables
# since a tenant's `FlowAssistantConfig`-supplied override is expected to be the same one used
# for the flow-editing sidebar (see `ProposeAgentCreationInput.model`'s own doc comment), and
# these env vars are only the fallback default when no such override is supplied.
_MODEL_ENV_VAR = "SHJ3_AGENT_CREATION_MODEL"
_FALLBACK_MODEL_ENV_VAR = "SHJ3_AGENT_CREATION_FALLBACK_MODEL"
_DEFAULT_MODEL = "anthropic/claude-sonnet-5"

_TEMPERATURE = 0.2
_MAX_OUTPUT_TOKENS = 4000
"""Raised from 1500 once `flowInstruction` was taught to preserve real structural detail
(a menu, FAQ topics, an escalation policy) from a rich `business_description` rather than
compressing it into one sentence — see this file's `flowInstruction` field description.
Still lower than `propose_flow_edit.py`'s own ceiling (6000): this call never emits a
node/edge graph, only scalar/catalog-grounded fields plus that one, now potentially larger,
string. A deliberate, informed choice, accepted with the real risk of a 402 "insufficient
credits" error if the account's balance is low at call time."""


@dataclass(frozen=True, slots=True)
class SkillCatalogEntry:
    id: str
    name: str
    description: str | None


@dataclass(frozen=True, slots=True)
class McpToolCatalogEntry:
    id: str
    name: str
    server_name: str


@dataclass(frozen=True, slots=True)
class ApiConnectorCatalogEntry:
    id: str
    name: str


@dataclass(frozen=True, slots=True)
class GuardrailPolicyCatalogEntry:
    policy_key: str
    title: str
    detail: str


@dataclass(frozen=True, slots=True)
class ProposeAgentCreationInput:
    business_description: str
    skills: tuple[SkillCatalogEntry, ...]
    mcp_tools: tuple[McpToolCatalogEntry, ...]
    api_connectors: tuple[ApiConnectorCatalogEntry, ...]
    guardrail_policies: tuple[GuardrailPolicyCatalogEntry, ...]
    knowledge_collection_exists: bool
    # Caller-supplied override from the tenant's `FlowAssistantConfig` (the AI settings
    # screen) — preferred over the env vars above when present, same resolution order
    # `propose_flow_edit.py` already established.
    model: str | None = None
    fallback_model: str | None = None


@dataclass(frozen=True, slots=True)
class ProposeAgentCreationResult:
    plan: AgentCreationPlan
    used_fallback: bool


_SYSTEM_PROMPT_TEMPLATE = """\
You are an assistant that helps a staff user create a new government-services conversation \
agent from a plain-language description of the business need. Propose a structured JSON \
plan for a HUMAN to review — you never create anything yourself, and the human may accept, \
edit, or reject any part of your plan.

Respond with ONLY a single JSON object, no prose outside it, matching this shape exactly:

{{
  "planSummary": "one short sentence describing the whole proposal",
  "identity": {{ "name": "short agent name", "description": "one paragraph" }},
  "instructions": {{
    "systemPrompt": "the system prompt this agent should use",
    "tone": "one of Helpful, Formal, Concise"
  }},
  "modelConfig": {{
    "primaryModel": "an opaque model identifier string, e.g. anthropic/claude-sonnet-5",
    "fallbackModel": "an opaque model identifier string, or null",
    "temperature": 0.7
  }},
  "channelKeys": ["zero or more of WebWidget, WhatsApp, KioskIvr"],
  "guardrailOverrides": [
    {{
      "policyKey": "must be one of the real policy keys listed below",
      "mode": "Value or Disabled",
      "valueJson": "a JSON-encoded value string, or null when mode is Disabled",
      "reason": "one short sentence explaining why"
    }}
  ],
  "toolBindings": [
    {{
      "targetKind": "Skill, McpTool, or ApiConnector",
      "targetId": "must be a real id from the matching catalog below",
      "requiredAssurance": "one of Anonymous, Verified, VerifiedPlusOtp, VerifiedPlusDocument"
    }}
  ],
  "enableKnowledge": true,
  "flowInstruction": "a description of the conversation flow this agent should have — \
greeting, what it collects, which tool(s) it calls, when it hands over to a human. This is \
handed, as-is, to a SEPARATE flow-authoring assistant that turns it into a real flow; do \
not describe individual nodes or edges here — describe the conversation in plain language, \
the way you'd explain it to a person. Usually one or two sentences is enough. But if the \
business description itself contains concrete structure — a topic menu, a list of FAQ \
question/answer pairs, an escalation policy, or similar — PRESERVE that structure and \
detail here rather than compressing it into one generic sentence: name the menu topics, \
summarize each answer, and state the escalation condition, since the flow-authoring \
assistant can only build from what you give it."
}}

Only propose a "guardrailOverrides" entry for a policy key in this real catalog (never any \
other key):
{guardrail_policies_json}

Only propose a "toolBindings" entry whose "targetId" is a real id from ONE of these real \
catalogs (never an invented id):
Skills: {skills_json}
MCP tools: {mcp_tools_json}
API connectors: {api_connectors_json}

This tenant {knowledge_clause} a knowledge collection. Propose "enableKnowledge": true \
whenever a collection already exists and the description contains substantial reference/FAQ \
material (not only when it explicitly asks for a knowledge base) — that material belongs in \
Knowledge, retrieved at answer time, rather than only in the flow. When you do, mention it \
in "planSummary": name what the flow itself covers, and note that the fuller reference \
detail should also be added as a Knowledge source.

If the description is unclear or nothing sensible can be proposed for a given field, leave \
that field empty/false/an empty list rather than inventing a value — the human will fill it \
in during review.
"""


def _catalog_entry_json(entry: object) -> dict[str, object]:
    if isinstance(entry, SkillCatalogEntry):
        return {"id": entry.id, "name": entry.name, "description": entry.description}
    if isinstance(entry, McpToolCatalogEntry):
        return {"id": entry.id, "name": entry.name, "serverName": entry.server_name}
    if isinstance(entry, ApiConnectorCatalogEntry):
        return {"id": entry.id, "name": entry.name}
    if isinstance(entry, GuardrailPolicyCatalogEntry):
        return {"policyKey": entry.policy_key, "title": entry.title, "detail": entry.detail}
    raise TypeError(f"Unsupported catalog entry type: {type(entry)!r}")


def _build_system_prompt(input: ProposeAgentCreationInput) -> str:
    return _SYSTEM_PROMPT_TEMPLATE.format(
        guardrail_policies_json=json.dumps([_catalog_entry_json(p) for p in input.guardrail_policies]),
        skills_json=json.dumps([_catalog_entry_json(s) for s in input.skills]),
        mcp_tools_json=json.dumps([_catalog_entry_json(t) for t in input.mcp_tools]),
        api_connectors_json=json.dumps([_catalog_entry_json(c) for c in input.api_connectors]),
        knowledge_clause="already has" if input.knowledge_collection_exists else "does NOT yet have",
    )


class ProposeAgentCreation:
    __slots__ = ("_invoker",)

    def __init__(self, invoker: InvokeWithFallback) -> None:
        self._invoker = invoker

    async def execute(self, input: ProposeAgentCreationInput) -> ProposeAgentCreationResult:
        messages = [
            ChatMessage(role="system", content=_build_system_prompt(input)),
            ChatMessage(role="user", content=input.business_description),
        ]

        request = ChatRequest(
            model=input.model or os.environ.get(_MODEL_ENV_VAR, _DEFAULT_MODEL),
            messages=messages,
            temperature=_TEMPERATURE,
            max_output_tokens=_MAX_OUTPUT_TOKENS,
            response_format="json_object",
        )
        fallback_model = input.fallback_model or os.environ.get(_FALLBACK_MODEL_ENV_VAR) or None

        outcome = await self._invoker.execute(request, fallback_model=fallback_model)

        plan = parse_agent_creation_plan(
            outcome.response.text,
            real_skill_ids=frozenset(s.id for s in input.skills),
            real_mcp_tool_ids=frozenset(t.id for t in input.mcp_tools),
            real_connector_ids=frozenset(c.id for c in input.api_connectors),
            real_unlocked_policy_keys=frozenset(p.policy_key for p in input.guardrail_policies),
            knowledge_collection_exists=input.knowledge_collection_exists,
        )

        return ProposeAgentCreationResult(plan=plan, used_fallback=outcome.cost.used_fallback)
