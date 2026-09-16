"""`tools_router.py` — a real, mounted-router proof (`TestClient`, no containers,
no network), matching `test_evaluation_router.py`'s established pattern:
`tools_router._mcp_client` (the dependency `McpClientDep` resolves through) is
replaced via `app.dependency_overrides` with a fake `McpClient` — this file never
imports the real `mcp` SDK or `McpSdkClient`, which is exercised for real
separately in `tests/adapters/mcp/test_mcp_sdk_client.py`.

Covers the wire-level contract api.md §5.6 documents: the success body shape, the
`502 tools.mcp_connect_failed` + `meta.reason` shape for a handshake failure, the
distinct `502 tools.mcp_discovery_empty` for zero tools, and `422 validation.failed`
for an out-of-vocabulary `transport`/`authMode` — the one input-validation concern
this router owns itself.
"""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.testclient import TestClient

from shj3_ai.adapters.inbound import tools_router
from shj3_ai.ports.mcp_client import (
    McpClient,
    McpConnectFailedError,
    McpServerConfig,
    McpSession,
    McpToolCall,
    McpToolDescriptor,
    McpToolResult,
)

TENANT_HEADERS = {"X-SHJ3-Tenant-Id": "sewa", "X-SHJ3-Principal-Id": "prn_tools_test"}


class _FakeSession:
    pass


class _FakeMcpClient(McpClient):
    def __init__(
        self,
        *,
        tools: list[McpToolDescriptor] | None = None,
        connect_error: Exception | None = None,
    ) -> None:
        self.tools = tools if tools is not None else []
        self.connect_error = connect_error
        self.seen_config: McpServerConfig | None = None

    async def connect(self, server: McpServerConfig) -> McpSession:
        self.seen_config = server
        if self.connect_error is not None:
            raise self.connect_error
        return _FakeSession()

    async def discover_tools(self, session: McpSession) -> list[McpToolDescriptor]:
        return self.tools

    async def invoke(
        self, session: McpSession, call: McpToolCall, timeout_ms: int
    ) -> McpToolResult:
        raise NotImplementedError

    async def close(self, session: McpSession) -> None:
        pass


def _build_app(client: _FakeMcpClient) -> FastAPI:
    app = FastAPI()
    app.include_router(tools_router.router)
    app.dependency_overrides[tools_router._mcp_client] = lambda: client
    return app


def test_connect_returns_discovered_tools() -> None:
    fake = _FakeMcpClient(
        tools=[McpToolDescriptor(name="get_bill_status", description="d", input_schema_json="{}")]
    )
    client = TestClient(_build_app(fake))

    response = client.post(
        "/v1/tools/mcp/servers/mcp_customs/connect",
        headers=TENANT_HEADERS,
        json={
            "endpoint": "https://customs.example/mcp",
            "transport": "StreamableHttp",
            "authMode": "None",
            "credentialSecretRef": None,
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body == {
        "tools": [{"name": "get_bill_status", "description": "d", "inputSchemaJson": "{}"}]
    }
    assert fake.seen_config == McpServerConfig(
        endpoint="https://customs.example/mcp",
        transport="StreamableHttp",
        auth_mode="None",
        credential_secret_ref=None,
    )


def test_connect_failure_returns_the_documented_shape_and_reason() -> None:
    fake = _FakeMcpClient(connect_error=McpConnectFailedError("tls", "handshake failed"))
    client = TestClient(_build_app(fake))

    response = client.post(
        "/v1/tools/mcp/servers/mcp_customs/connect",
        headers=TENANT_HEADERS,
        json={
            "endpoint": "https://customs.example/mcp",
            "transport": "StreamableHttp",
            "authMode": "None",
            "credentialSecretRef": None,
        },
    )

    assert response.status_code == 502
    assert response.json()["detail"] == {
        "code": "tools.mcp_connect_failed",
        "meta": {"reason": "tls"},
    }


def test_zero_discovered_tools_returns_discovery_empty() -> None:
    fake = _FakeMcpClient(tools=[])
    client = TestClient(_build_app(fake))

    response = client.post(
        "/v1/tools/mcp/servers/mcp_customs/connect",
        headers=TENANT_HEADERS,
        json={
            "endpoint": "https://customs.example/mcp",
            "transport": "StreamableHttp",
            "authMode": "None",
            "credentialSecretRef": None,
        },
    )

    assert response.status_code == 502
    assert response.json()["detail"] == {"code": "tools.mcp_discovery_empty"}


def test_unrecognised_transport_is_rejected_before_any_connection_attempt() -> None:
    fake = _FakeMcpClient()
    client = TestClient(_build_app(fake))

    response = client.post(
        "/v1/tools/mcp/servers/mcp_customs/connect",
        headers=TENANT_HEADERS,
        json={
            "endpoint": "https://customs.example/mcp",
            "transport": "Carrier-Pigeon",
            "authMode": "None",
            "credentialSecretRef": None,
        },
    )

    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "validation.failed"
    assert fake.seen_config is None  # never even attempted


def test_missing_tenant_headers_is_unauthorized() -> None:
    fake = _FakeMcpClient()
    client = TestClient(_build_app(fake))

    response = client.post(
        "/v1/tools/mcp/servers/mcp_customs/connect",
        json={
            "endpoint": "https://customs.example/mcp",
            "transport": "StreamableHttp",
            "authMode": "None",
            "credentialSecretRef": None,
        },
    )

    assert response.status_code == 401
