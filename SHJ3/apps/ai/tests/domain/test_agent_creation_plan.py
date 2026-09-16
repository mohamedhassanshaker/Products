import json

from shj3_ai.domain.agent_creation_plan import parse_agent_creation_plan

_SKILL_IDS = frozenset({"skill-1"})
_MCP_TOOL_IDS = frozenset({"mcp-tool-1"})
_CONNECTOR_IDS = frozenset({"connector-1"})
_POLICY_KEYS = frozenset({"grounding_threshold", "allow_competitor_discussion"})


def _parse(raw_text: str, *, knowledge_collection_exists: bool = True):
    return parse_agent_creation_plan(
        raw_text,
        real_skill_ids=_SKILL_IDS,
        real_mcp_tool_ids=_MCP_TOOL_IDS,
        real_connector_ids=_CONNECTOR_IDS,
        real_unlocked_policy_keys=_POLICY_KEYS,
        knowledge_collection_exists=knowledge_collection_exists,
    )


def test_malformed_json_returns_an_empty_plan_with_a_warning():
    plan = _parse("not json at all")
    assert plan.name == ""
    assert plan.warnings and "not valid JSON" in plan.warnings[0]


def test_a_non_object_json_value_returns_an_empty_plan_with_a_warning():
    plan = _parse("[1, 2, 3]")
    assert plan.warnings and "not a JSON object" in plan.warnings[0]


def test_an_empty_object_is_a_valid_empty_plan_with_no_warnings():
    plan = _parse("{}")
    assert plan.name == ""
    assert plan.tone == "Helpful"
    assert plan.temperature == 0.7
    assert plan.channel_keys == ()
    assert plan.warnings == ()


def test_a_complete_proposal_parses_every_field():
    raw = json.dumps(
        {
            "planSummary": "A billing assistant",
            "identity": {"name": "Billing Helper", "description": "Helps with bills."},
            "instructions": {"systemPrompt": "Be concise.", "tone": "Concise"},
            "modelConfig": {
                "primaryModel": "anthropic/claude-sonnet-5",
                "fallbackModel": "openai/gpt-5",
                "temperature": 0.3,
            },
            "channelKeys": ["WebWidget", "WhatsApp"],
            "guardrailOverrides": [
                {
                    "policyKey": "grounding_threshold",
                    "mode": "Value",
                    "valueJson": "0.8",
                    "reason": "Higher bar for billing facts.",
                }
            ],
            "toolBindings": [
                {"targetKind": "Skill", "targetId": "skill-1", "requiredAssurance": "Verified"}
            ],
            "enableKnowledge": True,
            "flowInstruction": "Greet, collect account number, look up the bill, escalate on failure.",
        }
    )
    plan = _parse(raw)
    assert plan.plan_summary == "A billing assistant"
    assert plan.name == "Billing Helper"
    assert plan.tone == "Concise"
    assert plan.primary_model == "anthropic/claude-sonnet-5"
    assert plan.temperature == 0.3
    assert plan.channel_keys == ("WebWidget", "WhatsApp")
    assert len(plan.guardrail_overrides) == 1
    assert plan.guardrail_overrides[0].policy_key == "grounding_threshold"
    assert len(plan.tool_bindings) == 1
    assert plan.tool_bindings[0].target_id == "skill-1"
    assert plan.enable_knowledge is True
    assert "escalate" in plan.flow_instruction
    assert plan.warnings == ()


def test_a_guardrail_override_for_an_unknown_or_locked_policy_is_dropped_individually():
    raw = json.dumps(
        {
            "guardrailOverrides": [
                {"policyKey": "mask_pii_in_transcripts", "mode": "Disabled", "reason": "x"},
                {"policyKey": "grounding_threshold", "mode": "Value", "valueJson": "0.5", "reason": "x"},
            ]
        }
    )
    plan = _parse(raw)
    assert len(plan.guardrail_overrides) == 1
    assert plan.guardrail_overrides[0].policy_key == "grounding_threshold"
    assert len(plan.warnings) == 1


def test_a_tool_binding_for_an_unknown_id_is_dropped_individually():
    raw = json.dumps(
        {
            "toolBindings": [
                {"targetKind": "Skill", "targetId": "skill-does-not-exist", "requiredAssurance": "Anonymous"},
                {"targetKind": "McpTool", "targetId": "mcp-tool-1", "requiredAssurance": "Verified"},
            ]
        }
    )
    plan = _parse(raw)
    assert len(plan.tool_bindings) == 1
    assert plan.tool_bindings[0].target_id == "mcp-tool-1"
    assert len(plan.warnings) == 1


def test_an_unrecognised_channel_key_is_dropped_individually():
    raw = json.dumps({"channelKeys": ["WebWidget", "CarrierPigeon"]})
    plan = _parse(raw)
    assert plan.channel_keys == ("WebWidget",)
    assert len(plan.warnings) == 1


def test_an_out_of_range_temperature_falls_back_to_the_default_with_a_warning():
    plan = _parse(json.dumps({"modelConfig": {"temperature": 5}}))
    assert plan.temperature == 0.7
    assert len(plan.warnings) == 1


def test_enable_knowledge_is_forced_false_when_no_collection_exists_even_if_proposed():
    plan = _parse(json.dumps({"enableKnowledge": True}), knowledge_collection_exists=False)
    assert plan.enable_knowledge is False
    assert len(plan.warnings) == 1
