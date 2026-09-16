"""The `ToolInvoker` port — dispatches a bound `Skill` for real, consulting the
circuit breaker first (architecture.md §8's canonical flow: "Agent calls
`list_service_centres()`, MCP tool, breaker consulted first").

Scope, flagged plainly: this wave's real adapter
(`adapters/outbound/tools/skill_invoker.py`) executes `Native` skills against a
small, real, deterministic in-process implementation (bill status, service
centres, account balance — the exact calls the brief's own canonical journey
names) and `ApiConnector` skills as real outbound HTTP calls to the connector's
configured `urlTemplate`. It does **not** implement a generic MCP wire-protocol
client (`McpTool`-kind bindings resolve to a clean, honest
`tool_execution_not_wired` failure) — building a full MCP client was explicitly
scoped out of B-3 "for whichever wave builds the runtime" without narrowing what
"real" means for that wave's first pass, and a generic MCP client is a
substantial, separable piece of work; the port itself does not foreclose adding
it later.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from typing import Protocol


class ToolInvocationOutcome(StrEnum):
    OK = "Ok"
    FAILED = "Failed"
    TIMEOUT = "Timeout"
    CIRCUIT_OPEN = "circuit_open"
    NOT_WIRED = "tool_execution_not_wired"


@dataclass(frozen=True, slots=True)
class ToolInvocationResult:
    outcome: ToolInvocationOutcome
    result_json: str | None
    error: str | None
    duration_ms: int


class ToolInvoker(Protocol):
    async def invoke(
        self,
        *,
        tool_binding_id: str,
        skill_key: str,
        invocation_kind: str,
        api_connector_id: str | None,
        arguments: dict[str, object],
        circuit_breaker_target_kind: str | None,
        circuit_breaker_target_ref: str | None,
    ) -> ToolInvocationResult:
        """Consults the circuit breaker (if the skill has one configured) before
        attempting the call; a breaker already `open` short-circuits to
        `CIRCUIT_OPEN` without attempting the call at all, matching FR-TOOL-22's
        "the breaker is in the state the observability screen implies". A real
        failure records it via `CircuitBreakerPort.record_failure` and, on
        crossing the threshold, `trip()` — never silently."""
