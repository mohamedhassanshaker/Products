"""Reranking provider adapter (ADR-0004 rule 6, FR-KNOW-14).

`CohereReranker.rerank` raises `RerankUnavailableError` on **any** failure —
network, auth, timeout, an empty/malformed response — rather than letting a
vendor exception escape. `application/hybrid_retrieve.py` catches exactly
that type to degrade to the unreranked hybrid order: "a rerank outage never
fails a citizen conversation" is enforced here, at the one seam that can
raise it, not by every caller remembering to catch a Cohere-specific
exception.
"""

from __future__ import annotations

import os

from shj3_ai.ports.reranker import RerankPort, RerankUnavailableError


class CohereReranker:
    """The real reranker. Structural, per this codebase's port convention."""

    __slots__ = ("_client",)

    def __init__(self, client: object) -> None:
        self._client = client

    async def rerank(self, query: str, documents: list[str], model: str) -> list[int]:
        if not documents:
            return []
        try:
            response = await self._client.rerank(  # type: ignore[attr-defined]
                model=model, query=query, documents=documents
            )
        except Exception as exc:
            raise RerankUnavailableError(f"Cohere rerank failed: {exc}") from exc

        results = getattr(response, "results", None)
        if not results:
            raise RerankUnavailableError("Cohere rerank returned no results")
        try:
            return [int(r.index) for r in results]
        except (AttributeError, TypeError, ValueError) as exc:
            raise RerankUnavailableError(
                f"Cohere rerank returned an unexpected shape: {exc}"
            ) from exc


def reranker_from_environment() -> RerankPort | None:
    """`None` when no API key is configured — the caller (`hybrid_retrieve.py`)
    treats a `None` reranker exactly like a raised `RerankUnavailableError`
    (see its own docstring), so "no key configured" and "the provider is down"
    degrade through the identical code path rather than two.
    """
    api_key = os.environ.get("SHJ3_COHERE_API_KEY")
    if not api_key:
        return None
    import cohere

    return CohereReranker(cohere.AsyncClientV2(api_key=api_key))
