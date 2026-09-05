"""`ILLMProvider` — the only interface `orchestration` may depend on for LLM
calls (LLD §7.1). Protocol classes only; no implementations here and no
vendor imports (`.importlinter`'s `vendor-sdk-isolation` contract enforces
this at the package level).
"""

from __future__ import annotations

from collections.abc import AsyncIterator, Sequence
from dataclasses import dataclass, field
from typing import NotRequired, Protocol, TypedDict, TypeVar

from pydantic import BaseModel

M = TypeVar("M", bound=BaseModel)


class ChatMessage(TypedDict):
    """One turn in a chat-completion request."""

    role: str  # "system" | "user" | "assistant" | "tool"
    content: str


class ToolSpec(TypedDict):
    """One callable tool exposed to the model (FR-AGENT-2)."""

    name: str
    description: str
    parameters: dict[str, object]  # JSON Schema


class ToolCallRequest(TypedDict):
    """One model-requested tool call, detected during streaming (FR-AGENT-2).

    `arguments` is already parsed/decoded JSON (never a raw string an
    adapter hands off unparsed) — each adapter accumulates the vendor's own
    streamed representation (OpenAI's per-delta partial JSON fragments,
    Anthropic's `tool_use` content blocks, Gemini's `function_call` parts)
    and only emits a `ToolCallRequest` once it is a complete, decodable
    call, on the terminal `done=True` chunk.
    """

    id: str
    name: str
    arguments: dict[str, object]


class LlmChunk(TypedDict):
    """One streamed token/delta (FR-LLM-4 `first_token_ms` instrumentation point).

    `tool_calls` is only ever populated on the terminal `done=True` chunk
    (empty/absent on every delta chunk before it) — `NotRequired` so the
    many existing call sites/tests that construct a delta chunk without it
    keep type-checking and dict-equality-asserting correctly.
    """

    delta: str
    done: bool
    tool_calls: NotRequired[list[ToolCallRequest]]


@dataclass
class FailoverResult:
    """Successful outcome of `orchestration.failover.run_with_failover`
    (FR-LLM-4 instrumentation fields).

    Lives in `ports` (not `orchestration`, where it originated) so that
    `ports.orchestration.IOrchestrator` — the port `ConversationPipeline`
    depends on — can reference it as a return type without a lower layer
    (`ports`) importing a higher one (`orchestration`), which the `layers`
    import-linter contract forbids. `orchestration/failover.py` imports it
    from here; every existing `from avatar_agent.orchestration.failover
    import FailoverResult` call site keeps working unchanged.
    """

    stream: AsyncIterator[LlmChunk]
    provider_key: str
    used_fallback: bool


@dataclass(frozen=True)
class ResidencyPayload:
    """The **only** shape `ILLMProvider.complete_stream` accepts (LLD §8.5).

    Built exclusively by `avatar_agent.residency.filter.build_payload` — an
    adapter physically cannot attach content the filter stripped, because
    there is no overload taking raw messages.
    """

    system_prompt: str
    messages: Sequence[ChatMessage]
    retrieved_chunks: Sequence[str] = field(default_factory=tuple)


class LlmError(Exception):
    """Raised by an adapter on any failure; classifies retry eligibility (LLD §8.4).

    A `401`-class vendor rejection is not retried three times, while a
    `429`/`503`/timeout is — the adapter, which alone knows the vendor's
    status codes, makes this call.
    """

    def __init__(self, message: str, *, retryable: bool, code: str = "LLM_UNAVAILABLE") -> None:
        super().__init__(message)
        self.retryable = retryable
        self.code = code


class ILLMProvider(Protocol):
    """Streaming + structured-output LLM port (FR-LLM-1..4)."""

    key: str

    async def complete_stream(
        self,
        messages: Sequence[ChatMessage],
        tools: Sequence[ToolSpec],
        residency: ResidencyPayload,
    ) -> AsyncIterator[LlmChunk]:
        """Streams the assistant reply. Raises `LlmError` on failure."""
        ...

    async def complete_structured(
        self,
        messages: Sequence[ChatMessage],
        schema: type[M],
        residency: ResidencyPayload,
    ) -> M:
        """Returns a `schema`-constrained, re-validated structured result.

        Used by `summary/post_call.py`. Hand-parsing JSON from a free-text
        completion here would be an architecture-compliance failure.
        """
        ...

    @property
    def first_token_ms(self) -> int | None:
        """Latency of the most recent `complete_stream` call's first token, if measured."""
        ...
