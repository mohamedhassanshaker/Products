"""The `/agents` registry's "Create with AI" entry point — `POST /v1/agents/creation-
proposals`. Mirrors `flow_authoring_router.py`'s conventions exactly: behind
`TenantContextDep`, ports constructed fresh per request from the environment, stateless —
computes and returns a proposed plan, writes nothing.

`shj3-ai` has no write access to `Agents`/`AgentVersions`/any binding table (`docs/data-
model.md` §5's grant enumeration), so this endpoint's caller (`apps/web`'s
`proposeAgentCreationAction`) sends the tenant's real, existing catalogs (skills, MCP tools,
API connectors, guardrail policy keys, knowledge-collection existence) in the request body —
the same "the caller already holds it, shj3-ai has no authoring-shaped read" shape
`flow_authoring_router.py`'s own doc comment already establishes for flow nodes/edges.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from shj3_ai.adapters.inbound.tenant_auth import TenantContextDep
from shj3_ai.adapters.outbound.chat.deterministic_chat_model import chat_model_from_environment
from shj3_ai.application.fallback_chat import InvokeWithFallback
from shj3_ai.application.propose_agent_creation import (
    ApiConnectorCatalogEntry,
    GuardrailPolicyCatalogEntry,
    McpToolCatalogEntry,
    ProposeAgentCreation,
    ProposeAgentCreationInput,
    SkillCatalogEntry,
)
from shj3_ai.domain.agent_creation_plan import AgentCreationPlan

router = APIRouter(prefix="/v1/agents", tags=["agents"])


def _propose_agent_creation() -> ProposeAgentCreation:
    return ProposeAgentCreation(InvokeWithFallback(chat_model_from_environment()))


ProposeAgentCreationDep = Annotated[ProposeAgentCreation, Depends(_propose_agent_creation)]


# ---------------------------------------------------------------------------
# Wire models — camelCase both ways, matching `flow_authoring_router.py`'s convention.
# ---------------------------------------------------------------------------


class SkillCatalogEntryIn(BaseModel):
    id: str
    name: str
    description: str | None = None


class McpToolCatalogEntryIn(BaseModel):
    id: str
    name: str
    server_name: str = Field(alias="serverName")


class ApiConnectorCatalogEntryIn(BaseModel):
    id: str
    name: str


class GuardrailPolicyCatalogEntryIn(BaseModel):
    policy_key: str = Field(alias="policyKey")
    title: str
    detail: str


class ProposeAgentCreationRequestIn(BaseModel):
    business_description: str = Field(alias="businessDescription")
    skills: list[SkillCatalogEntryIn] = Field(default_factory=list)
    mcp_tools: list[McpToolCatalogEntryIn] = Field(alias="mcpTools", default_factory=list)
    api_connectors: list[ApiConnectorCatalogEntryIn] = Field(alias="apiConnectors", default_factory=list)
    guardrail_policies: list[GuardrailPolicyCatalogEntryIn] = Field(
        alias="guardrailPolicies", default_factory=list
    )
    knowledge_collection_exists: bool = Field(alias="knowledgeCollectionExists")
    model: str | None = None
    fallback_model: str | None = Field(alias="fallbackModel", default=None)


class GuardrailOverrideProposalOut(BaseModel):
    policy_key: str = Field(serialization_alias="policyKey")
    mode: str
    value_json: str | None = Field(serialization_alias="valueJson")
    reason: str


class ToolBindingProposalOut(BaseModel):
    target_kind: str = Field(serialization_alias="targetKind")
    target_id: str = Field(serialization_alias="targetId")
    required_assurance: str = Field(serialization_alias="requiredAssurance")


class AgentCreationPlanOut(BaseModel):
    plan_summary: str = Field(serialization_alias="planSummary")
    name: str
    description: str
    system_prompt: str = Field(serialization_alias="systemPrompt")
    tone: str
    primary_model: str = Field(serialization_alias="primaryModel")
    fallback_model: str | None = Field(serialization_alias="fallbackModel")
    temperature: float
    channel_keys: list[str] = Field(serialization_alias="channelKeys")
    guardrail_overrides: list[GuardrailOverrideProposalOut] = Field(
        serialization_alias="guardrailOverrides"
    )
    tool_bindings: list[ToolBindingProposalOut] = Field(serialization_alias="toolBindings")
    enable_knowledge: bool = Field(serialization_alias="enableKnowledge")
    flow_instruction: str = Field(serialization_alias="flowInstruction")
    warnings: list[str]
    used_fallback_model: bool = Field(serialization_alias="usedFallbackModel")


def _plan_out(plan: AgentCreationPlan, used_fallback: bool) -> AgentCreationPlanOut:
    return AgentCreationPlanOut(
        plan_summary=plan.plan_summary,
        name=plan.name,
        description=plan.description,
        system_prompt=plan.system_prompt,
        tone=plan.tone,
        primary_model=plan.primary_model,
        fallback_model=plan.fallback_model,
        temperature=plan.temperature,
        channel_keys=list(plan.channel_keys),
        guardrail_overrides=[
            GuardrailOverrideProposalOut(
                policy_key=o.policy_key, mode=o.mode, value_json=o.value_json, reason=o.reason
            )
            for o in plan.guardrail_overrides
        ],
        tool_bindings=[
            ToolBindingProposalOut(
                target_kind=b.target_kind,
                target_id=b.target_id,
                required_assurance=b.required_assurance,
            )
            for b in plan.tool_bindings
        ],
        enable_knowledge=plan.enable_knowledge,
        flow_instruction=plan.flow_instruction,
        warnings=list(plan.warnings),
        used_fallback_model=used_fallback,
    )


@router.post("/creation-proposals", response_model=AgentCreationPlanOut)
async def propose_agent_creation(
    body: ProposeAgentCreationRequestIn,
    use_case: ProposeAgentCreationDep,
    context: TenantContextDep,
) -> AgentCreationPlanOut:
    del context  # auth/tracing only — this route's own work needs neither field.
    result = await use_case.execute(
        ProposeAgentCreationInput(
            business_description=body.business_description,
            skills=tuple(
                SkillCatalogEntry(id=s.id, name=s.name, description=s.description) for s in body.skills
            ),
            mcp_tools=tuple(
                McpToolCatalogEntry(id=t.id, name=t.name, server_name=t.server_name)
                for t in body.mcp_tools
            ),
            api_connectors=tuple(
                ApiConnectorCatalogEntry(id=c.id, name=c.name) for c in body.api_connectors
            ),
            guardrail_policies=tuple(
                GuardrailPolicyCatalogEntry(policy_key=p.policy_key, title=p.title, detail=p.detail)
                for p in body.guardrail_policies
            ),
            knowledge_collection_exists=body.knowledge_collection_exists,
            model=body.model,
            fallback_model=body.fallback_model,
        )
    )

    return _plan_out(result.plan, result.used_fallback)
