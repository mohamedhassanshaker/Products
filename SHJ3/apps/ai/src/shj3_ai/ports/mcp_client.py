"""The `McpClient` port — "speak MCP: connect, discover, invoke" (`docs/api.md`
§9.12). This wave (`POST /v1/tools/mcp/servers/{id}/connect`, §5.6) is the
first real caller, and only exercises `connect` + `discover_tools` + `close`;
`invoke` is implemented for real too (it costs nothing extra once a session
is open) but has no caller yet — tool *invocation* through a bound MCP tool
is the agent runtime's concern (B-5/B-6), which `adapters/outbound/tools/
skill_invoker.py` already names as real, separable, future work (its
`McpTool`-kind binding resolves to `NOT_WIRED` today).

Pure port: no vendor imports (the "swap test", `pyproject.toml`'s
import-linter contract). `McpSession` is a structural marker only — the real
adapter's session dataclass carries whatever vendor state it needs
(`adapters/outbound/mcp/mcp_sdk_client.py`), and nothing above this port ever
looks inside it.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from shj3_ai.domain.mcp import McpAuthMode, McpConnectFailureReason, McpTransport


@dataclass(frozen=True, slots=True)
class McpServerConfig:
    """Everything needed to attempt one connection — supplied whole by the
    caller (the web tier's already-persisted `McpServer` row, api.md §6.5),
    never looked up by this service: `shj3-ai`'s DB grant has no `SELECT` on
    `McpServers` (data-model.md §5's ADR-0005 grant enumeration lists only
    six AI-writable table groups, and `McpServers` is not one of them, nor is
    it among the tables `platform.*`/`tenant_template.*` `shj3_ai` may read)
    — this endpoint is deliberately stateless with respect to that table.
    """

    endpoint: str
    transport: McpTransport
    auth_mode: McpAuthMode
    credential_secret_ref: str | None


@dataclass(frozen=True, slots=True)
class McpToolDescriptor:
    """`tools/list` result, one entry. `input_schema_json` is the tool's JSON
    Schema serialised to a string — matching `McpTool.inputSchemaJson`
    (`prisma/tenant/schema.prisma`), which is what the web tier persists
    verbatim via `recordSuccessfulDiscovery`."""

    name: str
    description: str | None
    input_schema_json: str


@dataclass(frozen=True, slots=True)
class McpToolCall:
    name: str
    arguments: dict[str, object]


@dataclass(frozen=True, slots=True)
class McpToolResult:
    is_error: bool
    #: JSON-serialised content blocks (text/image/resource per the MCP spec)
    #: — kept as a string, matching this codebase's own `*Json` column
    #: convention rather than inventing a typed union no caller needs yet.
    content_json: str


class McpConnectFailedError(Exception):
    """Handshake/auth/transport failure. `reason` is always one of the
    closed set `docs/api.md` §5.6 documents (`dns | tls | auth | timeout |
    protocol`) — never the driver's own exception text (§2.4); `detail` is a
    developer-facing, non-vendor-leaking description for logs."""

    def __init__(self, reason: McpConnectFailureReason, detail: str) -> None:
        super().__init__(detail)
        self.reason: McpConnectFailureReason = reason
        self.detail = detail


class McpDiscoveryEmptyError(Exception):
    """The handshake succeeded but `tools/list` returned zero tools —
    `docs/api.md` §5.6's distinct `502 tools.mcp_discovery_empty`, not a
    handshake failure."""


class McpSession(Protocol):
    """An open, live MCP session. Opaque above this port by design."""


class McpClient(Protocol):
    async def connect(self, server: McpServerConfig) -> McpSession:
        """Open the transport and complete the MCP `initialize` handshake with
        the configured auth. Raises `McpConnectFailedError` on any genuine
        failure — never returns a session for a handshake that did not
        really succeed."""
        ...

    async def discover_tools(self, session: McpSession) -> list[McpToolDescriptor]:
        """`tools/list`. May legitimately return an empty list — turning that
        into `502 tools.mcp_discovery_empty` is the application layer's job
        (`application/connect_and_discover_mcp.py`), not this port's."""
        ...

    async def invoke(
        self, session: McpSession, call: McpToolCall, timeout_ms: int
    ) -> McpToolResult:
        """`tools/call`. No caller yet (see module docstring) — implemented
        for real regardless, so the next wave that binds this port to the
        runtime's tool invoker needs no rework here."""
        ...

    async def close(self, session: McpSession) -> None:
        """Release the transport. Idempotent-safe to call after a failed
        `discover_tools`/`invoke` as well as after success."""
        ...
