"""`SandboxToolInvoker` — three cases: `Native` and `McpTool` pass straight
through to the wrapped real invoker unchanged; `ApiConnector` never reaches it
at all and gets back a synthetic, clearly-marked result instead."""

from __future__ import annotations

from shj3_ai.adapters.outbound.sandbox.sandbox_tool_invoker import SandboxToolInvoker
from shj3_ai.ports.tool_invoker import ToolInvocationOutcome, ToolInvocationResult


class _FakeToolInvoker:
    """A bare `ToolInvoker` stub — records every call it actually receives, so
    a test can assert the real invoker was (or, for `ApiConnector`, was NOT)
    reached at all, not just that some result came back."""

    def __init__(self) -> None:
        self.calls: list[tuple[str, str]] = []

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
        self.calls.append((invocation_kind, skill_key))
        return ToolInvocationResult(
            outcome=ToolInvocationOutcome.OK,
            result_json='{"real": true}',
            error=None,
            duration_ms=7,
        )


async def test_native_call_reaches_the_wrapped_invoker_and_returns_its_real_result() -> None:
    fake = _FakeToolInvoker()
    invoker = SandboxToolInvoker(fake)

    result = await invoker.invoke(
        tool_binding_id="tb_1",
        skill_key="get_bill_status",
        invocation_kind="Native",
        api_connector_id=None,
        arguments={"provider": "SEWA"},
        circuit_breaker_target_kind=None,
        circuit_breaker_target_ref=None,
    )

    assert fake.calls == [("Native", "get_bill_status")]
    assert result.result_json == '{"real": true}'
    assert result.outcome == ToolInvocationOutcome.OK


async def test_api_connector_call_never_reaches_the_wrapped_invoker(
) -> None:
    fake = _FakeToolInvoker()
    invoker = SandboxToolInvoker(fake)

    result = await invoker.invoke(
        tool_binding_id="tb_2",
        skill_key="fetch_sewa_bill",
        invocation_kind="ApiConnector",
        api_connector_id="conn_1",
        arguments={"accountNumber": "12345"},
        circuit_breaker_target_kind="ApiConnector",
        circuit_breaker_target_ref="conn_1",
    )

    assert fake.calls == []  # the real invoker was never called
    assert result.outcome == ToolInvocationOutcome.OK
    assert result.result_json is not None
    assert '"sandbox": true' in result.result_json


async def test_mcp_tool_call_passes_through_unchanged_to_the_wrapped_invoker() -> None:
    fake = _FakeToolInvoker()
    invoker = SandboxToolInvoker(fake)

    result = await invoker.invoke(
        tool_binding_id="tb_3",
        skill_key="some_mcp_tool",
        invocation_kind="McpTool",
        api_connector_id=None,
        arguments={},
        circuit_breaker_target_kind=None,
        circuit_breaker_target_ref=None,
    )

    assert fake.calls == [("McpTool", "some_mcp_tool")]
    assert result.result_json == '{"real": true}'
