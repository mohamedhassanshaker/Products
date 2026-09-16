"""Liveness and readiness endpoints for ``shj3-ai`` / ``shj3-worker``.

Why this exists
----------------
Neither the Docker Compose ``ai``/``worker`` services nor a container
``HEALTHCHECK`` had anything to probe before this: confirmed by search, no
``/healthz`` (or equivalently-named) route existed anywhere in this service.
deployment.md §5.4 already documents the intended response shape and §7.4
names ``/healthz`` as the endpoint both the Kubernetes startup/liveness probes
and this repo's own Docker healthcheck should hit.

Liveness, not readiness — deliberately, mirroring the web tier
----------------------------------------------------------------
``apps/web/src/app/api/healthz/route.ts`` states the same reasoning: a
liveness probe that depends on a downstream store causes an orchestrator to
restart a perfectly healthy process during a database blip, trading a
recoverable slowdown for an unrecoverable restart storm. So ``/healthz``
answers only "is the process up and able to answer HTTP requests", never "can
it currently reach SQL Server / Neo4j / Qdrant / Redis / a model provider".

``/readyz`` — added for the Kubernetes/Helm wave (deployment.md §7.4 rule 2)
-----------------------------------------------------------------------------
Dependency- and concurrency-aware, deliberately unlike ``/healthz``: gates
traffic when model clients are not yet warm, or when
``active_turns >= SHJ3_AI_MAX_CONCURRENT_TURNS`` (sheds load to other pods
instead of queueing inside one). Backed by :mod:`shj3_ai.runtime_state` —
read that module's own doc comment before assuming this will report "ready"
on a freshly deployed pod. It will not, until B-5's real agent runtime calls
:func:`shj3_ai.runtime_state.mark_model_clients_ready`: nothing in this
codebase does yet, and reporting ready anyway would misrepresent a pod that
cannot serve a real conversation as fit to receive one. The active-turn half
of the check is fully real today even so — see the module doc comment for
why that half is not the same kind of gap.

Deliberately not implemented here (flagged, not silently dropped): §7.4 rule
2's prose also names a third not-ready condition, "the tenant registry is
unreadable" — out of scope for this pass, see ``runtime_state.py``.

Version/revision fields are honest, not aspirational
-------------------------------------------------------
deployment.md §5.4's illustrative response also carries a ``residency``
field. That field is deliberately NOT reproduced here: there is no real
config source for a residency zone anywhere in this codebase today (RISK-001
is still open), and fabricating one to match a doc's illustrative example
would be exactly the "looks right but isn't" shortcut this project's own
CLAUDE.md rules out. ``version``/``gitSha`` ARE wired for real, from the same
``SHJ3_RELEASE_VERSION``/``SHJ3_GIT_SHA`` build-time values ``docker/
ai.Dockerfile`` bakes in as image labels — both default to an explicit
``"unknown"`` rather than a fabricated value when absent (e.g. a bare `uvicorn`
run outside Docker), so a caller can tell "not set" from "actually this
version" at a glance.
"""

from __future__ import annotations

import os

from fastapi import APIRouter, Response, status
from pydantic import BaseModel

from shj3_ai.runtime_state import active_turn_count, model_clients_ready

router = APIRouter(tags=["health"])

#: deployment.md §16 var #21. Kept as a local default matching .env.example
#: rather than imported from a settings module — there isn't one yet on the
#: Python side (see entrypoint.py's own doc comment on that gap).
_DEFAULT_MAX_CONCURRENT_TURNS = 24


class HealthResponse(BaseModel):
    status: str
    version: str
    git_sha: str
    env: str


class ReadinessResponse(BaseModel):
    status: str
    model_clients_ready: bool
    active_turns: int
    max_concurrent_turns: int


@router.get("/healthz", response_model=HealthResponse)
async def healthz() -> HealthResponse:
    return HealthResponse(
        status="ok",
        version=os.environ.get("SHJ3_RELEASE_VERSION", "unknown"),
        git_sha=os.environ.get("SHJ3_GIT_SHA", "unknown"),
        env=os.environ.get("SHJ3_ENVIRONMENT", "unknown"),
    )


@router.get("/readyz", response_model=ReadinessResponse)
async def readyz(response: Response) -> ReadinessResponse:
    """Real dependency/concurrency readiness check — see the module doc comment.

    Sets a 503 status when not ready (Kubernetes readinessProbe: non-2xx
    removes the pod from Service endpoints, no restart) rather than raising —
    an HTTPException here would still be a 5xx, but returning a normal,
    fully-typed body alongside the 503 is more diagnosable for a human hitting
    this directly than an exception's generic error envelope.
    """
    max_turns = int(
        os.environ.get("SHJ3_AI_MAX_CONCURRENT_TURNS", str(_DEFAULT_MAX_CONCURRENT_TURNS))
    )
    active = active_turn_count()
    clients_ready = model_clients_ready()
    ready = clients_ready and active < max_turns

    if not ready:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE

    return ReadinessResponse(
        status="ok" if ready else "not_ready",
        model_clients_ready=clients_ready,
        active_turns=active,
        max_concurrent_turns=max_turns,
    )
