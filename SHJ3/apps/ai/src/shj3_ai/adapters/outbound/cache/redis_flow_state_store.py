"""The real `FlowStateStore` — Redis, `data-model.md` §8 keys #1 (the
conversation hash's `currentNodeKey`/`escapeContextJson` fields) and #2 (the
slots hash). Unlike the circuit-breaker key, nothing else in this codebase
reads or writes these two keys yet (no `apps/web` conversation module exists —
B-6 is the surface that will), so this adapter is free to use native Redis hash
commands, matching `data-model.md`'s literal "Hash" type with no cross-runtime
JSON-string convention to preserve.
"""

from __future__ import annotations

import json

from shj3_ai.adapters.outbound.cache.redis_client import TenantCache
from shj3_ai.domain.flows import FlowState
from shj3_ai.domain.tenancy import TenantSlug

# Matches key #1's own documented TTL: "24 h, sliding on each turn" — the same
# window the WhatsApp 24-hour session shares (B10 tab 3).
_SESSION_TTL_SECONDS = 24 * 60 * 60


def _conversation_key(conversation_id: str) -> str:
    return f"conv:{conversation_id}"


def _slots_key(conversation_id: str) -> str:
    return f"conv:{conversation_id}:slots"


class RedisFlowStateStore:
    __slots__ = ("_cache",)

    def __init__(self, tenant: TenantSlug) -> None:
        self._cache = TenantCache(tenant)

    async def get_state(self, conversation_id: str) -> FlowState | None:
        conv = await self._cache.hgetall(_conversation_key(conversation_id))
        if not conv or "flowVersionId" not in conv or "currentNodeKey" not in conv:
            return None
        slots_raw = await self._cache.hgetall(_slots_key(conversation_id))
        slots = {name: json.loads(value)["value"] for name, value in slots_raw.items()}
        retry_counts_json = conv.get("retryCountsJson")
        retry_counts = json.loads(retry_counts_json) if retry_counts_json else {}
        return FlowState(
            flow_version_id=conv["flowVersionId"],
            current_node_key=conv["currentNodeKey"],
            slots=slots,
            retry_counts=retry_counts,
            escape_context_json=conv.get("escapeContextJson") or None,
        )

    async def set_state(self, conversation_id: str, state: FlowState) -> None:
        mapping = {
            "flowVersionId": state.flow_version_id,
            "currentNodeKey": state.current_node_key,
            "retryCountsJson": json.dumps(state.retry_counts),
            "escapeContextJson": state.escape_context_json or "",
        }
        await self._cache.hset(_conversation_key(conversation_id), mapping, _SESSION_TTL_SECONDS)
        if state.slots:
            slot_mapping = {
                name: json.dumps({"value": value}) for name, value in state.slots.items()
            }
            await self._cache.hset(_slots_key(conversation_id), slot_mapping, _SESSION_TTL_SECONDS)

    async def clear_state(self, conversation_id: str) -> None:
        await self._cache.delete(_conversation_key(conversation_id))
        await self._cache.delete(_slots_key(conversation_id))
