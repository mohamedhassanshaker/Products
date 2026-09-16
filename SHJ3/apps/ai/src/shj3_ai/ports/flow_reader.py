"""The `FlowReader` port — reads a flow's durable definition (`Flow`/`FlowVersion`/
`FlowNode`/`FlowEdge`), read-only. Projects straight into
`domain.flows.FlowDefinition`; no vendor shape leaks past this adapter.
"""

from __future__ import annotations

from typing import Protocol

from shj3_ai.domain.flows import FlowDefinition


class FlowReader(Protocol):
    async def get_current_flow_version(self, flow_id: str) -> FlowDefinition | None: ...

    async def get_flow_version_by_id(self, flow_version_id: str) -> FlowDefinition | None:
        """Resume a conversation's *own* flow version — deliberately not
        `get_current_flow_version`. A live `FlowState.flow_version_id` names
        the exact version the conversation started on; re-resolving via
        "current" would silently jump a mid-flow citizen onto a newer,
        differently-shaped version the moment someone republishes the flow
        while the conversation is paused on a `Question` node. FR-FLOW-10's
        own versioning guarantee ("editing a published flow creates a new
        draft version rather than mutating the live definition") is exactly
        what makes this distinction meaningful instead of academic."""

    async def get_flow_version_for_agent(self, agent_version_id: str) -> FlowDefinition | None:
        """The one flow bound to this agent version via `AgentFlowBinding` that is
        eligible to run (published, per FR-AGENT-14's warning-not-block on a
        Draft binding — the warning is a publish-time concern, not this read)."""
