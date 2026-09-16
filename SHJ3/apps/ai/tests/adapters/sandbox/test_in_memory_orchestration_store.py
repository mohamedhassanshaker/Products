"""`InMemorySandboxOrchestrationStore` — the class holds no DB dependency at
all (no `AsyncSession`, no engine, no connection string; see its module
docstring), so the "never writes a real SQL row" guarantee is structural,
provable here simply by constructing it with nothing DB-shaped and calling
every write method without it raising."""

from __future__ import annotations

from decimal import Decimal

from shj3_ai.adapters.outbound.sandbox.in_memory_orchestration_store import (
    InMemorySandboxOrchestrationStore,
)
from shj3_ai.ports.orchestration_store import CitationToPersist, TraceToPersist, TurnToPersist


def _turn(conversation_id: str) -> TurnToPersist:
    return TurnToPersist(
        id="trn_1",
        conversation_id=conversation_id,
        ordinal=1,
        role="Citizen",
        content_masked="hello",
        content_format="Text",
        agent_version_id="avr_1",
        locale_code="en",
        input_tokens=None,
        output_tokens=None,
        latency_ms=None,
        was_refused=False,
        refusal_reason=None,
    )


def _trace(conversation_id: str) -> TraceToPersist:
    return TraceToPersist(
        id="trc_1",
        conversation_id=conversation_id,
        turn_id="trn_1",
        execution_mode="Sequential",
        routed_agent_id="agt_1",
        routed_agent_version_id="avr_1",
        routing_confidence=None,
        hop_count=1,
        total_input_tokens=0,
        total_output_tokens=0,
        total_cost_micro_aed=0,
        pending_slot_name=None,
        escape_triggered=False,
        merge_policy_applied=None,
        guardrail_pre_result="Pass",
        guardrail_post_result="Pass",
        grounding_confidence=None,
        duration_ms=0,
        steps=(),
    )


def _citation() -> CitationToPersist:
    return CitationToPersist(
        id="cit_1",
        trace_id="trc_1",
        turn_id="trn_1",
        chunk_id="chk_1",
        knowledge_source_id="src_1",
        rank=1,
        vector_score=Decimal("0.5"),
        graph_score=None,
        hybrid_score=Decimal("0.5"),
        rerank_score=None,
        retrieved_via="Vector",
        graph_path=None,
        was_cited=True,
    )


class TestGetConversation:
    async def test_returns_a_synthetic_row_built_from_the_sandbox_caller_s_own_values(
        self,
    ) -> None:
        store = InMemorySandboxOrchestrationStore(
            sandbox_session_id="sandbox:01ABC", agent_id="agt_billing", locale="en"
        )

        conversation = await store.get_conversation("sandbox:01ABC")

        assert conversation is not None
        assert conversation.id == "sandbox:01ABC"
        assert conversation.primary_agent_id == "agt_billing"
        assert conversation.locale_code == "en"
        assert conversation.channel_key == "sandbox"
        # No real citizen identity ever exists in a sandbox session — B-8's
        # gate must resolve this to the anonymous floor without a read.
        assert conversation.citizen_identity_id is None

    async def test_a_different_id_resolves_to_none_not_the_seeded_row(self) -> None:
        store = InMemorySandboxOrchestrationStore(
            sandbox_session_id="sandbox:01ABC", agent_id="agt_billing", locale="en"
        )

        assert await store.get_conversation("sandbox:some_other_session") is None


class TestNoOpWrites:
    """Nothing to assert was *not* written to SQL beyond construction itself —
    this class holds no DB session to write through at all — so these tests
    prove the weaker, still-real property: every write method returns
    cleanly, is awaitable, and accepts a genuine, fully-populated dataclass
    instance without raising."""

    async def test_persist_turn_is_a_genuine_no_op(self) -> None:
        store = InMemorySandboxOrchestrationStore(
            sandbox_session_id="sandbox:01ABC", agent_id="agt_billing", locale="en"
        )

        # `persist_turn` is declared `-> None` — completing without raising
        # is the entire assertion; there is no return value to inspect.
        await store.persist_turn(_turn("sandbox:01ABC"))

    async def test_persist_trace_is_a_genuine_no_op(self) -> None:
        store = InMemorySandboxOrchestrationStore(
            sandbox_session_id="sandbox:01ABC", agent_id="agt_billing", locale="en"
        )

        await store.persist_trace(_trace("sandbox:01ABC"))

    async def test_persist_citations_is_a_genuine_no_op(self) -> None:
        store = InMemorySandboxOrchestrationStore(
            sandbox_session_id="sandbox:01ABC", agent_id="agt_billing", locale="en"
        )

        await store.persist_citations([_citation()])
