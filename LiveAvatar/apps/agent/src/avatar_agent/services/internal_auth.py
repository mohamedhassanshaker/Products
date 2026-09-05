"""Symmetric counterpart to NestJS's `InternalTokenGuard`
(`apps/api/src/common/auth/internal-token.guard.ts`) — guards *inbound*
internal HTTP calls into this Python process. New as of Phase 12a: no
inbound internal HTTP surface existed in `apps/agent` before this phase
(the existing internal-auth pattern only guarded the Python->Nest
direction). Same shared secret (`INTERNAL_TOKEN` env var, already a
`Settings` field), same header (`X-Internal-Token`), same
constant-time-comparison discipline (`hmac.compare_digest`, the stdlib
equivalent of Node's `timingSafeEqual`).
"""

from __future__ import annotations

import hmac

from fastapi import Header, HTTPException, status

from avatar_agent.settings import load_settings


async def require_internal_token(x_internal_token: str | None = Header(default=None)) -> None:
    """FastAPI dependency — raises 401 unless `x_internal_token` matches
    `Settings.internal_token` exactly (constant-time compare)."""
    settings = load_settings()
    expected = settings.internal_token
    if not expected or not x_internal_token or not hmac.compare_digest(x_internal_token, expected):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="unauthorized")
