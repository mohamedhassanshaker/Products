"""The real `FlowReader` — SQL Server, read-only, projecting `Flow`/`FlowVersion`/
`FlowNode`/`FlowEdge` rows straight into `domain.flows.FlowDefinition`.
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from shj3_ai.adapters.outbound.sql._generated_models import (
    AgentFlowBinding,
    Flow,
    FlowEdge,
    FlowNode,
    FlowVersion,
)
from shj3_ai.adapters.outbound.sql.engine import tenant_session
from shj3_ai.domain.flows import FlowDefinition, FlowEdgeDef, FlowNodeDef, FlowNodeType
from shj3_ai.domain.tenancy import TenantSlug


class SqlAlchemyFlowReader:
    __slots__ = ("_tenant",)

    def __init__(self, tenant: TenantSlug) -> None:
        self._tenant = tenant

    async def get_current_flow_version(self, flow_id: str) -> FlowDefinition | None:
        async with tenant_session(self._tenant.value) as session:
            flow_result = await session.execute(select(Flow).where(Flow.id == flow_id))
            flow = flow_result.scalar_one_or_none()
            if flow is None or flow.current_version_id is None:
                return None
            return await self._load_version(session, flow.current_version_id)

    async def get_flow_version_by_id(self, flow_version_id: str) -> FlowDefinition | None:
        async with tenant_session(self._tenant.value) as session:
            return await self._load_version(session, flow_version_id)

    async def get_flow_version_for_agent(self, agent_version_id: str) -> FlowDefinition | None:
        async with tenant_session(self._tenant.value) as session:
            binding_result = await session.execute(
                select(AgentFlowBinding).where(
                    AgentFlowBinding.agent_version_id == agent_version_id
                )
            )
            binding = binding_result.scalars().first()
            if binding is None:
                return None
            # `== True`, not SQLAlchemy's usual `.is_(True)` — confirmed live
            # against a real SQL Server container that `.is_(True)` compiles
            # to `WHERE ... IS 1`, which T-SQL rejects outright ("Incorrect
            # syntax near '1'"): SQL Server's `IS`/`IS NOT` accept only the
            # `NULL` literal, unlike Postgres/SQLite, where `.is_(True)` is
            # the documented idiom. `.is_(None)` still generates the valid,
            # portable `IS NULL` everywhere, including here — this is
            # specifically a boolean-*literal* gotcha, not a reason to avoid
            # `.is_()` generally.
            version_result = await session.execute(
                select(FlowVersion).where(
                    FlowVersion.flow_id == binding.flow_id,
                    FlowVersion.is_current == True,  # noqa: E712
                )
            )
            version = version_result.scalar_one_or_none()
            if version is None:
                return None
            return await self._load_version(session, version.id)

    async def _load_version(
        self, session: AsyncSession, flow_version_id: str
    ) -> FlowDefinition | None:
        version_result = await session.execute(
            select(FlowVersion).where(FlowVersion.id == flow_version_id)
        )
        version = version_result.scalar_one_or_none()
        if version is None or version.entry_node_id is None:
            return None

        nodes_result = await session.execute(
            select(FlowNode).where(FlowNode.flow_version_id == flow_version_id)
        )
        node_rows = list(nodes_result.scalars())
        # Two passes: `onFailureNodeId` can reference a node defined later in
        # `node_rows` (or, in principle, iteration order is unspecified at
        # all) — `id_to_key` must be complete before any row resolves its own
        # fall-through target.
        id_to_key: dict[str, str] = {row.id: row.key for row in node_rows}
        nodes: dict[str, FlowNodeDef] = {}
        for row in node_rows:
            node_def = FlowNodeDef(
                id=row.id,
                key=row.key,
                type=FlowNodeType(row.type),
                slot_name=row.slot_name,
                retry_count=row.retry_count,
                on_failure_node_key=id_to_key.get(row.on_failure_node_id)
                if row.on_failure_node_id
                else None,
                required_assurance=row.required_assurance,
                tool_binding_id=row.tool_binding_id,
                handover_reason=row.handover_reason,
            )
            nodes[row.key] = node_def

        edges_result = await session.execute(
            select(FlowEdge).where(FlowEdge.flow_version_id == flow_version_id)
        )
        edges_from: dict[str, list[FlowEdgeDef]] = {}
        for edge_row in edges_result.scalars():
            from_key = id_to_key.get(edge_row.from_node_id)
            to_key = id_to_key.get(edge_row.to_node_id)
            if from_key is None or to_key is None:
                continue
            edges_from.setdefault(from_key, []).append(
                FlowEdgeDef(
                    from_node_key=from_key,
                    to_node_key=to_key,
                    ordinal=edge_row.ordinal,
                    condition_expression=edge_row.condition_expression,
                    is_default_branch=edge_row.is_default_branch,
                )
            )

        entry_key = id_to_key.get(version.entry_node_id)
        if entry_key is None:
            return None
        escape_key = id_to_key.get(version.escape_node_id) if version.escape_node_id else None

        return FlowDefinition(
            flow_version_id=version.id,
            entry_node_id=entry_key,
            escape_node_id=escape_key,
            free_text_escape_enabled=version.free_text_escape_enabled,
            nodes=nodes,
            edges_from={k: tuple(v) for k, v in edges_from.items()},
        )
