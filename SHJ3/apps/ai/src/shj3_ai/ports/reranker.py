"""The `RerankPort` — abstracts the reranking provider (ADR-0004 rule 6, FR-KNOW-14).

`RerankUnavailableError` is the degradation seam: `application/hybrid_retrieve.py`
catches exactly this type and falls back to the unreranked hybrid order,
recording the degradation rather than failing the turn — "a rerank outage
never fails a citizen conversation."
"""

from __future__ import annotations

from typing import Protocol


class RerankUnavailableError(RuntimeError):
    """The rerank provider could not be reached, timed out, or refused the request."""


class RerankPort(Protocol):
    async def rerank(self, query: str, documents: list[str], model: str) -> list[int]:
        """Return `documents`' indices in reranked order (best first).

        Raises :class:`RerankUnavailableError` rather than returning a
        degraded result silently — the caller decides what "degraded" means
        for its own response shape, this port just tells the truth about
        whether reranking happened.
        """
