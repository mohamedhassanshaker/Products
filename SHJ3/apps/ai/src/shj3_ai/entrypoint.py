"""Process entrypoint for the ``shj3-ai`` Docker image — ``python -m shj3_ai.entrypoint``.

Why this module exists, and what it deliberately does not do
------------------------------------------------------------
``app.py``'s own doc comment named this module before it existed: "This is
not ``shj3_ai.entrypoint``, the module deployment.md §5.3's Dockerfile
``ENTRYPOINT`` names and that dispatches on ``SHJ3_AI_ROLE`` (#20) between the
``api`` and ``worker`` workloads." ADR-0001 constraint 1 is why there are two
workloads sharing one image at all: background work is a replica of
``shj3-ai`` with another role, never a third deployable, so one Dockerfile and
one entrypoint dispatching on a role env var is the whole mechanism — not two
Dockerfiles, not a second FastAPI app.

This module deliberately builds ONLY that dispatch, nothing else:

* ``api`` imports and serves the real, already-built :data:`shj3_ai.app.app`
  via ``uvicorn`` — no second app object, per ``app.py``'s own instruction.
* ``worker`` has **no real job/queue-consumer logic to run yet.** Confirmed by
  search before writing this: no celery/arq/rq dependency exists in
  ``pyproject.toml``, nothing reads ``SHJ3_AI_ROLE`` anywhere in this codebase
  today, and ``prisma/tenant/schema.prisma``'s ``OutboxEvent`` model (the
  reconciliation mechanism ADR-0003 rule 4 and deployment.md's reconciliation
  sweep both describe) is migrated but unread by any application code —
  ``tasks/todo.md``'s own Phase B checklist still lists "Outbox +
  reconciliation; re-index job history" as unbuilt. Inventing a fake
  reconciliation loop here, just to give the ``worker`` role something to do,
  would ship code that *looks* like the real mechanism while doing nothing —
  worse than admitting the gap, and exactly the "looks right but isn't"
  shortcut this project's CLAUDE.md rules out. So the worker path logs a
  clear, honest, structured statement that no scheduled jobs are implemented
  yet and idles, keeping the container alive (and out of a crash-loop) for
  Compose/Kubernetes without pretending to do real work. Replace the ``_run_
  worker`` body with the real reconciliation loop when that wave is built —
  this dispatch shell does not need to change when it is.

Boot-time role validation
--------------------------
An unrecognised ``SHJ3_AI_ROLE`` fails immediately with a clear message
rather than silently falling back to a default — the same "refuse to start
rather than run in an unintended mode" posture ``.env.example`` documents for
missing secrets (config.ts's boot-time validation on the web side has no
Python equivalent yet; this is the one boot-time check this module owns).
"""

from __future__ import annotations

import logging
import os
import sys
import time

logging.basicConfig(
    level=os.environ.get("SHJ3_LOG_LEVEL", "info").upper(),
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger("shj3_ai.entrypoint")

_VALID_ROLES = ("api", "worker")


def _run_api() -> None:
    """Serve the real FastAPI app (``app.py``'s ``app``) over HTTP."""
    import uvicorn

    host = os.environ.get("SHJ3_AI_HOST", "0.0.0.0")  # noqa: S104 — container-internal bind, fronted by the compose/K8s network boundary, not exposed directly
    port = int(os.environ.get("SHJ3_AI_PORT", "8000"))
    logger.info("shj3-ai starting: role=api host=%s port=%d", host, port)
    uvicorn.run("shj3_ai.app:app", host=host, port=port, log_config=None)


def _run_worker() -> None:
    """Idle honestly. See the module doc comment for why there is nothing real to run yet."""
    logger.warning(
        "shj3-ai starting: role=worker — no scheduled jobs are implemented yet "
        "(outbox reconciliation is migrated but unread by any application code; "
        "see tasks/todo.md Phase B). Idling to stay out of a crash-loop rather "
        "than simulating work that does not exist."
    )
    while True:
        time.sleep(3600)


def main() -> None:
    role = os.environ.get("SHJ3_AI_ROLE", "api")
    if role not in _VALID_ROLES:
        logger.error("Unrecognised SHJ3_AI_ROLE=%r — expected one of %s", role, _VALID_ROLES)
        sys.exit(1)
    if role == "api":
        _run_api()
    else:
        _run_worker()


if __name__ == "__main__":
    main()
