"""In-process runtime readiness state for ``shj3-ai``.

Why this module exists
-----------------------
deployment.md §7.4 rule 2 requires a real ``/readyz`` check for shj3-ai: model
clients initialised AND ``active_turns < SHJ3_AI_MAX_CONCURRENT_TURNS``.
Neither signal existed anywhere in this codebase before this module —
confirmed by search before writing it: no model-client construction code
exists yet (``app.py``'s own doc comment names boot-time init as
``entrypoint``/B-5's future job, and ``ports``/``application`` are still
empty packages), and nothing anywhere tracked a concurrent-turn count. This
module is the minimal, real plumbing ``/readyz`` needs today, so that B-5's
real agent runtime has an existing, real hook to call rather than needing to
invent this mechanism itself later.

What "ready" honestly means right now — read before assuming a deployed
pod will pass this probe
--------------------------------------------------------------------------
``model_clients_ready()`` starts ``False`` and stays ``False`` until
something calls :func:`mark_model_clients_ready`. **Nothing calls it yet.**
There is no LiteLLM router construction and no provider handshake anywhere
in this codebase — that is B-5, not built. Defaulting this flag to ``True``
would report a pod that cannot actually run a conversation as fit to receive
one, which is exactly the "looks right but isn't" shortcut this project's
CLAUDE.md rules out — so it is not done here as a matter of convenience.

The direct, deployed-today consequence, stated plainly rather than left to
be discovered: with this module wired into ``/readyz`` and nothing yet
calling :func:`mark_model_clients_ready`, **every ``shj3-ai`` pod deployed
by this chart will sit at Ready=false forever**, and the ``shj3-ai``
Service will have zero endpoints, until B-5's real startup sequence calls
that function for real. This is not a bug in this module or in the Helm
chart that consumes it — it is this endpoint honestly reporting that the
thing it is asked about (a working agent runtime) does not exist yet.

The active-turn counter, by contrast, is meaningfully real *today* even
though nothing increments it outside tests yet: :func:`turn_started` /
:func:`turn_finished` are real, thread-safe operations against a real
module-level count, ready for B-5's turn-execution loop to call directly
around a real turn (or via the :func:`track_turn` context manager below, so
an exception mid-turn cannot leak the count upward forever). Its default
state — zero active turns — is not a fabrication the way a hardcoded
"ready" would be: zero is the true count of a process that is not currently
running any turns, because it cannot run any yet.

Not implemented here, flagged rather than silently dropped: deployment.md
§7.4 rule 2's own prose also lists a third not-ready condition, "the tenant
registry is unreadable". Out of scope for this pass — a real check needs
its own design (which connection, which schema, timeout behaviour under
load while still being cheap enough to poll every 5s) and belongs with
whoever wires real per-tenant data access into the agent runtime, not
bolted on here as an afterthought. Tracked in tasks/todo.md's Phase C
review rather than dropped without a trace.

Thread-safety
-------------
``SHJ3_AI_ROLE=api`` serves requests through Uvicorn's asyncio event loop,
but FastAPI dispatches sync ``def`` route handlers — and this module's real
future caller, a turn-execution loop, may call from a sync context too — to
a worker thread pool. So the counter is guarded by a real
:class:`threading.Lock` rather than relying on the GIL's per-bytecode
atomicity, which is an implementation detail this code should not depend on.
"""

from __future__ import annotations

import threading
from collections.abc import Iterator
from contextlib import contextmanager

_lock = threading.Lock()
_active_turns = 0
_model_clients_ready = False


def turn_started() -> None:
    """Record that one more turn is now in flight.

    Call at the real start of a turn. Prefer :func:`track_turn` where a
    context manager fits the call site — it guarantees the matching
    decrement even when the turn raises.
    """
    global _active_turns
    with _lock:
        _active_turns += 1


def turn_finished() -> None:
    """Record that one turn has completed, successfully or not.

    Floors at zero rather than going negative if ever called without a
    matching :func:`turn_started` — that would itself be a caller bug, but a
    readiness signal must never report a nonsensical negative count.
    """
    global _active_turns
    with _lock:
        _active_turns = max(0, _active_turns - 1)


@contextmanager
def track_turn() -> Iterator[None]:
    """``with track_turn():`` around one real turn — decrements even on an exception."""
    turn_started()
    try:
        yield
    finally:
        turn_finished()


def active_turn_count() -> int:
    """The real, current number of in-flight turns on this process."""
    with _lock:
        return _active_turns


def mark_model_clients_ready() -> None:
    """Flip the readiness flag once real model-client construction succeeds.

    Not called anywhere in this codebase yet — see the module doc comment.
    This is the exact hook B-5's real startup sequence must call.
    """
    global _model_clients_ready
    with _lock:
        _model_clients_ready = True


def mark_model_clients_not_ready() -> None:
    """Flip the readiness flag back off — e.g. a provider handshake that later fails health checks."""
    global _model_clients_ready
    with _lock:
        _model_clients_ready = False


def model_clients_ready() -> bool:
    """Whether a real model-client init routine has ever reported success."""
    with _lock:
        return _model_clients_ready


def reset_for_testing() -> None:
    """Reset all module state to its boot default. Tests only.

    Production has no caller for this — the whole point of process-lifetime
    state is that it is not resettable outside a restart.
    """
    global _active_turns, _model_clients_ready
    with _lock:
        _active_turns = 0
        _model_clients_ready = False
