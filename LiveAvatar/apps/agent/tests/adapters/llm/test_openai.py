"""Unit tests for the OpenAI vendor adapter, mocking the SDK client boundary."""

from __future__ import annotations

from unittest.mock import AsyncMock

import httpx
import openai
import pytest
from pydantic import BaseModel

from avatar_agent.adapters.llm.openai import OpenAiLlmAdapter
from avatar_agent.ports.llm import LlmError, ResidencyPayload
from avatar_agent.ports.runtime import ProviderRuntime


def runtime() -> ProviderRuntime:
    return ProviderRuntime(logical_key="llm.openai", endpoint_url=None, api_key="sk-test", model="gpt-4o")


def residency() -> ResidencyPayload:
    return ResidencyPayload(system_prompt="sys", messages=[{"role": "user", "content": "hi"}])


def fake_response(status: int) -> httpx.Response:
    return httpx.Response(status, request=httpx.Request("POST", "https://api.openai.com/v1/chat/completions"))


class Summary(BaseModel):
    summary_text: str


async def _chunks(items: list[str]) -> list[dict]:
    class Chunk:
        def __init__(self, text: str | None) -> None:
            delta = type("D", (), {"content": text, "tool_calls": None})()
            self.choices = [type("C", (), {"delta": delta})()] if text is not None else []

    async def _gen():
        for item in items:
            yield Chunk(item)

    return _gen()


def _tool_call_delta(index: int, *, call_id: str | None = None, name: str | None = None, arguments: str | None = None):
    function = type("F", (), {"name": name, "arguments": arguments})()
    return type("TC", (), {"index": index, "id": call_id, "function": function})()


async def test_complete_stream_yields_deltas_then_a_done_sentinel() -> None:
    adapter = OpenAiLlmAdapter(runtime())
    adapter._client.chat.completions.create = AsyncMock(return_value=await _chunks(["Hel", "lo"]))

    stream = await adapter.complete_stream([], [], residency())
    chunks = [c async for c in stream]

    assert chunks[0] == {"delta": "Hel", "done": False}
    assert chunks[1] == {"delta": "lo", "done": False}
    assert chunks[-1] == {"delta": "", "done": True, "tool_calls": []}
    assert adapter.first_token_ms is not None


async def test_complete_stream_accumulates_a_streamed_tool_call_across_deltas_and_parses_arguments() -> None:
    adapter = OpenAiLlmAdapter(runtime())

    class Chunk:
        def __init__(self, delta) -> None:  # noqa: ANN001
            self.choices = [type("C", (), {"delta": delta})()]

    async def _gen():
        yield Chunk(type("D", (), {"content": None, "tool_calls": [_tool_call_delta(0, call_id="call_1", name="get_weather")]})())
        yield Chunk(type("D", (), {"content": None, "tool_calls": [_tool_call_delta(0, arguments='{"city": ')]})())
        yield Chunk(type("D", (), {"content": None, "tool_calls": [_tool_call_delta(0, arguments='"nyc"}')]})())

    adapter._client.chat.completions.create = AsyncMock(return_value=_gen())

    stream = await adapter.complete_stream([], [], residency())
    chunks = [c async for c in stream]

    assert chunks[-1]["done"] is True
    assert chunks[-1]["tool_calls"] == [{"id": "call_1", "name": "get_weather", "arguments": {"city": "nyc"}}]


async def test_complete_stream_drops_a_tool_call_with_unparseable_arguments_rather_than_raising() -> None:
    adapter = OpenAiLlmAdapter(runtime())

    class Chunk:
        def __init__(self, delta) -> None:  # noqa: ANN001
            self.choices = [type("C", (), {"delta": delta})()]

    async def _gen():
        yield Chunk(
            type(
                "D",
                (),
                {"content": None, "tool_calls": [_tool_call_delta(0, call_id="call_1", name="broken", arguments="{not-json")]},
            )()
        )

    adapter._client.chat.completions.create = AsyncMock(return_value=_gen())

    stream = await adapter.complete_stream([], [], residency())
    chunks = [c async for c in stream]

    assert chunks[-1]["tool_calls"] == [{"id": "call_1", "name": "broken", "arguments": {}}]


async def test_complete_stream_maps_not_found_to_llm_model_not_found_retryable() -> None:
    adapter = OpenAiLlmAdapter(runtime())
    adapter._client.chat.completions.create = AsyncMock(
        side_effect=openai.NotFoundError("nope", response=fake_response(404), body=None)
    )
    with pytest.raises(LlmError) as exc_info:
        await adapter.complete_stream([], [], residency())
    assert exc_info.value.code == "LLM_MODEL_NOT_FOUND"
    assert exc_info.value.retryable is True


async def test_complete_stream_maps_authentication_error_to_non_retryable() -> None:
    adapter = OpenAiLlmAdapter(runtime())
    adapter._client.chat.completions.create = AsyncMock(
        side_effect=openai.AuthenticationError("bad key", response=fake_response(401), body=None)
    )
    with pytest.raises(LlmError) as exc_info:
        await adapter.complete_stream([], [], residency())
    assert exc_info.value.retryable is False


async def test_complete_stream_maps_rate_limit_to_retryable() -> None:
    adapter = OpenAiLlmAdapter(runtime())
    adapter._client.chat.completions.create = AsyncMock(
        side_effect=openai.RateLimitError("slow down", response=fake_response(429), body=None)
    )
    with pytest.raises(LlmError) as exc_info:
        await adapter.complete_stream([], [], residency())
    assert exc_info.value.retryable is True


async def test_complete_stream_maps_5xx_status_error_to_retryable() -> None:
    adapter = OpenAiLlmAdapter(runtime())
    adapter._client.chat.completions.create = AsyncMock(
        side_effect=openai.APIStatusError("server error", response=fake_response(500), body=None)
    )
    with pytest.raises(LlmError) as exc_info:
        await adapter.complete_stream([], [], residency())
    assert exc_info.value.retryable is True


async def test_complete_stream_maps_4xx_status_error_to_non_retryable() -> None:
    adapter = OpenAiLlmAdapter(runtime())
    adapter._client.chat.completions.create = AsyncMock(
        side_effect=openai.APIStatusError("bad request", response=fake_response(400), body=None)
    )
    with pytest.raises(LlmError) as exc_info:
        await adapter.complete_stream([], [], residency())
    assert exc_info.value.retryable is False


async def test_complete_structured_revalidates_the_parsed_result() -> None:
    adapter = OpenAiLlmAdapter(runtime())
    parsed = Summary(summary_text="a summary")
    completion = type("Completion", (), {"choices": [type("C", (), {"message": type("M", (), {"parsed": parsed})()})]})
    adapter._client.chat.completions.parse = AsyncMock(return_value=completion)

    result = await adapter.complete_structured([], Summary, residency())

    assert result == Summary(summary_text="a summary")


async def test_complete_structured_raises_when_the_sdk_returns_no_parsed_content() -> None:
    adapter = OpenAiLlmAdapter(runtime())
    completion = type("Completion", (), {"choices": [type("C", (), {"message": type("M", (), {"parsed": None})()})]})
    adapter._client.chat.completions.parse = AsyncMock(return_value=completion)

    with pytest.raises(LlmError):
        await adapter.complete_structured([], Summary, residency())


# --- QA D-5 (phase7-agent-summary-wiring retry 1), layer 1 of 3 -------------
# `complete_structured` previously enumerated only RateLimit/Timeout/
# Connection/APIStatus, so an AuthenticationError, a NotFoundError, an empty
# `choices` response or a pydantic ValidationError escaped as a NON-LlmError
# — out of `summary.post_call` (which only caught LlmError), out of
# `pipeline.generate_summary`, and out of `entrypoint.handle_job`'s teardown
# `finally`, skipping the terminal "ended" session event. Every one of the
# failure modes QA named is asserted below, at the adapter boundary, so this
# layer is verified independently of the two downstream safety nets.


async def test_complete_structured_maps_authentication_error_to_llm_error() -> None:
    """QA D-5's exact reproducer: a credential revoked between session start
    and end-of-call summary generation.
    """
    adapter = OpenAiLlmAdapter(runtime())
    adapter._client.chat.completions.parse = AsyncMock(
        side_effect=openai.AuthenticationError("bad key", response=fake_response(401), body=None)
    )

    with pytest.raises(LlmError) as exc_info:
        await adapter.complete_structured([], Summary, residency())
    assert exc_info.value.retryable is False


async def test_complete_structured_maps_not_found_to_llm_model_not_found() -> None:
    adapter = OpenAiLlmAdapter(runtime())
    adapter._client.chat.completions.parse = AsyncMock(
        side_effect=openai.NotFoundError("gone", response=fake_response(404), body=None)
    )

    with pytest.raises(LlmError) as exc_info:
        await adapter.complete_structured([], Summary, residency())
    assert exc_info.value.code == "LLM_MODEL_NOT_FOUND"


async def test_complete_structured_maps_an_empty_choices_response_to_llm_error() -> None:
    adapter = OpenAiLlmAdapter(runtime())
    adapter._client.chat.completions.parse = AsyncMock(return_value=type("Completion", (), {"choices": []}))

    with pytest.raises(LlmError):
        await adapter.complete_structured([], Summary, residency())


async def test_complete_structured_maps_a_revalidation_failure_to_llm_error() -> None:
    """The re-validation step (`schema.model_validate`) raises a
    `pydantic.ValidationError` when the "constrained" response did not
    actually conform — also an LlmError to the caller, never a raw pydantic
    exception.
    """

    class Mismatched(BaseModel):
        unrelated_field: int

    adapter = OpenAiLlmAdapter(runtime())
    parsed = Mismatched(unrelated_field=1)
    completion = type("Completion", (), {"choices": [type("C", (), {"message": type("M", (), {"parsed": parsed})()})]})
    adapter._client.chat.completions.parse = AsyncMock(return_value=completion)

    with pytest.raises(LlmError):
        await adapter.complete_structured([], Summary, residency())


async def test_complete_structured_maps_a_wholly_unanticipated_sdk_error_to_llm_error() -> None:
    """The fallback branch: the enumeration above is no longer what the
    port's "raises LlmError" contract depends on.
    """
    adapter = OpenAiLlmAdapter(runtime())
    adapter._client.chat.completions.parse = AsyncMock(side_effect=RuntimeError("something new in a future SDK"))

    with pytest.raises(LlmError) as exc_info:
        await adapter.complete_structured([], Summary, residency())
    assert exc_info.value.retryable is False


async def test_complete_stream_maps_a_mid_stream_failure_to_llm_error() -> None:
    """The streaming sibling's own body is classified too — a connection
    dropped mid-stream is an `LlmError` to the pipeline, not a raw SDK error.
    """
    adapter = OpenAiLlmAdapter(runtime())

    async def _gen():
        raise openai.APIConnectionError(request=httpx.Request("POST", "https://api.openai.com/v1/chat/completions"))
        yield  # pragma: no cover - unreachable, makes this an async generator

    adapter._client.chat.completions.create = AsyncMock(return_value=_gen())

    stream = await adapter.complete_stream([], [], residency())
    with pytest.raises(LlmError):
        [c async for c in stream]
