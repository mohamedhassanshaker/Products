"""HTTP client for the `/internal` surface (LLD §5.9), used by every
telemetry/event/summary/alert write path. Every write is best-effort: on
failure, the payload is pushed into a small bounded in-memory buffer and a
background retry loop drains it; on overflow the oldest entry is dropped
and logged (ADR-001 consequences table — "telemetry loss is preferred over
dropping a live call", a deliberate trade-off, not an oversight).
"""

from __future__ import annotations

import asyncio
import time
from collections import deque
from typing import Any
from uuid import UUID

import httpx
import structlog

from avatar_agent.contracts.internal_api import (
    AlertRequest,
    AlertType,
    HopBatchRequest,
    HopItem,
    SessionEventRequest,
    SummaryRequest,
    UtteranceBatchRequest,
    UtteranceItem,
)
from avatar_agent.contracts.runtime_config import AgentRuntimeConfig
from avatar_agent.ports.orchestration import (
    HitlDecisionCreated,
    HitlDecisionRecord,
    HitlProposedAction,
    KnowledgeSearchRequest,
    KnowledgeSearchResponse,
    SkillBody,
    SkillKnowledgeFilters,
    SkillToolDefinition,
    SubAgentPersona,
    SubAgentToolDefinition,
    knowledge_search_request_payload,
    knowledge_search_response_from_json,
)

logger = structlog.get_logger(__name__)

_MAX_BUFFER = 500


def _hitl_proposed_action_payload(action: HitlProposedAction) -> dict[str, Any]:
    """Builds `proposed_action`'s wire JSON for `POST /internal/hitl-decisions`
    (Phase 14, BL-052..057) — omits unset optional fields rather than
    sending explicit `null`s, same convention `knowledge_search_request_payload`'s
    own `filter` handling already uses."""
    payload: dict[str, Any] = {"kind": action.kind, "summary": action.summary}
    if action.arguments is not None:
        payload["arguments"] = action.arguments
    if action.transcript_excerpt is not None:
        payload["transcript_excerpt"] = list(action.transcript_excerpt)
    if action.caller_identity is not None:
        payload["caller_identity"] = action.caller_identity
    if action.retrieved_sources is not None:
        payload["retrieved_sources"] = list(action.retrieved_sources)
    if action.model_reasoning is not None:
        payload["model_reasoning"] = action.model_reasoning
    return payload


class ControlPlaneClient:
    """Talks to the internal listener (`:8081`, `X-Internal-Token`-guarded)."""

    def __init__(
        self,
        base_url: str,
        internal_token: str,
        *,
        http_client: httpx.AsyncClient | None = None,
        max_retries: int = 3,
    ) -> None:
        self._http = http_client or httpx.AsyncClient(base_url=base_url, timeout=10.0)
        self._headers = {"X-Internal-Token": internal_token}
        self._max_retries = max_retries
        # (method, path, json) tuples that failed every retry attempt.
        self._buffer: deque[tuple[str, str, dict[str, Any]]] = deque(maxlen=_MAX_BUFFER)

    async def _post(self, path: str, payload: dict[str, Any]) -> None:
        """Best-effort POST with bounded retry; never raises to the caller —
        a telemetry write must never kill the conversation (LLD §10.8).
        """
        last_error: Exception | None = None
        for attempt in range(self._max_retries):
            try:
                response = await self._http.post(path, json=payload, headers=self._headers)
                response.raise_for_status()
                return
            except httpx.HTTPError as err:
                last_error = err
                await asyncio.sleep(0.1 * (2**attempt))
        logger.warning("internal_write_failed", path=path, error=str(last_error))
        if len(self._buffer) == self._buffer.maxlen:
            dropped = self._buffer.popleft()
            logger.warning("telemetry_buffer_overflow_dropped", path=dropped[1])
        self._buffer.append(("POST", path, payload))

    async def flush_buffer(self) -> None:
        """Drains buffered writes, retrying each once more. Called
        periodically by the pipeline's background loop; failures are
        re-buffered (bounded), never raised.
        """
        pending = list(self._buffer)
        self._buffer.clear()
        for _method, path, payload in pending:
            await self._post(path, payload)

    async def get_runtime_config(self, session_id: UUID) -> AgentRuntimeConfig:
        """`GET /internal/sessions/{id}/runtime-config` — not buffered; a
        failure here is fatal to job start (no config, no pipeline).
        """
        response = await self._http.get(f"/internal/sessions/{session_id}/runtime-config", headers=self._headers)
        response.raise_for_status()
        return AgentRuntimeConfig.model_validate(response.json())

    async def send_event(self, session_id: UUID, event: SessionEventRequest) -> None:
        """`POST /internal/sessions/{id}/events` — drives the status machine.

        `exclude_none=True` on every `model_dump(mode="json")` call in this
        class matters: Pydantic serializes an unset `Optional` field as
        explicit JSON `null`, but the control plane's TypeBox schemas expect
        those keys omitted entirely, not present-with-null — an omitted
        `exclude_none` makes every write with any unset optional field fail
        `INTERNAL_PAYLOAD_INVALID`, found the first time this ever ran
        against a live session with a real optional field left unset.
        """
        await self._post(f"/internal/sessions/{session_id}/events", event.model_dump(mode="json", exclude_none=True))

    async def send_utterances(self, session_id: UUID, items: list[UtteranceItem]) -> None:
        """`POST /internal/sessions/{id}/utterances` — batch upsert."""
        if not items:
            return
        batch = UtteranceBatchRequest(items=items)
        await self._post(f"/internal/sessions/{session_id}/utterances", batch.model_dump(mode="json", exclude_none=True))

    async def send_hops(self, session_id: UUID, items: list[HopItem]) -> None:
        """`POST /internal/sessions/{id}/hops` — batch upsert (NFR-1)."""
        if not items:
            return
        batch = HopBatchRequest(items=items)
        await self._post(f"/internal/sessions/{session_id}/hops", batch.model_dump(mode="json", exclude_none=True))

    async def send_summary(self, session_id: UUID, request: SummaryRequest) -> None:
        """`POST /internal/sessions/{id}/summary` — the agent is the only writer."""
        await self._post(f"/internal/sessions/{session_id}/summary", request.model_dump(mode="json", exclude_none=True))

    async def send_alert(self, request: AlertRequest) -> None:
        """`POST /internal/alerts`."""
        await self._post("/internal/alerts", request.model_dump(mode="json", exclude_none=True))

    async def search_knowledge(self, request: KnowledgeSearchRequest) -> KnowledgeSearchResponse:
        """`POST /internal/knowledge/search` (Phase 12b, BL-045/047) — a
        **blocking, non-buffered** call, mirroring `get_runtime_config`'s
        raise-on-failure shape rather than the buffered `_post`
        fire-and-forget shape every telemetry write above uses: retrieval
        results are needed inline in the turn, so a failure here must
        surface to the caller immediately (the retrieval pipeline's own
        stage-level `asyncio.wait_for`/broad-except handling, not a buffered
        retry queue, is what turns this into "zero candidates" for a turn
        whose retrieval budget is usually well under a second)."""
        response = await self._http.post(
            "/internal/knowledge/search", json=knowledge_search_request_payload(request), headers=self._headers
        )
        response.raise_for_status()
        return knowledge_search_response_from_json(response.json())

    async def record_knowledge_gap(self, *, tenant_id: UUID, source_id: str | None, query: str, best_score: float | None) -> None:
        """`POST /internal/knowledge/gaps` (Phase 12b, BL-045/047) — buffered
        fire-and-forget (this file's own docstring already documents this
        trade-off for every other write here): a lost gap-report row on a
        rare internal-listener outage is acceptable, never worth blocking or
        risking the turn over."""
        payload: dict[str, Any] = {"tenant_id": str(tenant_id), "query": query, "best_score": best_score}
        if source_id is not None:
            payload["source_id"] = source_id
        await self._post("/internal/knowledge/gaps", payload)

    async def get_skill_body(self, skill_id: str, version: int) -> SkillBody:
        """`GET /internal/skills/{id}/versions/{version}/body` (Phase 13,
        BL-049/050/051) — a **blocking, non-buffered** call, same shape as
        `get_runtime_config`/`search_knowledge`: the Skill node executor
        needs the body inline to proceed, so a failure must surface
        immediately (the executor's own broad-except handling turns that
        into a recognized node failure, not a crash — see
        `orchestration/graph/nodes/skill.py`)."""
        response = await self._http.get(f"/internal/skills/{skill_id}/versions/{version}/body", headers=self._headers)
        response.raise_for_status()
        body = response.json()
        return SkillBody(
            skill_id=body["id"],
            version=body["version"],
            name=body["name"],
            description=body["description"],
            instructions=body["instructions"],
            trigger_mode=body["trigger_mode"],
            tool_definitions=tuple(
                SkillToolDefinition(
                    api_ref=t["api_ref"],
                    name=t["name"],
                    description=t.get("description"),
                    method=t["method"],
                    url=t["url"],
                    credential_ref=t.get("credential_ref"),
                    args_schema=t.get("args_schema") or {},
                )
                for t in body.get("tool_definitions", [])
            ),
            knowledge_filters=SkillKnowledgeFilters(
                source_refs=tuple(body.get("knowledge_filters", {}).get("source_refs", [])),
                top_k=body.get("knowledge_filters", {}).get("top_k"),
                min_score=body.get("knowledge_filters", {}).get("min_score"),
            ),
            budget_ms=body["budget_ms"],
        )

    async def get_subagent_persona(self, target_tenant_id: str) -> SubAgentPersona:
        """`GET /internal/tenants/{tenantId}/subagent-persona` (Phase 15,
        BL-058) — a **blocking, non-buffered** call, same shape as
        `get_skill_body`: the Sub-agent node executor needs the persona
        inline to run its one bounded delegated LLM turn, so a failure
        (including the endpoint's own 404 when the target tenant has no
        published config) must surface immediately via `raise_for_status`
        (the executor's own broad-except handling turns that into a
        recognized node failure, not a crash — see
        `orchestration/graph/nodes/subagent.py`)."""
        response = await self._http.get(f"/internal/tenants/{target_tenant_id}/subagent-persona", headers=self._headers)
        response.raise_for_status()
        body = response.json()
        return SubAgentPersona(
            tenant_id=body["tenant_id"],
            system_prompt=body["system_prompt"],
            tool_definitions=tuple(
                SubAgentToolDefinition(
                    api_ref=t["api_ref"],
                    name=t["name"],
                    description=t.get("description"),
                    method=t["method"],
                    url=t["url"],
                    credential_ref=t.get("credential_ref"),
                    args_schema=t.get("args_schema") or {},
                )
                for t in body.get("tool_definitions", [])
            ),
        )

    async def create_hitl_decision(
        self, *, tenant_id: UUID, session_id: UUID, gate_id: str, utterance_seq: int, proposed_action: HitlProposedAction
    ) -> HitlDecisionCreated:
        """`POST /internal/hitl-decisions` (Phase 14, BL-052..057) — a
        **blocking, non-buffered** call, same shape as `get_skill_body`: the
        Hitl node executor needs the created decision's id and the gate's
        own resolved hold-treatment/SLA inline to proceed (it must speak
        the hold treatment and start polling), so a failure here must
        surface immediately rather than being silently buffered like a
        telemetry write."""
        payload: dict[str, Any] = {
            "tenant_id": str(tenant_id),
            "session_id": str(session_id),
            "gate_id": gate_id,
            "utterance_seq": utterance_seq,
            "proposed_action": _hitl_proposed_action_payload(proposed_action),
        }
        response = await self._http.post("/internal/hitl-decisions", json=payload, headers=self._headers)
        response.raise_for_status()
        body = response.json()
        return HitlDecisionCreated(
            id=body["id"], hold_treatment_text=body["hold_treatment_text"], sla_seconds=body["sla_seconds"]
        )

    async def get_hitl_decision(self, decision_id: str) -> HitlDecisionRecord:
        """`GET /internal/hitl-decisions/{id}` (Phase 14, BL-052..057) — a
        **blocking, non-buffered** call, short-polled every ~1-2s by the
        Hitl node executor's own wait loop (`ARCHITECTURE_NOTES.md` §6.2
        point 3) until the decision leaves `pending` or the executor's own
        locally-tracked SLA deadline elapses."""
        response = await self._http.get(f"/internal/hitl-decisions/{decision_id}", headers=self._headers)
        response.raise_for_status()
        body = response.json()
        action = body["proposed_action"]
        return HitlDecisionRecord(
            id=body["id"],
            tenant_id=body["tenant_id"],
            session_id=body["session_id"],
            gate_id=body["gate_id"],
            utterance_seq=body["utterance_seq"],
            proposed_action=HitlProposedAction(
                kind=action["kind"],
                summary=action["summary"],
                arguments=action.get("arguments"),
                transcript_excerpt=action.get("transcript_excerpt"),
                caller_identity=action.get("caller_identity"),
                retrieved_sources=action.get("retrieved_sources"),
                model_reasoning=action.get("model_reasoning"),
            ),
            reviewer_id=body.get("reviewer_id"),
            decision=body["decision"],
            edited_arguments=body.get("edited_arguments"),
            justification_note=body.get("justification_note"),
            decided_at=body.get("decided_at"),
            latency_ms=body.get("latency_ms"),
            outcome_notified_at=body.get("outcome_notified_at"),
            created_at=body["created_at"],
        )


class ControlPlaneKnowledgeSearchAdapter:
    """Thin adapter satisfying `ports.orchestration.IKnowledgeSearchPort`'s
    `search(request)` shape by delegating to
    `ControlPlaneClient.search_knowledge` (Phase 12b, BL-045/047).

    **Documented wiring choice**: rather than naming the method on
    `ControlPlaneClient` itself the generic `search` (which the Protocol
    itself uses) so the class "structurally satisfies" the Protocol
    directly, this client keeps its own descriptive, collision-free method
    name (`search_knowledge`, consistent with its existing
    `send_hops`/`send_event`/`get_runtime_config`-style naming) and this
    small adapter bridges the two — `entrypoint.build_pipeline` constructs
    one per session, same as the `ControlPlaneClient` instance it wraps.
    """

    def __init__(self, control_plane: ControlPlaneClient) -> None:
        self._control_plane = control_plane

    async def search(self, request: KnowledgeSearchRequest) -> KnowledgeSearchResponse:
        return await self._control_plane.search_knowledge(request)


class ControlPlaneKnowledgeGapAdapter:
    """Thin adapter satisfying `ports.orchestration.IKnowledgeGapPort`'s
    `record_gap(...)` shape — same wiring reasoning as
    `ControlPlaneKnowledgeSearchAdapter`."""

    def __init__(self, control_plane: ControlPlaneClient) -> None:
        self._control_plane = control_plane

    async def record_gap(self, *, tenant_id: UUID, source_id: str | None, query: str, best_score: float | None) -> None:
        await self._control_plane.record_knowledge_gap(
            tenant_id=tenant_id, source_id=source_id, query=query, best_score=best_score
        )


class ControlPlaneSkillBodyAdapter:
    """Thin adapter satisfying `ports.orchestration.ISkillBodyPort`'s
    `get_body(skill_id, version)` shape by delegating to
    `ControlPlaneClient.get_skill_body` (Phase 13, BL-049/050/051) — same
    wiring reasoning as `ControlPlaneKnowledgeSearchAdapter`."""

    def __init__(self, control_plane: ControlPlaneClient) -> None:
        self._control_plane = control_plane

    async def get_body(self, skill_id: str, version: int) -> SkillBody:
        return await self._control_plane.get_skill_body(skill_id, version)


class ControlPlaneHitlDecisionAdapter:
    """Thin adapter satisfying `ports.orchestration.IHitlDecisionPort`'s
    `create_decision(...)`/`get_decision(id)` shape by delegating to
    `ControlPlaneClient.create_hitl_decision`/`get_hitl_decision` (Phase 14,
    BL-052..057) — same wiring reasoning as `ControlPlaneSkillBodyAdapter`."""

    def __init__(self, control_plane: ControlPlaneClient) -> None:
        self._control_plane = control_plane

    async def create_decision(
        self, *, tenant_id: UUID, session_id: UUID, gate_id: str, utterance_seq: int, proposed_action: HitlProposedAction
    ) -> HitlDecisionCreated:
        return await self._control_plane.create_hitl_decision(
            tenant_id=tenant_id,
            session_id=session_id,
            gate_id=gate_id,
            utterance_seq=utterance_seq,
            proposed_action=proposed_action,
        )

    async def get_decision(self, decision_id: str) -> HitlDecisionRecord:
        return await self._control_plane.get_hitl_decision(decision_id)


class ControlPlaneSubAgentPersonaAdapter:
    """Thin adapter satisfying `ports.orchestration.ISubAgentPersonaPort`'s
    `get_persona(target_tenant_id)` shape by delegating to
    `ControlPlaneClient.get_subagent_persona` (Phase 15, BL-058) — same
    wiring reasoning as `ControlPlaneSkillBodyAdapter`."""

    def __init__(self, control_plane: ControlPlaneClient) -> None:
        self._control_plane = control_plane

    async def get_persona(self, target_tenant_id: str) -> SubAgentPersona:
        return await self._control_plane.get_subagent_persona(target_tenant_id)


class ControlPlaneAlertAdapter:
    """Thin adapter satisfying `ports.orchestration.IAlertPort`'s
    `send_alert(...)` shape by delegating to `ControlPlaneClient.send_alert`
    (Phase 15, BL-059) — same wiring reasoning as
    `ControlPlaneSkillBodyAdapter`."""

    def __init__(self, control_plane: ControlPlaneClient) -> None:
        self._control_plane = control_plane

    async def send_alert(self, *, tenant_id: UUID, alert_type: AlertType, message: str) -> None:
        await self._control_plane.send_alert(AlertRequest(tenant_id=tenant_id, type=alert_type, message=message))


def now_ms() -> int:
    """Monotonic-clock milliseconds, used for hop latency measurement."""
    return int(time.monotonic() * 1000)
