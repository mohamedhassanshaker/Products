"""Registry-level errors (LLD §7.1's `FactoryLoadError` → degraded/abort per FR-PROVIDER-4)."""

from __future__ import annotations


class FactoryLoadError(Exception):
    """Raised when a logical key has no factory, or the resolved adapter
    fails to satisfy its Protocol at session start.

    The caller (pipeline/entrypoint) decides whether this is fatal
    (`STT_UNAVAILABLE` → session `failed`, since STT is required in v1) or
    tolerable (an avatar adapter not existing yet → audio-only, FR-AVATAR-5).
    """

    def __init__(self, message: str, *, logical_key: str) -> None:
        super().__init__(message)
        self.logical_key = logical_key
