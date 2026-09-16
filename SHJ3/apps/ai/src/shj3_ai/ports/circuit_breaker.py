"""The `CircuitBreakerPort` — live breaker state, `data-model.md` §8 keys #4-#6.

Config lives in SQL (`ConfigReader.get_circuit_breaker_config`); this port is
Redis-only live state, mirroring `CircuitBreakerConfig`'s own doc comment ("a
breaker tripped on one pod is tripped on all") and B-3's already-shipped
TypeScript sibling (`apps/web/.../redis-circuit-breaker-state-store.ts`) for the
manual trip/reset half of key #4. This wave adds the half B-3's own doc comment
named as deliberately out of scope for it: **automatic** threshold-breach
detection, key #5's sliding-window failure set — the runtime is the first caller
that can actually observe a tool-call failure to count.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True, slots=True)
class BreakerLiveState:
    """`state` uses the real, live wire values — `"Closed"` | `"Open"` |
    `"HalfOpen"` (`BREAKER_TRANSITIONS` in `apps/web/.../domain/circuit-breaker.ts`)
    — **not** `data-model.md` §8's own lower-cased illustration, which is stale
    relative to the already-shipped, already-tested TS adapter this port must
    interoperate with (this project's own "doc can drift from an already-tested
    sibling" lesson, checked directly against the real TS source rather than
    the doc before this port was written)."""

    state: str
    consecutive_probe_failures: int = 0


class CircuitBreakerPort(Protocol):
    async def get_state(self, target_kind: str, target_ref: str) -> BreakerLiveState:
        """Never raises for "no key yet" — returns the closed default, matching
        the TS sibling's own reasoning (`DEFAULT_BREAKER_STATE`)."""

    async def record_failure(
        self, target_kind: str, target_ref: str, window_seconds: int, failure_threshold: int
    ) -> bool:
        """Append one failure timestamp to key #5's sliding window (ZADD), prune
        entries older than the window, and return whether the count now meets
        `failure_threshold` — the trip test data-model.md §8 documents. Does
        **not** itself flip key #4's state; the caller (`SkillInvoker`) does that
        via `trip()` so the "count crossed the threshold" and "the breaker is now
        open" moments are two separately-observable, separately-testable steps."""

    async def trip(self, target_kind: str, target_ref: str, cooldown_seconds: int) -> None:
        """Automatic trip — `ThresholdBreached`, the one `BreakerEventReason`
        B-3's own adapter never produces. Sets key #4 to `open` with
        `cooldownUntil = now + cooldown_seconds` — real, immediate, shared
        across every pod (Redis is the live-state source of truth).

        **Deliberately does not also write a durable `CircuitBreakerEvents` row.**
        `prisma/sql/002_tenant_grants.sql` grants `shj3_ai_ro` no INSERT on that
        table (only `shj3_app`, the web-tier principal, holds it) — B-3 already
        owns the table's write path for the manual trip/reset it built. Extending
        that grant to the AI runtime for one automatic-transition row would
        widen a deliberately narrow, already-shipped boundary for a single
        caller; the correct fix is a small reconciliation write from
        `shj3-web` (observe the Redis transition, append the ledger row),
        left for whoever next owns B5 tab 4's automatic-trip history — named
        here rather than worked around by writing to a table this principal
        was never granted."""

    async def is_degraded(self) -> bool: ...
