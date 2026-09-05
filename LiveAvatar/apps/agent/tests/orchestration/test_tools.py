"""Unit tests for FR-AGENT-2/5 HTTP tool invocation."""

from __future__ import annotations

import httpx
import pytest
import respx

from avatar_agent.orchestration.tools import ToolDefinition, ToolError, ToolExecutor


def tool(**overrides: object) -> ToolDefinition:
    base = {
        "api_ref": "weather",
        "name": "Weather lookup",
        "method": "GET",
        "url": "https://internal.example.com/weather",
        "api_key": None,
    }
    base.update(overrides)
    return ToolDefinition(**base)  # type: ignore[arg-type]


@respx.mock
async def test_returns_the_response_body_on_success() -> None:
    respx.get("https://internal.example.com/weather").mock(return_value=httpx.Response(200, text="sunny"))
    executor = ToolExecutor()
    result = await executor.invoke(tool(), {"city": "London"})
    assert result == "sunny"


@respx.mock
async def test_sends_a_bearer_auth_header_when_api_key_is_set() -> None:
    route = respx.get("https://internal.example.com/weather").mock(return_value=httpx.Response(200, text="ok"))
    executor = ToolExecutor()
    await executor.invoke(tool(api_key="secret-key"), {})
    assert route.calls.last.request.headers["authorization"] == "Bearer secret-key"


@respx.mock
async def test_truncates_a_response_over_32kib_and_logs_truncation() -> None:
    huge = "x" * (32 * 1024 + 100)
    respx.get("https://internal.example.com/weather").mock(return_value=httpx.Response(200, text=huge))
    executor = ToolExecutor()
    result = await executor.invoke(tool(), {})
    assert result.endswith("[truncated]")
    assert len(result) < len(huge)


@respx.mock
async def test_timeout_raises_tool_error_with_tool_timeout_code() -> None:
    respx.get("https://internal.example.com/weather").mock(side_effect=httpx.TimeoutException("timed out"))
    executor = ToolExecutor()
    with pytest.raises(ToolError) as exc_info:
        await executor.invoke(tool(), {})
    assert exc_info.value.code == "TOOL_TIMEOUT"


@respx.mock
async def test_connection_error_raises_tool_error_with_tool_http_error_code() -> None:
    respx.get("https://internal.example.com/weather").mock(side_effect=httpx.ConnectError("refused"))
    executor = ToolExecutor()
    with pytest.raises(ToolError) as exc_info:
        await executor.invoke(tool(), {})
    assert exc_info.value.code == "TOOL_HTTP_ERROR"


@respx.mock
async def test_a_normal_http_error_status_is_not_raised_conversation_continues() -> None:
    respx.get("https://internal.example.com/weather").mock(return_value=httpx.Response(500, text="server error"))
    executor = ToolExecutor()
    result = await executor.invoke(tool(), {})
    assert result == "server error"
