import json
from collections.abc import AsyncIterator
from dataclasses import dataclass, field

import pytest

from shj3_ai.application.fallback_chat import InvokeWithFallback
from shj3_ai.application.propose_agent_creation import (
    ApiConnectorCatalogEntry,
    GuardrailPolicyCatalogEntry,
    McpToolCatalogEntry,
    ProposeAgentCreation,
    ProposeAgentCreationInput,
    SkillCatalogEntry,
)
from shj3_ai.ports.chat_model import (
    ChatModelUnavailableError,
    ChatRequest,
    ChatResponse,
    ChatStreamChunk,
)


@dataclass
class FakeChatModel:
    """Mirrors `test_propose_flow_edit.py`'s own dedicated fake exactly."""

    reply_text: str = "{}"
    fail_models: frozenset[str] = field(default_factory=frozenset)
    requests: list[ChatRequest] = field(default_factory=list)

    async def complete(self, request: ChatRequest) -> ChatResponse:
        self.requests.append(request)
        if request.model in self.fail_models:
            raise ChatModelUnavailableError(request.model, "forced failure for test")
        return ChatResponse(text=self.reply_text, input_tokens=10, output_tokens=5)

    async def stream(self, request: ChatRequest) -> AsyncIterator[ChatStreamChunk]:
        raise NotImplementedError("ProposeAgentCreation never streams")
        yield  # pragma: no cover - makes this an async generator


def _input(**overrides: object) -> ProposeAgentCreationInput:
    base: dict[str, object] = {
        "business_description": "An agent that helps citizens check their business license status.",
        "skills": (SkillCatalogEntry(id="skill-1", name="Check License", description=None),),
        "mcp_tools": (McpToolCatalogEntry(id="mcp-tool-1", name="Lookup", server_name="Licensing"),),
        "api_connectors": (ApiConnectorCatalogEntry(id="connector-1", name="License API"),),
        "guardrail_policies": (
            GuardrailPolicyCatalogEntry(
                policy_key="grounding_threshold", title="Grounding threshold", detail="x"
            ),
        ),
        "knowledge_collection_exists": True,
    }
    base.update(overrides)
    return ProposeAgentCreationInput(**base)  # type: ignore[arg-type]


@pytest.fixture(autouse=True)
def _clear_model_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("SHJ3_AGENT_CREATION_MODEL", raising=False)
    monkeypatch.delenv("SHJ3_AGENT_CREATION_FALLBACK_MODEL", raising=False)


async def test_a_valid_plan_response_parses_into_a_real_plan():
    reply = json.dumps(
        {
            "planSummary": "A licensing assistant",
            "identity": {"name": "License Helper", "description": "Checks license status."},
            "instructions": {"systemPrompt": "Be concise.", "tone": "Concise"},
            "modelConfig": {"primaryModel": "x", "fallbackModel": None, "temperature": 0.4},
        }
    )
    chat_model = FakeChatModel(reply_text=reply)
    use_case = ProposeAgentCreation(InvokeWithFallback(chat_model))

    result = await use_case.execute(_input())

    assert result.plan.name == "License Helper"
    assert result.plan.tone == "Concise"
    assert result.used_fallback is False


async def test_the_request_asks_for_json_mode_and_carries_the_real_catalogs_in_the_prompt():
    chat_model = FakeChatModel(reply_text="{}")
    use_case = ProposeAgentCreation(InvokeWithFallback(chat_model))

    await use_case.execute(_input())

    assert len(chat_model.requests) == 1
    request = chat_model.requests[0]
    assert request.response_format == "json_object"
    system_message = request.messages[0]
    assert system_message.role == "system"
    assert "skill-1" in system_message.content
    assert "mcp-tool-1" in system_message.content
    assert "grounding_threshold" in system_message.content
    assert request.messages[-1].role == "user"
    assert "business license" in request.messages[-1].content


async def test_malformed_model_output_yields_an_empty_plan_with_a_warning_not_a_crash():
    chat_model = FakeChatModel(reply_text="not json")
    use_case = ProposeAgentCreation(InvokeWithFallback(chat_model))

    result = await use_case.execute(_input())

    assert result.plan.name == ""
    assert len(result.plan.warnings) == 1


async def test_primary_model_failure_falls_back_and_response_format_survives_the_fallback_request(
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setenv("SHJ3_AGENT_CREATION_MODEL", "primary-model")
    monkeypatch.setenv("SHJ3_AGENT_CREATION_FALLBACK_MODEL", "fallback-model")
    chat_model = FakeChatModel(reply_text="{}", fail_models=frozenset({"primary-model"}))
    use_case = ProposeAgentCreation(InvokeWithFallback(chat_model))

    result = await use_case.execute(_input())

    assert result.used_fallback is True
    assert len(chat_model.requests) == 2
    assert chat_model.requests[0].response_format == "json_object"
    assert chat_model.requests[1].response_format == "json_object"
    assert chat_model.requests[1].model == "fallback-model"


async def test_a_request_supplied_model_overrides_the_env_default(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("SHJ3_AGENT_CREATION_MODEL", "env-model")
    chat_model = FakeChatModel(reply_text="{}")
    use_case = ProposeAgentCreation(InvokeWithFallback(chat_model))

    await use_case.execute(_input(model="tenant-configured-model"))

    assert chat_model.requests[0].model == "tenant-configured-model"
