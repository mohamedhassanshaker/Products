"""The `EmbeddingPort` — abstracts the embedding model provider (ADR-0004).

No degradation path here either: an embedding failure at ingestion time fails
that chunk honestly (`vectorState='Failed'`), and an embedding failure at
query time is a genuine retrieval failure — there is nothing to "degrade to"
if the query itself cannot be embedded, unlike reranking (which is additive
re-ordering on top of an already-usable result set).
"""

from __future__ import annotations

from typing import Protocol


class EmbeddingPort(Protocol):
    async def embed(self, texts: list[str], model: str) -> list[list[float]]:
        """One embedding vector per input text, in the same order."""
