"""The `ChatModel` port — abstracts the chat/reasoning provider (ADR-0004).

`domain`/`application` never learn which vendor answered (architecture.md §7):
this Protocol is the only shape either layer knows. The real adapter
(`adapters/outbound/chat/litellm_chat_model.py`) reaches OpenRouter through
LiteLLM inside Google ADK; a deterministic adapter
(`adapters/outbound/chat/deterministic_chat_model.py`) stands in when no live
key is configured, following the same "vendor absent -> deterministic
substitute, not a mock" pattern `OpenAiEmbedder`/`DeterministicLocalEmbedder`
already established in B-4.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import Protocol


class ChatModelUnavailableError(RuntimeError):
    """The named model could not be reached, timed out, errored, or refused the
    request. `application/fallback_chat.py` catches exactly this type to decide
    whether to retry against the agent's configured fallback model — an
    untested fallback path is not a fallback (FR-AGENT-12), so this exception is
    the one seam both the real adapter and every fallback test share."""

    def __init__(self, model: str, reason: str) -> None:
        super().__init__(f'Chat model "{model}" unavailable: {reason}')
        self.model = model
        self.reason = reason


@dataclass(frozen=True, slots=True)
class ChatMessage:
    role: str  # "system" | "user" | "assistant" | "tool"
    content: str


@dataclass(frozen=True, slots=True)
class ToolSpec:
    """A callable the model may invoke, as ADK/LiteLLM's function-calling shape
    expects — projected from a `ToolBinding` + its `Skill`, never a raw SQL row
    (ports/adapters keep the vendor's function-calling shape out of `domain`)."""

    name: str
    description: str
    input_schema_json: str


@dataclass(frozen=True, slots=True)
class ToolCallRequest:
    """A tool invocation the model asked for, if any."""

    tool_name: str
    arguments_json: str


@dataclass(frozen=True, slots=True)
class ChatRequest:
    model: str
    messages: list[ChatMessage]
    temperature: float
    max_output_tokens: int
    tools: list[ToolSpec] = field(default_factory=list)
    response_format: str | None = None
    """When set (currently only `"json_object"`), asks the provider to constrain its output
    to well-formed JSON — additive, `None` by default, every existing caller unaffected.
    Added for the flow-editing assistant (`application/propose_flow_edit.py`), which needs a
    structured plan back rather than a natural-language reply. NOT a substitute for real
    schema validation on the response: OpenRouter's JSON-mode support is model-dependent, and
    even where honoured it only guarantees well-formed JSON, not schema-conformant JSON — the
    caller must still validate the parsed structure itself."""


@dataclass(frozen=True, slots=True)
class ChatResponse:
    text: str
    input_tokens: int
    output_tokens: int
    tool_call: ToolCallRequest | None = None
    finish_reason: str = "stop"


@dataclass(frozen=True, slots=True)
class ChatStreamChunk:
    """One increment of a streamed completion (`ChatModel.stream()`), B-6.

    `delta_text` is the **new** text since the previous chunk — never
    cumulative — so a caller accumulates the full reply with
    ``"".join(chunk.delta_text for chunk in chunks)``. The stream's last
    chunk sets `is_final=True` (with `delta_text=""`) and carries the same
    usage/tool-call/finish-reason fields `ChatResponse` carries today, so a
    caller can fold an entire stream into the exact same `ChatResponse` shape
    `complete()` returns without a second, divergent response type:

        text = "".join(c.delta_text for c in chunks)
        final = next(c for c in chunks if c.is_final)
        response = ChatResponse(text=text, input_tokens=final.input_tokens,
                                 output_tokens=final.output_tokens,
                                 tool_call=final.tool_call,
                                 finish_reason=final.finish_reason)

    `application/fallback_chat.py`'s `InvokeWithFallbackStreaming` does
    exactly this while also forwarding each `delta_text` onward live, which
    is the whole point of this type existing separately from `ChatResponse`
    rather than `stream()` simply yielding many `ChatResponse`s.
    """

    delta_text: str
    is_final: bool = False
    input_tokens: int = 0
    output_tokens: int = 0
    tool_call: ToolCallRequest | None = None
    finish_reason: str = "stop"


class ChatModel(Protocol):
    async def complete(self, request: ChatRequest) -> ChatResponse:
        """Return a full completion. Raises :class:`ChatModelUnavailableError`
        on any failure — this port never returns a degraded result silently,
        matching `RerankPort`'s own established contract."""

    def stream(self, request: ChatRequest) -> AsyncIterator[ChatStreamChunk]:
        """Stream a completion incrementally, real chunk by real chunk.
        Raises :class:`ChatModelUnavailableError` on any failure — the same
        contract `complete()` carries, with one difference a caller must
        account for: `complete()` only ever raises before returning a result,
        while a `stream()` implementation may also raise partway through
        iteration (a connection that opens fine and then drops mid-response),
        a real possibility no caller of `complete()` ever had to consider.

        Declared here without `async def` — a plain `def` returning
        `AsyncIterator[...]` — which is the correct shape for a Protocol
        method a conforming class implements as an async generator (`async
        def stream(...): yield ...`): calling an async generator function
        returns an async generator object directly, with no `await` needed
        to obtain the iterator, exactly what a plain (non-async)
        `AsyncIterator[...]` return annotation expresses structurally.
        """
