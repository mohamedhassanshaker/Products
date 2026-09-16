"""Embedding provider adapters (ADR-0004).

Two implementations, selected by `embedder_from_environment()` on whether
`SHJ3_OPENAI_API_KEY` is set:

* `OpenAiEmbedder` — the real thing, `text-embedding-3-large` via the `openai`
  SDK.
* `DeterministicLocalEmbedder` — a hash-based fallback with no network call
  and no API key, used automatically in a dev/test environment where no key
  is configured. It is deterministic (the same text always embeds to the same
  vector) and dimension-correct, so the rest of the ingestion/retrieval
  pipeline — chunking, Qdrant upsert/search, hybrid scoring — is exercisable
  and provable against real Neo4j/Qdrant/SQL Server infrastructure without a
  live OpenAI key. It is not a semantically meaningful embedding (cosine
  similarity between two hash vectors carries no relationship to the text's
  actual meaning) — this is stated plainly so nobody mistakes a live-infra
  proof run under this fallback for a retrieval-quality claim.
"""

from __future__ import annotations

import hashlib
import os

from shj3_ai.ports.embedding import EmbeddingPort


class OpenAiEmbedder:
    """The real embedding adapter. Structural, per this codebase's port convention."""

    __slots__ = ("_client",)

    def __init__(self, client: object) -> None:
        self._client = client

    async def embed(self, texts: list[str], model: str) -> list[list[float]]:
        if not texts:
            return []
        # `openai`'s async client shape: `embeddings.create(model=..., input=[...])`.
        response = await self._client.embeddings.create(model=model, input=texts)  # type: ignore[attr-defined]
        return [item.embedding for item in response.data]


class DeterministicLocalEmbedder:
    """Hash-based fallback embedder — see module docstring."""

    __slots__ = ("_dimension",)

    def __init__(self, dimension: int) -> None:
        self._dimension = dimension

    async def embed(self, texts: list[str], model: str) -> list[list[float]]:
        return [self._embed_one(text) for text in texts]

    def _embed_one(self, text: str) -> list[float]:
        # Repeated SHA-256 over an incrementing counter is a cheap, dependency-free
        # way to fill an arbitrary-length vector deterministically from one seed.
        vector: list[float] = []
        counter = 0
        seed = text.encode("utf-8")
        while len(vector) < self._dimension:
            digest = hashlib.sha256(seed + counter.to_bytes(4, "big")).digest()
            # Each byte becomes one component, mapped from [0, 255] to [-1, 1] and
            # normalised by 255 so the resulting vector has bounded magnitude —
            # not unit length (Qdrant's cosine distance normalises internally),
            # but comparable in scale across every vector this function produces.
            vector.extend((b / 127.5) - 1.0 for b in digest)
            counter += 1
        return vector[: self._dimension]


def embedder_from_environment(dimension: int) -> EmbeddingPort:
    """Select the real or fallback embedder by whether an API key is configured."""
    api_key = os.environ.get("SHJ3_OPENAI_API_KEY")
    if api_key:
        import openai

        return OpenAiEmbedder(openai.AsyncOpenAI(api_key=api_key))
    return DeterministicLocalEmbedder(dimension)
