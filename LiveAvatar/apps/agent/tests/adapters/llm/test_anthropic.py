"""Unit tests for the Anthropic vendor adapter, mocking the SDK client boundary."""

from __future__ import annotations

import anthropic
import httpx
import pytest
from pydantic import BaseModel

from avatar_agent.adapters.llm.anthropic import AnthropicLlmAdapter
from avatar_agent.ports.llm import LlmError, ResidencyPayload
from avatar_agent.ports.runtime import ProviderRuntime


def runtime() -> ProviderRuntime:
    return ProviderRuntime(logical_key="llm.anthropic", endpoint_url=None, api_key="sk-test", model="claude-3-5-sonnet")


def residency() -> ResidencyPayload:
    return ResidencyPayload(system_prompt="sys", messages=[{"role": "user", "content": "hi"}])


def fake_response(status: int) -> httpx.Response:
    return httpx.Response(status, request=httpx.Request("POST", "https://api.anthropic.com/v1/messages"))


class Summary(BaseModel):
    summary_text: str


class _FinalMessage:
    def __init__(self, content: list) -> None:
        self.content = content


class _ToolUseBlock:
    def __init__(self, id: str, name: str, input: dict) -> None:  # noqa: A002
        self.type = "tool_use"
        self.id = id
        self.name = name
        self.input = input


def _make_stream(texts: list[str], final_message: _FinalMessage | None = None):
    class Stream:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        @property
        def text_stream(self):
            async def _gen():
                for t in texts:
                    yield t

            return _gen()

        async def get_final_message(self):
            return final_message or _FinalMessage([])

    return Stream()


async def test_complete_stream_yields_deltas_then_done() -> None:
    adapter = AnthropicLlmAdapter(runtime())
    adapter._client.messages.stream = lambda **kwargs: _make_stream(["Hel", "lo"])

    stream = await adapter.complete_stream([], [], residency())
    chunks = [c async for c in stream]

    assert chunks[0] == {"delta": "Hel", "done": False}
    assert chunks[-1] == {"delta": "", "done": True, "tool_calls": []}


async def test_complete_stream_extracts_tool_use_blocks_from_the_final_message() -> None:
    adapter = AnthropicLlmAdapter(runtime())
    final = _FinalMessage([_ToolUseBlock("toolu_1", "get_weather", {"city": "nyc"})])
    adapter._client.messages.stream = lambda **kwargs: _make_stream(["ok"], final)

    stream = await adapter.complete_stream([], [], residency())
    chunks = [c async for c in stream]

    assert chunks[-1]["tool_calls"] == [{"id": "toolu_1", "name": "get_weather", "arguments": {"city": "nyc"}}]


async def test_complete_stream_maps_not_found_to_llm_model_not_found() -> None:
    adapter = AnthropicLlmAdapter(runtime())

    def _raise(**kwargs):
        raise anthropic.NotFoundError("nope", response=fake_response(404), body=None)

    adapter._client.messages.stream = _raise
    with pytest.raises(LlmError) as exc_info:
        await adapter.complete_stream([], [], residency())
    assert exc_info.value.code == "LLM_MODEL_NOT_FOUND"


async def test_complete_stream_maps_authentication_error_to_non_retryable() -> None:
    adapter = AnthropicLlmAdapter(runtime())

    def _raise(**kwargs):
        raise anthropic.AuthenticationError("bad key", response=fake_response(401), body=None)

    adapter._client.messages.stream = _raise
    with pytest.raises(LlmError) as exc_info:
        await adapter.complete_stream([], [], residency())
    assert exc_info.value.retryable is False


async def test_complete_structured_extracts_the_tool_use_block_and_revalidates() -> None:
    adapter = AnthropicLlmAdapter(runtime())

    class ToolBlock:
        type = "tool_use"
        name = "emit_structured_output"
        input = {"summary_text": "a summary"}

    class Response:
        content = [ToolBlock()]

    async def _create(**kwargs):
        return Response()

    adapter._client.messages.create = _create

    result = await adapter.complete_structured([], Summary, residency())
    assert result == Summary(summary_text="a summary")


async def test_complete_structured_raises_when_no_tool_use_block_is_returned() -> None:
    adapter = AnthropicLlmAdapter(runtime())

    class Response:
        content = []

    async def _create(**kwargs):
        return Response()

    adapter._client.messages.create = _create

    with pytest.raises(LlmError):
        await adapter.complete_structured([], Summary, residency())


async def test_complete_structured_maps_a_revalidation_failure_to_llm_error() -> None:
    """QA D-5 gap-class sweep: this adapter already classified failures of
    the *request*, but its response post-processing (`model_validate` on a
    tool-call payload that didn't actually conform) sat outside the guarded
    block and could leak a raw `pydantic.ValidationError` to
    `summary.post_call`.
    """
    adapter = AnthropicLlmAdapter(runtime())

    class ToolBlock:
        type = "tool_use"
        name = "emit_structured_output"
        input = {"unrelated_field": 1}  # no `summary_text` -> ValidationError

    class Response:
        content = [ToolBlock()]

    async def _create(**kwargs):
        return Response()

    adapter._client.messages.create = _create

    with pytest.raises(LlmError):
        await adapter.complete_structured([], Summary, residency())
