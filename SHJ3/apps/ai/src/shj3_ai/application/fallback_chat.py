"""`InvokeWithFallback` — FR-AGENT-12: call the agent's primary model, and on
`ChatModelUnavailableError` retry once against its configured fallback model,
recording which model actually answered on the returned
`domain.orchestration.ModelCallCost` (`used_fallback`). "An untested fallback
path is not a fallback" — `tests/application/test_process_turn.py`'s dedicated
fallback test forces the primary to fail via
`SHJ3_CHAT_FORCE_FAIL_MODELS`/`DeterministicChatModel` and asserts the fallback
answered and is recorded distinctly.
"""

from __future__ import annotations

import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass

from shj3_ai.domain.orchestration import ModelCallCost
from shj3_ai.ports.chat_model import (
    ChatModel,
    ChatModelUnavailableError,
    ChatRequest,
    ChatResponse,
    ChatStreamChunk,
)

# Placeholder per-token pricing, in micro-AED (1 AED = 1,000,000 micro-AED).
# **Flagged, not a real OpenRouter price feed**: a faithful implementation
# would resolve each model's real per-token price from OpenRouter's own
# pricing API/response metadata and cache it — real work, scoped out of this
# pass, which is why every cost figure this wave produces is internally
# consistent (comparable across turns/modes/tenants) but not a claim about
# real AED billing accuracy. `FR-ORCH-08`'s own acceptance bar ("every model
# call yields a cost record... queryable per tenant, agent and conversation")
# is about the *accounting mechanism* existing and being real, not about this
# specific rate table.
_INPUT_MICRO_AED_PER_TOKEN = 8
_OUTPUT_MICRO_AED_PER_TOKEN = 24


def estimate_cost_micro_aed(input_tokens: int, output_tokens: int) -> int:
    return input_tokens * _INPUT_MICRO_AED_PER_TOKEN + output_tokens * _OUTPUT_MICRO_AED_PER_TOKEN


@dataclass(frozen=True, slots=True)
class FallbackChatOutcome:
    response: ChatResponse
    cost: ModelCallCost
    primary_error: str | None


class InvokeWithFallback:
    # `chat_model` is public (not `_chat_model`) precisely so
    # `InvokeWithFallbackStreaming` below can be constructed from the exact
    # same underlying `ChatModel` a `ProcessTurn` was already wired with,
    # without `ProcessTurn`'s own constructor needing a second, parallel
    # "streaming chat invoker" parameter — see that class's own docstring.
    __slots__ = ("chat_model",)

    def __init__(self, chat_model: ChatModel) -> None:
        self.chat_model = chat_model

    async def execute(
        self, request: ChatRequest, *, fallback_model: str | None
    ) -> FallbackChatOutcome:
        start = time.monotonic()
        primary_error: str | None = None
        try:
            response = await self.chat_model.complete(request)
            used_fallback = False
            model_used = request.model
        except ChatModelUnavailableError as error:
            primary_error = str(error)
            if fallback_model is None:
                raise
            fallback_request = ChatRequest(
                model=fallback_model,
                messages=request.messages,
                temperature=request.temperature,
                max_output_tokens=request.max_output_tokens,
                tools=request.tools,
                response_format=request.response_format,
            )
            response = await self.chat_model.complete(fallback_request)
            used_fallback = True
            model_used = fallback_model

        duration_ms = int((time.monotonic() - start) * 1000)
        cost = ModelCallCost(
            model=model_used,
            input_tokens=response.input_tokens,
            output_tokens=response.output_tokens,
            cost_micro_aed=estimate_cost_micro_aed(response.input_tokens, response.output_tokens),
            used_fallback=used_fallback,
            duration_ms=duration_ms,
        )
        return FallbackChatOutcome(response=response, cost=cost, primary_error=primary_error)


class InvokeWithFallbackStreaming:
    """The streaming-aware sibling of `InvokeWithFallback` (B-6), used only
    for the common widget path — `ProcessTurn`'s Sequential-mode primary
    agent invoke — where a real `on_event` sink exists to forward live token
    deltas to. Same fallback contract as `InvokeWithFallback` (retry once
    against the agent's configured fallback model on
    `ChatModelUnavailableError`, recorded on `ModelCallCost.used_fallback`
    exactly the same way) — with one narrower rule that only streaming
    forces, and that `InvokeWithFallback` never has to consider: a genuine
    mid-stream provider failure, once at least one real token has already
    reached the citizen live, is **not** retried transparently against the
    fallback model. Splicing a second model's continuation onto a
    citizen-visible partial sentence the first model started would silently
    corrupt the transcript the citizen is reading in real time — the SSE
    grammar's own documented retraction contract (api.md §5.2 rule 4) covers
    a post-guardrail refusal discarding a partial answer, not a provider
    outage mid-stream stitching two different models' output together. So: a
    failure before any token was forwarded still falls back exactly like
    `InvokeWithFallback` does unconditionally; a failure after at least one
    token was forwarded propagates instead, exactly like the "no fallback
    configured" case already does for the non-streaming path.
    """

    __slots__ = ("_chat_model",)

    def __init__(self, chat_model: ChatModel) -> None:
        self._chat_model = chat_model

    async def execute(
        self,
        request: ChatRequest,
        *,
        fallback_model: str | None,
        on_delta: Callable[[str], Awaitable[None]],
    ) -> FallbackChatOutcome:
        start = time.monotonic()
        # A single-element mutable cell (not a plain `bool`) because it must
        # keep reflecting "did the primary stream forward anything before it
        # raised" even when `_stream_and_forward` exits via an exception
        # rather than a normal return.
        forwarded = [False]
        primary_error: str | None = None
        try:
            response = await self._stream_and_forward(request, on_delta, forwarded)
            used_fallback = False
            model_used = request.model
        except ChatModelUnavailableError as error:
            primary_error = str(error)
            if fallback_model is None or forwarded[0]:
                raise
            fallback_request = ChatRequest(
                model=fallback_model,
                messages=request.messages,
                temperature=request.temperature,
                max_output_tokens=request.max_output_tokens,
                tools=request.tools,
                response_format=request.response_format,
            )
            response = await self._stream_and_forward(fallback_request, on_delta, forwarded)
            used_fallback = True
            model_used = fallback_model

        duration_ms = int((time.monotonic() - start) * 1000)
        cost = ModelCallCost(
            model=model_used,
            input_tokens=response.input_tokens,
            output_tokens=response.output_tokens,
            cost_micro_aed=estimate_cost_micro_aed(response.input_tokens, response.output_tokens),
            used_fallback=used_fallback,
            duration_ms=duration_ms,
        )
        return FallbackChatOutcome(response=response, cost=cost, primary_error=primary_error)

    async def _stream_and_forward(
        self,
        request: ChatRequest,
        on_delta: Callable[[str], Awaitable[None]],
        forwarded: list[bool],
    ) -> ChatResponse:
        """Drive `ChatModel.stream()` to completion, forwarding each real
        `delta_text` to `on_delta` the instant it arrives (a genuine await
        between each — no buffering here), while accumulating the full text
        and the final chunk's metadata into one `ChatResponse` — the same
        shape `complete()` returns, so every caller downstream of this
        method (trace-step building, tool-call handling) is unaffected by
        which of the two invokers actually produced it."""
        text_parts: list[str] = []
        final: ChatStreamChunk | None = None
        async for chunk in self._chat_model.stream(request):
            if chunk.delta_text:
                text_parts.append(chunk.delta_text)
                forwarded[0] = True
                await on_delta(chunk.delta_text)
            if chunk.is_final:
                final = chunk
        if final is None:
            # A `ChatModel.stream()` implementation that ends its async
            # generator without ever yielding an `is_final=True` chunk is
            # itself a contract violation (see the port's own docstring) —
            # surfaced as the same exception type every other failure mode
            # here already uses, not a raw `StopAsyncIteration`/`None`
            # crash further down the call chain.
            raise ChatModelUnavailableError(request.model, "stream ended without a final chunk")
        return ChatResponse(
            text="".join(text_parts),
            input_tokens=final.input_tokens,
            output_tokens=final.output_tokens,
            tool_call=final.tool_call,
            finish_reason=final.finish_reason,
        )
