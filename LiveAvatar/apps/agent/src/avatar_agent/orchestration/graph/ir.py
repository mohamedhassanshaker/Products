"""Graph interpreter IR (Phase 9, BL-036) — re-exports.

`GraphNode`/`GraphDefinition` (`ReasoningBlock`) are the Pydantic
discriminated union in `contracts/runtime_config.py` (the control plane's
wire shape, contract-tested against the TypeScript schema). `TurnContext`/
`NodeResult`/`NodeStatus`/`GraphRunResult`/`ResolvedLlmNode` are declared in
`ports/orchestration.py`, not here — `IOrchestrator.run_turn`'s signature
references them, and the `layers` import-linter contract places
`orchestration` above `ports`, so those types must live in the lower layer
(mirrors `ports/llm.py`'s `FailoverResult` precedent; see that module's and
`ports/orchestration.py`'s docstrings). This module exists purely so every
other file in `orchestration/graph/**` has one importable, orchestration-
local name for all of the above, without each of them needing to know which
half comes from `contracts` and which from `ports`.
"""

from __future__ import annotations

from avatar_agent.contracts.runtime_config import GraphNode, ReasoningBlock
from avatar_agent.ports.orchestration import (
    GraphDefinition,
    GraphRunResult,
    IHopRecorder,
    NodeResult,
    NodeStatus,
    ResolvedLlmNode,
    TurnContext,
)

__all__ = [
    "GraphNode",
    "ReasoningBlock",
    "GraphDefinition",
    "ResolvedLlmNode",
    "NodeStatus",
    "NodeResult",
    "TurnContext",
    "GraphRunResult",
    "IHopRecorder",
]
