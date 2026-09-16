"""`ExecutePipeline` — the graph-walking interpreter, exercised against the same
`FakeConfigReader`/`FakeChatModel`/`FakeToolInvoker` fakes B-5's own application-layer
tests already establish (`orchestration_fakes.py`)."""

from __future__ import annotations

from collections import defaultdict

import pytest

from shj3_ai.application.execute_pipeline import ExecutePipeline, PipelineRunRequest
from shj3_ai.application.fallback_chat import InvokeWithFallback
from shj3_ai.domain.identity import AssuranceLevel
from shj3_ai.domain.orchestration import Budget, TraceStepKind
from shj3_ai.domain.pipeline import (
    InputContextMode,
    NodeErrorPolicy,
    PipelineDefinition,
    PipelineEdgeDef,
    PipelineEdgeKind,
    PipelineNodeDef,
    PipelineNodeKind,
)
from shj3_ai.ports.config_reader import CandidateAgent
from tests.application.orchestration_fakes import (
    FakeChatModel,
    FakeConfigReader,
    FakeToolInvoker,
    default_agent_version,
)


def _node(
    key: str, kind: PipelineNodeKind = PipelineNodeKind.AGENT, **overrides: object
) -> PipelineNodeDef:
    base: dict[str, object] = {
        "key": key,
        "kind": kind,
        "title": key,
        "input_context_mode": InputContextMode.USER_TURN_ONLY,
        "on_error_policy": NodeErrorPolicy.FAIL_TURN,
    }
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
        cost_ceiling_tokens=1_000_000,
        cost_ceiling_micro_aed=100_000_000,
        default_merge_policy="DeduplicateOverlap",  # type: ignore[arg-type]
        default_conflict_resolution="HighestConfidence",  # type: ignore[arg-type]
        routing_strategy="IntentClassifier",
        min_routing_confidence=0.3,
        fallback_agent_id=None,
        nodes={n.key: n for n in nodes},
        edges_from={k: tuple(v) for k, v in edges_from.items()},
        edges_into={k: tuple(v) for k, v in edges_into.items()},
    )


def _generous_budget() -> Budget:
    return Budget(
        max_hops=20,
        max_loop_iterations=1,
        cost_ceiling_tokens=1_000_000,
        cost_ceiling_micro_aed=100_000_000,
    )


def _build(
    *,
    definition: PipelineDefinition,
    candidate_agents: list[CandidateAgent] | None = None,
    fail_models: frozenset[str] = frozenset(),
) -> tuple[ExecutePipeline, FakeChatModel]:
    chat_model = FakeChatModel(fail_models=fail_models)
    config = FakeConfigReader(candidate_agents=candidate_agents or [])
    pipeline = ExecutePipeline(
        config=config,  # type: ignore[arg-type]
        chat_invoker=InvokeWithFallback(chat_model),  # type: ignore[arg-type]
        tool_invoker=FakeToolInvoker(),  # type: ignore[arg-type]
    )
    return pipeline, chat_model


def _candidate(agent_id: str, model: str, fallback_model: str | None = None) -> CandidateAgent:
    return CandidateAgent(
        agent_id=agent_id,
        agent_version_id=f"avr_{agent_id}",
        name=agent_id,
        system_prompt=f"You are {agent_id}.",
        primary_model=model,
        fallback_model=fallback_model,
        temperature=0.3,
        max_output_tokens=500,
    )


def _request(definition: PipelineDefinition, content: str = "hello") -> PipelineRunRequest:
    return PipelineRunRequest(
        definition=definition,
        content=content,
        turn_bound_agent_version=default_agent_version(),
        held_assurance=AssuranceLevel.L0,
        starting_ordinal=0,
        budget=_generous_budget(),
    )


class TestSequentialChain:
    @pytest.mark.asyncio
    async def test_three_node_chain_reaches_response(self) -> None:
        defn = _definition(
            [
                _node("start", PipelineNodeKind.START),
                _node("a", agent_id="agt_a"),
                _node("respond", PipelineNodeKind.RESPONSE),
            ],
            [_edge("start", "a"), _edge("a", "respond")],
        )
        pipeline, chat_model = _build(
            definition=defn, candidate_agents=[_candidate("agt_a", "openrouter/agt-a")]
        )
        result = await pipeline.execute(_request(defn))
        assert result.terminal_node_key == "respond"
        assert "openrouter/agt-a" in result.final_text
        assert result.hop_count == 1
        assert chat_model.calls == ["openrouter/agt-a"]


class TestParallelJoin:
    @pytest.mark.asyncio
    async def test_two_way_fan_out_merges_at_the_join(self) -> None:
        defn = _definition(
            [
                _node("start", PipelineNodeKind.START),
                _node("a1", agent_id="agt_a1"),
                _node("a2", agent_id="agt_a2"),
                _node("respond", PipelineNodeKind.RESPONSE),
            ],
            [
                _edge("start", "a1", PipelineEdgeKind.PARALLEL, ordinal=0),
                _edge("start", "a2", PipelineEdgeKind.PARALLEL, ordinal=1),
                _edge("a1", "respond", ordinal=0),
                _edge("a2", "respond", ordinal=1),
            ],
        )
        pipeline, _ = _build(
            definition=defn,
            candidate_agents=[
                _candidate("agt_a1", "openrouter/a1"),
                _candidate("agt_a2", "openrouter/a2"),
            ],
        )
        result = await pipeline.execute(_request(defn))
        assert result.terminal_node_key == "respond"
        assert result.hop_count == 2
        assert result.branch_count >= 2
        merge_steps = [s for s in result.steps if s.kind == TraceStepKind.MERGE]
        assert len(merge_steps) == 1
        fan_out_steps = [s for s in result.steps if s.kind == TraceStepKind.FAN_OUT]
        assert len(fan_out_steps) == 1


class TestLoops:
    def _looped_definition(
        self, *, max_iterations: int, condition: str | None
    ) -> PipelineDefinition:
        return _definition(
            [
                _node("start", PipelineNodeKind.START),
                _node("a", agent_id="agt_a"),
                _node("b", agent_id="agt_b"),
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

    @pytest.mark.asyncio
    async def test_unconditional_loop_repeats_exactly_max_iterations_times(self) -> None:
        defn = self._looped_definition(max_iterations=2, condition=None)
        pipeline, chat_model = _build(
            definition=defn,
            candidate_agents=[
                _candidate("agt_a", "openrouter/a"),
                _candidate("agt_b", "openrouter/b"),
            ],
        )
        result = await pipeline.execute(_request(defn))
        assert result.terminal_node_key == "respond"
        assert result.loop_iterations_total == 2
        # a and b each ran 1 (initial) + 2 (loop retries) = 3 times.
        assert chat_model.calls.count("openrouter/a") == 3
        assert chat_model.calls.count("openrouter/b") == 3
        loop_steps = [s for s in result.steps if s.kind == TraceStepKind.LOOP_BACK]
        assert len(loop_steps) == 3  # 2 TAKE + 1 EXIT_MAX_ITERATIONS
        assert loop_steps[-1].error_code == "orchestration.loop_max_iterations_reached"

    @pytest.mark.asyncio
    async def test_conditional_loop_exits_early_under_the_bound(self) -> None:
        # "iteration < 2": true on the first check (iteration=1), false on the second
        # (iteration=2) -- exits after exactly one real loop-back, well under maxIterations=5.
        defn = self._looped_definition(max_iterations=5, condition="iteration < 2")
        pipeline, _chat_model = _build(
            definition=defn,
            candidate_agents=[
                _candidate("agt_a", "openrouter/a"),
                _candidate("agt_b", "openrouter/b"),
            ],
        )
        result = await pipeline.execute(_request(defn))
        assert result.terminal_node_key == "respond"
        assert result.loop_iterations_total == 1
        loop_steps = [s for s in result.steps if s.kind == TraceStepKind.LOOP_BACK]
        assert loop_steps[-1].error_code == "orchestration.condition_false"

    @pytest.mark.asyncio
    async def test_max_iterations_wins_even_when_the_condition_stays_true(self) -> None:
        defn = self._looped_definition(max_iterations=2, condition="iteration < 100")
        pipeline, _ = _build(
            definition=defn,
            candidate_agents=[
                _candidate("agt_a", "openrouter/a"),
                _candidate("agt_b", "openrouter/b"),
            ],
        )
        result = await pipeline.execute(_request(defn))
        assert result.loop_iterations_total == 2
        loop_steps = [s for s in result.steps if s.kind == TraceStepKind.LOOP_BACK]
        assert loop_steps[-1].error_code == "orchestration.loop_max_iterations_reached"


class TestNodeFailure:
    @pytest.mark.asyncio
    async def test_skip_node_failure_does_not_deadlock_a_downstream_join(self) -> None:
        defn = _definition(
            [
                _node("start", PipelineNodeKind.START),
                _node("a", agent_id="agt_a", on_error_policy=NodeErrorPolicy.SKIP_NODE),
                _node("b", agent_id="agt_b"),
                _node("respond", PipelineNodeKind.RESPONSE),
            ],
            [
                _edge("start", "a", PipelineEdgeKind.PARALLEL, ordinal=0),
                _edge("start", "b", PipelineEdgeKind.PARALLEL, ordinal=1),
                _edge("a", "respond", ordinal=0),
                _edge("b", "respond", ordinal=1),
            ],
        )
        pipeline, _ = _build(
            definition=defn,
            candidate_agents=[
                _candidate("agt_a", "openrouter/a"),
                _candidate("agt_b", "openrouter/b"),
            ],
            fail_models=frozenset({"openrouter/a"}),
        )
        result = await pipeline.execute(_request(defn))
        assert result.terminal_node_key == "respond"
        assert "openrouter/b" in result.final_text

    @pytest.mark.asyncio
    async def test_fail_turn_policy_raises(self) -> None:
        from shj3_ai.application.execute_pipeline import PipelineTurnFailedError

        defn = _definition(
            [
                _node("start", PipelineNodeKind.START),
                _node("a", agent_id="agt_a", on_error_policy=NodeErrorPolicy.FAIL_TURN),
                _node("respond", PipelineNodeKind.RESPONSE),
            ],
            [_edge("start", "a"), _edge("a", "respond")],
        )
        pipeline, _ = _build(
            definition=defn,
            candidate_agents=[_candidate("agt_a", "openrouter/a")],
            fail_models=frozenset({"openrouter/a"}),
        )
        with pytest.raises(PipelineTurnFailedError):
            await pipeline.execute(_request(defn))
