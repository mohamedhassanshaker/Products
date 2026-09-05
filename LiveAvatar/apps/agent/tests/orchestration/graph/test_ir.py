"""Proves `orchestration.graph.ir`'s re-exports resolve to the exact same
objects as their source modules (Phase 9, BL-036) — `ir.py` is a pure
re-export hub (see its own docstring for why `GraphNode`/`ReasoningBlock`
come from `contracts` while everything else comes from `ports.orchestration`),
so its only real failure mode is a broken/renamed import.
"""

from __future__ import annotations

from avatar_agent.contracts.runtime_config import GraphNode as ContractsGraphNode
from avatar_agent.contracts.runtime_config import ReasoningBlock as ContractsReasoningBlock
from avatar_agent.orchestration.graph import ir
from avatar_agent.ports.orchestration import (
    GraphDefinition,
    GraphRunResult,
    IHopRecorder,
    NodeResult,
    NodeStatus,
    ResolvedLlmNode,
    TurnContext,
)


def test_graph_node_and_reasoning_block_come_from_contracts() -> None:
    assert ir.GraphNode is ContractsGraphNode
    assert ir.ReasoningBlock is ContractsReasoningBlock


def test_the_runtime_only_types_come_from_ports_orchestration() -> None:
    assert ir.GraphDefinition is GraphDefinition
    assert ir.ResolvedLlmNode is ResolvedLlmNode
    assert ir.NodeStatus is NodeStatus
    assert ir.NodeResult is NodeResult
    assert ir.TurnContext is TurnContext
    assert ir.GraphRunResult is GraphRunResult
    assert ir.IHopRecorder is IHopRecorder


def test_graph_definition_is_the_reasoning_block_alias() -> None:
    """`GraphDefinition` *is* `ReasoningBlock` (ports/orchestration.py's own
    docstring) — both names resolve to one identical object.
    """
    assert ir.GraphDefinition is ir.ReasoningBlock


def test_all_lists_exactly_the_re_exported_names() -> None:
    assert set(ir.__all__) == {
        "GraphNode",
        "ReasoningBlock",
        "GraphDefinition",
        "ResolvedLlmNode",
        "NodeStatus",
        "NodeResult",
        "TurnContext",
        "GraphRunResult",
        "IHopRecorder",
    }
