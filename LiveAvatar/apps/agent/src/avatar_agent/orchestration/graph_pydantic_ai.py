"""`agent.runtime == "pydantic-ai"` orchestration (FR-AGENT-1, FR-CONFIG-2).

Uses `pydantic_graph` (the typed graph engine Pydantic AI is built on) for
control flow instead of Pydantic AI's own `Agent`/`Model` classes —
deliberately, see the pre-Phase-9 version of this docstring (still true):
Pydantic AI's built-in vendor `Model` wrappers import vendor SDKs directly,
which would violate ADR-001 §3's vendor-SDK-isolation rule. Phase 9
(BL-036) changes what the one step wraps — `GraphInterpreter.run` instead of
`run_with_failover` — keeping every vendor model call routed exclusively
through `ILLMProvider` (registry/adapters).
"""

from __future__ import annotations

from dataclasses import dataclass

from pydantic_graph import GraphBuilder, GraphRunContext

from avatar_agent.orchestration.graph.interpreter import GraphInterpreter
from avatar_agent.orchestration.graph.ir import GraphDefinition, GraphRunResult, TurnContext


@dataclass
class _TurnState:
    graph: GraphDefinition
    ctx: TurnContext


class PydanticAiOrchestrator:
    """Builds and runs a one-step `pydantic_graph` graph per turn."""

    def __init__(self) -> None:
        self._interpreter = GraphInterpreter()
        builder: GraphBuilder[_TurnState, None, _TurnState, GraphRunResult] = GraphBuilder(
            state_type=_TurnState, output_type=GraphRunResult
        )

        @builder.step
        async def run_graph(ctx: GraphRunContext[_TurnState]) -> GraphRunResult:
            state = ctx.state
            return await self._interpreter.run(state.graph, state.ctx)

        builder.add_edge(builder.start_node, run_graph)
        builder.add_edge(run_graph, builder.end_node)
        self._graph = builder.build()

    async def run_turn(self, graph: GraphDefinition, ctx: TurnContext) -> GraphRunResult:
        """Runs one turn through the compiled graph.

        @raises avatar_agent.orchestration.failover.LlmUnavailableError:
            when an `llm`-type node's primary and fallback legs are both
            exhausted (propagated from the step, unchanged from pre-Phase-9
            behavior).
        """
        state = _TurnState(graph=graph, ctx=ctx)
        return await self._graph.run(state=state)
