"""Tool invocation port (FR-AGENT-2/5). Protocol + plain dataclasses only —
mirrors `ports/llm.py`'s split (`ILLMProvider` Protocol / `FailoverResult`
dataclass there, the real retry logic in `orchestration/failover.py`). The
real HTTP-calling implementation is `orchestration/tools.py`'s
`ToolExecutor`, which re-exports `ToolDefinition`/`ToolError` from here so
every pre-existing `from avatar_agent.orchestration.tools import
ToolDefinition, ToolError` call site keeps working unchanged.

Phase 9 (BL-036) needs this split because `ports/orchestration.py`'s
`TurnContext` (referenced by `IOrchestrator.run_turn`'s signature) must not
import `avatar_agent.orchestration` — the `layers` import-linter contract
places `orchestration` *above* `ports`, so a lower layer referencing a
higher layer's concrete class (as `ports/llm.py`'s docstring already
explains for `FailoverResult`) is exactly the drift that contract exists to
catch.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True)
class ToolDefinition:
    """Resolved `ToolDefinition` row (LLD §4.3), as handed to the agent by
    `GET /internal/sessions/{id}/runtime-config`.
    """

    api_ref: str
    name: str
    method: str
    url: str
    api_key: str | None


class ToolError(Exception):
    """Raised on tool-call failure (`TOOL_TIMEOUT` / `TOOL_HTTP_ERROR`, non-fatal)."""

    def __init__(self, message: str, *, code: str) -> None:
        super().__init__(message)
        self.code = code


class IToolExecutor(Protocol):
    """Invokes one HTTP tool per call (FR-AGENT-2/5)."""

    async def invoke(self, tool: ToolDefinition, arguments: dict[str, object]) -> str:
        """@raises ToolError: connection-level failure (timeout/HTTP error).
        A normal HTTP error *response* is not an exception — it is returned
        as text (FR-AGENT-2's "conversation continues").
        """
        ...
