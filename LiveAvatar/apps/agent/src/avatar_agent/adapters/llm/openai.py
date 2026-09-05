"""`openai` vendor adapter (FR-LLM-1, factory key `openai`).

This module and its siblings under `adapters/` are the **only** place in the
codebase allowed to import a vendor AI SDK (ADR-001 §3 / `.importlinter`'s
`vendor-sdk-isolation` contract). `ILLMProvider.complete_stream` accepts only
a `ResidencyPayload` (LLD §8.5) — this adapter cannot see or attach anything
the residency filter stripped.
"""

from __future__ import annotations

import json
import time
from collections.abc import AsyncIterator, Sequence
from typing import TypeVar

import openai
from pydantic import BaseModel

from avatar_agent.ports.llm import ChatMessage, LlmChunk, LlmError, ResidencyPayload, ToolCallRequest, ToolSpec
from avatar_agent.ports.runtime import ProviderRuntime

M = TypeVar("M", bound=BaseModel)


def _messages_for(residency: ResidencyPayload) -> list[dict[str, str]]:
    """Builds the vendor-shaped message list from an already-residency-filtered
    payload — the only input this method accepts (LLD §8.5).
    """
    out: list[dict[str, str]] = [{"role": "system", "content": residency.system_prompt}]
    if residency.retrieved_chunks:
        out.append(
            {
                "role": "system",
                "content": "Relevant context:\n" + "\n".join(residency.retrieved_chunks),
            }
        )
    out.extend({"role": m["role"], "content": m["content"]} for m in residency.messages)
    return out


def _finalize_tool_calls(pending: dict[int, dict[str, str]]) -> list[ToolCallRequest]:
    """Parses every accumulated `(id, name, arguments-json-string)` entry into
    a `ToolCallRequest`. A call missing a name (never actually started) or
    whose `arguments` isn't valid JSON is dropped rather than raised — a
    single malformed tool call must not abort an otherwise-successful turn.
    """
    calls: list[ToolCallRequest] = []
    for entry in pending.values():
        if not entry["name"]:
            continue
        try:
            arguments = json.loads(entry["arguments"]) if entry["arguments"] else {}
        except json.JSONDecodeError:
            arguments = {}
        calls.append(ToolCallRequest(id=entry["id"] or entry["name"], name=entry["name"], arguments=arguments))
    return calls


class OpenAiLlmAdapter:
    """`ILLMProvider` implementation over the OpenAI SDK."""

    key = "openai"

    def __init__(self, runtime: ProviderRuntime) -> None:
        self._runtime = runtime
        self._client = openai.AsyncOpenAI(
            api_key=runtime.api_key,
            base_url=runtime.endpoint_url,
            timeout=runtime.timeouts.request_ms / 1000,
        )
        self._first_token_ms: int | None = None

    def _classify(self, err: Exception) -> LlmError:
        """Maps ANY exception raised by an OpenAI SDK call (or by this
        adapter's own post-processing of the response) onto an `LlmError`.

        Mirrors `anthropic.py`/`google.py`'s `_classify` deliberately: every
        caller of `ILLMProvider` — `orchestration.failover`'s retry ladder and
        `summary.post_call.generate_and_send_summary`'s degrade-to-
        `SUMMARY_UNAVAILABLE` path — is written against `LlmError` as the
        single failure type of this port (`ports/llm.py`'s contract:
        "Raises `LlmError` on failure"). Anything leaking out unclassified
        breaks that contract at a distance.

        QA D-5 (phase7-agent-summary-wiring, retry 1): `complete_structured`
        previously enumerated only `RateLimitError`/`APITimeoutError`/
        `APIConnectionError`/`APIStatusError`, so an `AuthenticationError`
        (a credential revoked mid-call), a `NotFoundError` (model deprecated
        between session start and call end), or a `pydantic.ValidationError`
        from the re-validation step below escaped as a non-`LlmError` and
        propagated all the way out of `entrypoint.handle_job`'s teardown
        `finally`, skipping the terminal `"ended"` session event. The fallback
        branch below is what makes that structurally impossible now, rather
        than depending on the enumeration staying exhaustive forever.

        @param err: the raw exception to classify.
        @returns the equivalent `LlmError` (never raises).
        """
        if isinstance(err, openai.NotFoundError):
            return LlmError(
                f"Model '{self._runtime.model}' was rejected by openai.",
                retryable=True,
                code="LLM_MODEL_NOT_FOUND",
            )
        if isinstance(err, openai.AuthenticationError):
            return LlmError("openai authentication failed.", retryable=False, code="LLM_UNAVAILABLE")
        if isinstance(err, (openai.RateLimitError, openai.APITimeoutError, openai.APIConnectionError)):
            return LlmError("openai is temporarily unavailable.", retryable=True, code="LLM_UNAVAILABLE")
        if isinstance(err, openai.APIStatusError):
            # 5xx is a transient server-side fault (worth retrying); a 4xx is
            # a request the vendor will reject identically every time.
            return LlmError("openai request failed.", retryable=err.status_code >= 500, code="LLM_UNAVAILABLE")
        # Unanticipated: a malformed/empty response shape, a schema
        # re-validation failure, an SDK-internal error type added in a future
        # release. Non-retryable — retrying an unclassifiable failure is at
        # best useless and at worst an amplification loop.
        return LlmError("openai request failed.", retryable=False, code="LLM_UNAVAILABLE")

    async def complete_stream(
        self,
        messages: Sequence[ChatMessage],
        tools: Sequence[ToolSpec],
        residency: ResidencyPayload,
    ) -> AsyncIterator[LlmChunk]:
        """@inheritdoc"""
        started = time.monotonic()
        self._first_token_ms = None
        tool_defs = [
            {"type": "function", "function": {"name": t["name"], "description": t["description"], "parameters": t["parameters"]}}
            for t in tools
        ]
        try:
            stream = await self._client.chat.completions.create(
                model=self._runtime.model,
                messages=_messages_for(residency),
                tools=tool_defs or openai.NOT_GIVEN,
                stream=True,
            )
        except Exception as err:  # noqa: BLE001 - reclassified into the port's own error type
            raise self._classify(err) from err

        async def _iter() -> AsyncIterator[LlmChunk]:
            # OpenAI streams a tool call's `id`/`name`/`arguments` across
            # several deltas, keyed by `index` (one entry per parallel tool
            # call) — `arguments` arrives as partial JSON-string fragments
            # that must be concatenated before parsing (FR-AGENT-2).
            pending_calls: dict[int, dict[str, str]] = {}
            # Mid-stream failures (a dropped connection, a `[DONE]`-less
            # truncated stream, an unexpected chunk shape) are reclassified
            # too — same treatment `anthropic.py`'s `_iter` already gives its
            # own stream body, so the port's "raises `LlmError`" contract
            # holds for the whole call, not just its opening request.
            try:
                async for chunk in stream:
                    if not chunk.choices:
                        continue
                    delta = chunk.choices[0].delta
                    text = delta.content if delta else None
                    if text:
                        if self._first_token_ms is None:
                            self._first_token_ms = int((time.monotonic() - started) * 1000)
                        yield LlmChunk(delta=text, done=False)
                    for call_delta in getattr(delta, "tool_calls", None) or []:
                        entry = pending_calls.setdefault(call_delta.index, {"id": "", "name": "", "arguments": ""})
                        if call_delta.id:
                            entry["id"] = call_delta.id
                        fn = call_delta.function
                        if fn is not None and fn.name:
                            entry["name"] = fn.name
                        if fn is not None and fn.arguments:
                            entry["arguments"] += fn.arguments
            except LlmError:
                raise
            except Exception as err:  # noqa: BLE001 - reclassified for the caller
                raise self._classify(err) from err
            yield LlmChunk(delta="", done=True, tool_calls=_finalize_tool_calls(pending_calls))

        return _iter()

    async def complete_structured(
        self,
        messages: Sequence[ChatMessage],
        schema: type[M],
        residency: ResidencyPayload,
    ) -> M:
        """@inheritdoc — uses OpenAI's structured-output (`response_format`) facility.

        @raises LlmError: on **every** failure mode of this call — a vendor
            rejection (auth/model/rate-limit/status), an empty or malformed
            `choices` response, or a `pydantic.ValidationError` from the
            re-validation step. QA D-5: the request *and* the response
            post-processing are both inside the classified block, since a
            summary generated at end-of-call has no caller left able to
            handle an arbitrary exception type.
        """
        try:
            completion = await self._client.chat.completions.parse(
                model=self._runtime.model,
                messages=_messages_for(residency),
                response_format=schema,
            )
            # Guarded explicitly rather than left to raise `IndexError`: an
            # empty `choices` list is a real (if rare) vendor response, e.g.
            # a request filtered entirely by a content policy.
            choices = getattr(completion, "choices", None) or []
            if not choices:
                raise LlmError("openai returned an empty completion.", retryable=False)
            parsed = choices[0].message.parsed
            if parsed is None:
                raise LlmError("openai returned no structured content.", retryable=False)
            # Re-validated on the way back even though the SDK already parsed it —
            # never trust that a constrained response actually conformed (ADR-001 §3).
            return schema.model_validate(parsed.model_dump())
        except LlmError:
            # Already this port's own error type — must not be re-wrapped
            # (that would flatten `LLM_MODEL_NOT_FOUND`/retryable into the
            # generic fallback classification).
            raise
        except Exception as err:  # noqa: BLE001 - reclassified into the port's own error type
            raise self._classify(err) from err

    @property
    def first_token_ms(self) -> int | None:
        """@inheritdoc"""
        return self._first_token_ms
