"""FR-AGENT-2/5 HTTP tool invocation.

Tool responses are **untrusted text** (ADR-001 §3 / FR-AGENT-5): size-capped
at 32 KiB and never `eval`'d or executed. A tool call failure (timeout or
HTTP error) is logged and fed back to the model as an error payload — it
never aborts the conversation.

`ToolDefinition`/`ToolError` are defined in `ports/tools.py` (Phase 9,
BL-036 — see that module's docstring for why) and re-exported here so every
pre-existing import site (`pipeline.py`, `entrypoint.py`,
`orchestration/graph/nodes/*.py`) keeps working unchanged.
"""

from __future__ import annotations

import httpx
import structlog

from avatar_agent.ports.tools import ToolDefinition, ToolError

__all__ = ["ToolDefinition", "ToolError", "ToolExecutor"]

logger = structlog.get_logger(__name__)

_MAX_RESPONSE_BYTES = 32 * 1024
_TOOL_TIMEOUT_SECONDS = 10.0


class ToolExecutor:
    """Invokes one HTTP tool per call, enforcing the 10s timeout and 32 KiB
    untrusted-response cap (FR-AGENT-2/5). Structurally satisfies
    `ports.tools.IToolExecutor`.
    """

    def __init__(self, http_client: httpx.AsyncClient | None = None) -> None:
        self._http = http_client or httpx.AsyncClient()

    async def invoke(self, tool: ToolDefinition, arguments: dict[str, object]) -> str:
        """Calls `tool` with `arguments` as the JSON body.

        @returns: the (possibly truncated) response text. Never raises for a
        normal HTTP error response body — only connection-level failures
        raise `ToolError`, matching FR-AGENT-2's "conversation continues".
        """
        headers = {"Authorization": f"Bearer {tool.api_key}"} if tool.api_key else {}
        try:
            response = await self._http.request(
                tool.method,
                tool.url,
                json=arguments,
                headers=headers,
                timeout=_TOOL_TIMEOUT_SECONDS,
            )
        except httpx.TimeoutException as err:
            logger.warning("TOOL_TIMEOUT", api_ref=tool.api_ref)
            raise ToolError(f"Tool '{tool.name}' timed out.", code="TOOL_TIMEOUT") from err
        except httpx.HTTPError as err:
            logger.warning("TOOL_HTTP_ERROR", api_ref=tool.api_ref)
            raise ToolError(f"Tool '{tool.name}' request failed.", code="TOOL_HTTP_ERROR") from err

        raw = response.content
        if len(raw) > _MAX_RESPONSE_BYTES:
            logger.warning("TOOL_RESPONSE_TRUNCATED", api_ref=tool.api_ref)
            return raw[:_MAX_RESPONSE_BYTES].decode("utf-8", errors="ignore") + " [truncated]"
        return raw.decode("utf-8", errors="ignore")
