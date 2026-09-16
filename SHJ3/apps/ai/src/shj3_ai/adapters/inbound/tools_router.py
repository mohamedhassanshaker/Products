"""The B-MCP tools surface (`docs/api.md` §5.6) — `POST /v1/tools/mcp/servers/{id}/
connect`. Mirrors `knowledge_router.py`/`conversation_router.py`'s conventions exactly:
every route behind `TenantContextDep`, ports constructed fresh per request from the
environment.

**This route reads no `McpServer` row and writes nothing.** `shj3-ai`'s DB grant has no
`SELECT`/`INSERT`/`UPDATE` on `McpServers`/`McpTools` (data-model.md §5's ADR-0005 grant
enumeration: only six AI-writable table groups exist, and this is not one of them) — the
caller (`apps/web`'s `ConnectAndDiscoverMcpServer` use case) already looked the server row
up and supplies its full connection config in the request body; persisting the result
(`recordSuccessfulDiscovery`/`recordConnectionFailure`) is `apps/web`'s job, matching
"if the runtime needs to persist something outside the three groups, it goes through
shj3-web's API" (data-model.md §5) applied to the *reverse* direction — here it is
`shj3-web` that owns the write and `shj3-ai` that is stateless with respect to it. `{id}`
in the path exists for symmetry with the documented URL shape and for structured logging
only.

`tenantId`/`principalId` are read from `TenantContextDep` purely for auth and tracing —
this endpoint's own work needs neither, since the connection target and credentials
travel in the body, already resolved to this tenant's own persisted `McpServer` row by
the caller.
"""

from __future__ import annotations

import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from shj3_ai.adapters.inbound.tenant_auth import TenantContextDep
from shj3_ai.adapters.outbound.mcp.mcp_sdk_client import McpSdkClient
from shj3_ai.adapters.outbound.secrets.env_secret_resolver import EnvSecretResolver
from shj3_ai.application.connect_and_discover_mcp import ConnectAndDiscoverMcp
from shj3_ai.domain.mcp import is_mcp_auth_mode, is_mcp_transport
from shj3_ai.ports.mcp_client import McpConnectFailedError, McpDiscoveryEmptyError, McpServerConfig

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1/tools", tags=["tools"])


# ---------------------------------------------------------------------------
# Per-request port construction — matches `knowledge_router.py`'s convention
# (a fresh client per call; see that module's own docstring for why this is
# an efficiency question for a later pass, not a correctness one).
# ---------------------------------------------------------------------------


def _mcp_client() -> McpSdkClient:
    return McpSdkClient(EnvSecretResolver())


McpClientDep = Annotated[McpSdkClient, Depends(_mcp_client)]


# ---------------------------------------------------------------------------
# Wire models — api.md §5.6, camelCase both ways.
# ---------------------------------------------------------------------------


class McpConnectRequestIn(BaseModel):
    endpoint: str
    transport: str
    auth_mode: str = Field(alias="authMode")
    credential_secret_ref: str | None = Field(alias="credentialSecretRef", default=None)


class McpToolDescriptorOut(BaseModel):
    name: str
    description: str | None
    input_schema_json: str = Field(serialization_alias="inputSchemaJson")


class McpConnectResponseOut(BaseModel):
    tools: list[McpToolDescriptorOut]


@router.post("/mcp/servers/{server_id}/connect", response_model=McpConnectResponseOut)
async def connect_mcp_server(
    server_id: str,
    body: McpConnectRequestIn,
    client: McpClientDep,
    context: TenantContextDep,
) -> McpConnectResponseOut:
    if not is_mcp_transport(body.transport):
        raise HTTPException(
            status_code=422,
            detail={"code": "validation.failed", "field": "transport"},
        )
    if not is_mcp_auth_mode(body.auth_mode):
        raise HTTPException(
            status_code=422,
            detail={"code": "validation.failed", "field": "authMode"},
        )

    config = McpServerConfig(
        endpoint=body.endpoint,
        transport=body.transport,  # type: ignore[arg-type]  # validated above via is_mcp_transport
        auth_mode=body.auth_mode,  # type: ignore[arg-type]  # validated above via is_mcp_auth_mode
        credential_secret_ref=body.credential_secret_ref,
    )

    use_case = ConnectAndDiscoverMcp(client)
    try:
        tools = await use_case.execute(config)
    except McpConnectFailedError as error:
        logger.warning(
            "MCP connect failed",
            extra={
                "tenant": context.tenant.value,
                "mcpServerId": server_id,
                "reason": error.reason,
                "detail": error.detail,
            },
        )
        raise HTTPException(
            status_code=502,
            detail={"code": "tools.mcp_connect_failed", "meta": {"reason": error.reason}},
        ) from error
    except McpDiscoveryEmptyError as error:
        logger.info(
            "MCP connected but discovered zero tools",
            extra={"tenant": context.tenant.value, "mcpServerId": server_id},
        )
        raise HTTPException(
            status_code=502, detail={"code": "tools.mcp_discovery_empty"}
        ) from error

    return McpConnectResponseOut(
        tools=[
            McpToolDescriptorOut(
                name=tool.name,
                description=tool.description,
                input_schema_json=tool.input_schema_json,
            )
            for tool in tools
        ]
    )
