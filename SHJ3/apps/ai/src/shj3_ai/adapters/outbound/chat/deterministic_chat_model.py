"""A deterministic, dependency-free `ChatModel` — the chat-side analogue of
B-4's `DeterministicLocalEmbedder`, selected automatically by
`chat_model_from_environment()` when no live `SHJ3_OPENROUTER_API_KEY` is
configured, so the full turn pipeline (routing, tool-calling, guardrails,
merge, cost accounting, the fallback path) is exercisable and provable against
real SQL Server/Redis infrastructure without a live OpenRouter key. Not a
quality claim about the *content* of any reply — stated plainly, matching the
embedder sibling's own disclosure.

**The forced-failure mechanism this wave's fallback test depends on**:
`SHJ3_CHAT_FORCE_FAIL_MODELS` (comma-separated model names) makes `complete()`
raise `ChatModelUnavailableError` for exactly those model names — the real
mechanism `tests/application/test_process_turn.py`'s live-infra fallback proof
uses to force the *primary* model to fail deterministically and confirm the
*fallback* model answers instead, without needing two real, distinct
OpenRouter model outages on demand.
"""

from __future__ import annotations

import asyncio
import json
import os
import re
from collections.abc import AsyncIterator

from shj3_ai.ports.chat_model import (
    ChatModel,
    ChatModelUnavailableError,
    ChatRequest,
    ChatResponse,
    ChatStreamChunk,
    ToolCallRequest,
)

# `DeterministicChatModel.stream()`'s real, honest simulated timing (B-6) —
# a small, real `asyncio.sleep()` between word-level chunks, deliberately in
# the 15-30ms range the deterministic-double's own docstring documents, never
# 0 (which would collapse into the exact "one microtask burst" shape this
# double exists to *not* be, and never claimed to be genuine provider
# timing — `LiteLlmChatModel.stream()` is the one that carries real,
# network-driven timing).
_STREAM_CHUNK_DELAY_SECONDS = 0.02

# A tiny, deterministic intent→tool heuristic: if the latest user message
# contains one of these substrings and the request offers a matching tool,
# "decide" to call it — the deterministic stand-in for what a real model's
# function-calling would do, real enough to drive a genuine `ToolCall` trace
# step end to end.
_INTENT_TRIGGERS: dict[str, tuple[str, ...]] = {
    "get_bill_status": ("bill status", "how much do i owe", "check my bill", "bill balance"),
    "list_service_centres": (
        "service centre",
        "service center",
        "nearest office",
        "where can i pay",
    ),
    # B-3's real, already-seeded `sewa` skill key — see
    # `adapters/outbound/tools/skill_invoker.py`'s `_NATIVE_SKILLS` for why
    # this maps to the same real handler as `get_bill_status`.
    "fetch_sewa_bill": ("bill status", "how much do i owe", "check my bill", "bill balance"),
}


class DeterministicChatModel:
    __slots__ = ("_fail_models",)

    def __init__(self, fail_models: frozenset[str] = frozenset()) -> None:
        self._fail_models = fail_models

    async def complete(self, request: ChatRequest) -> ChatResponse:
        if request.model in self._fail_models:
            raise ChatModelUnavailableError(
                request.model, "forced failure via SHJ3_CHAT_FORCE_FAIL_MODELS"
            )
        return self._build_response(request)

    async def stream(self, request: ChatRequest) -> AsyncIterator[ChatStreamChunk]:
        """An HONEST, clearly-documented deterministic test/no-live-key
        double SIMULATING chunk timing — not real provider streaming
        (contrast `LiteLlmChatModel.stream()`, which proxies genuine,
        network-driven provider timing). Splits the exact same deterministic
        reply `complete()` would return into word-level chunks and awaits a
        small, REAL `asyncio.sleep()` between each — real wall-clock spacing,
        so a caller/test genuinely observes discrete, separated deliveries
        rather than one microtask-scheduled burst — but the *content* of
        every chunk is entirely pre-computed, deterministic text, never a
        live model's own token-by-token generation. Exists so the full turn
        pipeline's real live-streaming code path (`ProcessTurn`'s primary-
        agent Sequential-mode invoke) is exercisable end to end without a
        live OpenRouter key, matching this class's own module docstring's
        established no-live-key convention.
        """
        if request.model in self._fail_models:
            raise ChatModelUnavailableError(
                request.model, "forced failure via SHJ3_CHAT_FORCE_FAIL_MODELS"
            )
        response = self._build_response(request)

        # A tool-call decision (or an empty reply) has no natural-language
        # text to chunk — go straight to the final, metadata-carrying chunk,
        # exactly like a real tool-calling model that emits no content
        # before its function call.
        words = response.text.split(" ") if response.tool_call is None and response.text else []
        for index, word in enumerate(words):
            await asyncio.sleep(_STREAM_CHUNK_DELAY_SECONDS)
            text = word if index == len(words) - 1 else word + " "
            yield ChatStreamChunk(delta_text=text)

        yield ChatStreamChunk(
            delta_text="",
            is_final=True,
            input_tokens=response.input_tokens,
            output_tokens=response.output_tokens,
            tool_call=response.tool_call,
            finish_reason=response.finish_reason,
        )

    def _build_response(self, request: ChatRequest) -> ChatResponse:
        """The same deterministic intent-matching/echo logic `complete()`
        has always used, factored out so `stream()` can chunk the identical
        computed reply rather than re-deriving a second, potentially
        divergent one. `complete()`'s own external behaviour is unchanged —
        this is a pure refactor, not a behaviour change."""
        # A generic, domain-agnostic deterministic substitute for JSON mode: an empty but
        # well-formed JSON object. This class deliberately knows nothing about any specific
        # caller's expected JSON shape (`propose_flow_edit.py`'s operation schema, or any
        # future JSON-mode consumer) — a caller's own parser must treat "no recognised keys
        # present" as "nothing to do" (e.g. an empty operations list), not a parse failure,
        # exactly the same "vendor absent -> honest, minimal substitute" pattern this file's
        # own module docstring already establishes for plain-text replies.
        if request.response_format == "json_object":
            return ChatResponse(text="{}", input_tokens=_estimate_tokens(request), output_tokens=1)

        last_user = next((m.content for m in reversed(request.messages) if m.role == "user"), "")
        lowered = last_user.lower()

        if request.tools:
            for tool in request.tools:
                triggers = _INTENT_TRIGGERS.get(tool.name, ())
                if any(trigger in lowered for trigger in triggers):
                    arguments = _default_arguments(tool.input_schema_json)
                    return ChatResponse(
                        text="",
                        input_tokens=_estimate_tokens(request),
                        output_tokens=8,
                        tool_call=ToolCallRequest(
                            tool_name=tool.name, arguments_json=json.dumps(arguments)
                        ),
                        finish_reason="tool_calls",
                    )

        text = f"[{request.model}] Acknowledged: {last_user[:200]}".strip()
        return ChatResponse(
            text=text,
            input_tokens=_estimate_tokens(request),
            output_tokens=max(1, len(text.split())),
        )


def _estimate_tokens(request: ChatRequest) -> int:
    # A rough, deterministic proxy (word count across every message) — good
    # enough for cost-ceiling arithmetic to be exercisable in tests without a
    # real tokenizer dependency; the real adapter reports the provider's own
    # usage figures.
    return sum(len(m.content.split()) for m in request.messages)


def _default_arguments(input_schema_json: str) -> dict[str, str]:
    try:
        schema = json.loads(input_schema_json)
    except (json.JSONDecodeError, TypeError):
        return {}
    properties = schema.get("properties", {}) if isinstance(schema, dict) else {}
    # A minimal, deterministic filler per declared property — "SEWA" for
    # anything named/shaped like a provider, otherwise a placeholder token.
    return {
        name: "SEWA" if re.search("provider", name, re.IGNORECASE) else f"demo-{name}"
        for name in properties
    }


def chat_model_from_environment() -> ChatModel:
    api_key = os.environ.get("SHJ3_OPENROUTER_API_KEY")
    if api_key:
        from shj3_ai.adapters.outbound.chat.litellm_chat_model import LiteLlmChatModel

        return LiteLlmChatModel(api_key)
    fail_models = frozenset(
        m.strip() for m in os.environ.get("SHJ3_CHAT_FORCE_FAIL_MODELS", "").split(",") if m.strip()
    )
    return DeterministicChatModel(fail_models)
