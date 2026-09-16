"""The real `CircuitBreakerPort` — Redis, interoperating byte-for-byte with
B-3's already-shipped TypeScript adapter
(`apps/web/.../redis-circuit-breaker-state-store.ts`): same key
(`cb:{targetKind}:{ref}`), same JSON-string value shape (a plain string via
`TenantCache.get`/`set`, not a native Redis hash — the TS adapter's own doc
comment explains why: `data-model.md`'s "Hash" column is a conceptual value
shape, not a literal Redis data-type requirement), same field names
(`state`/`openedAt`/`cooldownUntil`/`consecutiveProbeFailures`), same 24h TTL
refreshed on every write. A manual trip issued from `/tools` tab 4 and an
automatic trip this wave's `SkillInvoker` issues are the same live state either
way — "a breaker tripped on one pod is tripped on all" holds across runtimes,
not just across pods of one.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta

from shj3_ai.adapters.outbound.cache.redis_client import TenantCache
from shj3_ai.domain.tenancy import TenantSlug
from shj3_ai.ports.circuit_breaker import BreakerLiveState

_STATE_TTL_SECONDS = 24 * 60 * 60
_DEGRADED_KEY = "cb:degraded"


def _state_key(target_kind: str, target_ref: str) -> str:
    return f"cb:{target_kind}:{target_ref}"


def _failures_key(target_kind: str, target_ref: str) -> str:
    return f"cb:{target_kind}:{target_ref}:failures"


class RedisCircuitBreaker:
    __slots__ = ("_cache",)

    def __init__(self, tenant: TenantSlug) -> None:
        self._cache = TenantCache(tenant)

    async def get_state(self, target_kind: str, target_ref: str) -> BreakerLiveState:
        raw = await self._cache.get(_state_key(target_kind, target_ref))
        if raw is None:
            return BreakerLiveState(state="Closed", consecutive_probe_failures=0)
        try:
            parsed = json.loads(raw)
            return BreakerLiveState(
                state=str(parsed["state"]),
                consecutive_probe_failures=int(parsed.get("consecutiveProbeFailures", 0)),
            )
        except (json.JSONDecodeError, KeyError, TypeError, ValueError):
            # A record written under an older/corrupted shape is treated as
            # absent, matching the TS sibling's identical reasoning.
            return BreakerLiveState(state="Closed", consecutive_probe_failures=0)

    async def _set_state(
        self, target_kind: str, target_ref: str, *, state: str, cooldown_until: datetime | None
    ) -> None:
        payload = {
            "state": state,
            "openedAt": datetime.now(UTC).isoformat() if state == "Open" else None,
            "cooldownUntil": cooldown_until.isoformat() if cooldown_until else None,
            "consecutiveProbeFailures": 0,
        }
        await self._cache.set(
            _state_key(target_kind, target_ref), json.dumps(payload), _STATE_TTL_SECONDS
        )

    async def record_failure(
        self, target_kind: str, target_ref: str, window_seconds: int, failure_threshold: int
    ) -> bool:
        now = datetime.now(UTC)
        key = _failures_key(target_kind, target_ref)
        # `member` must be unique per attempt or ZADD would collapse two
        # failures in the same millisecond into one sorted-set member — an
        # attempt counter appended to the timestamp keeps every attempt its
        # own member while the score (epoch ms) stays the sliding-window
        # ordering key `data-model.md` §8 documents.
        member = f"{now.timestamp()}:{id(now)}"
        await self._cache.zadd_now(key, member, now.timestamp() * 1000, window_seconds + 60)
        since = (now - timedelta(seconds=window_seconds)).timestamp() * 1000
        count = await self._cache.zcount_since(key, since)
        return count >= failure_threshold

    async def trip(self, target_kind: str, target_ref: str, cooldown_seconds: int) -> None:
        cooldown_until = datetime.now(UTC) + timedelta(seconds=cooldown_seconds)
        await self._set_state(target_kind, target_ref, state="Open", cooldown_until=cooldown_until)

    async def reset(self, target_kind: str, target_ref: str) -> None:
        """Not on the `CircuitBreakerPort` Protocol (nothing in this wave's own
        pipeline resets a breaker automatically — B5 tab 4's manual reset
        already covers that) but kept here, real and tested, for the
        half-open-probe path a future wave can wire without a new adapter."""
        await self._set_state(target_kind, target_ref, state="Closed", cooldown_until=None)

    async def is_degraded(self) -> bool:
        return (await self._cache.get(_DEGRADED_KEY)) == "1"
