"""FR-LLM-2 retry/fallback state machine (LLD §8.4).

```
attempt(primary, i=1..max_attempts) with backoff_ms[i-1]
  |- success -> stream tokens
  `- exhausted
       |- fallback configured -> attempt(fallback, same policy)
       |     |- success -> used_fallback=True + caller raises AlertEvent{llm_failover}
       |     `- exhausted -> LlmUnavailableError (caller enters degraded mode)
       `- no fallback -> LlmUnavailableError
```

`LLM_MODEL_NOT_FOUND` is a special case (FR-LLM-1): retried once, then
always treated as exhausted regardless of `retry.max_attempts` — a wrong
model id will never resolve itself by waiting longer.
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator, Sequence

from avatar_agent.contracts.runtime_config import RetryPolicy
from avatar_agent.ports.llm import FailoverResult, ILLMProvider, LlmChunk, LlmError, ResidencyPayload, ToolSpec

__all__ = ["FailoverResult", "LlmUnavailableError", "run_with_failover"]


class LlmUnavailableError(Exception):
    """Both primary and fallback (if configured) are exhausted. The caller
    (`pipeline.py`) must enter degraded mode (FR-LLM-2) — the session stays
    `active`, it is never dropped.
    """


async def _attempt(
    provider: ILLMProvider,
    retry: RetryPolicy,
    tools: Sequence[ToolSpec],
    residency: ResidencyPayload,
) -> AsyncIterator[LlmChunk]:
    """Runs the retry ladder against a single provider leg."""
    last_error: LlmError | None = None
    for i in range(retry.max_attempts):
        try:
            return await provider.complete_stream(residency.messages, tools, residency)
        except LlmError as err:
            last_error = err
            is_last_attempt = i == retry.max_attempts - 1
            # FR-LLM-1: a rejected model id gets exactly one retry, then is
            # exhausted even if max_attempts would allow more.
            model_not_found_exhausted = err.code == "LLM_MODEL_NOT_FOUND" and i >= 1
            if not err.retryable or is_last_attempt or model_not_found_exhausted:
                break
            backoff_ms = retry.backoff_ms[i] if i < len(retry.backoff_ms) else retry.backoff_ms[-1]
            await asyncio.sleep(backoff_ms / 1000)
    assert last_error is not None
    raise last_error


async def run_with_failover(
    primary: ILLMProvider,
    fallback: ILLMProvider | None,
    retry: RetryPolicy,
    tools: Sequence[ToolSpec],
    residency: ResidencyPayload,
) -> FailoverResult:
    """Runs the full FR-LLM-2 ladder and returns the winning stream, or
    raises `LlmUnavailableError` when every configured leg is exhausted.
    """
    try:
        stream = await _attempt(primary, retry, tools, residency)
        return FailoverResult(stream=stream, provider_key=primary.key, used_fallback=False)
    except LlmError as primary_error:
        if fallback is None:
            raise LlmUnavailableError("primary exhausted, no fallback configured") from primary_error
        try:
            stream = await _attempt(fallback, retry, tools, residency)
            return FailoverResult(stream=stream, provider_key=fallback.key, used_fallback=True)
        except LlmError as fallback_error:
            raise LlmUnavailableError("primary and fallback both exhausted") from fallback_error
