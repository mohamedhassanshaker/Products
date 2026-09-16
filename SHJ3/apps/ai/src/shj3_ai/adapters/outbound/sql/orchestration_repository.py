"""The real `ConfigReader`, `OrchestrationStore` and `IdentityReader` (B-8) —
SQL Server, via the same `tenant_session()`/`schema_translate_map` mechanism
`SqlAlchemyKnowledgeReader` established in B-4. One class implements all three
ports (structurally, not by inheritance — this codebase's established
convention) since every method opens its own short-lived session and none of
the three needs another's state. `get_assurance` (`IdentityReader`) is a plain
SELECT against `CitizenIdentities`, granted the same way every other read here
is — `shj3_ai_ro`'s grant is schema-wide SELECT (`prisma/sql/002_tenant_
grants.sql`), so no new grant was needed to add it.

Write scope is exactly `prisma/sql/002_tenant_grants.sql`'s `shj3_ai_ro` grant:
`ConversationTurns`, `OrchestrationTraces`, `OrchestrationTraceSteps`,
`GroundingCitations`. Every other method here is SELECT-only, including the
platform-schema `Policies` read (`Policy.__table_args__` fixes its schema to
`"platform"` regardless of this session's tenant remap, so no special handling
is needed to reach it from a tenant-bound session).
"""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from shj3_ai.adapters.outbound.sql._generated_models import (
    Agent,
    AgentVersion,
    ApiConnector,
    CircuitBreakerConfig,
    CitizenIdentity,
    Conversation,
    ConversationTurn,
    GroundingCitation,
    McpTool,
    OrchestrationTrace,
    OrchestrationTraceStep,
    Policy,
    PolicyOverride,
    RouterConfig,
    Skill,
    ToolBinding,
)
from shj3_ai.adapters.outbound.sql._generated_models import (
    PipelineEdge as PipelineEdgeRow,
)
from shj3_ai.adapters.outbound.sql._generated_models import (
    PipelineNode as PipelineNodeRow,
)
from shj3_ai.adapters.outbound.sql.engine import tenant_session
from shj3_ai.domain.identity import CitizenAssurance
from shj3_ai.domain.ids import new_ulid
from shj3_ai.domain.tenancy import TenantSlug
from shj3_ai.ports.config_reader import (
    AgentVersionConfig,
    CandidateAgent,
    CircuitBreakerConfigRow,
    PolicyOverrideRow,
    PolicyRow,
    PriorTurnRow,
    RouterConfigRow,
    ToolBindingRow,
)
from shj3_ai.ports.orchestration_store import (
    CitationToPersist,
    ConversationRow,
    TraceToPersist,
    TurnToPersist,
)

# A fresh tenant that has never visited an orchestration-configuration screen
# (none exists yet — B4's own configuration UI is out of this wave's scope, see
# the review entry) still gets a bounded, working pipeline rather than an
# unbounded one. Matches `CK_RouterConfigs_maxHops`'s own permitted range and
# `CK_RouterConfigs_ceilings`'s "> 0" floor.
_DEFAULT_ROUTER_CONFIG = RouterConfigRow(
    execution_mode="Sequential",
    routing_strategy="IntentClassifier",
    agent_selection_scope="AllPublished",
    agent_scope_list=(),
    max_hops=6,
    max_loop_iterations=3,
    cost_ceiling_tokens=8000,
    cost_ceiling_micro_aed=350_000,
    conflict_resolution="HighestConfidence",
    response_merge_policy="DeduplicateOverlap",
    fallback_agent_id=None,
    min_routing_confidence=0.55,
)


class SqlAlchemyOrchestrationRepository:
    """Structural `ConfigReader` + `OrchestrationStore` + `IdentityReader` (B-8)."""

    __slots__ = ("_tenant",)

    def __init__(self, tenant: TenantSlug) -> None:
        self._tenant = tenant

    # -- ConfigReader ---------------------------------------------------

    async def get_current_agent_version(self, agent_id: str) -> AgentVersionConfig | None:
        async with tenant_session(self._tenant.value) as session:
            result = await session.execute(
                select(Agent, AgentVersion)
                .join(AgentVersion, AgentVersion.id == Agent.current_version_id)
                .where(Agent.id == agent_id, Agent.deleted_at.is_(None))
            )
            row = result.first()
            if row is None:
                return None
            agent, version = row
            return AgentVersionConfig(
                agent_version_id=version.id,
                agent_id=agent.id,
                status=version.status,
                system_prompt=version.system_prompt,
                tone=version.tone,
                primary_model=version.primary_model,
                fallback_model=version.fallback_model,
                temperature=float(version.temperature),
                max_output_tokens=version.max_output_tokens,
            )

    async def get_agent_version_by_id(self, agent_version_id: str) -> AgentVersionConfig | None:
        """B-9: mirrors `get_current_agent_version` above, but starts from the
        version rather than the agent's own `currentVersionId` pointer — the
        join direction is reversed (`AgentVersion.agentId == Agent.id`, not
        `AgentVersion.id == Agent.currentVersionId`) so a Draft/Testing
        version under evaluation resolves here even though it is never
        `Agent.currentVersionId`. `Agent.deletedAt IS NULL` is kept alongside
        `AgentVersion.deletedAt IS NULL` (both, not just the version's own) —
        a soft-deleted agent's version should not become runnable again just
        because a regression run still names it by id."""
        async with tenant_session(self._tenant.value) as session:
            result = await session.execute(
                select(Agent, AgentVersion)
                .join(AgentVersion, AgentVersion.agent_id == Agent.id)
                .where(
                    AgentVersion.id == agent_version_id,
                    AgentVersion.deleted_at.is_(None),
                    Agent.deleted_at.is_(None),
                )
            )
            row = result.first()
            if row is None:
                return None
            agent, version = row
            return AgentVersionConfig(
                agent_version_id=version.id,
                agent_id=agent.id,
                status=version.status,
                system_prompt=version.system_prompt,
                tone=version.tone,
                primary_model=version.primary_model,
                fallback_model=version.fallback_model,
                temperature=float(version.temperature),
                max_output_tokens=version.max_output_tokens,
            )

    async def list_published_agents(
        self, exclude_agent_id: str | None = None
    ) -> list[CandidateAgent]:
        async with tenant_session(self._tenant.value) as session:
            query = (
                select(Agent, AgentVersion)
                .join(AgentVersion, AgentVersion.id == Agent.current_version_id)
                .where(Agent.status == "Published", Agent.deleted_at.is_(None))
            )
            if exclude_agent_id is not None:
                query = query.where(Agent.id != exclude_agent_id)
            result = await session.execute(query)
            return [
                CandidateAgent(
                    agent_id=agent.id,
                    agent_version_id=version.id,
                    name=agent.name,
                    system_prompt=version.system_prompt,
                    primary_model=version.primary_model,
                    fallback_model=version.fallback_model,
                    temperature=float(version.temperature),
                    max_output_tokens=version.max_output_tokens,
                )
                for agent, version in result.all()
            ]

    async def get_router_config(self) -> RouterConfigRow:
        async with tenant_session(self._tenant.value) as session:
            result = await session.execute(
                select(RouterConfig).where(RouterConfig.singleton_key == 1)
            )
            row = result.scalar_one_or_none()
            if row is None:
                return _DEFAULT_ROUTER_CONFIG
            scope_list: tuple[str, ...] = ()
            if row.agent_scope_list_json:
                import json

                scope_list = tuple(json.loads(row.agent_scope_list_json))
            return RouterConfigRow(
                execution_mode=row.execution_mode,
                routing_strategy=row.routing_strategy,
                agent_selection_scope=row.agent_selection_scope,
                agent_scope_list=scope_list,
                max_hops=row.max_hops,
                max_loop_iterations=row.max_loop_iterations,
                cost_ceiling_tokens=row.cost_ceiling_tokens,
                cost_ceiling_micro_aed=row.cost_ceiling_micro_aed,
                conflict_resolution=row.conflict_resolution,
                response_merge_policy=row.response_merge_policy,
                fallback_agent_id=row.fallback_agent_id,
                min_routing_confidence=float(row.min_routing_confidence),
                active_pipeline_version_id=row.active_pipeline_version_id,
            )

    async def list_tool_bindings(self, agent_version_id: str) -> list[ToolBindingRow]:
        async with tenant_session(self._tenant.value) as session:
            result = await session.execute(
                select(ToolBinding, Skill, ApiConnector, McpTool)
                .outerjoin(Skill, Skill.id == ToolBinding.skill_id)
                .outerjoin(ApiConnector, ApiConnector.id == ToolBinding.api_connector_id)
                .outerjoin(McpTool, McpTool.id == ToolBinding.mcp_tool_id)
                .where(ToolBinding.agent_version_id == agent_version_id)
            )
            rows: list[ToolBindingRow] = []
            for binding, skill, api_connector, mcp_tool in result.all():
                cb_kind: str | None = None
                cb_ref: str | None = None
                if skill is not None:
                    if skill.invocation_kind == "ApiConnector" and api_connector is not None:
                        cb_kind, cb_ref = "ApiConnector", api_connector.id
                    elif skill.invocation_kind == "McpTool" and mcp_tool is not None:
                        cb_kind, cb_ref = "McpServer", mcp_tool.mcp_server_id
                    else:
                        cb_kind, cb_ref = "Internal", skill.key
                rows.append(
                    ToolBindingRow(
                        tool_binding_id=binding.id,
                        target_kind=binding.target_kind,
                        is_enabled=binding.is_enabled,
                        required_assurance=binding.required_assurance,
                        skill_key=skill.key if skill else None,
                        skill_name=skill.name if skill else None,
                        skill_input_schema_json=skill.input_schema_json if skill else None,
                        skill_invocation_kind=skill.invocation_kind if skill else None,
                        api_connector_id=binding.api_connector_id,
                        circuit_breaker_target_kind=cb_kind,
                        circuit_breaker_target_ref=cb_ref,
                    )
                )
            return rows

    async def list_policies(self) -> list[PolicyRow]:
        async with tenant_session(self._tenant.value) as session:
            result = await session.execute(select(Policy))
            return [
                PolicyRow(
                    policy_key=p.policy_key,
                    kind=p.kind,
                    default_value_json=p.default_value_json,
                    floor_value_json=p.floor_value_json,
                    is_locked=p.is_locked,
                )
                for p in result.scalars()
            ]

    async def list_policy_overrides(self, agent_id: str) -> list[PolicyOverrideRow]:
        async with tenant_session(self._tenant.value) as session:
            result = await session.execute(
                select(PolicyOverride).where(
                    PolicyOverride.agent_id == agent_id, PolicyOverride.removed_at.is_(None)
                )
            )
            return [
                PolicyOverrideRow(
                    policy_key=o.policy_key, mode=o.mode, value_json=o.value_json, reason=o.reason
                )
                for o in result.scalars()
            ]

    async def get_circuit_breaker_config(
        self, target_kind: str, target_ref: str
    ) -> CircuitBreakerConfigRow | None:
        async with tenant_session(self._tenant.value) as session:
            result = await session.execute(
                select(CircuitBreakerConfig).where(
                    CircuitBreakerConfig.target_kind == target_kind,
                    (CircuitBreakerConfig.target_id == target_ref)
                    | (CircuitBreakerConfig.target_key == target_ref),
                )
            )
            row = result.scalar_one_or_none()
            if row is None:
                return None
            return CircuitBreakerConfigRow(
                id=row.id,
                target_kind=row.target_kind,
                target_ref=target_ref,
                failure_threshold=row.failure_threshold,
                window_seconds=row.window_seconds,
                cooldown_seconds=row.cooldown_seconds,
                fallback_strategy=row.fallback_strategy,
                degraded_mode_message=row.degraded_mode_message,
                is_enabled=row.is_enabled,
            )

    async def get_prior_turns(self, conversation_id: str, limit: int) -> list[PriorTurnRow]:
        async with tenant_session(self._tenant.value) as session:
            result = await session.execute(
                select(ConversationTurn)
                .where(ConversationTurn.conversation_id == conversation_id)
                .order_by(ConversationTurn.ordinal.desc())
                .limit(limit)
            )
            rows = list(result.scalars())
            rows.reverse()
            return [
                PriorTurnRow(role=r.role, content_masked=r.content_masked, ordinal=r.ordinal)
                for r in rows
            ]

    # -- OrchestrationStore -----------------------------------------------

    async def get_conversation(self, conversation_id: str) -> ConversationRow | None:
        async with tenant_session(self._tenant.value) as session:
            result = await session.execute(
                select(Conversation).where(Conversation.id == conversation_id)
            )
            row = result.scalar_one_or_none()
            if row is None:
                return None
            return ConversationRow(
                id=row.id,
                channel_key=row.channel_key,
                locale_code=row.locale_code,
                primary_agent_id=row.primary_agent_id,
                citizen_identity_id=row.citizen_identity_id,
            )

    # -- IdentityReader (B-8) -----------------------------------------------

    async def get_assurance(self, citizen_identity_id: str) -> CitizenAssurance | None:
        """`CitizenIdentities.assuranceLevel`/`verificationExpiresAt`, read fresh
        every call — never cached, since a step-up completed via `shj3-web`
        mid-conversation must be visible to the very next turn's gate."""
        async with tenant_session(self._tenant.value) as session:
            result = await session.execute(
                select(CitizenIdentity).where(CitizenIdentity.id == citizen_identity_id)
            )
            row = result.scalar_one_or_none()
            if row is None or row.erased_at is not None:
                return None
            return CitizenAssurance(
                level=row.assurance_level,
                verification_expires_at=row.verification_expires_at,
            )

    async def persist_turn(self, turn: TurnToPersist) -> None:
        now = datetime.now(UTC).replace(tzinfo=None)
        async with tenant_session(self._tenant.value) as session:
            session.add(
                ConversationTurn(
                    id=turn.id,
                    conversation_id=turn.conversation_id,
                    ordinal=turn.ordinal,
                    role=turn.role,
                    content_masked=turn.content_masked,
                    content_format=turn.content_format,
                    agent_version_id=turn.agent_version_id,
                    locale_code=turn.locale_code,
                    input_tokens=turn.input_tokens,
                    output_tokens=turn.output_tokens,
                    latency_ms=turn.latency_ms,
                    was_refused=turn.was_refused,
                    refusal_reason=turn.refusal_reason,
                    created_at=now,
                    updated_at=now,
                )
            )
            await session.commit()

    async def persist_trace(self, trace: TraceToPersist) -> None:
        now = datetime.now(UTC).replace(tzinfo=None)
        async with tenant_session(self._tenant.value) as session:
            node_id_by_key: dict[str, str] = {}
            edge_id_by_from_key_and_kind: dict[tuple[str, str], str] = {}
            if trace.pipeline_version_id is not None:
                node_id_by_key, edge_id_by_from_key_and_kind = await self._pipeline_key_maps(
                    session, trace.pipeline_version_id
                )

            session.add(
                OrchestrationTrace(
                    id=trace.id,
                    conversation_id=trace.conversation_id,
                    turn_id=trace.turn_id,
                    execution_mode=trace.execution_mode,
                    routed_agent_id=trace.routed_agent_id,
                    routed_agent_version_id=trace.routed_agent_version_id,
                    routing_confidence=trace.routing_confidence,
                    hop_count=trace.hop_count,
                    total_input_tokens=trace.total_input_tokens,
                    total_output_tokens=trace.total_output_tokens,
                    total_cost_micro_aed=trace.total_cost_micro_aed,
                    pending_slot_name=trace.pending_slot_name,
                    escape_triggered=trace.escape_triggered,
                    merge_policy_applied=trace.merge_policy_applied,
                    guardrail_pre_result=trace.guardrail_pre_result,
                    guardrail_post_result=trace.guardrail_post_result,
                    grounding_confidence=trace.grounding_confidence,
                    started_at=now,
                    duration_ms=trace.duration_ms,
                    created_at=now,
                    updated_at=now,
                    pipeline_version_id=trace.pipeline_version_id,
                    pipeline_design_id=trace.pipeline_design_id,
                    pipeline_label=trace.pipeline_label,
                    terminal_node_key=trace.terminal_node_key,
                    branch_count=trace.branch_count,
                    loop_iterations_total=trace.loop_iterations_total,
                )
            )
            for step in trace.steps:
                session.add(
                    OrchestrationTraceStep(
                        id=new_ulid(),
                        trace_id=trace.id,
                        ordinal=step.ordinal,
                        kind=step.kind.value,
                        agent_id=step.agent_id,
                        tool_binding_id=step.tool_binding_id,
                        label=step.label,
                        arguments_masked=step.arguments_masked,
                        result_summary=step.result_summary,
                        confidence=step.confidence,
                        status=step.status.value,
                        error_code=step.error_code,
                        is_secondary_agent=step.is_secondary_agent,
                        duration_ms=step.duration_ms,
                        started_at=now,
                        created_at=now,
                        updated_at=now,
                        pipeline_node_id=node_id_by_key.get(step.pipeline_node_key)
                        if step.pipeline_node_key
                        else None,
                        pipeline_node_key=step.pipeline_node_key,
                        pipeline_edge_id=edge_id_by_from_key_and_kind.get(
                            (step.from_node_key, step.edge_kind)
                        )
                        if step.from_node_key and step.edge_kind
                        else None,
                        from_node_key=step.from_node_key,
                        edge_kind=step.edge_kind,
                        branch_id=step.branch_id,
                        loop_iteration=step.loop_iteration,
                        depth=step.depth,
                    )
                )
            await session.commit()

    async def _pipeline_key_maps(
        self, session: AsyncSession, pipeline_version_id: str
    ) -> tuple[dict[str, str], dict[tuple[str, str], str]]:
        """Real node/edge SQL ids, resolved once per persisted trace from the stable keys
        `execute_pipeline.py`'s interpreter carries — nothing upstream of this adapter ever
        sees a SQL id (`domain/pipeline.py`'s own key-not-id convention). An edge is
        resolved by `(fromNodeKey, kind)`; a node with two same-kind outgoing edges (e.g.
        two distinct `LoopBack` edges) is a real but rare shape this best-effort map leaves
        unresolved (`None`) rather than guessing wrong — `fromNodeKey`/`edgeKind` themselves
        are always still written on the step regardless."""
        node_rows = (
            await session.execute(
                select(PipelineNodeRow).where(
                    PipelineNodeRow.pipeline_version_id == pipeline_version_id
                )
            )
        ).scalars().all()
        node_id_by_key = {n.key: n.id for n in node_rows}
        node_key_by_id = {n.id: n.key for n in node_rows}

        edge_rows = (
            await session.execute(
                select(PipelineEdgeRow).where(
                    PipelineEdgeRow.pipeline_version_id == pipeline_version_id
                )
            )
        ).scalars().all()
        edge_id_by_from_key_and_kind: dict[tuple[str, str], str] = {}
        seen_ambiguous: set[tuple[str, str]] = set()
        for edge in edge_rows:
            from_key = node_key_by_id.get(edge.from_node_id)
            if from_key is None:
                continue
            map_key = (from_key, edge.kind)
            if map_key in edge_id_by_from_key_and_kind:
                seen_ambiguous.add(map_key)
                continue
            edge_id_by_from_key_and_kind[map_key] = edge.id
        for ambiguous_key in seen_ambiguous:
            edge_id_by_from_key_and_kind.pop(ambiguous_key, None)

        return node_id_by_key, edge_id_by_from_key_and_kind

    async def persist_citations(self, citations: list[CitationToPersist]) -> None:
        if not citations:
            return
        now = datetime.now(UTC).replace(tzinfo=None)
        async with tenant_session(self._tenant.value) as session:
            for citation in citations:
                session.add(
                    GroundingCitation(
                        id=citation.id,
                        trace_id=citation.trace_id,
                        turn_id=citation.turn_id,
                        chunk_id=citation.chunk_id,
                        knowledge_source_id=citation.knowledge_source_id,
                        rank=citation.rank,
                        vector_score=citation.vector_score,
                        graph_score=citation.graph_score,
                        hybrid_score=citation.hybrid_score,
                        rerank_score=citation.rerank_score,
                        retrieved_via=citation.retrieved_via,
                        graph_path=citation.graph_path,
                        was_cited=citation.was_cited,
                        created_at=now,
                        updated_at=now,
                    )
                )
            await session.commit()
