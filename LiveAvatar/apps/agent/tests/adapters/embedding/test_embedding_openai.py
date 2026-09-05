"""Unit tests for the OpenAI embedding vendor adapter, mocking the SDK
client boundary exactly like `tests/adapters/llm/test_openai.py` does for
the LLM adapter.
"""

from __future__ import annotations

from unittest.mock import AsyncMock

import httpx
import openai
import pytest

from avatar_agent.adapters.embedding.openai import OpenAiEmbeddingAdapter
from avatar_agent.ports.embedding import EmbeddingError
from avatar_agent.ports.runtime import ProviderRuntime


def runtime() -> ProviderRuntime:
    return ProviderRuntime(logical_key="embedding.openai", endpoint_url=None, api_key="sk-test", model="text-embedding-3-small")


def fake_response(status: int) -> httpx.Response:
    return httpx.Response(status, request=httpx.Request("POST", "https://api.openai.com/v1/embeddings"))


def _embedding_item(index: int, vector: list[float]):
    return type("Embedding", (), {"index": index, "embedding": vector})()


def _embeddings_response(items):
    return type("CreateEmbeddingResponse", (), {"data": items})()


async def test_embed_returns_vectors_in_input_order() -> None:
    adapter = OpenAiEmbeddingAdapter(runtime())
    adapter._client.embeddings.create = AsyncMock(
        return_value=_embeddings_response(
            [
                _embedding_item(0, [0.1, 0.2]),
                _embedding_item(1, [0.3, 0.4]),
            ]
        )
    )

    result = await adapter.embed(["a", "b"])

    assert result == [[0.1, 0.2], [0.3, 0.4]]
    adapter._client.embeddings.create.assert_awaited_once_with(model="text-embedding-3-small", input=["a", "b"])


async def test_embed_defensively_resorts_an_out_of_order_response() -> None:
    """Never assume vendor ordering without checking — even though the
    vendor documents in-order responses, this adapter re-sorts by `.index`.
    """
    adapter = OpenAiEmbeddingAdapter(runtime())
    adapter._client.embeddings.create = AsyncMock(
        return_value=_embeddings_response(
            [
                _embedding_item(1, [0.3, 0.4]),
                _embedding_item(0, [0.1, 0.2]),
            ]
        )
    )

    result = await adapter.embed(["a", "b"])

    assert result == [[0.1, 0.2], [0.3, 0.4]]


async def test_embed_returns_empty_list_for_empty_inputs_without_calling_the_vendor() -> None:
    adapter = OpenAiEmbeddingAdapter(runtime())
    adapter._client.embeddings.create = AsyncMock()

    result = await adapter.embed([])

    assert result == []
    adapter._client.embeddings.create.assert_not_awaited()


async def test_embed_maps_authentication_error_to_non_retryable() -> None:
    adapter = OpenAiEmbeddingAdapter(runtime())
    adapter._client.embeddings.create = AsyncMock(
        side_effect=openai.AuthenticationError("bad key", response=fake_response(401), body=None)
    )
    with pytest.raises(EmbeddingError) as exc_info:
        await adapter.embed(["a"])
    assert exc_info.value.retryable is False
    assert exc_info.value.code == "EMBEDDING_UNAVAILABLE"


async def test_embed_maps_rate_limit_to_retryable() -> None:
    adapter = OpenAiEmbeddingAdapter(runtime())
    adapter._client.embeddings.create = AsyncMock(
        side_effect=openai.RateLimitError("slow down", response=fake_response(429), body=None)
    )
    with pytest.raises(EmbeddingError) as exc_info:
        await adapter.embed(["a"])
    assert exc_info.value.retryable is True


async def test_embed_maps_timeout_to_retryable() -> None:
    adapter = OpenAiEmbeddingAdapter(runtime())
    adapter._client.embeddings.create = AsyncMock(
        side_effect=openai.APITimeoutError(request=httpx.Request("POST", "https://api.openai.com/v1/embeddings"))
    )
    with pytest.raises(EmbeddingError) as exc_info:
        await adapter.embed(["a"])
    assert exc_info.value.retryable is True


async def test_embed_maps_connection_error_to_retryable() -> None:
    adapter = OpenAiEmbeddingAdapter(runtime())
    adapter._client.embeddings.create = AsyncMock(
        side_effect=openai.APIConnectionError(request=httpx.Request("POST", "https://api.openai.com/v1/embeddings"))
    )
    with pytest.raises(EmbeddingError) as exc_info:
        await adapter.embed(["a"])
    assert exc_info.value.retryable is True


async def test_embed_maps_5xx_status_error_to_retryable() -> None:
    adapter = OpenAiEmbeddingAdapter(runtime())
    adapter._client.embeddings.create = AsyncMock(
        side_effect=openai.APIStatusError("server error", response=fake_response(500), body=None)
    )
    with pytest.raises(EmbeddingError) as exc_info:
        await adapter.embed(["a"])
    assert exc_info.value.retryable is True


async def test_embed_maps_4xx_status_error_to_non_retryable() -> None:
    adapter = OpenAiEmbeddingAdapter(runtime())
    adapter._client.embeddings.create = AsyncMock(
        side_effect=openai.APIStatusError("bad request", response=fake_response(400), body=None)
    )
    with pytest.raises(EmbeddingError) as exc_info:
        await adapter.embed(["a"])
    assert exc_info.value.retryable is False


async def test_embed_maps_a_wholly_unanticipated_sdk_error_to_non_retryable() -> None:
    adapter = OpenAiEmbeddingAdapter(runtime())
    adapter._client.embeddings.create = AsyncMock(side_effect=RuntimeError("something new in a future SDK"))
    with pytest.raises(EmbeddingError) as exc_info:
        await adapter.embed(["a"])
    assert exc_info.value.retryable is False


async def test_embed_falls_back_to_the_default_model_when_runtime_model_is_none() -> None:
    runtime_no_model = ProviderRuntime(logical_key="embedding.openai", endpoint_url=None, api_key="sk-test", model=None)
    adapter = OpenAiEmbeddingAdapter(runtime_no_model)
    adapter._client.embeddings.create = AsyncMock(return_value=_embeddings_response([_embedding_item(0, [0.1])]))

    await adapter.embed(["a"])

    adapter._client.embeddings.create.assert_awaited_once_with(model="text-embedding-3-small", input=["a"])
