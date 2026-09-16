"""`sandbox_router.py` — a real, mounted-router proof (`TestClient`, no
containers), matching `test_evaluation_router.py`'s own established pattern:
`sandbox_router`'s own per-request dependencies (`_config_reader`,
`_flow_reader`, `_flow_state_store`, `_circuit_breaker`) are replaced via
`app.dependency_overrides` with `tests/application/orchestration_fakes.py`'s
in-memory fakes — a `SqlAlchemyOrchestrationRepository`/`SqlAlchemyFlowReader`/
`RedisFlowStateStore`/`RedisCircuitBreaker` real construction is never
reached, so this suite never touches real SQL Server or Redis. The breaker
needs overriding too, confirmed live rather than assumed: `ProcessTurn.
execute()` calls `self._breaker.is_degraded()` unconditionally on every
turn's routing stage, not only when a tool call actually reaches
`SkillInvoker` — this test's flow has no `ToolCall` node at all, and a real
`RedisCircuitBreaker` would still be reached without this override.

The one flow under test is deliberately Draft-status and two nodes deep
(`start` -> `ask_name`, a `Question` node) so the two real properties this
feature's own brief calls out are both provable in one place: (1) the FIRST
turn resolves the Draft flow version by id (never the published-only default
resolution `get_flow_version_for_agent` would use), and (2) the SECOND turn
genuinely resumes the live flow position the first turn paused at — it
answers `ask_name`'s question and the flow completes, rather than restarting
at `start`.
"""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.testclient import TestClient

from shj3_ai.adapters.inbound import sandbox_router
from shj3_ai.domain.flows import FlowDefinition, FlowEdgeDef, FlowNodeDef, FlowNodeType
from tests.application.orchestration_fakes import (
    FakeCircuitBreaker,
    FakeConfigReader,
    FakeFlowReader,
    FakeFlowStateStore,
    default_agent_version,
    default_router_config,
)

TENANT_HEADERS = {"X-SHJ3-Tenant-Id": "sewa", "X-SHJ3-Principal-Id": "prn_designer_test"}
SANDBOX_SESSION_ID = "sandbox:01TESTSESSION0000000001"
AGENT_ID = "agt_sandbox_billing"
DRAFT_AGENT_VERSION_ID = "avr_sandbox_draft"
DRAFT_FLOW_VERSION_ID = "flwv_sandbox_draft"


def _draft_flow_definition() -> FlowDefinition:
    """A two-node Draft flow: `start` (Message) -> `ask_name` (Question,
    slot `name`) -> `end` (Message, no outgoing edge — the flow's terminal
    node). Simple enough that its own two real transitions are the whole
    proof this test needs."""
    nodes = {
        "start": FlowNodeDef(id="nd_start", key="start", type=FlowNodeType.MESSAGE),
        "ask_name": FlowNodeDef(
            id="nd_ask_name", key="ask_name", type=FlowNodeType.QUESTION, slot_name="name"
        ),
        "end": FlowNodeDef(id="nd_end", key="end", type=FlowNodeType.MESSAGE),
    }
    # Explicitly annotated: without it, mypy infers each literal tuple below
    # as the fixed-length `tuple[FlowEdgeDef]` rather than the variable-length
    # `tuple[FlowEdgeDef, ...]` `FlowDefinition.edges_from` actually declares,
    # and `dict`'s invariance then rejects the assignment.
    edges_from: dict[str, tuple[FlowEdgeDef, ...]] = {
        "start": (
            FlowEdgeDef(
                from_node_key="start",
                to_node_key="ask_name",
                ordinal=1,
                condition_expression=None,
                is_default_branch=True,
            ),
        ),
        "ask_name": (
            FlowEdgeDef(
                from_node_key="ask_name",
                to_node_key="end",
                ordinal=1,
                condition_expression=None,
                is_default_branch=True,
            ),
        ),
    }
    return FlowDefinition(
        flow_version_id=DRAFT_FLOW_VERSION_ID,
        entry_node_id="start",
        escape_node_id=None,
        free_text_escape_enabled=True,
        nodes=nodes,
        edges_from=edges_from,
    )


def _build_app() -> tuple[FastAPI, FakeFlowStateStore]:
    draft_version = default_agent_version(
        agent_id=AGENT_ID, agent_version_id=DRAFT_AGENT_VERSION_ID, status="Draft"
    )
    config = FakeConfigReader(
        agent_version=draft_version,
        router_config=default_router_config(execution_mode="Sequential"),
    )
    # Keyed by agent_version_id per `FakeFlowReader`'s own constructor shape
    # (used for `get_flow_version_for_agent`) — never actually exercised by
    # this test, since the router seeds `FlowState` directly by id before
    # `ProcessTurn` ever needs the by-agent-version lookup; kept as a real
    # key rather than a placeholder purely for readability.
    flow_reader = FakeFlowReader({DRAFT_AGENT_VERSION_ID: _draft_flow_definition()})
    flow_state_store = FakeFlowStateStore()
    breaker = FakeCircuitBreaker()

    app = FastAPI()
    app.include_router(sandbox_router.router)
    app.dependency_overrides[sandbox_router._config_reader] = lambda: config
    app.dependency_overrides[sandbox_router._flow_reader] = lambda: flow_reader
    app.dependency_overrides[sandbox_router._flow_state_store] = lambda: flow_state_store
    app.dependency_overrides[sandbox_router._circuit_breaker] = lambda: breaker
    return app, flow_state_store


def _turn_body(**overrides: object) -> dict[str, object]:
    base: dict[str, object] = {
        "sandboxSessionId": SANDBOX_SESSION_ID,
        "agentId": AGENT_ID,
        "agentVersionId": DRAFT_AGENT_VERSION_ID,
        "flowVersionId": DRAFT_FLOW_VERSION_ID,
        "turnId": "turn_1",
        "turnOrdinal": 0,
        "content": "Hello there",
        "locale": "en",
    }
    base.update(overrides)
    return base


class TestSandboxTurnsEndpoint:
    def test_first_turn_resolves_the_draft_flow_by_id_and_pauses_at_the_question_node(
        self,
    ) -> None:
        app, _flow_state_store = _build_app()

        with TestClient(app) as client:
            response = client.post(
                "/v1/sandbox/turns", headers=TENANT_HEADERS, json=_turn_body()
            )

        assert response.status_code == 200
        body = response.json()
        assert body["status"] == "completed"
        # The flow paused at the Draft flow's own `Question` node — proof the
        # Draft version (never published) was the one actually resolved and
        # executed.
        assert body["flowState"]["nodeKey"] == "ask_name"
        assert body["flowState"]["flowVersionId"] == DRAFT_FLOW_VERSION_ID

    async def test_second_turn_resumes_the_live_flow_position_instead_of_restarting(self) -> None:
        app, flow_state_store = _build_app()

        with TestClient(app) as client:
            first = client.post(
                "/v1/sandbox/turns",
                headers=TENANT_HEADERS,
                json=_turn_body(turnId="turn_1", turnOrdinal=0, content="Hello there"),
            )
            assert first.json()["flowState"]["nodeKey"] == "ask_name"

            second = client.post(
                "/v1/sandbox/turns",
                headers=TENANT_HEADERS,
                json=_turn_body(turnId="turn_2", turnOrdinal=1, content="Alice"),
            )

        assert second.status_code == 200
        second_body = second.json()
        # The flow advanced past `ask_name` into `end` and completed — not a
        # second `AWAITING_INPUT` at `start`, which is what an accidental
        # restart-from-entry bug would produce instead.
        assert second_body["status"] == "completed"
        assert second_body["flowState"] is None
        # The live position is gone from the store too — `ProcessTurn` clears
        # it once the flow itself reaches `COMPLETED`.
        assert await flow_state_store.get_state(SANDBOX_SESSION_ID) is None

    def test_unresolvable_draft_flow_version_returns_a_real_404(self) -> None:
        app, _flow_state_store = _build_app()

        with TestClient(app) as client:
            response = client.post(
                "/v1/sandbox/turns",
                headers=TENANT_HEADERS,
                json=_turn_body(flowVersionId="flwv_does_not_exist"),
            )

        assert response.status_code == 404
        assert response.json()["detail"]["code"] == "sandbox.flow_version_not_found"

    def test_unresolvable_agent_version_returns_a_real_404(self) -> None:
        app, _flow_state_store = _build_app()

        with TestClient(app) as client:
            response = client.post(
                "/v1/sandbox/turns",
                headers=TENANT_HEADERS,
                json=_turn_body(agentVersionId="avr_does_not_exist"),
            )

        assert response.status_code == 404
        assert response.json()["detail"]["code"] == "sandbox.agent_version_not_found"

    def test_a_full_turn_never_touches_real_sql_or_redis(self) -> None:
        """`_build_app()` overrides all four of this router's real-infra
        dependencies (`_config_reader` -> `SqlAlchemyOrchestrationRepository`,
        `_flow_reader` -> `SqlAlchemyFlowReader`, `_flow_state_store` ->
        `RedisFlowStateStore`, `_circuit_breaker` -> `RedisCircuitBreaker`)
        with in-memory fakes — so a real SQL Server session or Redis
        connection is never constructed for this call, by construction of
        the override rather than by observation after the fact. This test
        exists to fail loudly if a future change to `run_sandbox_turn` or
        `_build_process_turn` ever adds a fifth real-infra port constructed
        directly instead of via an overridable `Depends` (`SkillInvoker`/the
        chat model are the two real exceptions today, deliberately — see the
        module docstring for why touching them is safe: no `ToolCall` node in
        this test's flow ever reaches the tool invoker, and the chat model's
        own environment-based factory is dependency-free with no live key
        set)."""
        app, _flow_state_store = _build_app()

        assert set(app.dependency_overrides) == {
            sandbox_router._config_reader,
            sandbox_router._flow_reader,
            sandbox_router._flow_state_store,
            sandbox_router._circuit_breaker,
        }

        with TestClient(app) as client:
            response = client.post(
                "/v1/sandbox/turns", headers=TENANT_HEADERS, json=_turn_body()
            )
        assert response.status_code == 200
