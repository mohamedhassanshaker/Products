"""The `FlowStateStore` port — the live, per-conversation flow position.
`data-model.md` §8 keys #1 (`currentNodeKey`, `escapeContextJson` on the
conversation hash) and #2 (the slots hash). Redis-only, ephemeral by design
(ADR-0003) — losing it degrades an in-flight flow to a fresh session, never
destroys a record.
"""

from __future__ import annotations

from typing import Protocol

from shj3_ai.domain.flows import FlowState


class FlowStateStore(Protocol):
    async def get_state(self, conversation_id: str) -> FlowState | None: ...

    async def set_state(self, conversation_id: str, state: FlowState) -> None: ...

    async def clear_state(self, conversation_id: str) -> None:
        """A flow reaching its terminal node, or being abandoned by a full
        (non-escape) router re-route, clears the live position."""
