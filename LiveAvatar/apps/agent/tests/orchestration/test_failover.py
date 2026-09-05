"""Unit tests for the FR-LLM-2 failover ladder (LLD §8.4)."""

from __future__ import annotations

from collections.abc import AsyncIterator

import pytest

from avatar_agent.contracts.runtime_config import RetryPolicy
from avatar_agent.orchestration.failover import LlmUnavailableError, run_with_failover
from avatar_agent.ports.llm import LlmChunk, LlmError, ResidencyPayload


class FakeLlm:
    """A minimal `ILLMProvider` test double whose failure schedule is scripted."""

    def __init__(self, key: str, failures: list[LlmError] | None = None) -> None:
        self.key = key
        self._failures = list(failures or [])
        self.call_count = 0
        self._first_token_ms = None

    async def complete_stream(self, messages, tools, residency) -> AsyncIterator[LlmChunk]:  # noqa: ANN001
        self.call_count += 1
        if self._failures:
            raise self._failures.pop(0)

        async def _gen() -> AsyncIterator[LlmChunk]:
            yield LlmChunk(delta="ok", done=False)
            yield LlmChunk(delta="", done=True)

        return _gen()

    async def complete_structured(self, messages, schema, residency):  # noqa: ANN001
        raise NotImplementedError

    @property
    def first_token_ms(self) -> int | None:
        return self._first_token_ms


def residency() -> ResidencyPayload:
    return ResidencyPayload(system_prompt="sys", messages=[{"role": "user", "content": "hi"}])


async def test_succeeds_on_first_attempt_no_fallback_used() -> None:
    primary = FakeLlm("openai")
    result = await run_with_failover(primary, None, RetryPolicy(), [], residency())
    assert result.provider_key == "openai"
    assert result.used_fallback is False
    assert primary.call_count == 1


async def test_retries_a_retryable_error_then_succeeds() -> None:
    primary = FakeLlm("openai", failures=[LlmError("busy", retryable=True)])
    result = await run_with_failover(primary, None, RetryPolicy(max_attempts=2, backoff_ms=[0, 0]), [], residency())
    assert result.provider_key == "openai"
    assert primary.call_count == 2


async def test_non_retryable_error_does_not_retry_and_falls_back_immediately() -> None:
    primary = FakeLlm("openai", failures=[LlmError("auth failed", retryable=False)])
    fallback = FakeLlm("anthropic")
    result = await run_with_failover(primary, fallback, RetryPolicy(max_attempts=3, backoff_ms=[0, 0, 0]), [], residency())
    assert primary.call_count == 1
    assert result.provider_key == "anthropic"
    assert result.used_fallback is True


async def test_falls_back_after_primary_exhausts_all_retries() -> None:
    primary = FakeLlm(
        "openai",
        failures=[LlmError("busy", retryable=True), LlmError("busy", retryable=True), LlmError("busy", retryable=True)],
    )
    fallback = FakeLlm("anthropic")
    result = await run_with_failover(primary, fallback, RetryPolicy(max_attempts=3, backoff_ms=[0, 0, 0]), [], residency())
    assert primary.call_count == 3
    assert result.used_fallback is True


async def test_raises_llm_unavailable_when_no_fallback_configured() -> None:
    primary = FakeLlm("openai", failures=[LlmError("busy", retryable=True), LlmError("busy", retryable=True)])
    with pytest.raises(LlmUnavailableError):
        await run_with_failover(primary, None, RetryPolicy(max_attempts=2, backoff_ms=[0, 0]), [], residency())


async def test_raises_llm_unavailable_when_both_legs_exhausted() -> None:
    primary = FakeLlm("openai", failures=[LlmError("busy", retryable=True)])
    fallback = FakeLlm("anthropic", failures=[LlmError("busy", retryable=True)])
    with pytest.raises(LlmUnavailableError):
        await run_with_failover(primary, fallback, RetryPolicy(max_attempts=1, backoff_ms=[0]), [], residency())


async def test_model_not_found_is_retried_exactly_once_then_treated_as_exhausted() -> None:
    # max_attempts=5 would normally allow 5 tries, but LLM_MODEL_NOT_FOUND
    # must stop after exactly 2 attempts (FR-LLM-1: "retried once then failover").
    primary = FakeLlm(
        "openai",
        failures=[
            LlmError("bad model", retryable=True, code="LLM_MODEL_NOT_FOUND"),
            LlmError("bad model", retryable=True, code="LLM_MODEL_NOT_FOUND"),
        ],
    )
    fallback = FakeLlm("anthropic")
    result = await run_with_failover(primary, fallback, RetryPolicy(max_attempts=5, backoff_ms=[0, 0, 0, 0, 0]), [], residency())
    assert primary.call_count == 2
    assert result.used_fallback is True
