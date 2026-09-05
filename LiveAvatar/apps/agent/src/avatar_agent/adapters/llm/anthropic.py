"""`anthropic` (Claude) vendor adapter (FR-LLM-1, factory key `anthropic`)."""

from __future__ import annotations

import time
from collections.abc import AsyncIterator, Sequence
from typing import TypeVar

import anthropic
from pydantic import BaseModel

from avatar_agent.ports.llm import ChatMessage, LlmChunk, LlmError, ResidencyPayload, ToolCallRequest, ToolSpec
from avatar_agent.ports.runtime import ProviderRuntime

M = TypeVar("M", bound=BaseModel)

_STRUCTURED_TOOL_NAME = "emit_structured_output"


def _messages_for(residency: ResidencyPayload) -> list[dict[str, str]]:
    """Anthropic keeps `system` separate from the message list; only user/assistant
    turns (plus retrieved context folded into the first user turn) go here.
    """
    out: list[dict[str, str]] = [
        {"role": m["role"], "content": m["content"]} for m in residency.messages if m["role"] != "system"
    ]
    if residency.retrieved_chunks and out:
        context_text = "Relevant context:\n" + "\n".join(residency.retrieved_chunks)
        out[0] = {**out[0], "content": f"{context_text}\n\n{out[0]['content']}"}
    return out


def _system_prompt(residency: ResidencyPayload) -> str:
    return residency.system_prompt


class AnthropicLlmAdapter:
    """`ILLMProvider` implementation over the Anthropic SDK."""

    key = "anthropic"

    def __init__(self, runtime: ProviderRuntime) -> None:
        self._runtime = runtime
        self._client = anthropic.AsyncAnthropic(
            api_key=runtime.api_key,
            base_url=runtime.endpoint_url,
            timeout=runtime.timeouts.request_ms / 1000,
        )
        self._first_token_ms: int | None = None

    def _classify(self, err: Exception) -> LlmError:
        if isinstance(err, anthropic.NotFoundError):
            return LlmError(
                f"Model '{self._runtime.model}' was rejected by anthropic.",
                retryable=True,
                code="LLM_MODEL_NOT_FOUND",
            )
        if isinstance(err, anthropic.AuthenticationError):
            return LlmError("anthropic authentication failed.", retryable=False)
        if isinstance(err, (anthropic.RateLimitError, anthropic.APITimeoutError, anthropic.APIConnectionError)):
            return LlmError("anthropic is temporarily unavailable.", retryable=True)
        if isinstance(err, anthropic.APIStatusError):
            return LlmError("anthropic request failed.", retryable=err.status_code >= 500)
        return LlmError("anthropic request failed.", retryable=False)

    async def complete_stream(
        self,
        messages: Sequence[ChatMessage],
        tools: Sequence[ToolSpec],
        residency: ResidencyPayload,
    ) -> AsyncIterator[LlmChunk]:
        """@inheritdoc"""
        started = time.monotonic()
        self._first_token_ms = None
        tool_defs = [{"name": t["name"], "description": t["description"], "input_schema": t["parameters"]} for t in tools]

        try:
            stream_cm = self._client.messages.stream(
                model=self._runtime.model,
                max_tokens=4096,
                system=_system_prompt(residency),
                messages=_messages_for(residency),
                tools=tool_defs or anthropic.NOT_GIVEN,
            )
        except Exception as err:  # noqa: BLE001 - reclassified below
            raise self._classify(err) from err

        async def _iter() -> AsyncIterator[LlmChunk]:
            tool_calls: list[ToolCallRequest] = []
            try:
                async with stream_cm as stream:
                    async for text in stream.text_stream:
                        if text:
                            if self._first_token_ms is None:
                                self._first_token_ms = int((time.monotonic() - started) * 1000)
                            yield LlmChunk(delta=text, done=False)
                    # `get_final_message()` is the SDK's own accumulated-result
                    # accessor (available once the text stream is exhausted) —
                    # `tool_use` content blocks (FR-AGENT-2) never appear in
                    # `text_stream`, only in the final assembled message.
                    final_message = await stream.get_final_message()
                    for block in getattr(final_message, "content", None) or []:
                        if getattr(block, "type", None) == "tool_use":
                            tool_calls.append(ToolCallRequest(id=block.id, name=block.name, arguments=dict(block.input or {})))
            except Exception as err:  # noqa: BLE001 - reclassified for the caller
                raise self._classify(err) from err
            yield LlmChunk(delta="", done=True, tool_calls=tool_calls)

        return _iter()

    async def complete_structured(
        self,
        messages: Sequence[ChatMessage],
        schema: type[M],
        residency: ResidencyPayload,
    ) -> M:
        """@inheritdoc — Anthropic has no native structured-output mode, so a
        single forced tool call whose `input_schema` is the Pydantic model's
        JSON Schema is used instead; the tool-call arguments are re-validated
        against `schema` on return (never hand-parsed free text).

        @raises LlmError: on every failure mode — a vendor rejection, a
            malformed response shape, or a `pydantic.ValidationError` from
            the re-validation below (QA D-5: response post-processing is
            inside the classified block too, not only the request).
        """
        structured_tool = {
            "name": _STRUCTURED_TOOL_NAME,
            "description": "Emit the structured result.",
            "input_schema": schema.model_json_schema(),
        }
        try:
            response = await self._client.messages.create(
                model=self._runtime.model,
                max_tokens=1024,
                system=_system_prompt(residency),
                messages=_messages_for(residency),
                tools=[structured_tool],
                tool_choice={"type": "tool", "name": _STRUCTURED_TOOL_NAME},
            )
            for block in getattr(response, "content", None) or []:
                if getattr(block, "type", None) == "tool_use" and block.name == _STRUCTURED_TOOL_NAME:
                    return schema.model_validate(block.input)
            raise LlmError("anthropic returned no structured tool call.", retryable=False)
        except LlmError:
            raise  # already this port's error type — never re-wrapped
        except Exception as err:  # noqa: BLE001
            raise self._classify(err) from err

    @property
    def first_token_ms(self) -> int | None:
        """@inheritdoc"""
        return self._first_token_ms
