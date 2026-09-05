"""Unit tests for `RetrieveNodeExecutor` (Phase 12b, BL-045/047/048) — the
real six-stage retrieval pipeline, replacing the Phase 9 stub (which used to
be tested here as a logged no-op; see `orchestration.retrieval.pipeline`'s
own test module, `tests/orchestration/retrieval/test_pipeline.py`, for the
stage-by-stage behavior this executor delegates to).
"""

from __future__ import annotations

from uuid import UUID, uuid4

from avatar_agent.contracts.runtime_config import (
    HybridSearchStage,
    InjectStage,
    MetadataFilterStage,
    RerankStage,
    RetrievalPipelineConfig,
    RetrieveNode,
    RetryPolicy,
    RewriteStage,
    ThresholdStage,
)
from avatar_agent.orchestration.graph.ir import TurnContext
from avatar_agent.orchestration.graph.nodes.retrieve import RetrieveNodeExecutor, _build_conversation_context
from avatar_agent.ports.llm import ChatMessage
from avatar_agent.ports.orchestration import (
    KnowledgeSearchCandidate,
    KnowledgeSearchRequest,
    KnowledgeSearchResponse,
    ResolvedLlmNode,
)
from avatar_agent.residency.filter import ResidencyPayload


class _NullHopRecorder:
    def record(self, item):  # noqa: ANN001
        pass

    async def flush(self) -> None:
        pass


class FakeLlmProvider:
    key = "openai"

    def __init__(self, text: str = "rewritten query") -> None:
        self._text = text
        self.call_count = 0

    async def complete_stream(self, messages, tools, residency):  # noqa: ANN001
        self.call_count += 1
        text = self._text

        async def _gen():
            yield {"delta": text, "done": False}
            yield {"delta": "", "done": True}

        return _gen()

    async def complete_structured(self, *a, **k):  # noqa: ANN002, ANN003
        raise NotImplementedError

    @property
    def first_token_ms(self) -> int | None:
        return None


class FakeSearcher:
    def __init__(self, candidates: list[KnowledgeSearchCandidate] | None = None) -> None:
        self.requests: list[KnowledgeSearchRequest] = []
        self._candidates = candidates or []

    async def search(self, request: KnowledgeSearchRequest) -> KnowledgeSearchResponse:
        self.requests.append(request)
        return KnowledgeSearchResponse(candidates=self._candidates)


class FakeGapRecorder:
    def __init__(self) -> None:
        self.calls: list[dict[str, object]] = []

    async def record_gap(self, *, tenant_id: UUID, source_id: str | None, query: str, best_score: float | None) -> None:
        self.calls.append({"tenant_id": tenant_id, "source_id": source_id, "query": query, "best_score": best_score})


class FakeEmbeddingProvider:
    key = "fake"
    dimension = 3

    async def embed(self, inputs: list[str]) -> list[list[float]]:
        return [[0.1, 0.2, 0.3] for _ in inputs]


def make_candidate(**overrides: object) -> KnowledgeSearchCandidate:
    base: dict[str, object] = {
        "chunk_id": "chunk-1",
        "source_id": "source-1",
        "source_name": "returns-policy",
        "text": "Refunds are available within 30 days of delivery.",
        "vector_score": 0.8,
        "keyword_score": 0.7,
        "blend_score": 0.9,
        "passed_filter": True,
    }
    base.update(overrides)
    return KnowledgeSearchCandidate(**base)  # type: ignore[arg-type]


def make_pipeline_config(**overrides: object) -> RetrievalPipelineConfig:
    base: dict[str, object] = {
        "rewrite": RewriteStage(enabled=True, context_turns=3, budget_ms=200),
        "hybrid_search": HybridSearchStage(vector_weight=0.6, keyword_weight=0.4, candidates=20, budget_ms=200),
        "metadata_filter": MetadataFilterStage(enabled=False, budget_ms=20),
        "rerank": RerankStage(),
        "threshold": ThresholdStage(min_score=0.5, budget_ms=10),
        "inject": InjectStage(token_cap=1200, citation_format="numbered", budget_ms=30),
    }
    base.update(overrides)
    return RetrievalPipelineConfig(**base)  # type: ignore[arg-type]


def make_retrieve_node(
    *,
    node_id: str = "retrieve-1",
    next_node_id: str | None = "llm-1",
    on_error_target: str | None = "llm-1",
    budget_ms: int = 1000,
) -> RetrieveNode:
    on_error = {"action": "goto", "target_node_id": on_error_target} if on_error_target else {"action": "degrade"}
    return RetrieveNode.model_validate(
        {
            "id": node_id,
            "type": "retrieve",
            "name": "Retrieve",
            "lane": "foreground",
            "on_error": on_error,
            "on_deadline": {"action": "degrade"},
            "source_refs": ["kb-1"],
            "top_k": 5,
            "budget_ms": budget_ms,
            "next_node_id": next_node_id,
        }
    )


# Sentinel distinguishing "caller didn't pass `embedding_provider`, use the
# default fake" from "caller explicitly passed `embedding_provider=None`"
# (a real, meaningful value -- embedding resolution failed for this
# session) -- `None` itself can't serve as the "unset" default here.
_UNSET = object()


def make_ctx(
    *,
    utterance: str = "refund after 30 days",
    messages: tuple[ChatMessage, ...] = (),
    knowledge_pipeline: RetrievalPipelineConfig | None = None,
    searcher: FakeSearcher | None = None,
    gap_recorder: FakeGapRecorder | None = None,
    default_llm: ResolvedLlmNode | None = None,
    embedding_provider: object = _UNSET,
) -> TurnContext:
    async def _speak(text: str) -> None:  # pragma: no cover - not exercised here
        pass

    resolved_embedding_provider = FakeEmbeddingProvider() if embedding_provider is _UNSET else embedding_provider

    return TurnContext(
        session_id=uuid4(),
        tenant_id=uuid4(),
        utterance_seq=1,
        llm_by_node={},
        tool_definitions_by_api_ref={},
        tools_by_name={},
        tool_specs=[],
        tool_executor=object(),
        residency=ResidencyPayload(system_prompt="sys", messages=(*messages, ChatMessage(role="user", content=utterance))),
        turn_state={"utterance": utterance},
        speak=_speak,
        hop_recorder=_NullHopRecorder(),
        embedding_provider=resolved_embedding_provider,  # type: ignore[arg-type]
        knowledge_pipeline=knowledge_pipeline or make_pipeline_config(),
        knowledge_search=searcher if searcher is not None else FakeSearcher(),
        knowledge_gap=gap_recorder if gap_recorder is not None else FakeGapRecorder(),
        default_llm=default_llm,
    )


# --- Core execution behavior --------------------------------------------------


async def test_execute_injects_formatted_chunks_via_apply_retrieved_chunks() -> None:
    searcher = FakeSearcher(candidates=[make_candidate(source_name="returns-policy", text="Refund policy text.")])
    node = make_retrieve_node()
    ctx = make_ctx(searcher=searcher)

    result, next_id = await RetrieveNodeExecutor().execute(node, ctx)

    assert result.status == "complete"
    assert result.node_type == "retrieve"
    assert next_id == "llm-1"
    assert len(ctx.residency.retrieved_chunks) == 1
    assert "returns-policy" in ctx.residency.retrieved_chunks[0]
    assert "Refund policy text." in ctx.residency.retrieved_chunks[0]
    assert ctx.residency.retrieved_chunks[0].startswith("[1]")


async def test_execute_returns_complete_status_even_with_zero_chunks_injected() -> None:
    """An empty result is a valid, non-error outcome (R-R3/R-R7)."""
    searcher = FakeSearcher(candidates=[])
    node = make_retrieve_node()
    ctx = make_ctx(searcher=searcher)

    result, next_id = await RetrieveNodeExecutor().execute(node, ctx)

    assert result.status == "complete"
    assert next_id == "llm-1"
    assert ctx.residency.retrieved_chunks == ()


async def test_execute_with_no_embedding_provider_still_completes_with_zero_chunks() -> None:
    """`ctx.embedding_provider is None` (embedding resolution failed for
    this session) must degrade gracefully, same as any other stage
    failure -- never crash the turn."""
    searcher = FakeSearcher(candidates=[make_candidate()])
    node = make_retrieve_node()
    ctx = make_ctx(searcher=searcher, embedding_provider=None)

    result, next_id = await RetrieveNodeExecutor().execute(node, ctx)

    assert result.status == "complete"
    assert next_id == "llm-1"
    assert ctx.residency.retrieved_chunks == ()
    assert searcher.requests == []


async def test_execute_calls_the_gap_recorder_when_nothing_passes_threshold() -> None:
    searcher = FakeSearcher(candidates=[make_candidate(blend_score=0.1)])
    gap_recorder = FakeGapRecorder()
    node = make_retrieve_node()
    ctx = make_ctx(
        searcher=searcher, gap_recorder=gap_recorder, knowledge_pipeline=make_pipeline_config(rewrite=RewriteStage(enabled=False))
    )

    await RetrieveNodeExecutor().execute(node, ctx)

    assert len(gap_recorder.calls) == 1
    assert gap_recorder.calls[0]["query"] == "refund after 30 days"


async def test_execute_with_no_default_llm_silently_disables_rewrite() -> None:
    """`ctx.default_llm is None` (no LLM node in the graph) must not fail
    the node -- rewrite silently no-ops, using the raw utterance."""
    searcher = FakeSearcher(candidates=[make_candidate()])
    node = make_retrieve_node()
    ctx = make_ctx(searcher=searcher, default_llm=None)

    result, _next_id = await RetrieveNodeExecutor().execute(node, ctx)

    assert result.status == "complete"
    assert searcher.requests[0].query_text == "refund after 30 days"


async def test_execute_with_a_default_llm_uses_the_rewritten_query() -> None:
    searcher = FakeSearcher(candidates=[make_candidate()])
    provider = FakeLlmProvider(text="refund eligibility after thirty days")
    default_llm = ResolvedLlmNode(primary=provider, fallback=None, retry=RetryPolicy(max_attempts=1, backoff_ms=[0]))
    node = make_retrieve_node()
    ctx = make_ctx(searcher=searcher, default_llm=default_llm)

    await RetrieveNodeExecutor().execute(node, ctx)

    assert provider.call_count == 1
    assert searcher.requests[0].query_text == "refund eligibility after thirty days"


async def test_execute_on_unexpected_pipeline_failure_takes_on_error_edge() -> None:
    """Defensive posture: if `run_retrieval_pipeline` itself somehow raises
    (it shouldn't per its own internal handling), the node fails and takes
    its configured `on_error` edge rather than crashing the turn."""
    import avatar_agent.orchestration.graph.nodes.retrieve as retrieve_module

    async def _boom(*_a, **_k):
        raise RuntimeError("boom")

    node = make_retrieve_node(next_node_id="normal-next", on_error_target="error-path")
    ctx = make_ctx()

    original = retrieve_module.run_retrieval_pipeline
    retrieve_module.run_retrieval_pipeline = _boom  # type: ignore[assignment]
    try:
        result, next_id = await RetrieveNodeExecutor().execute(node, ctx)
    finally:
        retrieve_module.run_retrieval_pipeline = original  # type: ignore[assignment]

    assert result.status == "failed"
    assert result.error_code == "RETRIEVE_NODE_ERROR"
    assert next_id == "error-path"  # the on_error edge, not the ordinary next_node_id


# --- Conversation-context building (documented judgment call) -----------------


def test_build_conversation_context_excludes_the_current_utterance() -> None:
    messages = (
        ChatMessage(role="user", content="my order arrived broken"),
        ChatMessage(role="assistant", content="I'm sorry to hear that"),
        ChatMessage(role="user", content="what about a refund"),  # the "current utterance"
    )
    context = _build_conversation_context(messages, context_turns=3)
    assert context is not None
    assert "what about a refund" not in context
    assert "caller: my order arrived broken" in context
    assert "agent: I'm sorry to hear that" in context


def test_build_conversation_context_slices_to_the_last_n_turns() -> None:
    messages = tuple(ChatMessage(role="user" if i % 2 == 0 else "assistant", content=f"msg{i}") for i in range(10))
    context = _build_conversation_context(messages, context_turns=1)
    assert context is not None
    lines = context.split("\n")
    assert len(lines) == 2  # 2 * context_turns


def test_build_conversation_context_returns_none_when_no_prior_messages() -> None:
    messages = (ChatMessage(role="user", content="only the current utterance"),)
    assert _build_conversation_context(messages, context_turns=3) is None
