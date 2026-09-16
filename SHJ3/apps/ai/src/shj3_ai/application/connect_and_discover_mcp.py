""" "Connect and discover" — `docs/api.md` §5.6's `POST /v1/tools/mcp/servers/{id}/
connect`. Pure orchestration over the `McpClient` port: open a session, list tools,
always close the session, and turn "connected but zero tools" into the distinct
`McpDiscoveryEmptyError` case api.md §5.6 documents separately from a handshake failure
(`502 tools.mcp_discovery_empty` vs `502 tools.mcp_connect_failed`).

No vendor imports (the "swap test") — every real protocol/network concern lives in
`adapters/outbound/mcp/mcp_sdk_client.py`, which this class never references by name.
"""

from __future__ import annotations

from shj3_ai.ports.mcp_client import (
    McpClient,
    McpDiscoveryEmptyError,
    McpServerConfig,
    McpToolDescriptor,
)


class ConnectAndDiscoverMcp:
    __slots__ = ("_client",)

    def __init__(self, client: McpClient) -> None:
        self._client = client

    async def execute(self, config: McpServerConfig) -> list[McpToolDescriptor]:
        """Raises `McpConnectFailedError` (a handshake/transport failure, `reason` from
        the closed set) or `McpDiscoveryEmptyError` (connected, but `tools/list` came back
        empty). Returns the discovered descriptors on success — persisting them is the
        caller's job (the web tier's `recordSuccessfulDiscovery`, api.md §6.5); this
        service has no write grant on `McpTools` (data-model.md §5's ADR-0005 grant
        enumeration)."""
        session = await self._client.connect(config)
        try:
            tools = await self._client.discover_tools(session)
        finally:
            await self._client.close(session)

        if not tools:
            raise McpDiscoveryEmptyError()
        return tools
