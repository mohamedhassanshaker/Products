"""Additional field-level unit tests for the Pydantic runtime-config mirror
(beyond the cross-language fixture corpus test).
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from avatar_agent.contracts.runtime_config import AgentRuntimeConfig

BASE = {
    "version": 1,
    "deployment": {"tenant_id": "11111111-1111-1111-1111-111111111111", "name": "t"},
    "transport": {"provider": "livekit", "room_namespace": "acme"},
    "stt": {"provider": "deepgram", "language": "en-US"},
    "reasoning": {
        "entry_node_id": "llm-1",
        "background_entry_node_ids": [],
        "turn_budget_ms": 3000,
        "graph": [
            {
                "id": "llm-1",
                "type": "llm",
                "name": "Answer",
                "lane": "foreground",
                "on_error": {"action": "degrade"},
                "on_deadline": {"action": "degrade"},
                "provider": "openai",
                "model": "gpt-4o",
                "retry": {"max_attempts": 3, "backoff_ms": [200, 400, 800]},
                "next_node_id": None,
            }
        ],
    },
    "tts": {"provider": "fish-speech", "voice_id": "v1"},
    "avatar": {"provider": "bithuman", "avatar_id": "a1"},
    "agent": {
        "runtime": "langgraph",
        "system_prompt": "hi",
        "tools": [],
        "memory": {"enabled": True, "window_turns": 16},
    },
    "knowledge": {
        "pipeline": {
            "rewrite": {"enabled": True, "context_turns": 3, "budget_ms": 150},
            "hybrid_search": {"vector_weight": 0.6, "keyword_weight": 0.4, "candidates": 20, "budget_ms": 100},
            "metadata_filter": {"enabled": False, "budget_ms": 20},
            "rerank": {"enabled": False},
            "threshold": {"min_score": 0.5, "budget_ms": 10},
            "inject": {"token_cap": 1200, "citation_format": "numbered", "budget_ms": 30},
        }
    },
    "privacy": {"send_to_remote_llm": "prompt_text_only", "retain_transcripts_days": 90, "recordings_enabled": False},
    "alerts": {"degraded_mode_message": "hold on"},
    "session_id": "22222222-2222-2222-2222-222222222222",
    "room_name": "acme_s1",
    "endpoints": {"openai": "https://api.openai.com"},
}


def test_accepts_a_complete_valid_document() -> None:
    cfg = AgentRuntimeConfig.model_validate(BASE)
    assert cfg.room_name == "acme_s1"
    assert str(cfg.endpoints["openai"]).startswith("https://api.openai.com")


def test_rejects_an_unknown_top_level_field() -> None:
    with pytest.raises(ValidationError):
        AgentRuntimeConfig.model_validate({**BASE, "unknown_field": 1})


def test_rejects_a_non_https_looking_garbage_endpoint() -> None:
    with pytest.raises(ValidationError):
        AgentRuntimeConfig.model_validate({**BASE, "endpoints": {"openai": "not a url"}})


def test_knowledge_block_is_required() -> None:
    bad = {k: v for k, v in BASE.items() if k != "knowledge"}
    with pytest.raises(ValidationError):
        AgentRuntimeConfig.model_validate(bad)


def test_agent_block_no_longer_accepts_a_rag_field() -> None:
    """Phase 12b (BL-045/047): the old RAG enable-flag / free-text
    index-reference pair is removed entirely — superseded by `knowledge
    .pipeline` + `RetrieveNode.source_refs`."""
    bad = {**BASE, "agent": {**BASE["agent"], "rag": {"enabled": False}}}
    with pytest.raises(ValidationError):
        AgentRuntimeConfig.model_validate(bad)


def test_v10_retrieval_stage_budgets_exceeding_the_retrieve_nodes_budget_is_rejected() -> None:
    """V-10 (Phase 12b) — mirrors the TS-side `validateRetrievalBudgets`."""
    retrieve_node = {
        "id": "retrieve-1",
        "type": "retrieve",
        "name": "Retrieve",
        "lane": "foreground",
        "on_error": {"action": "goto", "target_node_id": "llm-1"},
        "on_deadline": {"action": "degrade"},
        "source_refs": ["kb-1"],
        "top_k": 5,
        "budget_ms": 100,  # smaller than the pipeline's own stage sum below (150+100+20+10+30=310)
        "next_node_id": "llm-1",
    }
    bad = {
        **BASE,
        "reasoning": {
            **BASE["reasoning"],
            "entry_node_id": "retrieve-1",
            "graph": [retrieve_node, BASE["reasoning"]["graph"][0]],
        },
    }
    with pytest.raises(ValidationError):
        AgentRuntimeConfig.model_validate(bad)


def test_v10_retrieval_stage_budgets_within_the_retrieve_nodes_budget_is_accepted() -> None:
    retrieve_node = {
        "id": "retrieve-1",
        "type": "retrieve",
        "name": "Retrieve",
        "lane": "foreground",
        "on_error": {"action": "goto", "target_node_id": "llm-1"},
        "on_deadline": {"action": "degrade"},
        "source_refs": ["kb-1"],
        "top_k": 5,
        "budget_ms": 400,  # comfortably above the pipeline's own stage sum (310)
        "next_node_id": "llm-1",
    }
    ok = {
        **BASE,
        "reasoning": {
            **BASE["reasoning"],
            "entry_node_id": "retrieve-1",
            "graph": [retrieve_node, BASE["reasoning"]["graph"][0]],
        },
    }
    cfg = AgentRuntimeConfig.model_validate(ok)
    assert cfg.knowledge.pipeline.inject.citation_format == "numbered"


def test_backoff_ms_length_must_match_max_attempts() -> None:
    bad_node = {**BASE["reasoning"]["graph"][0], "retry": {"max_attempts": 3, "backoff_ms": [200, 400]}}
    bad = {**BASE, "reasoning": {**BASE["reasoning"], "graph": [bad_node]}}
    with pytest.raises(ValidationError):
        AgentRuntimeConfig.model_validate(bad)


def test_system_prompt_over_32768_bytes_is_rejected() -> None:
    bad = {**BASE, "agent": {**BASE["agent"], "system_prompt": "x" * 32769}}
    with pytest.raises(ValidationError):
        AgentRuntimeConfig.model_validate(bad)


def test_invalid_bcp47_language_is_rejected() -> None:
    bad = {**BASE, "stt": {**BASE["stt"], "language": "not-a-tag!!"}}
    with pytest.raises(ValidationError):
        AgentRuntimeConfig.model_validate(bad)


def test_unknown_provider_literal_is_rejected() -> None:
    bad_node = {**BASE["reasoning"]["graph"][0], "provider": "cohere"}
    bad = {**BASE, "reasoning": {**BASE["reasoning"], "graph": [bad_node]}}
    with pytest.raises(ValidationError):
        AgentRuntimeConfig.model_validate(bad)


def test_fallback_leg_is_optional() -> None:
    cfg = AgentRuntimeConfig.model_validate(BASE)
    assert cfg.reasoning.graph[0].fallback is None  # type: ignore[union-attr]


def test_hitl_node_is_accepted_and_references_a_gate_by_id() -> None:
    """Phase 14 (BL-052..057) — `HitlNode` mirrors
    `HitlNodeSchema` (`reasoning-graph.schema.ts`): a bare `gate_id`
    reference plus the shared `NodeBase`/`next_node_id` shape every other
    by-reference node type (`ToolNode.api_ref`, `SkillNode.skill_id`)
    already uses."""
    hitl_node = {
        "id": "hitl-1",
        "type": "hitl",
        "name": "Refund approval",
        "lane": "foreground",
        "on_error": {"action": "goto", "target_node_id": "llm-1"},
        "on_deadline": {"action": "degrade"},
        "gate_id": "11111111-1111-1111-1111-111111111111",
        "next_node_id": "llm-1",
    }
    reasoning = {**BASE["reasoning"], "entry_node_id": "hitl-1", "graph": [hitl_node, BASE["reasoning"]["graph"][0]]}
    cfg = AgentRuntimeConfig.model_validate({**BASE, "reasoning": reasoning})
    hitl = cfg.reasoning.graph[0]
    assert hitl.type == "hitl"  # type: ignore[union-attr]
    assert hitl.gate_id == "11111111-1111-1111-1111-111111111111"  # type: ignore[union-attr]


def test_hitl_node_without_a_gate_id_is_rejected() -> None:
    bad_node = {
        "id": "hitl-1",
        "type": "hitl",
        "name": "Refund approval",
        "lane": "foreground",
        "on_error": {"action": "degrade"},
        "on_deadline": {"action": "degrade"},
        "next_node_id": None,
    }
    reasoning = {**BASE["reasoning"], "entry_node_id": "hitl-1", "graph": [bad_node]}
    with pytest.raises(ValidationError):
        AgentRuntimeConfig.model_validate({**BASE, "reasoning": reasoning})


def test_hitl_node_with_a_dangling_next_node_id_is_rejected() -> None:
    """Gate A structural check (`ReasoningBlock._graph_references_resolve`)
    covers `HitlNode.next_node_id` the same way it already covers
    `SkillNode`'s — see the `isinstance(...)` tuple that check extends."""
    bad_node = {
        "id": "hitl-1",
        "type": "hitl",
        "name": "Refund approval",
        "lane": "foreground",
        "on_error": {"action": "degrade"},
        "on_deadline": {"action": "degrade"},
        "gate_id": "11111111-1111-1111-1111-111111111111",
        "next_node_id": "does-not-exist",
    }
    reasoning = {**BASE["reasoning"], "entry_node_id": "hitl-1", "graph": [bad_node]}
    with pytest.raises(ValidationError):
        AgentRuntimeConfig.model_validate({**BASE, "reasoning": reasoning})


# --- Phase 15 (BL-058/059/060): Sub-agent / Handoff / State -----------------
# Mirrors the Hitl fixture cases immediately above — the same acceptance /
# missing-required-field / dangling-next_node_id trio, applied to each of
# the final three of the full 13-type A3.2 set.


def test_subagent_node_is_accepted_and_references_a_target_tenant_by_id() -> None:
    subagent_node = {
        "id": "subagent-1",
        "type": "subagent",
        "name": "Delegate to billing",
        "lane": "foreground",
        "on_error": {"action": "goto", "target_node_id": "llm-1"},
        "on_deadline": {"action": "degrade"},
        "target_tenant_id": "33333333-3333-3333-3333-333333333333",
        "handback_policy": "speak_and_return",
        "budget_ms": 4000,
        "next_node_id": "llm-1",
    }
    reasoning = {**BASE["reasoning"], "entry_node_id": "subagent-1", "graph": [subagent_node, BASE["reasoning"]["graph"][0]]}
    cfg = AgentRuntimeConfig.model_validate({**BASE, "reasoning": reasoning})
    node = cfg.reasoning.graph[0]
    assert node.type == "subagent"  # type: ignore[union-attr]
    assert str(node.target_tenant_id) == "33333333-3333-3333-3333-333333333333"  # type: ignore[union-attr]
    assert node.handback_policy == "speak_and_return"  # type: ignore[union-attr]


def test_subagent_node_without_a_target_tenant_id_is_rejected() -> None:
    bad_node = {
        "id": "subagent-1",
        "type": "subagent",
        "name": "Delegate to billing",
        "lane": "foreground",
        "on_error": {"action": "degrade"},
        "on_deadline": {"action": "degrade"},
        "handback_policy": "speak_and_return",
        "next_node_id": None,
    }
    reasoning = {**BASE["reasoning"], "entry_node_id": "subagent-1", "graph": [bad_node]}
    with pytest.raises(ValidationError):
        AgentRuntimeConfig.model_validate({**BASE, "reasoning": reasoning})


def test_subagent_node_with_a_dangling_next_node_id_is_rejected() -> None:
    bad_node = {
        "id": "subagent-1",
        "type": "subagent",
        "name": "Delegate to billing",
        "lane": "foreground",
        "on_error": {"action": "degrade"},
        "on_deadline": {"action": "degrade"},
        "target_tenant_id": "33333333-3333-3333-3333-333333333333",
        "handback_policy": "speak_and_return",
        "next_node_id": "does-not-exist",
    }
    reasoning = {**BASE["reasoning"], "entry_node_id": "subagent-1", "graph": [bad_node]}
    with pytest.raises(ValidationError):
        AgentRuntimeConfig.model_validate({**BASE, "reasoning": reasoning})


def test_handoff_node_is_accepted_as_a_terminal_node_with_no_next_node_id() -> None:
    """`HandoffNode` mirrors `EndNode`'s terminal shape — a single-node graph
    consisting only of a Handoff node is valid, exactly like an End-only
    graph would be."""
    handoff_node = {
        "id": "handoff-1",
        "type": "handoff",
        "name": "Transfer to human",
        "lane": "foreground",
        "on_error": {"action": "end_turn"},
        "on_deadline": {"action": "end_turn"},
        "destination": "billing-queue",
        "context_summary": "Caller wants a refund exceeding agent authority.",
    }
    reasoning = {**BASE["reasoning"], "entry_node_id": "handoff-1", "graph": [handoff_node]}
    cfg = AgentRuntimeConfig.model_validate({**BASE, "reasoning": reasoning})
    node = cfg.reasoning.graph[0]
    assert node.type == "handoff"  # type: ignore[union-attr]
    assert node.destination == "billing-queue"  # type: ignore[union-attr]
    assert not hasattr(node, "next_node_id")


def test_handoff_node_without_a_destination_is_rejected() -> None:
    bad_node = {
        "id": "handoff-1",
        "type": "handoff",
        "name": "Transfer to human",
        "lane": "foreground",
        "on_error": {"action": "end_turn"},
        "on_deadline": {"action": "end_turn"},
        "context_summary": "Caller wants a refund exceeding agent authority.",
    }
    reasoning = {**BASE["reasoning"], "entry_node_id": "handoff-1", "graph": [bad_node]}
    with pytest.raises(ValidationError):
        AgentRuntimeConfig.model_validate({**BASE, "reasoning": reasoning})


def test_state_node_write_mode_is_accepted_with_a_value() -> None:
    state_node = {
        "id": "state-1",
        "type": "state",
        "name": "Remember order id",
        "lane": "foreground",
        "on_error": {"action": "degrade"},
        "on_deadline": {"action": "degrade"},
        "mode": "write",
        "variable": "order_id",
        "value": "$llm-1",
        "next_node_id": "llm-1",
    }
    reasoning = {**BASE["reasoning"], "entry_node_id": "state-1", "graph": [state_node, BASE["reasoning"]["graph"][0]]}
    cfg = AgentRuntimeConfig.model_validate({**BASE, "reasoning": reasoning})
    node = cfg.reasoning.graph[0]
    assert node.type == "state"  # type: ignore[union-attr]
    assert node.mode == "write"  # type: ignore[union-attr]
    assert node.value == "$llm-1"  # type: ignore[union-attr]


def test_state_node_read_mode_is_accepted_without_a_value() -> None:
    """`value` is required only when `mode: 'write'` — enforced server-side
    in `apps/api`'s Gate A structural check (`graph-structure.ts`'s
    `checkStateValue`), not re-validated here (see `StateNode`'s own
    docstring in `contracts/runtime_config.py`)."""
    state_node = {
        "id": "state-1",
        "type": "state",
        "name": "Recall order id",
        "lane": "foreground",
        "on_error": {"action": "degrade"},
        "on_deadline": {"action": "degrade"},
        "mode": "read",
        "variable": "order_id",
        "next_node_id": "llm-1",
    }
    reasoning = {**BASE["reasoning"], "entry_node_id": "state-1", "graph": [state_node, BASE["reasoning"]["graph"][0]]}
    cfg = AgentRuntimeConfig.model_validate({**BASE, "reasoning": reasoning})
    node = cfg.reasoning.graph[0]
    assert node.mode == "read"  # type: ignore[union-attr]
    assert node.value is None  # type: ignore[union-attr]


def test_state_node_with_an_invalid_variable_name_is_rejected() -> None:
    bad_node = {
        "id": "state-1",
        "type": "state",
        "name": "Remember order id",
        "lane": "foreground",
        "on_error": {"action": "degrade"},
        "on_deadline": {"action": "degrade"},
        "mode": "write",
        "variable": "order-id!",  # only [a-zA-Z0-9_] allowed
        "value": "4821",
        "next_node_id": None,
    }
    reasoning = {**BASE["reasoning"], "entry_node_id": "state-1", "graph": [bad_node]}
    with pytest.raises(ValidationError):
        AgentRuntimeConfig.model_validate({**BASE, "reasoning": reasoning})


def test_state_node_with_a_dangling_next_node_id_is_rejected() -> None:
    bad_node = {
        "id": "state-1",
        "type": "state",
        "name": "Remember order id",
        "lane": "foreground",
        "on_error": {"action": "degrade"},
        "on_deadline": {"action": "degrade"},
        "mode": "write",
        "variable": "order_id",
        "value": "4821",
        "next_node_id": "does-not-exist",
    }
    reasoning = {**BASE["reasoning"], "entry_node_id": "state-1", "graph": [bad_node]}
    with pytest.raises(ValidationError):
        AgentRuntimeConfig.model_validate({**BASE, "reasoning": reasoning})
