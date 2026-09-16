"""B-6: proof that `ProcessTurn.execute(command, on_event=...)` forwards real,
live token deltas — not a buffered-then-flushed replay.

Deliberately its own file (not appended to `test_process_turn.py`) to keep this
wave's addition isolated from that file's own, independently evolving test
suite. Uses the same in-memory fakes and `_make_process_turn` shape that file
established, built locally here so this file has no dependency on that file's
own internal helpers.
"""

from __future__ import annotations

import time

import pytest

from shj3_ai.application.execute_flow import ExecuteFlowStep
from shj3_ai.application.fallback_chat import InvokeWithFallback
from shj3_ai.application.process_turn import ProcessTurn, ProcessTurnCommand, TurnStatus
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

CONVERSATION_ID = "conv_stream_000000000000001"
AGENT_ID = "agt_billing_stream"


def _make_process_turn(
    chat: FakeChatModel,
) -> tuple[ProcessTurn, FakeOrchestrationStore]:
    """A minimal Sequential-mode `ProcessTurn` — the one execution mode B-6
    gives real, live per-token streaming to (see `process_turn.py`'s own
    module docstring for the deliberate scope trim on the other two modes)."""
    conversation = ConversationRow(
        id=CONVERSATION_ID, channel_key="web", locale_code="en", primary_agent_id=AGENT_ID
    )
    config = FakeConfigReader(
        agent_version=default_agent_version(agent_id=AGENT_ID, agent_version_id="avr_stream"),
        router_config=default_router_config(execution_mode="Sequential"),
    )
    store = FakeOrchestrationStore(conversation)
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
    return process_turn, store


def _command() -> ProcessTurnCommand:
    return ProcessTurnCommand(
        conversation_id=CONVERSATION_ID,
        turn_id="trn_stream_1",
        content="What is my SEWA bill status?",
        channel="web",
        locale="en",
        agent_id=AGENT_ID,
        turn_ordinal=1,
    )


class TestLiveTokenStreaming:
    @pytest.mark.asyncio
    async def test_sequential_primary_invoke_streams_tokens_incrementally_not_buffered(
        self,
    ) -> None:
        # A real, awaited 50ms delay between each of the fake model's chunks
        # (`FakeChatModel.stream()` — genuinely awaits `asyncio.sleep`, not a
        # synchronous loop) — the same mechanism `DeterministicChatModel`'s
        # own honest simulated timing uses, just faster to run in a test.
        chat = FakeChatModel(
            stream_chunks=["Hello,", "here", "is", "your", "answer."],
            stream_delay_seconds=0.05,
        )
        process_turn, _store = _make_process_turn(chat)

        events: list[tuple[str, dict[str, object], float]] = []

        async def on_event(name: str, data: dict[str, object]) -> None:
            events.append((name, data, time.monotonic()))

        result = await process_turn.execute(_command(), on_event=on_event)

        assert result.status == TurnStatus.COMPLETED
        # `.complete()` was never called for the primary invoke — only
        # `.stream()` — proving the streaming path, not the ordinary
        # fallback-invoker path, actually ran.
        assert chat.calls == []
        assert chat.stream_calls == ["openrouter/test-primary"]

        token_events = [e for e in events if e[0] == "token"]
        assert [e[1]["text"] for e in token_events] == [
            "Hello, ",
            "here ",
            "is ",
            "your ",
            "answer.",
        ]
        # Discrete, multiple events (not one big flush) — the first half of
        # the "real, not buffered" proof.
        assert len(token_events) == 5

        # The second, decisive half of the proof: consecutive `token` events
        # are measurably spaced apart in real wall-clock time. A buffered-
        # then-flushed implementation collecting the whole reply first and
        # replaying it afterward would show every timestamp within
        # microseconds of each other; this asserts a gap close to the real,
        # awaited 50ms delay between each one.
        gaps = [token_events[i + 1][2] - token_events[i][2] for i in range(len(token_events) - 1)]
        assert all(gap >= 0.03 for gap in gaps), (
            f"token events arrived too close together to be live-streamed: {gaps}"
        )

        # And they weren't reordered relative to the surrounding pipeline
        # events either — `agent_started` before every token, `agent_finished`
        # after all of them, matching api.md §5.2 rule 2's "in real order".
        names_in_order = [e[0] for e in events]
        assert names_in_order.index("agent_started") < names_in_order.index("token")
        assert names_in_order.index("agent_finished") > max(
            i for i, n in enumerate(names_in_order) if n == "token"
        )
        assert names_in_order[-1] == "done"

    @pytest.mark.asyncio
    async def test_streaming_fallback_falls_back_before_any_token_is_forwarded(self) -> None:
        # The primary model fails on its very first chunk (no tokens ever
        # forwarded for it) — the streaming-aware fallback still switches to
        # the configured fallback model and streams *its* tokens live,
        # exactly mirroring `InvokeWithFallback`'s own non-streaming
        # fallback contract (`test_process_turn.py::TestFallbackModel`).
        agent_version = default_agent_version(
            agent_id=AGENT_ID,
            agent_version_id="avr_stream",
            primary_model="openrouter/broken-primary",
            fallback_model="openrouter/working-fallback",
        )
        chat = FakeChatModel(
            fail_models=frozenset({"openrouter/broken-primary"}),
            stream_chunks=["Recovered", "via", "fallback."],
            stream_delay_seconds=0.01,
        )
        conversation = ConversationRow(
            id=CONVERSATION_ID, channel_key="web", locale_code="en", primary_agent_id=AGENT_ID
        )
        config = FakeConfigReader(
            agent_version=agent_version, router_config=default_router_config()
        )
        store = FakeOrchestrationStore(conversation)
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

        events: list[tuple[str, dict[str, object]]] = []

        async def on_event(name: str, data: dict[str, object]) -> None:
            events.append((name, data))

        result = await process_turn.execute(_command(), on_event=on_event)

        assert result.status == TurnStatus.COMPLETED
        assert result.used_fallback_model is True
        assert "openrouter/broken-primary" in chat.stream_calls
        assert "openrouter/working-fallback" in chat.stream_calls
        token_texts = [data["text"] for name, data in events if name == "token"]
        assert token_texts == ["Recovered ", "via ", "fallback."]
