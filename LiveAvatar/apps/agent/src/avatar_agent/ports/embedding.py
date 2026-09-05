"""`IEmbeddingProvider` — batch text-embedding port (Phase 12a, BL-044),
mirrors `ports/llm.py`'s shape. Protocol only; no implementations, no vendor
imports (`.importlinter`'s `vendor-sdk-isolation` contract enforces this at
the package level, same as every other `ports/*.py` file).
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Protocol


class EmbeddingError(Exception):
    """Raised by an adapter on any failure; classifies retry eligibility,
    mirrors `ports.llm.LlmError`."""

    def __init__(self, message: str, *, retryable: bool, code: str = "EMBEDDING_UNAVAILABLE") -> None:
        super().__init__(message)
        self.retryable = retryable
        self.code = code


class IEmbeddingProvider(Protocol):
    """Batch text-embedding port. `dimension` is fixed per adapter (the
    pgvector column this phase's index writes into is a single fixed
    width, `vector(1536)` — see ARCHITECTURE_NOTES.md §4.1/plan doc's
    Phase 12a decisions)."""

    key: str
    dimension: int

    async def embed(self, inputs: Sequence[str]) -> list[list[float]]:
        """Returns one embedding vector per input, same order. Raises
        `EmbeddingError` on failure. Returns `[]` for empty `inputs`."""
        ...
