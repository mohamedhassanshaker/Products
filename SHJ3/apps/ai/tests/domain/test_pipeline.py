"""Pure pipeline-graph logic — structural analysis and the interpreter's scheduling
decisions, independent of any effectful `ExecutePipeline` run."""

from __future__ import annotations

from collections import defaultdict
from decimal import Decimal

import pytest

from shj3_ai.domain.condition_expr import ConditionContext, parse
from shj3_ai.domain.orchestration import ConflictResolution, MergePolicy, TraceStepStatus
from shj3_ai.domain.pipeline import (
    InputContextMode,
    LoopDecision,
    NodeErrorPolicy,
    NodeOutput,
    PipelineCycleError,
    PipelineDefinition,
    PipelineEdgeDef,
    PipelineEdgeKind,
    PipelineNodeDef,
    PipelineNodeKind,
    PipelineRunState,
    ReadyKind,
    decide_loop_back,
    forward_edges_from,
    forward_indegree,
    loop_edges_from,
    loop_region,
    next_ready_set,
    topological_depth,
    topological_order,
    validate_definition,
)


def _node(
    key: str, kind: PipelineNodeKind = PipelineNodeKind.AGENT, **overrides: object
) -> PipelineNodeDef:
    base: dict[str, object] = {"key": key, "kind": kind, "title": key}
    if (
        kind in (PipelineNodeKind.AGENT, PipelineNodeKind.SUPERVISOR)
        and "agent_id" not in overrides
    ):
        base["agent_id"] = f"agt_{key}"
    base.update(overrides)
    return PipelineNodeDef(**base)  # type: ignore[arg-type]


def _edge(
    from_key: str,
    to_key: str,
    kind: PipelineEdgeKind = PipelineEdgeKind.SEQUENTIAL,
    *,
    ordinal: int = 0,
    max_iterations: int | None = None,
    condition_expression: str | None = None,
) -> PipelineEdgeDef:
    return PipelineEdgeDef(
        from_node_key=from_key,
        to_node_key=to_key,
        kind=kind,
        ordinal=ordinal,
        max_iterations=max_iterations,
        condition_expression=condition_expression,
    )


def _definition(
    nodes: list[PipelineNodeDef], edges: list[PipelineEdgeDef], entry_node_key: str = "start"
) -> PipelineDefinition:
    edges_from: dict[str, list[PipelineEdgeDef]] = defaultdict(list)
    edges_into: dict[str, list[PipelineEdgeDef]] = defaultdict(list)
    for edge in edges:
        edges_from[edge.from_node_key].append(edge)
        edges_into[edge.to_node_key].append(edge)
    for bucket in (edges_from, edges_into):
        for lst in bucket.values():
            lst.sort(key=lambda e: e.ordinal)
    return PipelineDefinition(
        pipeline_version_id="pv_1",
        pipeline_design_id="pd_1",
        label="v1.0",
        entry_node_key=entry_node_key,
        max_total_hops=10,
        cost_ceiling_tokens=1000,
        cost_ceiling_micro_aed=50_000,
        default_merge_policy=MergePolicy.DEDUPLICATE_OVERLAP,
        default_conflict_resolution=ConflictResolution.HIGHEST_CONFIDENCE,
        routing_strategy="IntentClassifier",
        min_routing_confidence=0.3,
        fallback_agent_id=None,
        nodes={n.key: n for n in nodes},
        edges_from={k: tuple(v) for k, v in edges_from.items()},
        edges_into={k: tuple(v) for k, v in edges_into.items()},
    )


def _linear_chain() -> PipelineDefinition:
    """start -> a -> respond"""
    return _definition(
        [
            _node("start", PipelineNodeKind.START),
            _node("a"),
            _node("respond", PipelineNodeKind.RESPONSE),
        ],
        [_edge("start", "a", ordinal=0), _edge("a", "respond", ordinal=0)],
    )


def _parallel_fan_out() -> PipelineDefinition:
    """start -[Parallel]-> a1, start -[Parallel]-> a2, both -> respond"""
    return _definition(
        [
            _node("start", PipelineNodeKind.START),
            _node("a1"),
            _node("a2"),
            _node("respond", PipelineNodeKind.RESPONSE),
        ],
        [
            _edge("start", "a1", PipelineEdgeKind.PARALLEL, ordinal=0),
            _edge("start", "a2", PipelineEdgeKind.PARALLEL, ordinal=1),
            _edge("a1", "respond", ordinal=0),
            _edge("a2", "respond", ordinal=1),
        ],
    )


def _looped_chain(*, max_iterations: int = 3, condition: str | None = None) -> PipelineDefinition:
    """start -> a -> b -[LoopBack to a]-> , b -> respond"""
    return _definition(
        [
            _node("start", PipelineNodeKind.START),
            _node("a"),
            _node("b"),
            _node("respond", PipelineNodeKind.RESPONSE),
        ],
        [
            _edge("start", "a", ordinal=0),
            _edge("a", "b", ordinal=0),
            _edge(
                "b",
                "a",
                PipelineEdgeKind.LOOP_BACK,
                ordinal=0,
                max_iterations=max_iterations,
                condition_expression=condition,
            ),
            _edge("b", "respond", ordinal=1),
        ],
    )


class TestStructuralQueries:
    def test_forward_edges_from_excludes_loop_back(self) -> None:
        defn = _looped_chain()
        assert [e.to_node_key for e in forward_edges_from(defn, "b")] == ["respond"]

    def test_loop_edges_from_returns_only_loop_back(self) -> None:
        defn = _looped_chain()
        assert [e.to_node_key for e in loop_edges_from(defn, "b")] == ["a"]

    def test_forward_indegree(self) -> None:
        defn = _parallel_fan_out()
        assert forward_indegree(defn, "respond") == 2
        assert forward_indegree(defn, "start") == 0

    def test_topological_order_linear_chain(self) -> None:
        assert topological_order(_linear_chain()) == ("start", "a", "respond")

    def test_topological_order_raises_on_a_real_forward_cycle(self) -> None:
        defn = _definition(
            [_node("start", PipelineNodeKind.START), _node("a"), _node("b")],
            [_edge("start", "a"), _edge("a", "b"), _edge("b", "a")],
        )
        with pytest.raises(PipelineCycleError) as exc_info:
            topological_order(defn)
        assert set(exc_info.value.cyclic_node_keys) == {"a", "b"}

    def test_topological_order_tolerates_a_loop_back_cycle(self) -> None:
        # b -> a is LoopBack, not Sequential -- must NOT be treated as a forward cycle.
        order = topological_order(_looped_chain())
        assert order.index("start") < order.index("a") < order.index("b")

    def test_topological_depth(self) -> None:
        depth = topological_depth(_parallel_fan_out())
        assert depth["start"] == 0
        assert depth["a1"] == 1
        assert depth["a2"] == 1
        assert depth["respond"] == 2

    def test_loop_region_includes_every_node_between_target_and_source(self) -> None:
        defn = _looped_chain()
        loop_edge = loop_edges_from(defn, "b")[0]
        assert loop_region(defn, loop_edge) == frozenset({"a", "b"})

    def test_loop_region_falls_back_to_endpoints_when_not_a_real_loop(self) -> None:
        # b -> respond marked as LoopBack, but respond can never reach back to b.
        defn = _definition(
            [
                _node("start", PipelineNodeKind.START),
                _node("a"),
                _node("b"),
                _node("respond", PipelineNodeKind.RESPONSE),
            ],
            [
                _edge("start", "a"),
                _edge("a", "b"),
                _edge("b", "respond", PipelineEdgeKind.LOOP_BACK, max_iterations=2),
            ],
        )
        bad_edge = loop_edges_from(defn, "b")[0]
        assert loop_region(defn, bad_edge) == frozenset({"b", "respond"})


class TestValidateDefinition:
    def test_valid_linear_chain_has_no_issues(self) -> None:
        assert validate_definition(_linear_chain()) == ()

    def test_valid_looped_chain_has_no_issues(self) -> None:
        assert validate_definition(_looped_chain()) == ()

    def test_entry_node_not_a_start_node(self) -> None:
        defn = _definition(
            [
                _node("start", PipelineNodeKind.START),
                _node("a"),
                _node("respond", PipelineNodeKind.RESPONSE),
            ],
            [_edge("start", "a"), _edge("a", "respond")],
            entry_node_key="a",
        )
        codes = [i.code for i in validate_definition(defn)]
        assert "orchestration.pipeline.entry_node_required" in codes

    def test_missing_response_node(self) -> None:
        defn = _definition(
            [_node("start", PipelineNodeKind.START), _node("a")],
            [_edge("start", "a")],
        )
        codes = [i.code for i in validate_definition(defn)]
        assert "orchestration.pipeline.terminal_node_required" in codes

    def test_orphan_node_with_no_inbound_edge(self) -> None:
        defn = _definition(
            [
                _node("start", PipelineNodeKind.START),
                _node("a"),
                _node("orphan"),
                _node("respond", PipelineNodeKind.RESPONSE),
            ],
            [_edge("start", "a"), _edge("a", "respond"), _edge("orphan", "respond")],
        )
        issues = [
            i for i in validate_definition(defn) if i.code == "orchestration.pipeline.orphan_node"
        ]
        assert any("orphan" in i.node_keys for i in issues)

    def test_dead_end_node_with_no_outbound_edge(self) -> None:
        defn = _definition(
            [
                _node("start", PipelineNodeKind.START),
                _node("a"),
                _node("deadend"),
                _node("respond", PipelineNodeKind.RESPONSE),
            ],
            [_edge("start", "a"), _edge("a", "respond"), _edge("start", "deadend", ordinal=1)],
        )
        issues = [
            i for i in validate_definition(defn) if i.code == "orchestration.pipeline.orphan_node"
        ]
        assert any("deadend" in i.node_keys for i in issues)

    def test_forward_cycle_flagged(self) -> None:
        defn = _definition(
            [_node("start", PipelineNodeKind.START), _node("a"), _node("b")],
            [_edge("start", "a"), _edge("a", "b"), _edge("b", "a")],
        )
        codes = [i.code for i in validate_definition(defn)]
        assert "orchestration.pipeline.cycle_outside_loop_edge" in codes

    def test_loop_edge_not_closing_a_loop_is_flagged(self) -> None:
        defn = _definition(
            [
                _node("start", PipelineNodeKind.START),
                _node("a"),
                _node("b"),
                _node("respond", PipelineNodeKind.RESPONSE),
            ],
            [
                _edge("start", "a"),
                _edge("a", "b"),
                _edge("b", "respond", PipelineEdgeKind.LOOP_BACK, max_iterations=2),
            ],
        )
        codes = [i.code for i in validate_definition(defn)]
        assert "orchestration.pipeline.loop_edge_does_not_close_a_loop" in codes

    def test_unpublished_agent_reference_flagged_when_set_supplied(self) -> None:
        defn = _linear_chain()
        issues = validate_definition(defn, published_agent_ids=frozenset({"agt_other"}))
        codes = [i.code for i in issues]
        assert "orchestration.pipeline.agent_not_published" in codes

    def test_published_agent_reference_not_flagged(self) -> None:
        defn = _linear_chain()
        issues = validate_definition(defn, published_agent_ids=frozenset({"agt_a"}))
        codes = [i.code for i in issues]
        assert "orchestration.pipeline.agent_not_published" not in codes

    def test_agent_reference_not_checked_when_no_set_supplied(self) -> None:
        defn = _linear_chain()
        codes = [i.code for i in validate_definition(defn)]
        assert "orchestration.pipeline.agent_not_published" not in codes


def _output(
    key: str, *, status: TraceStepStatus = TraceStepStatus.OK, branch_id: str = "0"
) -> NodeOutput:
    return NodeOutput(
        node_key=key,
        agent_id=f"agt_{key}",
        text=f"reply from {key}",
        confidence=Decimal("0.8"),
        is_owning_entity=False,
        status=status,
        via_edge_key=None,
        branch_id=branch_id,
    )


class TestNextReadySet:
    def test_start_node_is_ready_first(self) -> None:
        state = PipelineRunState(definition=_linear_chain())
        ready = next_ready_set(state)
        assert ready is not None
        assert ready.kind == ReadyKind.SEQUENTIAL
        assert ready.nodes[0].key == "start"

    def test_next_node_ready_after_predecessor_output_applied(self) -> None:
        defn = _linear_chain()
        state = PipelineRunState(definition=defn)
        state.apply_output(_output("start"))
        ready = next_ready_set(state)
        assert ready is not None
        assert ready.nodes[0].key == "a"

    def test_returns_none_when_every_node_has_output(self) -> None:
        defn = _linear_chain()
        state = PipelineRunState(definition=defn)
        for key in ("start", "a", "respond"):
            state.apply_output(_output(key))
        assert next_ready_set(state) is None

    def test_parallel_fan_out_produces_a_parallel_ready_set(self) -> None:
        defn = _parallel_fan_out()
        state = PipelineRunState(definition=defn)
        state.apply_output(_output("start"))
        ready = next_ready_set(state)
        assert ready is not None
        assert ready.kind == ReadyKind.PARALLEL
        assert {n.key for n in ready.nodes} == {"a1", "a2"}

    def test_join_node_waits_for_every_parallel_branch(self) -> None:
        defn = _parallel_fan_out()
        state = PipelineRunState(definition=defn)
        state.apply_output(_output("start"))
        state.apply_output(_output("a1"))
        # a2 hasn't produced output yet -- respond must not be ready.
        ready = next_ready_set(state)
        assert ready is not None
        assert {n.key for n in ready.nodes} == {"a2"}

    def test_join_node_ready_once_both_branches_complete(self) -> None:
        defn = _parallel_fan_out()
        state = PipelineRunState(definition=defn)
        state.apply_output(_output("start"))
        state.apply_output(_output("a1"))
        state.apply_output(_output("a2"))
        ready = next_ready_set(state)
        assert ready is not None
        assert ready.nodes[0].key == "respond"


class TestTakeLoop:
    def test_take_loop_resets_the_loop_region_and_marks_target_pending(self) -> None:
        defn = _looped_chain()
        state = PipelineRunState(definition=defn)
        state.apply_output(_output("start"))
        state.apply_output(_output("a"))
        state.apply_output(_output("b"))
        loop_edge = loop_edges_from(defn, "b")[0]

        state.take_loop(loop_edge)

        assert state.loop_iterations[loop_edge.edge_key] == 1
        assert "a" not in state.node_outputs
        assert "b" not in state.node_outputs
        assert "start" in state.node_outputs  # outside the loop region -- untouched
        assert "a" in state.pending_reentry

    def test_pending_reentry_is_served_before_the_normal_forward_check(self) -> None:
        defn = _looped_chain()
        state = PipelineRunState(definition=defn)
        state.apply_output(_output("start"))
        state.apply_output(_output("a"))
        state.apply_output(_output("b"))
        loop_edge = loop_edges_from(defn, "b")[0]
        state.take_loop(loop_edge)

        ready = next_ready_set(state)
        assert ready is not None
        assert ready.kind == ReadyKind.SEQUENTIAL
        assert ready.nodes[0].key == "a"

    def test_second_pass_reaches_b_again_and_then_respond(self) -> None:
        defn = _looped_chain()
        state = PipelineRunState(definition=defn)
        for key in ("start", "a", "b"):
            state.apply_output(_output(key))
        loop_edge = loop_edges_from(defn, "b")[0]
        state.take_loop(loop_edge)

        state.apply_output(_output("a"))  # re-run of the loop region
        ready = next_ready_set(state)
        assert ready is not None
        assert ready.nodes[0].key == "b"

        state.apply_output(_output("b"))
        ready = next_ready_set(state)
        assert ready is not None
        assert ready.nodes[0].key == "respond"


class TestDecideLoopBack:
    def test_no_loop_edges_returns_none(self) -> None:
        state = PipelineRunState(definition=_linear_chain())
        ctx = ConditionContext(
            iteration=1,
            hop_count=1,
            grounding_confidence=None,
            cost_tokens=0,
            cost_micro_aed=0,
            branch_cost_tokens=0,
            degraded=False,
            used_fallback_model=False,
            last_reply=None,
            node_outputs={},
        )
        assert decide_loop_back(state, "a", ctx, {}) is None

    def test_unconditional_loop_always_takes_until_the_bound(self) -> None:
        defn = _looped_chain(max_iterations=2)
        state = PipelineRunState(definition=defn)
        ctx = ConditionContext(
            iteration=1,
            hop_count=1,
            grounding_confidence=None,
            cost_tokens=0,
            cost_micro_aed=0,
            branch_cost_tokens=0,
            degraded=False,
            used_fallback_model=False,
            last_reply=None,
            node_outputs={},
        )
        edge, decision = decide_loop_back(state, "b", ctx, {})  # type: ignore[misc]
        assert decision == LoopDecision.TAKE
        state.loop_iterations[edge.edge_key] = 2
        _, decision2 = decide_loop_back(state, "b", ctx, {})  # type: ignore[misc]
        assert decision2 == LoopDecision.EXIT_MAX_ITERATIONS

    def test_condition_true_takes(self) -> None:
        defn = _looped_chain(max_iterations=5, condition="hopCount < 3")
        state = PipelineRunState(definition=defn)
        edge = loop_edges_from(defn, "b")[0]
        compiled = {edge.edge_key: parse("hopCount < 3")}
        ctx = ConditionContext(
            iteration=1,
            hop_count=1,
            grounding_confidence=None,
            cost_tokens=0,
            cost_micro_aed=0,
            branch_cost_tokens=0,
            degraded=False,
            used_fallback_model=False,
            last_reply=None,
            node_outputs={},
        )
        _, decision = decide_loop_back(state, "b", ctx, compiled)  # type: ignore[misc]
        assert decision == LoopDecision.TAKE

    def test_condition_false_exits_even_under_the_bound(self) -> None:
        defn = _looped_chain(max_iterations=5, condition="hopCount < 3")
        state = PipelineRunState(definition=defn)
        edge = loop_edges_from(defn, "b")[0]
        compiled = {edge.edge_key: parse("hopCount < 3")}
        ctx = ConditionContext(
            iteration=1,
            hop_count=10,
            grounding_confidence=None,
            cost_tokens=0,
            cost_micro_aed=0,
            branch_cost_tokens=0,
            degraded=False,
            used_fallback_model=False,
            last_reply=None,
            node_outputs={},
        )
        _, decision = decide_loop_back(state, "b", ctx, compiled)  # type: ignore[misc]
        assert decision == LoopDecision.EXIT_CONDITION_FALSE

    def test_max_iterations_wins_even_if_the_condition_would_still_be_true(self) -> None:
        defn = _looped_chain(max_iterations=2, condition="hopCount < 100")
        state = PipelineRunState(definition=defn)
        edge = loop_edges_from(defn, "b")[0]
        compiled = {edge.edge_key: parse("hopCount < 100")}
        state.loop_iterations[edge.edge_key] = 2
        ctx = ConditionContext(
            iteration=1,
            hop_count=1,
            grounding_confidence=None,
            cost_tokens=0,
            cost_micro_aed=0,
            branch_cost_tokens=0,
            degraded=False,
            used_fallback_model=False,
            last_reply=None,
            node_outputs={},
        )
        _, decision = decide_loop_back(state, "b", ctx, compiled)  # type: ignore[misc]
        assert decision == LoopDecision.EXIT_MAX_ITERATIONS

    def test_missing_compiled_ast_fails_closed_as_condition_error(self) -> None:
        defn = _looped_chain(max_iterations=5, condition="hopCount < 3")
        state = PipelineRunState(definition=defn)
        ctx = ConditionContext(
            iteration=1,
            hop_count=1,
            grounding_confidence=None,
            cost_tokens=0,
            cost_micro_aed=0,
            branch_cost_tokens=0,
            degraded=False,
            used_fallback_model=False,
            last_reply=None,
            node_outputs={},
        )
        _, decision = decide_loop_back(state, "b", ctx, {})  # type: ignore[misc]  # no compiled entry
        assert decision == LoopDecision.EXIT_CONDITION_ERROR


class TestPipelineNodeDefaults:
    def test_agent_node_defaults(self) -> None:
        node = _node("a")
        assert node.input_context_mode == InputContextMode.USER_TURN_ONLY
        assert node.on_error_policy == NodeErrorPolicy.FAIL_TURN
        assert node.uses_turn_bound_agent is False
