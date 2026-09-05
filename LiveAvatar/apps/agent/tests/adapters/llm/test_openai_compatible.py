"""Unit tests for the on-prem/gateway `llm.openai-compatible` adapter."""

from __future__ import annotations

import pytest

from avatar_agent.adapters.llm._openai_compatible import OpenAiCompatibleLlmAdapter
from avatar_agent.ports.runtime import ProviderRuntime


def test_requires_an_endpoint_url() -> None:
    runtime = ProviderRuntime(logical_key="llm.openai-compatible", endpoint_url=None, api_key="k", model="llama3")
    with pytest.raises(ValueError, match="endpoint_url"):
        OpenAiCompatibleLlmAdapter(runtime)


def test_constructs_successfully_with_an_endpoint_url_and_uses_the_openai_wire_protocol() -> None:
    runtime = ProviderRuntime(
        logical_key="llm.openai-compatible", endpoint_url="http://localhost:11434/v1", api_key="k", model="llama3"
    )
    adapter = OpenAiCompatibleLlmAdapter(runtime)
    assert adapter.key == "openai-compatible"
