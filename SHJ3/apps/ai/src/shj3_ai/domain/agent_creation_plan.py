"""
Pure domain logic for the "Create with AI" agent-creation assistant (B2 registry's
"Create with AI" entry point, sibling to the plain "New agent" form). An LLM never creates
an agent directly — it proposes a structured `AgentCreationPlan` here, which a human reviews
before any of it is applied (`apps/web`'s `applyAgentCreationPlanAction`, which owns actually
writing the agent, through the exact same real Server Actions/application classes a human's
own manual wizard walk-through already goes through: `CreateAgent`, `UpdateAgentVersionConfig`,
`ReplaceChannelBindings`, `SetGuardrailOverride`, `BindTool`, `ReplaceKnowledgeBindings`).

## Why this parser is a best-effort pre-filter, not the authoritative gate

Same rule as `flow_edit_plan.py`'s own doc comment: the authoritative validation for every one
of these fields already exists, on the TypeScript side, in the exact same Server Actions a
human's own wizard edit already goes through. This parser's job is narrower — catch gross
malformation early and, critically, never let a fabricated tool/policy id reach the apply step
— so the human review screen sees a clean, catalog-grounded plan, not a re-implementation of
every field's full validation rule set a second time.

## Why this plan carries a `flow_instruction` sentence, not a node/edge graph

Flow generation already has its own dedicated, already-shipped, already-battle-tested pipeline
(`propose_flow_edit.py`/`parse_flow_edit_plan`). Asking ONE model response to emit both an
agent's scalar/catalog-grounded fields AND a flow's node/edge graph in the same JSON object
would mean one response spanning two very different, independently-fragile schemas — a real
correctness risk, not a theoretical one. Instead, this plan's only flow-shaped output is one
plain-language instruction sentence, which `apps/web`'s apply step feeds, unmodified, into the
existing flow-editing call as a second, separate LLM request against the freshly-created
(empty) flow.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

# Mirrors `TONES` (`modules/agents/domain/agent.ts`).
_TONES = frozenset({"Helpful", "Formal", "Concise"})
# Mirrors `WIZARD_CHANNEL_KEYS` (`modules/agents/domain/agent.ts`) — the 3-key subset the
# wizard's own Channels step (B3 step 8) actually renders; `MobileApp` exists in the full
# `CHANNEL_KEYS` domain enum but has no B3 UI yet, so this assistant never proposes it either.
_CHANNEL_KEYS = frozenset({"WebWidget", "WhatsApp", "KioskIvr"})
# Mirrors `TOOL_BINDING_TARGET_KINDS` (`modules/tools/domain/tool-catalog.ts`).
_TOOL_BINDING_TARGET_KINDS = frozenset({"Skill", "McpTool", "ApiConnector"})
# Mirrors `REQUIRED_ASSURANCE_LEVELS` (`modules/tools/domain/tool-catalog.ts`).
_REQUIRED_ASSURANCE_LEVELS = frozenset(
    {"Anonymous", "Verified", "VerifiedPlusOtp", "VerifiedPlusDocument"}
)
_GUARDRAIL_MODES = frozenset({"Value", "Disabled"})

_DEFAULT_TEMPERATURE = 0.7
"""Mid-range default matching the wizard's own Model step no-op starting point — used only
when the model omits `temperature` or supplies a non-numeric value, never invented as a
"business decision" beyond that fallback."""

_DEFAULT_GUARDRAIL_REASON = "Proposed by the AI-assisted agent-creation assistant."


@dataclass(frozen=True, slots=True)
class GuardrailOverrideProposal:
    policy_key: str
    mode: str  # "Value" | "Disabled"
    value_json: str | None
    reason: str


@dataclass(frozen=True, slots=True)
class ToolBindingProposal:
    target_kind: str  # "Skill" | "McpTool" | "ApiConnector"
    target_id: str
    required_assurance: str


@dataclass(frozen=True, slots=True)
class AgentCreationPlan:
    plan_summary: str
    name: str
    description: str
    system_prompt: str
    tone: str
    primary_model: str
    fallback_model: str | None
    temperature: float
    channel_keys: tuple[str, ...]
    guardrail_overrides: tuple[GuardrailOverrideProposal, ...]
    tool_bindings: tuple[ToolBindingProposal, ...]
    enable_knowledge: bool
    flow_instruction: str
    warnings: tuple[str, ...]


def _str(value: Any, default: str = "") -> str:
    return value if isinstance(value, str) and value.strip() != "" else default


def _sub_dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _number(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int | float):
        return float(value)
    return None


def _empty_plan(warning: str) -> AgentCreationPlan:
    return AgentCreationPlan(
        plan_summary="",
        name="",
        description="",
        system_prompt="",
        tone="Helpful",
        primary_model="",
        fallback_model=None,
        temperature=_DEFAULT_TEMPERATURE,
        channel_keys=(),
        guardrail_overrides=(),
        tool_bindings=(),
        enable_knowledge=False,
        flow_instruction="",
        warnings=(warning,),
    )


def parse_agent_creation_plan(
    raw_text: str,
    real_skill_ids: frozenset[str],
    real_mcp_tool_ids: frozenset[str],
    real_connector_ids: frozenset[str],
    real_unlocked_policy_keys: frozenset[str],
    knowledge_collection_exists: bool,
) -> AgentCreationPlan:
    warnings: list[str] = []

    try:
        raw = json.loads(raw_text)
    except (json.JSONDecodeError, TypeError):
        return _empty_plan("The model's response was not valid JSON — no proposal produced.")
    if not isinstance(raw, dict):
        return _empty_plan("The model's response was not a JSON object — no proposal produced.")

    identity = _sub_dict(raw.get("identity"))
    instructions = _sub_dict(raw.get("instructions"))
    model_config = _sub_dict(raw.get("modelConfig"))

    tone = _str(instructions.get("tone"), "Helpful")
    if tone not in _TONES:
        warnings.append(f'Unrecognised tone "{tone}" — defaulted to "Helpful".')
        tone = "Helpful"

    temperature = _number(model_config.get("temperature"))
    if temperature is None or not (0 <= temperature <= 2):
        if temperature is not None:
            warnings.append(
                f"Proposed temperature {temperature} was outside 0-2 — defaulted to "
                f"{_DEFAULT_TEMPERATURE}."
            )
        temperature = _DEFAULT_TEMPERATURE

    channel_keys: list[str] = []
    raw_channel_keys = raw.get("channelKeys")
    if isinstance(raw_channel_keys, list):
        for key in raw_channel_keys:
            if isinstance(key, str) and key in _CHANNEL_KEYS and key not in channel_keys:
                channel_keys.append(key)
            else:
                warnings.append(f'Unrecognised channel key "{key!r}" — dropped.')

    guardrail_overrides: list[GuardrailOverrideProposal] = []
    raw_guardrails = raw.get("guardrailOverrides")
    if isinstance(raw_guardrails, list):
        for index, raw_override in enumerate(raw_guardrails):
            if not isinstance(raw_override, dict):
                warnings.append(f"Guardrail override {index + 1} was not a JSON object — dropped.")
                continue
            policy_key = raw_override.get("policyKey")
            mode = raw_override.get("mode")
            if not isinstance(policy_key, str) or policy_key not in real_unlocked_policy_keys:
                warnings.append(
                    f"Guardrail override {index + 1} named an unknown or locked policy — dropped."
                )
                continue
            if not isinstance(mode, str) or mode not in _GUARDRAIL_MODES:
                warnings.append(
                    f'Guardrail override {index + 1} for "{policy_key}" had an invalid mode — '
                    "dropped."
                )
                continue
            guardrail_overrides.append(
                GuardrailOverrideProposal(
                    policy_key=policy_key,
                    mode=mode,
                    value_json=_str(raw_override.get("valueJson")) or None,
                    reason=_str(raw_override.get("reason"), _DEFAULT_GUARDRAIL_REASON),
                )
            )

    real_target_ids_by_kind = {
        "Skill": real_skill_ids,
        "McpTool": real_mcp_tool_ids,
        "ApiConnector": real_connector_ids,
    }
    tool_bindings: list[ToolBindingProposal] = []
    raw_tool_bindings = raw.get("toolBindings")
    if isinstance(raw_tool_bindings, list):
        for index, raw_binding in enumerate(raw_tool_bindings):
            if not isinstance(raw_binding, dict):
                warnings.append(f"Tool binding {index + 1} was not a JSON object — dropped.")
                continue
            target_kind = raw_binding.get("targetKind")
            target_id = raw_binding.get("targetId")
            required_assurance = _str(raw_binding.get("requiredAssurance"), "Anonymous")
            if target_kind not in _TOOL_BINDING_TARGET_KINDS:
                warnings.append(f"Tool binding {index + 1} named an unrecognised kind — dropped.")
                continue
            if not isinstance(target_id, str) or target_id not in real_target_ids_by_kind[target_kind]:
                warnings.append(
                    f"Tool binding {index + 1} referenced a tool that does not exist — dropped."
                )
                continue
            if required_assurance not in _REQUIRED_ASSURANCE_LEVELS:
                required_assurance = "Anonymous"
            tool_bindings.append(
                ToolBindingProposal(
                    target_kind=target_kind,
                    target_id=target_id,
                    required_assurance=required_assurance,
                )
            )

    enable_knowledge = raw.get("enableKnowledge") is True and knowledge_collection_exists
    if raw.get("enableKnowledge") is True and not knowledge_collection_exists:
        warnings.append("Knowledge was proposed, but this tenant has no knowledge collection yet.")

    return AgentCreationPlan(
        plan_summary=_str(raw.get("planSummary")),
        name=_str(identity.get("name")),
        description=_str(identity.get("description")),
        system_prompt=_str(instructions.get("systemPrompt")),
        tone=tone,
        primary_model=_str(model_config.get("primaryModel")),
        fallback_model=_str(model_config.get("fallbackModel")) or None,
        temperature=temperature,
        channel_keys=tuple(channel_keys),
        guardrail_overrides=tuple(guardrail_overrides),
        tool_bindings=tuple(tool_bindings),
        enable_knowledge=enable_knowledge,
        flow_instruction=_str(raw.get("flowInstruction")),
        warnings=tuple(warnings),
    )
