"""`McpSdkClient` — the real MCP client adapter, exercised against a **real** MCP
server speaking the real protocol: `mcp.server.mcpserver.MCPServer`'s own
`streamable_http_app()`, reached through `httpx2.ASGITransport` (in-process, no
socket, no network — but a genuine ASGI request/response cycle carrying real
JSON-RPC bytes, real SSE framing, real session-id headers; the "real, tiny
reference server" verification option this wave's own task named as the most
rigorous local alternative to a live external target).

The live, real-network round trip against `https://mcpplaygroundonline.com/
mcp-complex-server` (this wave's product-owner-registered test target) and the
honest-failure path against a genuinely unreachable host are exercised
separately, by hand, as part of this wave's own live verification (`tasks/
todo.md`'s dated review entry) — deliberately not wired into the automated
suite, which must stay hermetic and not depend on a live third party being up.

`_classify_mcp_failure` is tested directly with synthetic exceptions
(`test_classify_mcp_failure`, no network at all): the closed-set contract
(`dns | tls | auth | timeout | protocol`, api.md §5.6) is the part of this
module a regression is most likely to silently break.
"""

from __future__ import annotations

import asyncio
import contextlib
import socket
import ssl
from collections.abc import AsyncIterator, Callable
from contextlib import AsyncExitStack
from typing import Any

import httpx2
import pytest
from mcp.server.mcpserver import MCPServer
from mcp.server.transport_security import TransportSecuritySettings

from shj3_ai.adapters.outbound.mcp.mcp_sdk_client import (
    McpSdkClient,
    _aclose_and_capture,
    _classify_mcp_failure,
    _safe_aclose,
)
from shj3_ai.adapters.outbound.secrets.env_secret_resolver import EnvSecretResolver
from shj3_ai.ports.mcp_client import McpConnectFailedError, McpServerConfig

_ENDPOINT = "http://localhost/mcp"


@contextlib.asynccontextmanager
async def _local_streamable_server(
    register: Callable[[MCPServer], None] | None = None,
) -> AsyncIterator[httpx2.AsyncBaseTransport]:
    """Runs a real `MCPServer`'s ASGI app's lifespan for the duration of the block and
    yields an in-process transport pointed at it. DNS-rebinding protection is disabled
    deliberately: it exists to stop a browser-hosted attacker rebinding DNS to reach a
    `localhost`-bound server, which has no bearing on an in-process ASGI call with no
    socket at all — real dev/CI convenience, not a weakening of anything this test
    verifies."""
    server = MCPServer(name="shj3-test-server")
    if register is not None:
        register(server)

    app = server.streamable_http_app(
        transport_security=TransportSecuritySettings(enable_dns_rebinding_protection=False)
    )

    # Manual ASGI lifespan protocol — `httpx2.ASGITransport` does not run it itself, and
    # `MCPServer`'s own `StreamableHTTPSessionManager` only starts inside a real lifespan
    # (`streamable_http_manager.py`'s "session manager started" log line, confirmed
    # against the running server before this fixture existed in its current form).
    started: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
    to_app: asyncio.Queue[dict[str, Any]] = asyncio.Queue()

    async def receive() -> dict[str, Any]:
        return await to_app.get()

    async def send(message: dict[str, Any]) -> None:
        await started.put(message)

    task = asyncio.create_task(app({"type": "lifespan"}, receive, send))
    await to_app.put({"type": "lifespan.startup"})
    await started.get()  # "lifespan.startup.complete"
    try:
        yield httpx2.ASGITransport(app=app)
    finally:
        await to_app.put({"type": "lifespan.shutdown"})
        await started.get()  # "lifespan.shutdown.complete"
        await task


async def test_real_handshake_and_discovery_against_a_real_local_server() -> None:
    def register(server: MCPServer) -> None:
        @server.tool()
        def add(a: int, b: int) -> int:
            """Add two numbers."""
            return a + b

        @server.tool()
        def greet(name: str) -> str:
            """Greet someone by name."""
            return f"hello {name}"

    async with _local_streamable_server(register) as transport:
        client = McpSdkClient(EnvSecretResolver(), http_transport=transport)
        config = McpServerConfig(
            endpoint=_ENDPOINT,
            transport="StreamableHttp",
            auth_mode="None",
            credential_secret_ref=None,
        )

        session = await client.connect(config)
        try:
            tools = await client.discover_tools(session)
        finally:
            await client.close(session)

    names = {t.name for t in tools}
    assert names == {"add", "greet"}
    add_tool = next(t for t in tools if t.name == "add")
    assert "properties" in add_tool.input_schema_json


async def test_real_server_with_no_tools_discovers_an_empty_list() -> None:
    """The adapter's own contract (`ports/mcp_client.py`): an empty discovery is not its
    job to reject — `McpDiscoveryEmptyError` is `ConnectAndDiscoverMcp`'s concern
    (`tests/application/test_connect_and_discover_mcp.py` covers that layer)."""
    async with _local_streamable_server(register=None) as transport:
        client = McpSdkClient(EnvSecretResolver(), http_transport=transport)
        config = McpServerConfig(
            endpoint=_ENDPOINT,
            transport="StreamableHttp",
            auth_mode="None",
            credential_secret_ref=None,
        )

        session = await client.connect(config)
        try:
            tools = await client.discover_tools(session)
        finally:
            await client.close(session)

    assert tools == []


async def test_wrong_route_on_a_real_server_classifies_as_protocol() -> None:
    """A real server that is reachable but not speaking MCP at the requested path —
    the same real-world shape this wave's live verification hit against the actual
    `mcpplaygroundonline.com` target's own "not an MCP route" probe."""
    async with _local_streamable_server(register=None) as transport:
        client = McpSdkClient(EnvSecretResolver(), http_transport=transport)
        config = McpServerConfig(
            endpoint="http://localhost/not-an-mcp-route",
            transport="StreamableHttp",
            auth_mode="None",
            credential_secret_ref=None,
        )

        with pytest.raises(McpConnectFailedError) as excinfo:
            await client.connect(config)

    assert excinfo.value.reason == "protocol"


async def test_stdio_transport_is_refused_without_attempting_anything() -> None:
    client = McpSdkClient(EnvSecretResolver())
    config = McpServerConfig(
        endpoint="https://example.test/mcp",
        transport="Stdio",
        auth_mode="None",
        credential_secret_ref=None,
    )

    with pytest.raises(McpConnectFailedError) as excinfo:
        await client.connect(config)

    assert excinfo.value.reason == "protocol"
    assert "Stdio" in excinfo.value.detail


# ---------------------------------------------------------------------------
# `_classify_mcp_failure` — the closed-set contract, with synthetic exceptions
# (no network, no server).
# ---------------------------------------------------------------------------


def test_classify_tls_from_ssl_error() -> None:
    error = httpx2.ConnectError("boom")
    error.__cause__ = ssl.SSLCertVerificationError("certificate verify failed")
    assert _classify_mcp_failure(error) == "tls"


def test_classify_dns_from_gaierror() -> None:
    error = httpx2.ConnectError("boom")
    error.__cause__ = socket.gaierror(11001, "getaddrinfo failed")
    assert _classify_mcp_failure(error) == "dns"


def test_classify_dns_from_the_real_container_message() -> None:
    """Regression for this wave's own live verification against the real running
    `shj3-ai` container (Debian/glibc): `httpcore2`'s asyncio backend re-raises the
    low-level connect failure for a genuinely nonexistent host as a plain `OSError`
    carrying this exact message, losing the `socket.gaierror` subtype the `isinstance`
    branch above relies on — this string check is what still catches it."""
    error = httpx2.ConnectError("boom")
    error.__cause__ = OSError(-5, "No address associated with hostname")
    assert _classify_mcp_failure(error) == "dns"


def test_classify_timeout_from_httpx_timeout_exception() -> None:
    assert _classify_mcp_failure(httpx2.ConnectTimeout("timed out")) == "timeout"


def test_classify_auth_from_401_status() -> None:
    request = httpx2.Request("POST", "https://example.test/mcp")
    response = httpx2.Response(401, request=request)
    error = httpx2.HTTPStatusError("unauthorized", request=request, response=response)
    assert _classify_mcp_failure(error) == "auth"


def test_classify_falls_back_to_protocol_for_the_unclassified_case() -> None:
    assert _classify_mcp_failure(RuntimeError("something else entirely")) == "protocol"


def test_classify_unwraps_exception_groups() -> None:
    leaf = httpx2.ConnectError("boom")
    leaf.__cause__ = socket.gaierror(11001, "getaddrinfo failed")
    group = ExceptionGroup("wrapped", [ExceptionGroup("wrapped again", [leaf])])
    assert _classify_mcp_failure(group) == "dns"


# ---------------------------------------------------------------------------
# `_aclose_and_capture` / `_safe_aclose` — this wave's own live-verification finding:
# `AsyncExitStack.aclose()` can itself raise, and sometimes carries the *only* classifiable
# form of a real failure `connect()` otherwise only sees as a bare `CancelledError` (see
# that method's generic except branch for the full real-world trace this was found from).
# ---------------------------------------------------------------------------


class _RaisingExitStack:
    """A minimal stand-in for `AsyncExitStack` whose `aclose()` raises a given error —
    exercises the capture/swallow contract without needing a real SDK race condition."""

    def __init__(self, to_raise: Exception) -> None:
        self._to_raise = to_raise

    async def aclose(self) -> None:
        raise self._to_raise


async def test_aclose_and_capture_returns_what_cleanup_raised() -> None:
    boom = RuntimeError("cleanup boom")
    captured = await _aclose_and_capture(_RaisingExitStack(boom))  # type: ignore[arg-type]
    assert captured is boom


async def test_aclose_and_capture_returns_none_on_clean_close() -> None:
    captured = await _aclose_and_capture(AsyncExitStack())
    assert captured is None


async def test_safe_aclose_never_raises_even_when_cleanup_does() -> None:
    # No assertion beyond "did not raise" — this is the whole contract.
    await _safe_aclose(_RaisingExitStack(RuntimeError("cleanup boom")))  # type: ignore[arg-type]
