"""Pure flow-engine state machine — B7's node types, retry-then-fall-through,
and the free-text escape (brief requirement R3 / FR-FLOW-07 / FR-FLOW-09)."""

from __future__ import annotations

from shj3_ai.domain.flows import (
    FlowDefinition,
    FlowEdgeDef,
    FlowNodeDef,
    FlowNodeType,
    FlowState,
    apply_free_text_escape,
    fill_slot,
    is_free_text_escape,
    record_tool_retry,
    resolve_default_or_matching_edge,
    resume_flow,
    should_retry,
)


def _definition() -> FlowDefinition:
    nodes = {
        "ask_provider": FlowNodeDef(
            id="n1", key="ask_provider", type=FlowNodeType.QUESTION, slot_name="provider"
        ),
        "get_bill": FlowNodeDef(
            id="n2",
            key="get_bill",
            type=FlowNodeType.TOOL_CALL,
            retry_count=1,
            on_failure_node_key="handover",
            tool_binding_id="tb1",
        ),
        "handover": FlowNodeDef(id="n3", key="handover", type=FlowNodeType.HANDOVER),
        "confirm": FlowNodeDef(id="n4", key="confirm", type=FlowNodeType.MESSAGE),
    }
    edges: dict[str, tuple[FlowEdgeDef, ...]] = {
        "ask_provider": (FlowEdgeDef("ask_provider", "get_bill", 0, None, is_default_branch=True),),
        "get_bill": (FlowEdgeDef("get_bill", "confirm", 0, None, is_default_branch=True),),
    }
    return FlowDefinition(
        flow_version_id="fv1",
        entry_node_id="ask_provider",
        escape_node_id=None,
        free_text_escape_enabled=True,
        nodes=nodes,
        edges_from=edges,
    )


class TestFreeTextEscape:
    def test_recognised_escape_phrase(self) -> None:
        assert is_free_text_escape("Actually, I have another inquiry")

    def test_ordinary_slot_answer_is_not_an_escape(self) -> None:
        assert not is_free_text_escape("SEWA")

    def test_escape_preserves_node_and_slots(self) -> None:
        state = FlowState(flow_version_id="fv1", current_node_key="ask_provider", slots={"a": "1"})
        escaped = apply_free_text_escape(state, "i have another inquiry")
        assert escaped.current_node_key == "ask_provider"
        assert escaped.slots == {"a": "1"}
        assert escaped.escape_context_json == "i have another inquiry"

    def test_resume_clears_escape_marker_but_keeps_position(self) -> None:
        state = FlowState(
            flow_version_id="fv1",
            current_node_key="ask_provider",
            slots={"a": "1"},
            escape_context_json="i have another inquiry",
        )
        resumed = resume_flow(state)
        assert resumed.escape_context_json is None
        assert resumed.current_node_key == "ask_provider"
        assert resumed.slots == {"a": "1"}

    def test_escape_available_at_every_node_type(self) -> None:
        # Asserted node by node, per FR-FLOW-07's own acceptance bar.
        definition = _definition()
        for node_key in definition.nodes:
            state = FlowState(flow_version_id="fv1", current_node_key=node_key)
            escaped = apply_free_text_escape(state, "never mind")
            assert escaped.current_node_key == node_key


class TestRetryThenFallThrough:
    def test_first_failure_permits_a_retry(self) -> None:
        node = FlowNodeDef(id="n2", key="get_bill", type=FlowNodeType.TOOL_CALL, retry_count=1)
        state = FlowState(flow_version_id="fv1", current_node_key="get_bill")
        state, attempt = record_tool_retry(state, "get_bill")
        assert attempt == 1
        assert should_retry(node, attempt)

    def test_second_failure_falls_through(self) -> None:
        node = FlowNodeDef(id="n2", key="get_bill", type=FlowNodeType.TOOL_CALL, retry_count=1)
        state = FlowState(flow_version_id="fv1", current_node_key="get_bill")
        state, _ = record_tool_retry(state, "get_bill")
        state, attempt = record_tool_retry(state, "get_bill")
        assert attempt == 2
        assert not should_retry(node, attempt)

    def test_a_node_with_no_configured_retries_never_retries(self) -> None:
        node = FlowNodeDef(id="n1", key="x", type=FlowNodeType.TOOL_CALL, retry_count=None)
        assert not should_retry(node, 1)


class TestEdgeResolution:
    def test_default_branch_fires_with_no_condition_match(self) -> None:
        definition = _definition()
        edge = resolve_default_or_matching_edge(definition, "ask_provider", {})
        assert edge is not None
        assert edge.to_node_key == "get_bill"

    def test_condition_expression_matches_before_default(self) -> None:
        nodes = {
            "cond": FlowNodeDef(id="n1", key="cond", type=FlowNodeType.CONDITION),
            "yes": FlowNodeDef(id="n2", key="yes", type=FlowNodeType.MESSAGE),
            "no": FlowNodeDef(id="n3", key="no", type=FlowNodeType.MESSAGE),
        }
        edges: dict[str, tuple[FlowEdgeDef, ...]] = {
            "cond": (
                FlowEdgeDef("cond", "yes", 0, "verified=true", is_default_branch=False),
                FlowEdgeDef("cond", "no", 1, None, is_default_branch=True),
            )
        }
        definition = FlowDefinition("fv1", "cond", None, True, nodes, edges)
        matched = resolve_default_or_matching_edge(definition, "cond", {"verified": "true"})
        assert matched is not None
        assert matched.to_node_key == "yes"
        fallback = resolve_default_or_matching_edge(definition, "cond", {"verified": "false"})
        assert fallback is not None
        assert fallback.to_node_key == "no"

    def test_no_outgoing_edges_returns_none(self) -> None:
        definition = _definition()
        assert resolve_default_or_matching_edge(definition, "confirm", {}) is None


class TestFillSlot:
    def test_fills_without_mutating_other_slots(self) -> None:
        state = FlowState(flow_version_id="fv1", current_node_key="ask_provider", slots={"a": "1"})
        filled = fill_slot(state, "provider", "SEWA")
        assert filled.slots == {"a": "1", "provider": "SEWA"}
        assert state.slots == {"a": "1"}  # original untouched
