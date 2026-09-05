"""`google` (Gemini) vendor adapter (FR-LLM-1, factory key `google`)."""

from __future__ import annotations

import time
from collections.abc import AsyncIterator, Sequence
from typing import TypeVar

from google import genai
from google.genai import errors as genai_errors
from google.genai import types as genai_types
from pydantic import BaseModel

from avatar_agent.ports.llm import ChatMessage, LlmChunk, LlmError, ResidencyPayload, ToolCallRequest, ToolSpec
from avatar_agent.ports.runtime import ProviderRuntime

M = TypeVar("M", bound=BaseModel)


def _contents_for(residency: ResidencyPayload) -> list[genai_types.Content]:
    contents: list[genai_types.Content] = []
    if residency.retrieved_chunks:
        context_text = "Relevant context:\n" + "\n".join(residency.retrieved_chunks)
        contents.append(genai_types.Content(role="user", parts=[genai_types.Part(text=context_text)]))
    for m in residency.messages:
        role = "model" if m["role"] == "assistant" else "user"
        contents.append(genai_types.Content(role=role, parts=[genai_types.Part(text=m["content"])]))
    return contents


class GoogleLlmAdapter:
    """`ILLMProvider` implementation over the Google Gen AI SDK."""

    key = "google"

    def __init__(self, runtime: ProviderRuntime) -> None:
        self._runtime = runtime
        self._client = genai.Client(api_key=runtime.api_key)
        self._first_token_ms: int | None = None

    def _classify(self, err: Exception) -> LlmError:
        if isinstance(err, genai_errors.ClientError):
            status = getattr(err, "code", None)
            if status == 404:
                return LlmError(
                    f"Model '{self._runtime.model}' was rejected by google.",
                    retryable=True,
                    code="LLM_MODEL_NOT_FOUND",
                )
            if status == 401 or status == 403:
                return LlmError("google authentication failed.", retryable=False)
            return LlmError("google request failed.", retryable=status == 429)
        if isinstance(err, genai_errors.ServerError):
            return LlmError("google is temporarily unavailable.", retryable=True)
        return LlmError("google request failed.", retryable=False)

    async def complete_stream(
        self,
        messages: Sequence[ChatMessage],
        tools: Sequence[ToolSpec],
        residency: ResidencyPayload,
    ) -> AsyncIterator[LlmChunk]:
        """@inheritdoc"""
        started = time.monotonic()
        self._first_token_ms = None
        declarations = [
            genai_types.FunctionDeclaration(name=t["name"], description=t["description"], parameters=t["parameters"])
            for t in tools
        ]
        config = genai_types.GenerateContentConfig(
            system_instruction=residency.system_prompt,
            tools=[genai_types.Tool(function_declarations=declarations)] if declarations else None,
        )

        async def _iter() -> AsyncIterator[LlmChunk]:
            tool_calls: list[ToolCallRequest] = []
            call_index = 0
            try:
                stream = await self._client.aio.models.generate_content_stream(
                    model=self._runtime.model,
                    contents=_contents_for(residency),
                    config=config,
                )
                async for chunk in stream:
                    text = getattr(chunk, "text", None)
                    if text:
                        if self._first_token_ms is None:
                            self._first_token_ms = int((time.monotonic() - started) * 1000)
                        yield LlmChunk(delta=text, done=False)
                    # `function_calls` is the SDK's own convenience accessor
                    # aggregating every `function_call` part on this chunk's
                    # candidate (FR-AGENT-2); Gemini has no call `id`, so one
                    # is synthesized from the name and a per-stream counter.
                    for fc in getattr(chunk, "function_calls", None) or []:
                        call_index += 1
                        tool_calls.append(
                            ToolCallRequest(id=f"{fc.name}-{call_index}", name=fc.name, arguments=dict(fc.args or {}))
                        )
            except Exception as err:  # noqa: BLE001
                raise self._classify(err) from err
            yield LlmChunk(delta="", done=True, tool_calls=tool_calls)

        return _iter()

    async def complete_structured(
        self,
        messages: Sequence[ChatMessage],
        schema: type[M],
        residency: ResidencyPayload,
    ) -> M:
        """@inheritdoc — uses Gemini's `response_schema` structured-output mode.

        @raises LlmError: on every failure mode — a vendor rejection, a
            missing/malformed `parsed` payload, or a `pydantic.ValidationError`
            from the re-validation below (QA D-5: response post-processing is
            inside the classified block too, not only the request).
        """
        config = genai_types.GenerateContentConfig(
            system_instruction=residency.system_prompt,
            response_mime_type="application/json",
            response_schema=schema,
        )
        try:
            response = await self._client.aio.models.generate_content(
                model=self._runtime.model,
                contents=_contents_for(residency),
                config=config,
            )
            parsed = getattr(response, "parsed", None)
            if parsed is None:
                raise LlmError("google returned no structured content.", retryable=False)
            # Re-validated even though the SDK claims to have parsed it already.
            return schema.model_validate(parsed if isinstance(parsed, dict) else parsed.model_dump())
        except LlmError:
            raise  # already this port's error type — never re-wrapped
        except Exception as err:  # noqa: BLE001
            raise self._classify(err) from err

    @property
    def first_token_ms(self) -> int | None:
        """@inheritdoc"""
        return self._first_token_ms
