"""`ConnectAndDiscoverMcp` — pure orchestration over a fake `McpClient`, no
network, no vendor code. Exercises: happy path, zero-tools -> `McpDiscoveryEmptyError`,
a handshake failure propagating `McpConnectFailedError` untouched, and — the one
correctness property this class alone owns — `close()` is always called, even when
`discover_tools()` raises.
"""

from __future__ import annotations

import pytest

from shj3_ai.application.connect_and_discover_mcp import ConnectAndDiscoverMcp
from shj3_ai.ports.mcp_client import (
    McpClient,
    McpConnectFailedError,
    McpDiscoveryEmptyError,
    McpServerConfig,
    McpSession,
    McpToolCall,
    McpToolDescriptor,
    McpToolResult,
)

_CONFIG = McpServerConfig(
    endpoint="https://example.test/mcp",
    transport="StreamableHttp",
    auth_mode="None",
    credential_secret_ref=None,
)


class _FakeSession:
    """A minimal, real object satisfying the empty `McpSession` Protocol."""


class _FakeMcpClient(McpClient):
    """A controllable fake — never touches a network or the real SDK."""

    def __init__(
        self,
        *,
        tools: list[McpToolDescriptor] | None = None,
        connect_error: Exception | None = None,
        discover_error: Exception | None = None,
    ) -> None:
        self.tools = tools if tools is not None else []
        self.connect_error = connect_error
        self.discover_error = discover_error
        self.closed_sessions: list[McpSession] = []
        self.connected = False

    async def connect(self, server: McpServerConfig) -> McpSession:
        if self.connect_error is not None:
            raise self.connect_error
        self.connected = True
        return _FakeSession()

    async def discover_tools(self, session: McpSession) -> list[McpToolDescriptor]:
        if self.discover_error is not None:
            raise self.discover_error
        return self.tools

    async def invoke(
        self, session: McpSession, call: McpToolCall, timeout_ms: int
    ) -> McpToolResult:
        raise NotImplementedError  # not exercised by this use case

    async def close(self, session: McpSession) -> None:
        self.closed_sessions.append(session)


async def test_returns_discovered_tools_on_success() -> None:
    descriptor = McpToolDescriptor(name="get_bill_status", description="d", input_schema_json="{}")
    client = _FakeMcpClient(tools=[descriptor])

    result = await ConnectAndDiscoverMcp(client).execute(_CONFIG)

    assert result == [descriptor]
    assert client.connected is True
    assert len(client.closed_sessions) == 1


async def test_zero_tools_raises_discovery_empty() -> None:
    client = _FakeMcpClient(tools=[])

    with pytest.raises(McpDiscoveryEmptyError):
        await ConnectAndDiscoverMcp(client).execute(_CONFIG)

    # Still closed — a distinct-but-terminal outcome is not an excuse to leak the session.
    assert len(client.closed_sessions) == 1


async def test_connect_failure_propagates_with_its_reason() -> None:
    client = _FakeMcpClient(connect_error=McpConnectFailedError("dns", "boom"))

    with pytest.raises(McpConnectFailedError) as excinfo:
        await ConnectAndDiscoverMcp(client).execute(_CONFIG)

    assert excinfo.value.reason == "dns"
    # connect() itself failed, so there is no session to close.
    assert client.closed_sessions == []


async def test_session_is_closed_even_when_discovery_fails() -> None:
    client = _FakeMcpClient(discover_error=McpConnectFailedError("protocol", "bad frame"))

    with pytest.raises(McpConnectFailedError) as excinfo:
        await ConnectAndDiscoverMcp(client).execute(_CONFIG)

    assert excinfo.value.reason == "protocol"
    assert len(client.closed_sessions) == 1
