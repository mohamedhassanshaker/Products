"""MCP registry vocabulary — the Python mirror of `apps/web`'s
`modules/tools/domain/tool-catalog.ts`, transcribed from the same real CHECK
constraints (`prisma/sql/001_constraints.sql`, confirmed by dedicated
research before writing this file — see `tasks/todo.md`'s B-3 review, which
transcribed the TypeScript side).

Pure domain: no vendor imports (architecture.md §4, this project's own
"swap test" — `pyproject.toml`'s `[[tool.importlinter.contracts]]` "Domain
and application are vendor-free").
"""

from __future__ import annotations

from typing import Literal, get_args

#: `CK_McpServers_transport`. `Stdio` is a real, modelled value with **no real
#: code path today** — `McpServer.endpoint` is a URL column (`prisma/tenant/
#: schema.prisma`), not a launchable command, so there is nothing a server
#: registration's `endpoint` field could mean under `Stdio` transport. Named
#: honestly rather than faked: `adapters/outbound/mcp/mcp_sdk_client.py`
#: refuses it with a clear, specific detail message instead of silently
#: attempting something else or claiming success.
McpTransport = Literal["Stdio", "Sse", "StreamableHttp"]
MCP_TRANSPORTS: tuple[McpTransport, ...] = get_args(McpTransport)

#: `CK_McpServers_authMode`.
McpAuthMode = Literal["OAuth2ClientCredentials", "MutualTls", "ApiKey", "None"]
MCP_AUTH_MODES: tuple[McpAuthMode, ...] = get_args(McpAuthMode)

#: `docs/api.md` §5.6 / §9.12's closed set of MCP handshake-failure reasons.
#: Never the driver's exception text (§2.4) — every real failure this module
#: produces is translated into exactly one of these five tokens.
McpConnectFailureReason = Literal["dns", "tls", "auth", "timeout", "protocol"]
MCP_CONNECT_FAILURE_REASONS: tuple[McpConnectFailureReason, ...] = get_args(McpConnectFailureReason)


def is_mcp_transport(value: str) -> bool:
    return value in MCP_TRANSPORTS


def is_mcp_auth_mode(value: str) -> bool:
    return value in MCP_AUTH_MODES
