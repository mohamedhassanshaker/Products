"""The `ConfigReader` port — every piece of configuration `ProcessTurn` resolves
before or during a turn, read-only.

One combined Protocol rather than one per table, matching B-4's
`KnowledgeSqlReader` precedent (`ports/knowledge_sql.py`): the turn pipeline reads
a fixed, small set of tenant-scoped configuration tables every turn, and a single
adapter opening one `tenant_session()` per call is the natural shape, not five
adapters each opening their own.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True, slots=True)
class AgentVersionConfig:
    agent_version_id: str
    agent_id: str
    status: str
    system_prompt: str
    tone: str
    primary_model: str
    fallback_model: str | None
    temperature: float
    max_output_tokens: int


@dataclass(frozen=True, slots=True)
class RouterConfigRow:
    execution_mode: str  # ExecutionMode value
    routing_strategy: str
    agent_selection_scope: str
    agent_scope_list: tuple[str, ...]
    max_hops: int
    max_loop_iterations: int
    cost_ceiling_tokens: int
    cost_ceiling_micro_aed: int
    conflict_resolution: str
    response_merge_policy: str
    fallback_agent_id: str | None
    min_routing_confidence: float
    #: The tenant's live pipeline, if activated (`RouterConfigs.
    #: activePipelineVersionId`). `None` for every tenant that hasn't — the
    #: overwhelming majority today — in which case `ProcessTurn` runs the
    #: legacy flat dispatcher exactly as before this field existed.
    active_pipeline_version_id: str | None = None


@dataclass(frozen=True, slots=True)
class ToolBindingRow:
    tool_binding_id: str
    target_kind: str  # "Skill" | "McpTool" | "ApiConnector"
    is_enabled: bool
    required_assurance: str
    skill_key: str | None
    skill_name: str | None
    skill_input_schema_json: str | None
    skill_invocation_kind: str | None
    api_connector_id: str | None
    circuit_breaker_target_kind: str | None
    circuit_breaker_target_ref: str | None


@dataclass(frozen=True, slots=True)
class PolicyRow:
    policy_key: str
    kind: str  # "Boolean" | "Threshold" | "Enum"
    default_value_json: str
    floor_value_json: str | None
    is_locked: bool


@dataclass(frozen=True, slots=True)
class PolicyOverrideRow:
    policy_key: str
    mode: str  # "Value" | "Disabled"
    value_json: str | None
    reason: str


@dataclass(frozen=True, slots=True)
class CircuitBreakerConfigRow:
    id: str
    target_kind: str
    target_ref: str  # targetId or targetKey, whichever is set
    failure_threshold: int
    window_seconds: int
    cooldown_seconds: int
    fallback_strategy: str
    degraded_mode_message: str
    is_enabled: bool


@dataclass(frozen=True, slots=True)
class CandidateAgent:
    """A routable agent — enough for `domain.orchestration.route()`'s scoring
    and for a secondary invocation's own `AgentVersionConfig`-shaped fields."""

    agent_id: str
    agent_version_id: str
    name: str
    system_prompt: str
    primary_model: str
    fallback_model: str | None
    temperature: float
    max_output_tokens: int


@dataclass(frozen=True, slots=True)
class PriorTurnRow:
    role: str
    content_masked: str
    ordinal: int


class ConfigReader(Protocol):
    async def get_current_agent_version(self, agent_id: str) -> AgentVersionConfig | None: ...

    async def get_agent_version_by_id(self, agent_version_id: str) -> AgentVersionConfig | None:
        """Resolves a SPECIFIC version — including a Draft one — unlike
        `get_current_agent_version`, which only ever resolves
        `Agent.current_version_id`. Needed so a golden-set regression run
        (B-9) can score a version under test before it is published."""

    async def list_published_agents(
        self, exclude_agent_id: str | None = None
    ) -> list[CandidateAgent]:
        """`RouterConfig.agent_selection_scope == "AllPublished"`'s own read —
        every other `Published` agent's current version, for the modes that
        invoke more than one agent per turn (Parallel, SupervisorWorker)."""

    async def get_router_config(self) -> RouterConfigRow:
        """Always returns a row — `CK_RouterConfigs_singleton` guarantees at most
        one, and the adapter returns a hardcoded platform-safe default (never a
        raise) when the tenant has never had one seeded, so a fresh tenant with
        no `/orchestration` configuration screen visited yet still gets a
        working, bounded pipeline rather than an unbounded one."""

    async def list_tool_bindings(self, agent_version_id: str) -> list[ToolBindingRow]: ...

    async def list_policies(self) -> list[PolicyRow]:
        """Platform-wide catalogue (`platform.Policies`), not tenant-scoped."""

    async def list_policy_overrides(self, agent_id: str) -> list[PolicyOverrideRow]: ...

    async def get_circuit_breaker_config(
        self, target_kind: str, target_ref: str
    ) -> CircuitBreakerConfigRow | None: ...

    async def get_prior_turns(self, conversation_id: str, limit: int) -> list[PriorTurnRow]: ...
