"""`agent.runtime == "langgraph"` orchestration (FR-AGENT-1, FR-CONFIG-2).

A single-node compiled `StateGraph` wired around `GraphInterpreter.run`
(Phase 9, BL-036 — was `run_with_failover` before this phase). LangGraph
supplies the explicit node/edge control-flow structure the tenant selected;
the interpreter itself still only calls vendor models through an
`ILLMProvider` adapter (`registry`/`adapters`) — LangGraph never imports or
calls a vendor SDK (`.importlinter`'s `vendor-sdk-isolation` contract would
fail the build if it did).
"""

from __future__ import annotations

from typing import TypedDict

from langgraph.graph import END, START, StateGraph

from avatar_agent.orchestration.graph.interpreter import GraphInterpreter
from avatar_agent.orchestration.graph.ir import GraphDefinition, GraphRunResult, TurnContext


class _GraphState(TypedDict):
    graph: GraphDefinition
    ctx: TurnContext
    result: GraphRunResult | None


class LangGraphOrchestrator:
    """Compiled once per process; `run_turn` is called once per utterance."""

    def __init__(self) -> None:
        self._interpreter = GraphInterpreter()
        builder = StateGraph(_GraphState)
        builder.add_node("run_graph", self._run_graph_node)
        builder.add_edge(START, "run_graph")
        builder.add_edge("run_graph", END)
        self._compiled = builder.compile()

    async def _run_graph_node(self, state: _GraphState) -> _GraphState:
        """The graph's one node: runs the Phase 9 multi-node interpreter."""
        result = await self._interpreter.run(state["graph"], state["ctx"])
        return {**state, "result": result}

    async def run_turn(self, graph: GraphDefinition, ctx: TurnContext) -> GraphRunResult:
        """Runs one turn through the compiled graph.

        @raises avatar_agent.orchestration.failover.LlmUnavailableError:
            when an `llm`-type node's primary and fallback legs are both
            exhausted (propagated from the node, unchanged from pre-Phase-9
            behavior).
        """
        state: _GraphState = {"graph": graph, "ctx": ctx, "result": None}
        final_state = await self._compiled.ainvoke(state)
        result = final_state["result"]
        assert result is not None  # the single node always sets it or raises
        return result
