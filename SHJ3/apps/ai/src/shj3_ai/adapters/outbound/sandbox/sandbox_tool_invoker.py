"""`SandboxToolInvoker` — a `ToolInvoker` decorator that lets a backoffice
sandbox turn exercise real tool-calling *logic* (branching on a tool's result,
slot-filling, retry/fall-through wiring) without ever letting an
`ApiConnector`-kind binding make a genuine outbound call to a real, possibly
production, external API.

Scope, matching the real `SkillInvoker` (`adapters/outbound/tools/
skill_invoker.py`) it wraps: `Native` skills are a small, real, deterministic
in-process computation — safe to run for real in sandbox, and valuable to,
since that is exactly the branching/slot-filling behaviour a Draft flow under
test needs proven. `McpTool` bindings already resolve to `NOT_WIRED` inside the
real invoker without any network I/O (`ports/tool_invoker.py`'s own docstring)
— nothing unsafe to intercept there, so those pass through unchanged too.
`ApiConnector` is the one real risk (a genuine `httpx` call to the connector's
own `urlTemplate`) and the one case this class never forwards.
"""

from __future__ import annotations

from shj3_ai.ports.tool_invoker import ToolInvocationOutcome, ToolInvocationResult, ToolInvoker

#: Clearly marked as synthetic, never mistakable for a genuine result — a
#: sandbox trace step must read as "ok, but not real", not merge invisibly
#: with a step that actually reached an external system.
_SANDBOX_RESULT_JSON = '{"sandbox": true, "note": "real API call skipped in sandbox"}'


class SandboxToolInvoker:
    """Wraps a real `ToolInvoker` (in practice, a `SkillInvoker`). `Native` and
    `McpTool` invocations pass straight through, unchanged, to the wrapped
    invoker; `ApiConnector` invocations never reach it at all."""

    __slots__ = ("_real",)

    def __init__(self, real: ToolInvoker) -> None:
        self._real = real

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
        if invocation_kind == "ApiConnector":
            # Never calls `self._real.invoke(...)` — no `ApiConnector` row is
            # read, no outbound HTTPS request is made, no circuit-breaker
            # state is touched. A clearly marked synthetic success rather than
            # a failure/no-op, so a flow authored to branch on the tool's
            # result still has a plausible "ok" result to branch on while
            # under test.
            return ToolInvocationResult(
                outcome=ToolInvocationOutcome.OK,
                result_json=_SANDBOX_RESULT_JSON,
                error=None,
                duration_ms=0,
            )
        return await self._real.invoke(
            tool_binding_id=tool_binding_id,
            skill_key=skill_key,
            invocation_kind=invocation_kind,
            api_connector_id=api_connector_id,
            arguments=arguments,
            circuit_breaker_target_kind=circuit_breaker_target_kind,
            circuit_breaker_target_ref=circuit_breaker_target_ref,
        )
