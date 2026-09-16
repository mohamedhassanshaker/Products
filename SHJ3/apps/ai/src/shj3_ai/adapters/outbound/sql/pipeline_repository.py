"""The real `PipelineReader` — one `tenant_session()`, three selects, projected into a
`domain.pipeline.PipelineDefinition`. Node/edge SQL ids are resolved to `key` HERE, at read
time — nothing downstream (the interpreter, the condition evaluator) ever sees a SQL id,
the same convention `FlowReader`'s own adapter already establishes for `FlowNode`/
`FlowEdge`."""

from __future__ import annotations

from collections import defaultdict

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from shj3_ai.adapters.outbound.sql._generated_models import (
    PipelineEdge as PipelineEdgeRow,
)
from shj3_ai.adapters.outbound.sql._generated_models import (
    PipelineNode as PipelineNodeRow,
)
from shj3_ai.adapters.outbound.sql._generated_models import (
    PipelineVersion as PipelineVersionRow,
)
from shj3_ai.adapters.outbound.sql._generated_models import RouterConfig
from shj3_ai.adapters.outbound.sql.engine import tenant_session
from shj3_ai.domain.orchestration import ConflictResolution, MergePolicy
from shj3_ai.domain.pipeline import (
    InputContextMode,
    NodeErrorPolicy,
    PipelineDefinition,
    PipelineEdgeDef,
    PipelineEdgeKind,
    PipelineNodeDef,
    PipelineNodeKind,
)
from shj3_ai.domain.tenancy import TenantSlug


class SqlAlchemyPipelineReader:
    __slots__ = ("_tenant",)

    def __init__(self, tenant: TenantSlug) -> None:
        self._tenant = tenant

    async def get_active_pipeline_version(self) -> PipelineDefinition | None:
        async with tenant_session(self._tenant.value) as session:
            router_result = await session.execute(
                select(RouterConfig.active_pipeline_version_id).where(
                    RouterConfig.singleton_key == 1
                )
            )
            active_id = router_result.scalar_one_or_none()
            if active_id is None:
                return None
            return await self._load(session, active_id)

    async def get_pipeline_version_by_id(
        self, pipeline_version_id: str
    ) -> PipelineDefinition | None:
        async with tenant_session(self._tenant.value) as session:
            return await self._load(session, pipeline_version_id)

    async def _load(
        self, session: AsyncSession, pipeline_version_id: str
    ) -> PipelineDefinition | None:
        version_result = await session.execute(
            select(PipelineVersionRow).where(PipelineVersionRow.id == pipeline_version_id)
        )
        version = version_result.scalar_one_or_none()
        if version is None or version.entry_node_id is None:
            return None

        nodes_result = await session.execute(
            select(PipelineNodeRow).where(
                PipelineNodeRow.pipeline_version_id == pipeline_version_id
            )
        )
        node_rows = nodes_result.scalars().all()
        node_by_id = {n.id: n for n in node_rows}
        entry_node = node_by_id.get(version.entry_node_id)
        if entry_node is None:
            return None

        edges_result = await session.execute(
            select(PipelineEdgeRow).where(
                PipelineEdgeRow.pipeline_version_id == pipeline_version_id
            )
        )
        edge_rows = edges_result.scalars().all()

        nodes: dict[str, PipelineNodeDef] = {}
        for n in node_rows:
            nodes[n.key] = PipelineNodeDef(
                key=n.key,
                kind=PipelineNodeKind(n.kind),
                title=n.title,
                agent_id=n.agent_id,
                uses_turn_bound_agent=n.uses_turn_bound_agent,
                agent_version_pin_id=n.agent_version_pin_id,
                input_context_mode=InputContextMode(n.input_context_mode),
                merge_policy_override=MergePolicy(n.merge_policy_override)
                if n.merge_policy_override is not None
                else None,
                conflict_resolution_override=ConflictResolution(n.conflict_resolution_override)
                if n.conflict_resolution_override is not None
                else None,
                is_owning_entity=n.is_owning_entity,
                cost_ceiling_tokens_override=n.cost_ceiling_tokens_override,
                cost_ceiling_micro_aed_override=n.cost_ceiling_micro_aed_override,
                timeout_ms_override=n.timeout_ms_override,
                on_error_policy=NodeErrorPolicy(n.on_error_policy),
            )

        edges_from: dict[str, list[PipelineEdgeDef]] = defaultdict(list)
        edges_into: dict[str, list[PipelineEdgeDef]] = defaultdict(list)
        for e in edge_rows:
            from_key = node_by_id[e.from_node_id].key
            to_key = node_by_id[e.to_node_id].key
            edge_def = PipelineEdgeDef(
                from_node_key=from_key,
                to_node_key=to_key,
                kind=PipelineEdgeKind(e.kind),
                ordinal=e.ordinal,
                label=e.label,
                max_iterations=e.max_iterations,
                condition_expression=e.condition_expression,
            )
            edges_from[from_key].append(edge_def)
            edges_into[to_key].append(edge_def)
        for bucket in (edges_from, edges_into):
            for lst in bucket.values():
                lst.sort(key=lambda edge: edge.ordinal)

        return PipelineDefinition(
            pipeline_version_id=version.id,
            pipeline_design_id=version.pipeline_design_id,
            label=f"v{version.major}.{version.minor}",
            entry_node_key=entry_node.key,
            max_total_hops=version.max_total_hops,
            cost_ceiling_tokens=version.cost_ceiling_tokens,
            cost_ceiling_micro_aed=version.cost_ceiling_micro_aed,
            default_merge_policy=MergePolicy(version.default_merge_policy),
            default_conflict_resolution=ConflictResolution(version.default_conflict_resolution),
            routing_strategy=version.routing_strategy,
            min_routing_confidence=float(version.min_routing_confidence),
            fallback_agent_id=version.fallback_agent_id,
            nodes=nodes,
            edges_from={k: tuple(v) for k, v in edges_from.items()},
            edges_into={k: tuple(v) for k, v in edges_into.items()},
        )
