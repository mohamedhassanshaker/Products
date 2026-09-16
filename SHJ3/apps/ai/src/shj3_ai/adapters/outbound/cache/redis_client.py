"""The one Redis client construction site for `shj3-ai` (`no-unscoped-store-clients`'
Python analogue — matching `engine.py`'s lazy, process-wide, fail-loudly-and-late
convention rather than introducing a second pattern).

Every caller reaches this through `TenantCache` below, never the raw client —
the same "prefix applied by a wrapper that owns the only reference" reasoning
`apps/web/.../tenant-cache.ts`'s own module docstring gives, ported here rather
than re-derived: Redis's isolation unit is a key prefix, and a prefix that can
only be produced by one wrapper is a rule that holds structurally rather than
one that has to be remembered at every call site.
"""

from __future__ import annotations

import os
from typing import Any, cast

import redis.asyncio as redis_asyncio

from shj3_ai.domain.tenancy import TenantSlug

_client: redis_asyncio.Redis | None = None


def _url() -> str:
    url = os.environ.get("SHJ3_REDIS_URL")
    if not url:
        raise RuntimeError(
            "SHJ3_REDIS_URL is not set. The process should have refused to start — check the "
            "boot-time config validation."
        )
    return url


def _connection() -> redis_asyncio.Redis:
    global _client
    if _client is None:
        _client = redis_asyncio.from_url(_url(), decode_responses=True)
    return _client


class TenantCache:
    """A tenant-scoped Redis handle. Deliberately narrow — only the commands
    this wave's adapters actually need (`data-model.md` §8 keys #1, #2, #4,
    #5, #6), not a passthrough of the whole Redis API."""

    __slots__ = ("_prefix",)

    def __init__(self, tenant: TenantSlug) -> None:
        self._prefix = tenant.cache_prefix

    def _k(self, key: str) -> str:
        return f"{self._prefix}{key}"

    async def get(self, key: str) -> str | None:
        # redis-py's stubs type every reply as `bytes | str | ...` because the
        # same client class serves both binary and (via `decode_responses`)
        # text mode — `_connection()` is always constructed with
        # `decode_responses=True` (see that factory), so every real reply
        # this process ever receives is already `str`. The cast documents
        # that runtime guarantee rather than erasing it to `object`.
        value = await _connection().get(self._k(key))
        return cast("str | None", value)

    async def set(self, key: str, value: str, ttl_seconds: int | None = None) -> None:
        await _connection().set(self._k(key), value, ex=ttl_seconds)

    async def delete(self, key: str) -> None:
        await _connection().delete(self._k(key))

    async def hgetall(self, key: str) -> dict[str, str]:
        result = await _connection().hgetall(self._k(key))
        return cast("dict[str, str]", result)

    async def hset(self, key: str, mapping: dict[str, str], ttl_seconds: int | None = None) -> None:
        client = _connection()
        # Same stub-precision gap as `get`/`hgetall` above, the other
        # direction: redis-py's `hset` stub accepts a wider key/value union
        # than `dict[str, str]` structurally satisfies under mypy's strict
        # invariance for `dict`. `Any` here is the documented escape hatch
        # (`disallow_any_explicit = false`), not a loosening of this
        # module's own `dict[str, str]` contract with its callers.
        await client.hset(self._k(key), mapping=cast(Any, mapping))
        if ttl_seconds is not None:
            await client.expire(self._k(key), ttl_seconds)

    async def zadd_now(self, key: str, member: str, score: float, ttl_seconds: int) -> None:
        client = _connection()
        full_key = self._k(key)
        await client.zadd(full_key, {member: score})
        await client.expire(full_key, ttl_seconds)

    async def zcount_since(self, key: str, since_score: float) -> int:
        return await _connection().zcount(self._k(key), since_score, "+inf")


async def disconnect_cache() -> None:
    """Shutdown, and between integration tests — matches `disconnectCache()`'s
    TypeScript sibling."""
    global _client
    client = _client
    _client = None
    if client is not None:
        await client.aclose()
