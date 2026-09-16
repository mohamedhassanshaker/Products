"""B-6: a real, end-to-end SSE proof against the actual mounted router, driven
through `TestClient` — proves the real ASGI/`StreamingResponse`/`asyncio.Queue`
wiring in `conversation_router.py`, not just `ProcessTurn`'s own emission
(covered separately by `tests/application/test_process_turn_streaming.py`).

No containers: `_process_turn`/`_config_reader` (the router's own per-request
port-construction dependencies) are replaced through `app.dependency_overrides`
with the exact in-memory fakes `tests/application/orchestration_fakes.py`
already provides — the same "no containers, swap through dependency_overrides"
pattern `tests/provisioning/test_provisioning_router.py` established first.

Per the established `TestClient` gotcha (`tasks/lessons.md`): used as a context
manager (`with TestClient(app) as client:`), never bare — a bare `TestClient`
spins a fresh event loop per call, which breaks a real long-lived background
`asyncio.Task` (exactly what `_sse_stream` launches) across the request.
"""

from __future__ import annotations

from typing import Any

from fastapi import FastAPI
from fastapi.testclient import TestClient

from shj3_ai.adapters.inbound import conversation_router
from shj3_ai.application.execute_flow import ExecuteFlowStep
from shj3_ai.application.fallback_chat import InvokeWithFallback
from shj3_ai.application.process_turn import ProcessTurn
from shj3_ai.ports.orchestration_store import ConversationRow
from tests.application.orchestration_fakes import (
    FakeChatModel,
    FakeCircuitBreaker,
    FakeConfigReader,
    FakeFlowReader,
    FakeFlowStateStore,
    FakeIdentityReader,
    FakeOrchestrationStore,
    FakeToolInvoker,
    default_agent_version,
    default_router_config,
)

CONVERSATION_ID = "conv_sse_test_00000000001"
AGENT_ID = "agt_sse_billing"
TENANT_HEADERS = {"X-SHJ3-Tenant-Id": "sewa", "X-SHJ3-Principal-Id": "prn_sse_test"}


class _FakeConfigAndStore:
    """One object structurally satisfying both `ConfigReaderDep`'s and
    `ProcessTurn`'s `store=` role — mirroring the real
    `SqlAlchemyOrchestrationRepository`'s own "one class, both ports" shape
    (see that adapter's docstring), which is exactly what
    `conversation_router.post_turn`'s pre-stream 404 check
    (`config_reader.get_conversation(...)`) needs from whatever fills
    `ConfigReaderDep` in this test."""

    def __init__(self, config: FakeConfigReader, store: FakeOrchestrationStore) -> None:
        self._config = config
        self._store = store

    def __getattr__(self, name: str) -> Any:
        if hasattr(self._store, name):
            return getattr(self._store, name)
        return getattr(self._config, name)


def _build_app(chat: FakeChatModel) -> tuple[FastAPI, FakeOrchestrationStore]:
    conversation = ConversationRow(
        id=CONVERSATION_ID, channel_key="web", locale_code="en", primary_agent_id=AGENT_ID
    )
    config = FakeConfigReader(
        agent_version=default_agent_version(agent_id=AGENT_ID, agent_version_id="avr_sse"),
        router_config=default_router_config(execution_mode="Sequential"),
    )
    store = FakeOrchestrationStore(conversation)
    combined = _FakeConfigAndStore(config, store)
    tool_invoker = FakeToolInvoker()
    process_turn = ProcessTurn(
        config=config,
        store=store,
        chat_invoker=InvokeWithFallback(chat),
        breaker=FakeCircuitBreaker(),
        tool_invoker=tool_invoker,
        flow_reader=FakeFlowReader({}),
        flow_state_store=FakeFlowStateStore(),
        flow_executor=ExecuteFlowStep(tool_invoker),
        identity_reader=FakeIdentityReader(),
        retrieval=None,
    )

    app = FastAPI()
    app.include_router(conversation_router.router)
    app.dependency_overrides[conversation_router._process_turn] = lambda: process_turn
    app.dependency_overrides[conversation_router._config_reader] = lambda: combined
    return app, store


def _turn_body() -> dict[str, object]:
    return {
        "turnId": "trn_sse_1",
        "content": "What is my SEWA bill status?",
        "channel": "web",
        "locale": "en",
        "agentBinding": {"agentId": AGENT_ID},
    }


def _event_names(raw_sse_text: str) -> list[str]:
    names = []
    for frame in raw_sse_text.split("\n\n"):
        for line in frame.splitlines():
            if line.startswith("event: "):
                names.append(line[len("event: ") :])
    return names


class TestSseStreamEndToEnd:
    def test_turn_started_is_first_and_done_is_last(self) -> None:
        chat = FakeChatModel(stream_chunks=["Hi", "there."], stream_delay_seconds=0.02)
        app, _store = _build_app(chat)

        with TestClient(app) as client:
            response = client.post(
                f"/v1/conversations/{CONVERSATION_ID}/turns",
                headers={**TENANT_HEADERS, "Accept": "text/event-stream"},
                json=_turn_body(),
            )

        assert response.status_code == 200
        assert response.headers["cache-control"] == "no-store"
        assert response.headers["x-accel-buffering"] == "no"
        body = response.text
        names = _event_names(body)
        assert names[0] == "turn_started"
        assert names[-1] == "done"

    def test_token_frames_arrive_between_agent_started_and_agent_finished_in_order(self) -> None:
        # Multiple distinct chunks with a real delay between them — the same
        # "not buffered-then-flushed" proof `test_process_turn_streaming.py`
        # makes at the `ProcessTurn` level, checked here end to end through
        # the real HTTP/SSE surface instead.
        chat = FakeChatModel(
            stream_chunks=["The", "answer", "is", "42."], stream_delay_seconds=0.02
        )
        app, _store = _build_app(chat)

        with TestClient(app) as client:
            response = client.post(
                f"/v1/conversations/{CONVERSATION_ID}/turns",
                headers={**TENANT_HEADERS, "Accept": "text/event-stream"},
                json=_turn_body(),
            )

        assert response.status_code == 200
        names = _event_names(response.text)

        token_count = sum(1 for n in names if n == "token")
        assert token_count == 4
        assert names.index("agent_started") < names.index("token")
        assert names.index("agent_finished") > max(i for i, n in enumerate(names) if n == "token")
        # api.md §5.2 rule 1: exactly one of done/error, last.
        assert names[-1] in ("done", "error")
        assert names.count("done") + names.count("error") == 1

    def test_json_accept_header_still_returns_one_buffered_envelope_unchanged(self) -> None:
        # The `Accept: application/json` path is explicitly untouched by B-6
        # — still one blocking call, one JSON body, no streaming at all.
        chat = FakeChatModel(stream_chunks=["Hi", "there."], stream_delay_seconds=0.02)
        app, _store = _build_app(chat)

        with TestClient(app) as client:
            response = client.post(
                f"/v1/conversations/{CONVERSATION_ID}/turns",
                headers={**TENANT_HEADERS, "Accept": "application/json"},
                json=_turn_body(),
            )

        assert response.status_code == 200
        envelope = response.json()
        assert envelope["turnId"] == "trn_sse_1"
        assert envelope["status"] == "completed"
        # No `on_event` means `ProcessTurn` never calls `ChatModel.stream()`
        # at all -- `.complete()`'s own (different) default reply text comes
        # back untouched, proving this path truly never touches the
        # streaming seam (`stream_calls` stays empty; `stream_chunks` above
        # is never consulted).
        expected_reply = f"[openrouter/test-primary] reply to: {_turn_body()['content']}"
        assert envelope["message"]["content"] == expected_reply
        assert chat.stream_calls == []
        assert chat.calls == ["openrouter/test-primary"]

    def test_unknown_conversation_returns_a_real_404_before_the_stream_opens(self) -> None:
        # api.md §5.1: `404 conversation.not_found` is a real HTTP status
        # line -- once an SSE response's `200` status has been sent, an
        # error can only ever arrive as an `error` *event* (api.md §5.2), so
        # this must be a genuine 404, not a 200 stream carrying an error
        # event.
        chat = FakeChatModel()
        app, _store = _build_app(chat)

        with TestClient(app) as client:
            response = client.post(
                "/v1/conversations/conv_does_not_exist_00000001/turns",
                headers={**TENANT_HEADERS, "Accept": "text/event-stream"},
                json=_turn_body(),
            )

        assert response.status_code == 404
        assert response.json()["detail"]["code"] == "conversation.not_found"
