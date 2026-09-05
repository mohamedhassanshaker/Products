"""`openai` embedding vendor adapter (Phase 12a, BL-044, factory key
`embedding.openai`). Only place besides `adapters/llm/openai.py` allowed to
import the `openai` SDK for this vendor (ADR-001 §3 / `.importlinter`'s
`vendor-sdk-isolation` contract).
"""

from __future__ import annotations

from collections.abc import Sequence

import openai

from avatar_agent.ports.embedding import EmbeddingError
from avatar_agent.ports.runtime import ProviderRuntime

_DEFAULT_MODEL = "text-embedding-3-small"
_DIMENSION = 1536


class OpenAiEmbeddingAdapter:
    """`IEmbeddingProvider` implementation over the OpenAI embeddings API."""

    key = "openai"
    dimension = _DIMENSION

    def __init__(self, runtime: ProviderRuntime) -> None:
        self._runtime = runtime
        self._client = openai.AsyncOpenAI(
            api_key=runtime.api_key,
            base_url=runtime.endpoint_url,
            timeout=runtime.timeouts.request_ms / 1000,
        )

    def _classify(self, err: Exception) -> EmbeddingError:
        """Mirrors `adapters.llm.openai.OpenAiLlmAdapter._classify` — same
        vendor exception taxonomy, this port's own error type."""
        if isinstance(err, openai.AuthenticationError):
            return EmbeddingError("openai authentication failed.", retryable=False, code="EMBEDDING_UNAVAILABLE")
        if isinstance(err, (openai.RateLimitError, openai.APITimeoutError, openai.APIConnectionError)):
            return EmbeddingError("openai is temporarily unavailable.", retryable=True, code="EMBEDDING_UNAVAILABLE")
        if isinstance(err, openai.APIStatusError):
            return EmbeddingError("openai request failed.", retryable=err.status_code >= 500, code="EMBEDDING_UNAVAILABLE")
        return EmbeddingError("openai request failed.", retryable=False, code="EMBEDDING_UNAVAILABLE")

    async def embed(self, inputs: Sequence[str]) -> list[list[float]]:
        """@inheritdoc"""
        if not inputs:
            return []
        try:
            response = await self._client.embeddings.create(
                model=self._runtime.model or _DEFAULT_MODEL,
                input=list(inputs),
            )
        except Exception as err:  # noqa: BLE001 - reclassified into the port's own error type
            raise self._classify(err) from err
        # Defensive re-sort by `.index` even though the vendor documents
        # in-order responses -- never assume ordering without checking.
        ordered = sorted(response.data, key=lambda item: item.index)
        return [list(item.embedding) for item in ordered]
