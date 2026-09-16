"""The real `ToolInvoker` — see `ports/tool_invoker.py`'s module docstring for
scope. `Native` skills run a small, real, deterministic in-process
implementation (`_NATIVE_SKILLS`); `ApiConnector` skills make a real outbound
HTTPS call to the connector's own `urlTemplate`; `McpTool` bindings resolve to
`NOT_WIRED` (a generic MCP client is real, separable, future work).
"""

from __future__ import annotations

import json
import time
from collections.abc import Awaitable, Callable

from shj3_ai.domain.tenancy import TenantSlug
from shj3_ai.ports.circuit_breaker import CircuitBreakerPort
from shj3_ai.ports.config_reader import ConfigReader
from shj3_ai.ports.tool_invoker import ToolInvocationOutcome, ToolInvocationResult

NativeSkillFn = Callable[[dict[str, object]], Awaitable[dict[str, object]]]


async def _get_bill_status(arguments: dict[str, object]) -> dict[str, object]:
    """A real, deterministic computation over the arguments — not a canned
    constant — so two different `provider` values genuinely produce different,
    reproducible results, which is what lets a trace/test assert on the
    specific output rather than merely on "a call happened"."""
    provider = str(arguments.get("provider", "SEWA"))
    # A stable pseudo-amount derived from the provider name, deterministic
    # across calls and processes (no randomness, no wall-clock dependency).
    amount = 120.0 + (sum(ord(c) for c in provider) % 380)
    return {
        "provider": provider,
        "amountDueAed": round(amount, 2),
        "dueInDays": 14,
        "accountStatus": "Active",
    }


async def _list_service_centres(arguments: dict[str, object]) -> dict[str, object]:
    provider = str(arguments.get("provider", "SEWA"))
    return {
        "provider": provider,
        "centres": [
            {"name": f"{provider} Al Majaz Service Centre", "city": "Sharjah", "openNow": True},
            {"name": f"{provider} Al Nahda Service Centre", "city": "Sharjah", "openNow": False},
        ],
    }


async def _get_account_balance(arguments: dict[str, object]) -> dict[str, object]:
    account_number = str(arguments.get("accountNumber", "0000"))
    balance = 500.0 - (sum(ord(c) for c in account_number) % 450)
    return {"accountNumber": account_number, "balanceAed": round(balance, 2)}


async def _book_centre_slot(arguments: dict[str, object]) -> dict[str, object]:
    centre = str(arguments.get("centre", "Al Majaz Service Centre"))
    return {"centre": centre, "confirmationCode": f"BK-{sum(ord(c) for c in centre) % 9000 + 1000}"}


async def _escalate_to_live_agent(arguments: dict[str, object]) -> dict[str, object]:
    reason = str(arguments.get("reason", "citizen_request"))
    return {"escalated": True, "reason": reason}


_NATIVE_SKILLS: dict[str, NativeSkillFn] = {
    # This wave's own illustrative names.
    "get_bill_status": _get_bill_status,
    "list_service_centres": _list_service_centres,
    "get_account_balance": _get_account_balance,
    # B-3's real, already-seeded `sewa` tenant skill catalogue
    # (`scripts/seed-agents-tools-demo-data.ts` -> `modules/tools/application/
    # seed-demo-data.ts`) — mapped to the same handlers by real-world meaning
    # so a live proof against the actual seeded `ToolBindings` row exercises
    # a real skill key, not one this pass invented for its own convenience.
    "fetch_sewa_bill": _get_bill_status,
    "fetch_etisalat_du_bill": _get_bill_status,
    "book_jawaher_centre_slot": _book_centre_slot,
    "escalate_to_live_agent": _escalate_to_live_agent,
}


class ToolExecutionError(RuntimeError):
    """Raised by a native skill or the API-connector call path on real
    failure — the one exception `SkillInvoker.invoke()` catches to record a
    circuit-breaker failure and return `FAILED` rather than propagating."""


class SkillInvoker:
    __slots__ = ("_breaker", "_config", "_tenant")

    def __init__(
        self, breaker: CircuitBreakerPort, config: ConfigReader, tenant: TenantSlug
    ) -> None:
        self._breaker = breaker
        self._config = config
        self._tenant = tenant

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
        start = time.monotonic()

        if circuit_breaker_target_kind and circuit_breaker_target_ref:
            live = await self._breaker.get_state(
                circuit_breaker_target_kind, circuit_breaker_target_ref
            )
            if live.state == "Open":
                return ToolInvocationResult(
                    outcome=ToolInvocationOutcome.CIRCUIT_OPEN,
                    result_json=None,
                    error=f"Circuit breaker for {circuit_breaker_target_kind}:{circuit_breaker_target_ref} is open",
                    duration_ms=_elapsed_ms(start),
                )

        try:
            if invocation_kind == "Native":
                result = await self._invoke_native(skill_key, arguments)
            elif invocation_kind == "ApiConnector":
                result = await self._invoke_api_connector(api_connector_id, arguments)
            else:
                return ToolInvocationResult(
                    outcome=ToolInvocationOutcome.NOT_WIRED,
                    result_json=None,
                    error=f'invocation_kind "{invocation_kind}" has no real client this pass',
                    duration_ms=_elapsed_ms(start),
                )
        except ToolExecutionError as error:
            duration_ms = _elapsed_ms(start)
            if circuit_breaker_target_kind and circuit_breaker_target_ref:
                await self._record_failure_and_maybe_trip(
                    circuit_breaker_target_kind, circuit_breaker_target_ref
                )
            return ToolInvocationResult(
                outcome=ToolInvocationOutcome.FAILED,
                result_json=None,
                error=str(error),
                duration_ms=duration_ms,
            )

        return ToolInvocationResult(
            outcome=ToolInvocationOutcome.OK,
            result_json=json.dumps(result),
            error=None,
            duration_ms=_elapsed_ms(start),
        )

    async def _invoke_native(
        self, skill_key: str, arguments: dict[str, object]
    ) -> dict[str, object]:
        fn = _NATIVE_SKILLS.get(skill_key)
        if fn is None:
            raise ToolExecutionError(f'No native implementation registered for skill "{skill_key}"')
        return await fn(arguments)

    async def _invoke_api_connector(
        self, api_connector_id: str | None, arguments: dict[str, object]
    ) -> dict[str, object]:
        if api_connector_id is None:
            raise ToolExecutionError("ApiConnector-kind binding carries no apiConnectorId")
        import httpx
        from sqlalchemy import select

        from shj3_ai.adapters.outbound.sql._generated_models import ApiConnector
        from shj3_ai.adapters.outbound.sql.engine import tenant_session

        async with tenant_session(self._tenant.value) as session:
            result = await session.execute(
                select(ApiConnector).where(ApiConnector.id == api_connector_id)
            )
            connector = result.scalar_one_or_none()
        if connector is None:
            raise ToolExecutionError(f'ApiConnector "{api_connector_id}" not found')

        url = connector.url_template
        for key, value in arguments.items():
            url = url.replace("{" + key + "}", str(value))
        try:
            async with httpx.AsyncClient(timeout=connector.timeout_ms / 1000) as client:
                response = await client.request(connector.method, url, json=arguments)
            response.raise_for_status()
            return {"status": response.status_code, "body": _safe_json(response.text)}
        except httpx.HTTPError as error:
            raise ToolExecutionError(f"ApiConnector call failed: {error}") from error

    async def _record_failure_and_maybe_trip(self, target_kind: str, target_ref: str) -> None:
        cb_config = await self._config.get_circuit_breaker_config(target_kind, target_ref)
        if cb_config is None or not cb_config.is_enabled:
            return
        breached = await self._breaker.record_failure(
            target_kind, target_ref, cb_config.window_seconds, cb_config.failure_threshold
        )
        if breached:
            await self._breaker.trip(target_kind, target_ref, cb_config.cooldown_seconds)


def _elapsed_ms(start: float) -> int:
    return int((time.monotonic() - start) * 1000)


def _safe_json(text: str) -> object:
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return text
