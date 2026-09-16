"""In-memory fakes for B-5's application-layer tests — one fake per port,
mirroring `tests/application/fakes.py`'s (B-4) exact convention: constructor
records state, methods that can degrade take a `fail_with`/`fail_models`
switch, everything written is recorded on a plain list/dict for assertion.
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from dataclasses import dataclass, field

from shj3_ai.domain.flows import FlowDefinition, FlowState
from shj3_ai.domain.identity import CitizenAssurance
from shj3_ai.domain.pipeline import PipelineDefinition
from shj3_ai.ports.chat_model import (
    ChatModelUnavailableError,
    ChatRequest,
    ChatResponse,
    ChatStreamChunk,
    ToolCallRequest,
)
from shj3_ai.ports.circuit_breaker import BreakerLiveState
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
from shj3_ai.ports.tool_invoker import ToolInvocationOutcome, ToolInvocationResult


def default_router_config(**overrides: object) -> RouterConfigRow:
    base: dict[str, object] = {
        "execution_mode": "Sequential",
        "routing_strategy": "IntentClassifier",
        "agent_selection_scope": "AllPublished",
        "agent_scope_list": (),
        "max_hops": 6,
        "max_loop_iterations": 3,
        "cost_ceiling_tokens": 8000,
        "cost_ceiling_micro_aed": 350_000,
        "conflict_resolution": "HighestConfidence",
        "response_merge_policy": "DeduplicateOverlap",
        "fallback_agent_id": None,
        "min_routing_confidence": 0.3,
    }
    base.update(overrides)
    return RouterConfigRow(**base)  # type: ignore[arg-type]


def default_agent_version(**overrides: object) -> AgentVersionConfig:
    base: dict[str, object] = {
        "agent_version_id": "avr_primary",
        "agent_id": "agt_primary",
        "status": "Published",
        "system_prompt": "You are the SEWA billing agent. Handle bill status and payments.",
        "tone": "Helpful",
        "primary_model": "openrouter/test-primary",
        "fallback_model": "openrouter/test-fallback",
        "temperature": 0.3,
        "max_output_tokens": 500,
    }
    base.update(overrides)
    return AgentVersionConfig(**base)  # type: ignore[arg-type]


class FakeConfigReader:
    def __init__(
        self,
        *,
        agent_version: AgentVersionConfig | None = None,
        router_config: RouterConfigRow | None = None,
        tool_bindings: list[ToolBindingRow] | None = None,
        policies: list[PolicyRow] | None = None,
        policy_overrides: list[PolicyOverrideRow] | None = None,
        breaker_configs: dict[tuple[str, str], CircuitBreakerConfigRow] | None = None,
        candidate_agents: list[CandidateAgent] | None = None,
        prior_turns: list[PriorTurnRow] | None = None,
        additional_versions: dict[str, AgentVersionConfig] | None = None,
    ) -> None:
        self._agent_version = agent_version or default_agent_version()
        self._router_config = router_config or default_router_config()
        self._tool_bindings = tool_bindings or []
        self._policies = policies or []
        self._policy_overrides = policy_overrides or []
        self._breaker_configs = breaker_configs or {}
        self._candidate_agents = candidate_agents or []
        self._prior_turns = prior_turns or []
        # B-9: versions resolvable by id, for `get_agent_version_by_id`'s own
        # evaluation-version-pinning path — kept as a separate map (not
        # derived from `_agent_version` alone) so a test can seed a genuinely
        # different (e.g. Draft-status) version and prove the pin actually
        # reaches it, rather than the two config methods coincidentally
        # resolving to the same row.
        self._versions_by_id: dict[str, AgentVersionConfig] = {
            self._agent_version.agent_version_id: self._agent_version,
            **(additional_versions or {}),
        }

    async def get_current_agent_version(self, agent_id: str) -> AgentVersionConfig | None:
        if agent_id != self._agent_version.agent_id:
            for c in self._candidate_agents:
                if c.agent_id == agent_id:
                    return AgentVersionConfig(
                        agent_version_id=c.agent_version_id,
                        agent_id=c.agent_id,
                        status="Published",
                        system_prompt=c.system_prompt,
                        tone="Helpful",
                        primary_model=c.primary_model,
                        fallback_model=c.fallback_model,
                        temperature=c.temperature,
                        max_output_tokens=c.max_output_tokens,
                    )
            return None
        return self._agent_version

    async def get_agent_version_by_id(self, agent_version_id: str) -> AgentVersionConfig | None:
        return self._versions_by_id.get(agent_version_id)

    async def list_published_agents(
        self, exclude_agent_id: str | None = None
    ) -> list[CandidateAgent]:
        return [c for c in self._candidate_agents if c.agent_id != exclude_agent_id]

    async def get_router_config(self) -> RouterConfigRow:
        return self._router_config

    async def list_tool_bindings(self, agent_version_id: str) -> list[ToolBindingRow]:
        return list(self._tool_bindings)

    async def list_policies(self) -> list[PolicyRow]:
        return list(self._policies)

    async def list_policy_overrides(self, agent_id: str) -> list[PolicyOverrideRow]:
        return list(self._policy_overrides)

    async def get_circuit_breaker_config(
        self, target_kind: str, target_ref: str
    ) -> CircuitBreakerConfigRow | None:
        return self._breaker_configs.get((target_kind, target_ref))

    async def get_prior_turns(self, conversation_id: str, limit: int) -> list[PriorTurnRow]:
        return self._prior_turns[-limit:]


class FakeOrchestrationStore:
    def __init__(self, conversation: ConversationRow | None = None) -> None:
        self._conversation = conversation
        self.turns: list[TurnToPersist] = []
        self.traces: list[TraceToPersist] = []
        self.citations: list[CitationToPersist] = []

    async def get_conversation(self, conversation_id: str) -> ConversationRow | None:
        if self._conversation is not None and self._conversation.id == conversation_id:
            return self._conversation
        return None

    async def persist_turn(self, turn: TurnToPersist) -> None:
        self.turns.append(turn)

    async def persist_trace(self, trace: TraceToPersist) -> None:
        self.traces.append(trace)

    async def persist_citations(self, citations: list[CitationToPersist]) -> None:
        self.citations.extend(citations)


@dataclass
class FakeChatModel:
    """`fail_models`: model names that always raise `ChatModelUnavailableError` —
    the direct mechanism the fallback test uses to force the primary to fail."""

    fail_models: frozenset[str] = field(default_factory=frozenset)
    tool_trigger: dict[str, str] = field(default_factory=dict)
    """skill_name -> substring; if present in the last user message, the fake
    "decides" to call that tool, matching `DeterministicChatModel`'s own real
    heuristic shape but fully controllable per test."""
    calls: list[str] = field(default_factory=list)
    stream_calls: list[str] = field(default_factory=list)
    stream_chunks: list[str] | None = None
    """Word/segment texts `stream()` yields, in order, one per real
    `asyncio.sleep(stream_delay_seconds)`. `None` (the default) derives them
    from `complete()`'s own single-shot reply text, split on spaces — a test
    that doesn't care about the exact streamed text still gets *a* real,
    multi-chunk stream."""
    stream_delay_seconds: float = 0.05
    """B-6: a real, awaited delay between chunks — deliberately not 0, so a
    test asserting "these token events arrived measurably spaced apart in
    wall-clock time" (the proof that `ProcessTurn`'s forwarding is live, not
    buffered-then-flushed) has something real to measure."""

    async def complete(self, request: ChatRequest) -> ChatResponse:
        self.calls.append(request.model)
        if request.model in self.fail_models:
            raise ChatModelUnavailableError(request.model, "forced failure for test")
        last_user = next((m.content for m in reversed(request.messages) if m.role == "user"), "")
        for tool in request.tools:
            trigger = self.tool_trigger.get(tool.name)
            if trigger and trigger in last_user:
                return ChatResponse(
                    text="",
                    input_tokens=10,
                    output_tokens=2,
                    tool_call=ToolCallRequest(tool_name=tool.name, arguments_json="{}"),
                )
        return ChatResponse(
            text=f"[{request.model}] reply to: {last_user[:60]}", input_tokens=10, output_tokens=5
        )

    async def stream(self, request: ChatRequest) -> AsyncIterator[ChatStreamChunk]:
        """The streaming sibling of `complete()` above — same fail/tool-
        trigger switches, same default reply text, but delivered as several
        real, separately-awaited `ChatStreamChunk`s rather than one
        `ChatResponse`, exercising `InvokeWithFallbackStreaming`/
        `ProcessTurn`'s live-forwarding path in tests without a real
        provider."""
        self.stream_calls.append(request.model)
        if request.model in self.fail_models:
            raise ChatModelUnavailableError(request.model, "forced failure for test")
        last_user = next((m.content for m in reversed(request.messages) if m.role == "user"), "")
        for tool in request.tools:
            trigger = self.tool_trigger.get(tool.name)
            if trigger and trigger in last_user:
                yield ChatStreamChunk(
                    delta_text="",
                    is_final=True,
                    input_tokens=10,
                    output_tokens=2,
                    tool_call=ToolCallRequest(tool_name=tool.name, arguments_json="{}"),
                    finish_reason="tool_calls",
                )
                return

        words = (
            self.stream_chunks
            if self.stream_chunks is not None
            else f"[{request.model}] reply to: {last_user[:60]}".split(" ")
        )
        for index, word in enumerate(words):
            await asyncio.sleep(self.stream_delay_seconds)
            text = word if index == len(words) - 1 else word + " "
            yield ChatStreamChunk(delta_text=text)
        yield ChatStreamChunk(delta_text="", is_final=True, input_tokens=10, output_tokens=5)


class FakeIdentityReader:
    """B-8's `IdentityReader` port, faked — a plain dict of already-resolved
    `CitizenAssurance` rows keyed by `citizen_identity_id`, matching every
    other fake in this module's own "constructor records state" convention.
    Defaults to an empty map, i.e. every identity id resolves to `None`
    (`ProcessTurn._resolve_held_assurance` then reports `AssuranceLevel.L0`),
    which is the correct behaviour for every test in this module that does
    not itself exercise B-8's step-up gate."""

    def __init__(self, records: dict[str, CitizenAssurance] | None = None) -> None:
        self._records = records or {}

    async def get_assurance(self, citizen_identity_id: str) -> CitizenAssurance | None:
        return self._records.get(citizen_identity_id)


class FakeCircuitBreaker:
    def __init__(self, degraded: bool = False) -> None:
        self._states: dict[tuple[str, str], BreakerLiveState] = {}
        self._degraded = degraded
        self.failures_recorded: list[tuple[str, str]] = []
        self.tripped: list[tuple[str, str]] = []

    def set_state(self, target_kind: str, target_ref: str, state: BreakerLiveState) -> None:
        self._states[(target_kind, target_ref)] = state

    async def get_state(self, target_kind: str, target_ref: str) -> BreakerLiveState:
        return self._states.get((target_kind, target_ref), BreakerLiveState(state="Closed"))

    async def record_failure(
        self, target_kind: str, target_ref: str, window_seconds: int, failure_threshold: int
    ) -> bool:
        self.failures_recorded.append((target_kind, target_ref))
        count = sum(1 for f in self.failures_recorded if f == (target_kind, target_ref))
        return count >= failure_threshold

    async def trip(self, target_kind: str, target_ref: str, cooldown_seconds: int) -> None:
        self.tripped.append((target_kind, target_ref))
        self._states[(target_kind, target_ref)] = BreakerLiveState(state="Open")

    async def is_degraded(self) -> bool:
        return self._degraded


class FakeToolInvoker:
    def __init__(self, results: dict[str, ToolInvocationResult] | None = None) -> None:
        self._results = results or {}
        self.invocations: list[str] = []

    async def invoke(
        self,
        *,
        tool_binding_id: str,
        skill_key: str,
        invocation_kind: str,
        api_connector_id: str | None,
        arguments: dict[str, object],
        circuit_breaker_target_kind: str | None,
        circuit_breaker_target_ref: str | None,
    ) -> ToolInvocationResult:
        self.invocations.append(skill_key)
        if skill_key in self._results:
            return self._results[skill_key]
        return ToolInvocationResult(
            outcome=ToolInvocationOutcome.OK,
            result_json='{"ok": true}',
            error=None,
            duration_ms=5,
        )


class FakeFlowReader:
    def __init__(self, definitions: dict[str, FlowDefinition] | None = None) -> None:
        self._by_flow_id: dict[str, FlowDefinition] = {}
        self._by_agent_version: dict[str, FlowDefinition] = definitions or {}
        self._by_flow_version_id: dict[str, FlowDefinition] = {
            d.flow_version_id: d for d in (definitions or {}).values()
        }

    async def get_current_flow_version(self, flow_id: str) -> FlowDefinition | None:
        return self._by_flow_id.get(flow_id)

    async def get_flow_version_by_id(self, flow_version_id: str) -> FlowDefinition | None:
        return self._by_flow_version_id.get(flow_version_id)

    async def get_flow_version_for_agent(self, agent_version_id: str) -> FlowDefinition | None:
        return self._by_agent_version.get(agent_version_id)


class FakeFlowStateStore:
    def __init__(self) -> None:
        self._states: dict[str, FlowState] = {}

    async def get_state(self, conversation_id: str) -> FlowState | None:
        return self._states.get(conversation_id)

    async def set_state(self, conversation_id: str, state: FlowState) -> None:
        self._states[conversation_id] = state

    async def clear_state(self, conversation_id: str) -> None:
        self._states.pop(conversation_id, None)


class FakePipelineReader:
    """`PipelineReader`, faked — `active` is the version
    `RouterConfigRow.active_pipeline_version_id` would resolve to;
    `by_id` additionally serves `get_pipeline_version_by_id`'s
    authoring/preview lookup (Draft included), matching
    `FakeConfigReader._versions_by_id`'s own two-map shape."""

    def __init__(
        self,
        active: PipelineDefinition | None = None,
        by_id: dict[str, PipelineDefinition] | None = None,
    ) -> None:
        self._active = active
        self._by_id = by_id or ({active.pipeline_version_id: active} if active else {})

    async def get_active_pipeline_version(self) -> PipelineDefinition | None:
        return self._active

    async def get_pipeline_version_by_id(
        self, pipeline_version_id: str
    ) -> PipelineDefinition | None:
        return self._by_id.get(pipeline_version_id)
