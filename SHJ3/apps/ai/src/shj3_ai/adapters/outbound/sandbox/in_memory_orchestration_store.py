"""The backoffice "sandbox testing" feature's `OrchestrationStore` — an
in-memory, no-op-writes implementation used only by `sandbox_router.py`.

This is what makes sandbox testing a real, correctness-critical guarantee
rather than a policy promise: `ProcessTurn` has exactly one write port besides
`FlowStateStore` (`ports/orchestration_store.py`'s own docstring — "the only
write path this wave uses"), and this class holds no `AsyncSession`, no
SQLAlchemy engine, no connection string, nothing that could reach a real
`Conversations`/`ConversationTurns`/`OrchestrationTraces`/`GroundingCitations`
row even by accident. `persist_turn`/`persist_trace`/`persist_citations` are
true no-ops for exactly that reason — there is nothing behind them to write
through, not merely a check that declines to.

`get_conversation` is the one *read* this port carries (real SELECT grant
broadly, per that method's own docstring on the port) and the one precondition
`ProcessTurn.execute()` requires before it will process a turn at all. Here it
returns a synthetic `ConversationRow` built from exactly the
`sandboxSessionId`/`agentId`/`locale` the sandbox caller supplied — never a
real `Conversations` row, and never a value fabricated independently of what
the caller actually asked to test.
"""

from __future__ import annotations

from shj3_ai.ports.orchestration_store import (
    CitationToPersist,
    ConversationRow,
    TraceToPersist,
    TurnToPersist,
)


class InMemorySandboxOrchestrationStore:
    """One instance per sandbox turn request, holding exactly one synthetic
    conversation row keyed by the caller's own `sandboxSessionId` — matching
    `sandbox_router.py`'s "construct ports fresh per request" convention
    (the same one `evaluation_router.py`/`flow_authoring_router.py`/
    `tools_router.py` already established for this codebase's inbound layer).
    """

    __slots__ = ("_conversation",)

    def __init__(
        self,
        *,
        sandbox_session_id: str,
        agent_id: str,
        locale: str,
        channel_key: str = "sandbox",
    ) -> None:
        self._conversation = ConversationRow(
            id=sandbox_session_id,
            # Overridable so a caller other than sandbox testing (e.g. the orchestrator
            # trace-preview endpoint, `orchestration_preview_router.py`) gets an honest
            # channel label on its own synthetic trace instead of a cosmetically wrong
            # "sandbox" one — default unchanged, so `sandbox_router.py`'s own call site
            # needs no edit.
            channel_key=channel_key,
            locale_code=locale,
            primary_agent_id=agent_id,
            # A sandbox session never carries a real citizen identity. B-8's
            # step-up gate resolves `None` to `AssuranceLevel.L0` without any
            # `IdentityReader` read at all (`ProcessTurn._resolve_held_
            # assurance`'s own short-circuit) — so a Draft flow's step-up
            # gated nodes are exercisable in sandbox only at the anonymous
            # floor. A real, flagged scope limit, not an oversight: modelling
            # a specific held assurance level for sandbox testing would need
            # its own design (a designer picking a "test as" identity), out
            # of scope for this pass.
            citizen_identity_id=None,
        )

    async def get_conversation(self, conversation_id: str) -> ConversationRow | None:
        """Returns the one synthetic row this instance was built for — `None`
        for any other id, matching `ProcessTurn`'s own real 404 behaviour
        (`ConversationNotFoundError`) rather than silently answering for an
        id nobody actually asked about."""
        if conversation_id == self._conversation.id:
            return self._conversation
        return None

    async def persist_turn(self, turn: TurnToPersist) -> None:
        """No-op — see the module docstring. Never writes a `ConversationTurns` row."""

    async def persist_trace(self, trace: TraceToPersist) -> None:
        """No-op — see the module docstring. Never writes an `OrchestrationTraces`
        row (or its `OrchestrationTraceSteps` children)."""

    async def persist_citations(self, citations: list[CitationToPersist]) -> None:
        """No-op — see the module docstring. Never writes a `GroundingCitations` row."""
