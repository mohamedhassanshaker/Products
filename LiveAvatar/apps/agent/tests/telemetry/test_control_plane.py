"""Unit tests for `ControlPlaneClient` (LLD §5.9's agent-facing `/internal` writes)."""

from __future__ import annotations

import json
from uuid import UUID

import httpx
import pytest
import respx

from avatar_agent.contracts.internal_api import (
    AlertRequest,
    HopItem,
    SessionEventRequest,
    SummaryRequest,
    UtteranceItem,
)
from avatar_agent.contracts.runtime_config import AgentRuntimeConfig
from avatar_agent.ports.orchestration import KnowledgeSearchRequest, MetadataFilterQuery
from avatar_agent.telemetry.control_plane import (
    ControlPlaneClient,
    ControlPlaneKnowledgeGapAdapter,
    ControlPlaneKnowledgeSearchAdapter,
)

SESSION_ID = UUID("11111111-1111-1111-1111-111111111111")
BASE_URL = "http://control-plane.internal"


def make_client(max_retries: int = 3) -> ControlPlaneClient:
    return ControlPlaneClient(BASE_URL, "test-internal-token", max_retries=max_retries)


def valid_runtime_config_json() -> dict:
    return {
        "version": 1,
        "deployment": {"tenant_id": str(SESSION_ID), "name": "Example A"},
        "transport": {"provider": "livekit", "room_namespace": "acme"},
        "stt": {"provider": "deepgram", "language": "en-US"},
        "reasoning": {
            "entry_node_id": "llm-1",
            "background_entry_node_ids": [],
            "turn_budget_ms": 3000,
            "graph": [
                {
                    "id": "llm-1",
                    "type": "llm",
                    "name": "Answer",
                    "lane": "foreground",
                    "on_error": {"action": "degrade"},
                    "on_deadline": {"action": "degrade"},
                    "provider": "openai",
                    "model": "gpt-4o",
                    "retry": {"max_attempts": 3, "backoff_ms": [200, 400, 800]},
                    "next_node_id": None,
                }
            ],
        },
        "tts": {"provider": "fish-speech", "voice_id": "v1"},
        "avatar": {"provider": "bithuman", "avatar_id": "a1"},
        "agent": {
            "runtime": "langgraph",
            "system_prompt": "hi",
            "tools": [],
            "memory": {"enabled": True, "window_turns": 16},
        },
        "knowledge": {
            "pipeline": {
                "rewrite": {"enabled": True, "context_turns": 3, "budget_ms": 150},
                "hybrid_search": {"vector_weight": 0.6, "keyword_weight": 0.4, "candidates": 20, "budget_ms": 100},
                "metadata_filter": {"enabled": False, "budget_ms": 20},
                "rerank": {"enabled": False},
                "threshold": {"min_score": 0.5, "budget_ms": 10},
                "inject": {"token_cap": 1200, "citation_format": "numbered", "budget_ms": 30},
            }
        },
        "privacy": {"send_to_remote_llm": "prompt_text_only", "retain_transcripts_days": 90, "recordings_enabled": False},
        "alerts": {"degraded_mode_message": "hold on"},
        "session_id": str(SESSION_ID),
        "room_name": "acme_s1",
        "endpoints": {},
    }


@respx.mock
async def test_get_runtime_config_parses_into_agent_runtime_config() -> None:
    respx.get(f"{BASE_URL}/internal/sessions/{SESSION_ID}/runtime-config").mock(
        return_value=httpx.Response(200, json=valid_runtime_config_json())
    )
    client = make_client()
    cfg = await client.get_runtime_config(SESSION_ID)
    assert isinstance(cfg, AgentRuntimeConfig)
    assert cfg.room_name == "acme_s1"


@respx.mock
async def test_get_runtime_config_raises_on_a_failure_response() -> None:
    respx.get(f"{BASE_URL}/internal/sessions/{SESSION_ID}/runtime-config").mock(return_value=httpx.Response(404))
    client = make_client()
    with pytest.raises(httpx.HTTPStatusError):
        await client.get_runtime_config(SESSION_ID)


@respx.mock
async def test_get_runtime_config_sends_the_internal_token_header() -> None:
    route = respx.get(f"{BASE_URL}/internal/sessions/{SESSION_ID}/runtime-config").mock(
        return_value=httpx.Response(200, json=valid_runtime_config_json())
    )
    client = make_client()
    await client.get_runtime_config(SESSION_ID)
    assert route.calls.last.request.headers["x-internal-token"] == "test-internal-token"


@respx.mock
async def test_send_event_posts_the_event_body() -> None:
    route = respx.post(f"{BASE_URL}/internal/sessions/{SESSION_ID}/events").mock(return_value=httpx.Response(204))
    client = make_client()
    await client.send_event(SESSION_ID, SessionEventRequest(type="active", at="2026-01-01T00:00:00Z"))
    assert route.called


@respx.mock
async def test_send_utterances_skips_the_request_when_items_is_empty() -> None:
    route = respx.post(f"{BASE_URL}/internal/sessions/{SESSION_ID}/utterances")
    client = make_client()
    await client.send_utterances(SESSION_ID, [])
    assert not route.called


@respx.mock
async def test_send_utterances_posts_a_batch() -> None:
    route = respx.post(f"{BASE_URL}/internal/sessions/{SESSION_ID}/utterances").mock(return_value=httpx.Response(204))
    client = make_client()
    await client.send_utterances(SESSION_ID, [UtteranceItem(seq=1, role="user", text="hi", started_at="2026-01-01T00:00:00Z")])
    assert route.called


@respx.mock
async def test_send_hops_posts_a_batch() -> None:
    route = respx.post(f"{BASE_URL}/internal/sessions/{SESSION_ID}/hops").mock(return_value=httpx.Response(204))
    client = make_client()
    await client.send_hops(SESSION_ID, [HopItem(utterance_seq=1, hop="stt", first_partial_ms=100)])
    assert route.called


@respx.mock
async def test_send_summary_posts_the_summary() -> None:
    route = respx.post(f"{BASE_URL}/internal/sessions/{SESSION_ID}/summary").mock(return_value=httpx.Response(204))
    client = make_client()
    await client.send_summary(SESSION_ID, SummaryRequest(summary_status="ready", summary_text="a summary"))
    assert route.called


@respx.mock
async def test_send_alert_posts_to_the_tenant_scoped_alerts_route() -> None:
    route = respx.post(f"{BASE_URL}/internal/alerts").mock(return_value=httpx.Response(204))
    client = make_client()
    await client.send_alert(AlertRequest(tenant_id=SESSION_ID, type="llm_failover", message="hold on"))
    assert route.called


@respx.mock
async def test_a_write_that_fails_every_retry_is_buffered_not_raised() -> None:
    respx.post(f"{BASE_URL}/internal/alerts").mock(return_value=httpx.Response(500))
    client = make_client(max_retries=1)
    # Must not raise — telemetry loss is preferred over crashing the job (ADR-001).
    await client.send_alert(AlertRequest(tenant_id=SESSION_ID, type="llm_failover", message="hold on"))


@respx.mock
async def test_flush_buffer_retries_a_previously_failed_write() -> None:
    route = respx.post(f"{BASE_URL}/internal/alerts")
    route.mock(return_value=httpx.Response(500))
    client = make_client(max_retries=1)
    await client.send_alert(AlertRequest(tenant_id=SESSION_ID, type="llm_failover", message="hold on"))
    assert route.call_count == 1

    route.mock(return_value=httpx.Response(204))
    await client.flush_buffer()
    assert route.call_count == 2


# --- Phase 12b (BL-045/047): knowledge search / gap -------------------------


@respx.mock
async def test_search_knowledge_posts_the_expected_payload_and_parses_the_response() -> None:
    route = respx.post(f"{BASE_URL}/internal/knowledge/search").mock(
        return_value=httpx.Response(
            200,
            json={
                "candidates": [
                    {
                        "chunk_id": "c1",
                        "source_id": "s1",
                        "source_name": "returns-policy",
                        "text": "Refunds within 30 days.",
                        "vector_score": 0.81,
                        "keyword_score": 0.74,
                        "blend_score": 0.78,
                        "passed_filter": True,
                    }
                ]
            },
        )
    )
    client = make_client()
    request = KnowledgeSearchRequest(
        tenant_id=SESSION_ID,
        source_refs=["src-1"],
        query_text="refund after 30 days",
        query_embedding=[0.1, 0.2],
        vector_weight=0.6,
        keyword_weight=0.4,
        candidates=20,
        filter=MetadataFilterQuery(field="section", op="eq", value="refunds"),
    )

    response = await client.search_knowledge(request)

    assert route.called
    sent_body = route.calls.last.request.content
    payload = json.loads(sent_body)
    assert payload["tenant_id"] == str(SESSION_ID)
    assert payload["filter"] == {"field": "section", "op": "eq", "value": "refunds"}
    assert len(response.candidates) == 1
    assert response.candidates[0].chunk_id == "c1"
    assert response.candidates[0].blend_score == 0.78


@respx.mock
async def test_search_knowledge_omits_filter_key_when_none() -> None:
    route = respx.post(f"{BASE_URL}/internal/knowledge/search").mock(return_value=httpx.Response(200, json={"candidates": []}))
    client = make_client()
    request = KnowledgeSearchRequest(
        tenant_id=SESSION_ID,
        source_refs=["src-1"],
        query_text="q",
        query_embedding=[0.1],
        vector_weight=0.6,
        keyword_weight=0.4,
        candidates=20,
        filter=None,
    )
    await client.search_knowledge(request)

    payload = json.loads(route.calls.last.request.content)
    assert "filter" not in payload


@respx.mock
async def test_search_knowledge_raises_on_a_failure_response() -> None:
    respx.post(f"{BASE_URL}/internal/knowledge/search").mock(return_value=httpx.Response(500))
    client = make_client()
    request = KnowledgeSearchRequest(
        tenant_id=SESSION_ID,
        source_refs=[],
        query_text="q",
        query_embedding=[],
        vector_weight=0.6,
        keyword_weight=0.4,
        candidates=20,
    )
    with pytest.raises(httpx.HTTPStatusError):
        await client.search_knowledge(request)


@respx.mock
async def test_record_knowledge_gap_posts_the_expected_payload() -> None:
    route = respx.post(f"{BASE_URL}/internal/knowledge/gaps").mock(return_value=httpx.Response(204))
    client = make_client()
    await client.record_knowledge_gap(tenant_id=SESSION_ID, source_id="src-1", query="refund after 30 days", best_score=0.42)

    assert route.called
    payload = json.loads(route.calls.last.request.content)
    assert payload == {"tenant_id": str(SESSION_ID), "query": "refund after 30 days", "best_score": 0.42, "source_id": "src-1"}


@respx.mock
async def test_record_knowledge_gap_omits_source_id_when_none() -> None:
    route = respx.post(f"{BASE_URL}/internal/knowledge/gaps").mock(return_value=httpx.Response(204))
    client = make_client()
    await client.record_knowledge_gap(tenant_id=SESSION_ID, source_id=None, query="q", best_score=None)

    payload = json.loads(route.calls.last.request.content)
    assert "source_id" not in payload


@respx.mock
async def test_record_knowledge_gap_is_buffered_not_raised_on_failure() -> None:
    respx.post(f"{BASE_URL}/internal/knowledge/gaps").mock(return_value=httpx.Response(500))
    client = make_client(max_retries=1)
    # Must not raise -- same buffered fire-and-forget posture as every other telemetry write.
    await client.record_knowledge_gap(tenant_id=SESSION_ID, source_id=None, query="q", best_score=None)


async def test_control_plane_knowledge_search_adapter_delegates_to_search_knowledge() -> None:
    calls: list[KnowledgeSearchRequest] = []

    class _Spy(ControlPlaneClient):
        async def search_knowledge(self, request):  # noqa: ANN001
            calls.append(request)
            return "sentinel-response"  # type: ignore[return-value]

    client = _Spy(BASE_URL, "token")
    adapter = ControlPlaneKnowledgeSearchAdapter(client)
    request = KnowledgeSearchRequest(
        tenant_id=SESSION_ID,
        source_refs=[],
        query_text="q",
        query_embedding=[],
        vector_weight=0.6,
        keyword_weight=0.4,
        candidates=20,
    )
    result = await adapter.search(request)

    assert calls == [request]
    assert result == "sentinel-response"


async def test_control_plane_knowledge_gap_adapter_delegates_to_record_knowledge_gap() -> None:
    calls: list[dict] = []

    class _Spy(ControlPlaneClient):
        async def record_knowledge_gap(self, *, tenant_id, source_id, query, best_score):  # noqa: ANN001
            calls.append({"tenant_id": tenant_id, "source_id": source_id, "query": query, "best_score": best_score})

    client = _Spy(BASE_URL, "token")
    adapter = ControlPlaneKnowledgeGapAdapter(client)
    await adapter.record_gap(tenant_id=SESSION_ID, source_id="s1", query="q", best_score=0.5)

    assert calls == [{"tenant_id": SESSION_ID, "source_id": "s1", "query": "q", "best_score": 0.5}]


@respx.mock
async def test_buffer_overflow_drops_the_oldest_entry(monkeypatch: pytest.MonkeyPatch) -> None:
    import asyncio

    async def _no_sleep(_seconds: float) -> None:
        return None

    monkeypatch.setattr(asyncio, "sleep", _no_sleep)
    respx.post(f"{BASE_URL}/internal/alerts").mock(return_value=httpx.Response(500))
    client = make_client(max_retries=1)
    assert client._buffer.maxlen == 500
    for i in range(510):
        await client.send_alert(AlertRequest(tenant_id=SESSION_ID, type="llm_failover", message=f"msg {i}"))
    assert len(client._buffer) == client._buffer.maxlen
