"""FR-ALERT-3 degraded-mode spoken message throttle (LLD §8.4).

When both LLM legs are exhausted, the session stays `active` and — if TTS
is still reachable — speaks `alerts.degraded_mode_message` at most once per
30 seconds per session, so a run of consecutive failed utterances doesn't
repeat the message on every turn.
"""

from __future__ import annotations

import time
from collections.abc import Callable

_COOLDOWN_SECONDS = 30.0


class DegradedModeThrottle:
    """One instance per session (LLD §9.2's `SessionState`)."""

    def __init__(self, cooldown_seconds: float = _COOLDOWN_SECONDS, clock: Callable[[], float] = time.monotonic) -> None:
        self._cooldown = cooldown_seconds
        self._clock = clock
        self._last_spoken_at: float | None = None

    def should_speak(self) -> bool:
        """@returns: `True` (and starts a new cooldown window) exactly once
        per `cooldown_seconds`; `False` otherwise.
        """
        now = self._clock()
        if self._last_spoken_at is None or now - self._last_spoken_at >= self._cooldown:
            self._last_spoken_at = now
            return True
        return False
