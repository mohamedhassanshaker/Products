"""Unit tests for the Google (Gemini) vendor adapter, mocking the SDK client boundary."""

from __future__ import annotations

import pytest
from google.genai import errors as genai_errors
from pydantic import BaseModel

from avatar_agent.adapters.llm.google import GoogleLlmAdapter
from avatar_agent.ports.llm import LlmError, ResidencyPayload
from avatar_agent.ports.runtime import ProviderRuntime


def runtime() -> ProviderRuntime:
    return ProviderRuntime(logical_key="llm.google", endpoint_url=None, api_key="k", model="gemini-1.5-pro")


def residency() -> ResidencyPayload:
    return ResidencyPayload(system_prompt="sys", messages=[{"role": "user", "content": "hi"}])


class Summary(BaseModel):
    summary_text: str


def make_client_error(code: int) -> genai_errors.ClientError:
    err = genai_errors.ClientError.__new__(genai_errors.ClientError)
    err.code = code
    Exception.__init__(err, f"client error {code}")
    return err


async def test_complete_stream_yields_deltas_then_done() -> None:
    adapter = GoogleLlmAdapter(runtime())

    class Chunk:
        def __init__(self, text: str, function_calls: list | None = None) -> None:
            self.text = text
            self.function_calls = function_calls

    async def _gen():
        yield Chunk("Hel")
        yield Chunk("lo")

    async def _stream(**kwargs):
        return _gen()

    adapter._client.aio.models.generate_content_stream = _stream

    stream = await adapter.complete_stream([], [], residency())
    chunks = [c async for c in stream]

    assert chunks[0] == {"delta": "Hel", "done": False}
    assert chunks[-1] == {"delta": "", "done": True, "tool_calls": []}


async def test_complete_stream_extracts_function_calls_from_chunks() -> None:
    adapter = GoogleLlmAdapter(runtime())

    class FunctionCall:
        def __init__(self, name: str, args: dict) -> None:
            self.name = name
            self.args = args

    class Chunk:
        def __init__(self, text: str | None, function_calls: list | None = None) -> None:
            self.text = text
            self.function_calls = function_calls

    async def _gen():
        yield Chunk(None, [FunctionCall("get_weather", {"city": "nyc"})])

    async def _stream(**kwargs):
        return _gen()

    adapter._client.aio.models.generate_content_stream = _stream

    stream = await adapter.complete_stream([], [], residency())
    chunks = [c async for c in stream]

    assert chunks[-1]["tool_calls"] == [{"id": "get_weather-1", "name": "get_weather", "arguments": {"city": "nyc"}}]


async def test_complete_stream_maps_404_client_error_to_llm_model_not_found() -> None:
    adapter = GoogleLlmAdapter(runtime())

    async def _stream(**kwargs):
        raise make_client_error(404)

    adapter._client.aio.models.generate_content_stream = _stream

    result = await adapter.complete_stream([], [], residency())
    with pytest.raises(LlmError) as exc_info:
        async for _ in result:
            pass
    assert exc_info.value.code == "LLM_MODEL_NOT_FOUND"


async def test_complete_stream_maps_401_client_error_to_non_retryable() -> None:
    adapter = GoogleLlmAdapter(runtime())

    async def _stream(**kwargs):
        raise make_client_error(401)

    adapter._client.aio.models.generate_content_stream = _stream

    result = await adapter.complete_stream([], [], residency())
    with pytest.raises(LlmError) as exc_info:
        async for _ in result:
            pass
    assert exc_info.value.retryable is False


async def test_complete_stream_maps_429_client_error_to_retryable() -> None:
    adapter = GoogleLlmAdapter(runtime())

    async def _stream(**kwargs):
        raise make_client_error(429)

    adapter._client.aio.models.generate_content_stream = _stream

    result = await adapter.complete_stream([], [], residency())
    with pytest.raises(LlmError) as exc_info:
        async for _ in result:
            pass
    assert exc_info.value.retryable is True


async def test_complete_structured_revalidates_the_parsed_dict() -> None:
    adapter = GoogleLlmAdapter(runtime())

    class Response:
        parsed = {"summary_text": "a summary"}

    async def _generate(**kwargs):
        return Response()

    adapter._client.aio.models.generate_content = _generate

    result = await adapter.complete_structured([], Summary, residency())
    assert result == Summary(summary_text="a summary")


async def test_complete_structured_raises_when_no_parsed_content() -> None:
    adapter = GoogleLlmAdapter(runtime())

    class Response:
        parsed = None

    async def _generate(**kwargs):
        return Response()

    adapter._client.aio.models.generate_content = _generate

    with pytest.raises(LlmError):
        await adapter.complete_structured([], Summary, residency())


async def test_complete_structured_maps_a_revalidation_failure_to_llm_error() -> None:
    """QA D-5 gap-class sweep: the request was already classified, but the
    re-validation of a non-conforming "constrained" response was outside the
    guarded block and could leak a raw `pydantic.ValidationError`.
    """
    adapter = GoogleLlmAdapter(runtime())

    class Response:
        parsed = {"unrelated_field": 1}  # no `summary_text` -> ValidationError

    async def _generate(**kwargs):
        return Response()

    adapter._client.aio.models.generate_content = _generate

    with pytest.raises(LlmError):
        await adapter.complete_structured([], Summary, residency())
