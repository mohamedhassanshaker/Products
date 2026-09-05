"""Pydantic models used as `ILLMProvider.complete_structured` output schemas.

ADR-001 §3 requires model output feeding application logic to go through a
typed schema passed to the framework's structured-output facility and
re-validated on return — never hand-parsed JSON from a free-text
completion. Every structured call site in this codebase must pass one of
these models (or a test-only equivalent), never a raw dict.
"""

from __future__ import annotations

from pydantic import BaseModel, Field


class PostCallSummary(BaseModel):
    """FR-CALL-4 — one-paragraph post-call summary, generated once at end-call."""

    summary_text: str = Field(max_length=500)


class ToolInvocationArgs(BaseModel):
    """Generic container for a tool call's arguments (FR-AGENT-2).

    Concrete tools validate their own arguments against `ToolDefinition.argsSchema`
    (a JSON Schema stored per tool) — this model only guarantees the LLM's
    tool-call payload round-trips as a JSON object, never a hand-parsed string.
    """

    arguments: dict[str, object] = Field(default_factory=dict)
