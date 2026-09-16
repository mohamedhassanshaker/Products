import json
from collections.abc import AsyncIterator
from dataclasses import dataclass, field

import pytest

from shj3_ai.application.fallback_chat import InvokeWithFallback
from shj3_ai.application.propose_flow_edit import (
    ConversationTurn,
    FlowEdgeSnapshot,
    FlowNodeSnapshot,
    ProposeFlowEdit,
    ProposeFlowEditInput,
)
from shj3_ai.domain.flow_edit_plan import CreateNodeOperation
from shj3_ai.ports.chat_model import (
    ChatModelUnavailableError,
    ChatRequest,
    ChatResponse,
    ChatStreamChunk,
)


@dataclass
class FakeChatModel:
    """A small, dedicated fake — mirrors `tests/application/orchestration_fakes.py`'s own
    `FakeChatModel` shape (record calls, controllable failure), scoped to this file since
    this use case's own needs (returning a fixed JSON `reply_text`, seeing the real
    `response_format` a caller passed) are narrower than that shared fixture's."""

    reply_text: str = "{}"
    fail_models: frozenset[str] = field(default_factory=frozenset)
    requests: list[ChatRequest] = field(default_factory=list)

    async def complete(self, request: ChatRequest) -> ChatResponse:
        self.requests.append(request)
        if request.model in self.fail_models:
            raise ChatModelUnavailableError(request.model, "forced failure for test")
        return ChatResponse(text=self.reply_text, input_tokens=10, output_tokens=5)

    async def stream(self, request: ChatRequest) -> AsyncIterator[ChatStreamChunk]:
        raise NotImplementedError("ProposeFlowEdit never streams")
        yield  # pragma: no cover - makes this an async generator


_NODES = (
    FlowNodeSnapshot(
        id="node-greeting",
        type="Message",
        title="Greeting",
        message_text="Welcome!",
        slot_name=None,
        option_source_kind=None,
        tool_binding_id=None,
        handover_reason=None,
        condition_expression=None,
    ),
)
_EDGES: tuple[FlowEdgeSnapshot, ...] = ()


@pytest.fixture(autouse=True)
def _clear_model_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("SHJ3_FLOW_EDIT_MODEL", raising=False)
    monkeypatch.delenv("SHJ3_FLOW_EDIT_FALLBACK_MODEL", raising=False)


async def test_a_valid_plan_response_parses_into_real_operations():
    reply = json.dumps(
        {
            "planSummary": "Add a follow-up question",
            "operations": [
                {
                    "kind": "CreateNode",
                    "localRef": "amount",
                    "nodeType": "Question",
                    "summary": "Ask for the bill amount",
                    "title": "Ask amount",
                    "slotName": "amount",
                    "optionSourceKind": "Static",
                    "staticOptionsJson": '["Yes", "No"]',
                }
            ],
        }
    )
    chat_model = FakeChatModel(reply_text=reply)
    use_case = ProposeFlowEdit(InvokeWithFallback(chat_model))

    result = await use_case.execute(
        ProposeFlowEditInput(
            instruction="Add a question asking for the bill amount",
            conversation_history=(),
            nodes=_NODES,
            edges=_EDGES,
        )
    )

    assert result.plan.plan_summary == "Add a follow-up question"
    assert len(result.plan.operations) == 1
    assert isinstance(result.plan.operations[0], CreateNodeOperation)
    assert result.used_fallback is False


async def test_the_request_asks_for_json_mode_and_carries_a_real_system_prompt_with_the_flow_snapshot():
    chat_model = FakeChatModel(reply_text="{}")
    use_case = ProposeFlowEdit(InvokeWithFallback(chat_model))

    await use_case.execute(
        ProposeFlowEditInput(
            instruction="Do something",
            conversation_history=(),
            nodes=_NODES,
            edges=_EDGES,
        )
    )

    assert len(chat_model.requests) == 1
    request = chat_model.requests[0]
    assert request.response_format == "json_object"
    system_message = request.messages[0]
    assert system_message.role == "system"
    assert "node-greeting" in system_message.content
    assert request.messages[-1].role == "user"
    assert request.messages[-1].content == "Do something"


async def test_conversation_history_is_threaded_through_as_real_prior_turns():
    chat_model = FakeChatModel(reply_text="{}")
    use_case = ProposeFlowEdit(InvokeWithFallback(chat_model))

    await use_case.execute(
        ProposeFlowEditInput(
            instruction="Also add a fallback",
            conversation_history=(
                ConversationTurn(role="user", text="Add a question node"),
                ConversationTurn(role="assistant", text="Added a Question node asking for the amount."),
            ),
            nodes=_NODES,
            edges=_EDGES,
        )
    )

    request = chat_model.requests[0]
    roles_and_text = [(m.role, m.content) for m in request.messages]
    assert ("user", "Add a question node") in roles_and_text
    assert ("assistant", "Added a Question node asking for the amount.") in roles_and_text
    assert roles_and_text[-1] == ("user", "Also add a fallback")


async def test_malformed_model_output_yields_an_empty_plan_with_a_warning_not_a_crash():
    chat_model = FakeChatModel(reply_text="not json")
    use_case = ProposeFlowEdit(InvokeWithFallback(chat_model))

    result = await use_case.execute(
        ProposeFlowEditInput(instruction="x", conversation_history=(), nodes=_NODES, edges=_EDGES)
    )

    assert result.plan.operations == ()
    assert len(result.plan.warnings) == 1


async def test_a_dropped_reference_to_an_unknown_node_id_is_reported_as_a_warning():
    reply = json.dumps(
        {"operations": [{"kind": "DeleteNode", "nodeId": "node-does-not-exist", "summary": "x"}]}
    )
    chat_model = FakeChatModel(reply_text=reply)
    use_case = ProposeFlowEdit(InvokeWithFallback(chat_model))

    result = await use_case.execute(
        ProposeFlowEditInput(instruction="x", conversation_history=(), nodes=_NODES, edges=_EDGES)
    )

    assert result.plan.operations == ()
    assert "unknown node" in result.plan.warnings[0]


async def test_primary_model_failure_falls_back_and_response_format_survives_the_fallback_request(
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setenv("SHJ3_FLOW_EDIT_MODEL", "primary-model")
    monkeypatch.setenv("SHJ3_FLOW_EDIT_FALLBACK_MODEL", "fallback-model")
    chat_model = FakeChatModel(reply_text="{}", fail_models=frozenset({"primary-model"}))
    use_case = ProposeFlowEdit(InvokeWithFallback(chat_model))

    result = await use_case.execute(
        ProposeFlowEditInput(instruction="x", conversation_history=(), nodes=_NODES, edges=_EDGES)
    )

    assert result.used_fallback is True
    assert len(chat_model.requests) == 2
    # The real bug this test guards against: InvokeWithFallback's fallback ChatRequest used
    # to drop response_format entirely, which would have silently lost JSON mode on retry.
    assert chat_model.requests[0].response_format == "json_object"
    assert chat_model.requests[1].response_format == "json_object"
    assert chat_model.requests[1].model == "fallback-model"


async def test_no_fallback_configured_and_primary_fails_raises(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("SHJ3_FLOW_EDIT_MODEL", "primary-model")
    chat_model = FakeChatModel(reply_text="{}", fail_models=frozenset({"primary-model"}))
    use_case = ProposeFlowEdit(InvokeWithFallback(chat_model))

    with pytest.raises(ChatModelUnavailableError):
        await use_case.execute(
            ProposeFlowEditInput(instruction="x", conversation_history=(), nodes=_NODES, edges=_EDGES)
        )


async def test_a_request_supplied_model_overrides_the_env_default(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("SHJ3_FLOW_EDIT_MODEL", "env-model")
    monkeypatch.setenv("SHJ3_FLOW_EDIT_FALLBACK_MODEL", "env-fallback")
    chat_model = FakeChatModel(reply_text="{}")
    use_case = ProposeFlowEdit(InvokeWithFallback(chat_model))

    await use_case.execute(
        ProposeFlowEditInput(
            instruction="x",
            conversation_history=(),
            nodes=_NODES,
            edges=_EDGES,
            model="tenant-configured-model",
            fallback_model="tenant-configured-fallback",
        )
    )

    assert chat_model.requests[0].model == "tenant-configured-model"


async def test_an_omitted_model_still_falls_back_to_the_env_default_exactly_as_before():
    chat_model = FakeChatModel(reply_text="{}")
    use_case = ProposeFlowEdit(InvokeWithFallback(chat_model))

    await use_case.execute(
        ProposeFlowEditInput(instruction="x", conversation_history=(), nodes=_NODES, edges=_EDGES)
    )

    assert chat_model.requests[0].model == "anthropic/claude-sonnet-5"
