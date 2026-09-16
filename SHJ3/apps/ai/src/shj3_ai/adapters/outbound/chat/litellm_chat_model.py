"""The real `ChatModel` — OpenRouter, reached through LiteLLM (ADR-0004).

Structural `ChatModel`, per this codebase's established port convention. Every
failure — a timeout, a 4xx/5xx from OpenRouter, a malformed response — is
caught and re-raised as `ChatModelUnavailableError`, the one seam
`application/fallback_chat.py` watches to decide whether the agent's configured
fallback model should be tried.
"""

from __future__ import annotations

from collections.abc import AsyncIterator

from shj3_ai.ports.chat_model import (
    ChatModelUnavailableError,
    ChatRequest,
    ChatResponse,
    ChatStreamChunk,
    ToolCallRequest,
)


def _response_format_kwargs(response_format: str | None) -> dict[str, dict[str, str]]:
    """Conditionally-present kwarg, not `response_format=None` — LiteLLM/OpenRouter's own
    `response_format` param means something specific when present at all; passing it
    explicitly as `None` is not the same as omitting it on every provider, so this only ever
    adds the key when the caller actually asked for a constrained format."""
    if response_format is None:
        return {}
    return {"response_format": {"type": response_format}}


def _openrouter_model_name(model: str) -> str:
    # LiteLLM's OpenRouter provider prefix. `AgentVersion.primaryModel`/
    # `fallbackModel` are stored as opaque strings (FR-AGENT-11) — this is
    # the one place that opacity ends, and only to add the routing prefix
    # LiteLLM itself requires, never to interpret the model identity. Shared
    # by `complete()` and `stream()` so the two never silently diverge on
    # which model string is actually sent.
    return model if model.startswith("openrouter/") else f"openrouter/{model}"


class LiteLlmChatModel:
    __slots__ = ("_api_key",)

    def __init__(self, api_key: str) -> None:
        self._api_key = api_key

    async def complete(self, request: ChatRequest) -> ChatResponse:
        import litellm

        model = _openrouter_model_name(request.model)
        messages = [{"role": m.role, "content": m.content} for m in request.messages]
        try:
            response = await litellm.acompletion(
                model=model,
                messages=messages,
                temperature=request.temperature,
                max_tokens=request.max_output_tokens,
                api_key=self._api_key,
                timeout=30,
                **_response_format_kwargs(request.response_format),
            )
        except Exception as error:
            raise ChatModelUnavailableError(request.model, str(error)) from error

        try:
            choice = response.choices[0]
            text = choice.message.content or ""
            usage = response.usage
            input_tokens = int(usage.prompt_tokens) if usage else 0
            output_tokens = int(usage.completion_tokens) if usage else 0
            finish_reason = choice.finish_reason or "stop"
            tool_call: ToolCallRequest | None = None
            raw_tool_calls = getattr(choice.message, "tool_calls", None)
            if raw_tool_calls:
                first = raw_tool_calls[0]
                tool_call = ToolCallRequest(
                    tool_name=first.function.name, arguments_json=first.function.arguments
                )
        except (AttributeError, IndexError, KeyError) as error:
            raise ChatModelUnavailableError(
                request.model, f"malformed response: {error}"
            ) from error

        return ChatResponse(
            text=text,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            tool_call=tool_call,
            finish_reason=finish_reason,
        )

    async def stream(self, request: ChatRequest) -> AsyncIterator[ChatStreamChunk]:
        """Real, provider-driven token streaming. `litellm.acompletion(...,
        stream=True)` returns an async iterator LiteLLM itself fills in as
        OpenRouter's response arrives over the wire — the timing between the
        chunks this yields is genuine network-driven timing, not simulated
        (contrast `DeterministicChatModel.stream()`). Same error contract as
        `complete()`: anything raised opening the stream, or raised by the
        provider partway through delivering it, becomes
        `ChatModelUnavailableError`.
        """
        import litellm

        model = _openrouter_model_name(request.model)
        messages = [{"role": m.role, "content": m.content} for m in request.messages]
        try:
            response_stream = await litellm.acompletion(
                model=model,
                messages=messages,
                temperature=request.temperature,
                max_tokens=request.max_output_tokens,
                api_key=self._api_key,
                timeout=30,
                stream=True,
                **_response_format_kwargs(request.response_format),
            )
        except Exception as error:
            raise ChatModelUnavailableError(request.model, str(error)) from error

        tool_call_name: str | None = None
        tool_call_arguments = ""
        input_tokens = 0
        output_tokens = 0
        finish_reason = "stop"
        try:
            async for chunk in response_stream:
                choice = chunk.choices[0]
                delta = choice.delta
                text = getattr(delta, "content", None) or ""
                if text:
                    yield ChatStreamChunk(delta_text=text)

                # A tool call's name/arguments arrive incrementally too (the
                # arguments are themselves streamed as a partial JSON string,
                # accumulated the same way `text` accumulates above) — real
                # provider behaviour this codebase's `complete()` never had
                # to handle, since a non-streamed response always carries the
                # whole tool call already assembled.
                delta_tool_calls = getattr(delta, "tool_calls", None)
                if delta_tool_calls:
                    first = delta_tool_calls[0]
                    function = getattr(first, "function", None)
                    if function is not None and function.name:
                        tool_call_name = function.name
                    if function is not None and function.arguments:
                        tool_call_arguments += function.arguments

                if choice.finish_reason:
                    finish_reason = choice.finish_reason

                usage = getattr(chunk, "usage", None)
                if usage is not None:
                    input_tokens = int(usage.prompt_tokens or 0)
                    output_tokens = int(usage.completion_tokens or 0)
        except (AttributeError, IndexError, KeyError) as error:
            raise ChatModelUnavailableError(
                request.model, f"malformed stream chunk: {error}"
            ) from error
        except Exception as error:
            raise ChatModelUnavailableError(request.model, str(error)) from error

        tool_call = (
            ToolCallRequest(tool_name=tool_call_name, arguments_json=tool_call_arguments)
            if tool_call_name
            else None
        )
        yield ChatStreamChunk(
            delta_text="",
            is_final=True,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            tool_call=tool_call,
            finish_reason=finish_reason,
        )
