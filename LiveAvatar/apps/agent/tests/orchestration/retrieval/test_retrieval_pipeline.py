"""Unit tests for the shared six-stage retrieval pipeline (Phase 12b,
BL-045/047/048). Exercises each stage's behavior in isolation with fake
`rewriter`/`searcher`/`gap_recorder`/embedder, plus a handful of
whole-pipeline composition tests.
"""

from __future__ import annotations

import asyncio
from uuid import UUID, uuid4

from avatar_agent.contracts.runtime_config import (
    HybridSearchStage,
    InjectStage,
    MetadataFilterCondition,
    MetadataFilterStage,
    RerankStage,
    RetrievalPipelineConfig,
    RewriteStage,
    ThresholdStage,
)
from avatar_agent.orchestration.retrieval import pipeline as rp
from avatar_agent.ports.orchestration import KnowledgeSearchCandidate, KnowledgeSearchRequest, KnowledgeSearchResponse


class FakeEmbeddingProvider:
    key = "fake"
    dimension = 3

    async def embed(self, inputs: list[str]) -> list[list[float]]:
        return [[0.1, 0.2, 0.3] for _ in inputs]


class FakeRewriter:
    def __init__(self, *, text: str = "rewritten query", delay: float = 0.0, raises: Exception | None = None) -> None:
        self.calls: list[tuple[str, str | None]] = []
        self._text = text
        self._delay = delay
        self._raises = raises

    async def rewrite(self, *, query: str, conversation_context: str | None) -> str:
        self.calls.append((query, conversation_context))
        if self._delay:
            await asyncio.sleep(self._delay)
        if self._raises is not None:
            raise self._raises
        return self._text


class FakeSearcher:
    def __init__(
        self, *, candidates: list[KnowledgeSearchCandidate] | None = None, delay: float = 0.0, raises: Exception | None = None
    ) -> None:
        self.requests: list[KnowledgeSearchRequest] = []
        self._candidates = candidates or []
        self._delay = delay
        self._raises = raises

    async def search(self, request: KnowledgeSearchRequest) -> KnowledgeSearchResponse:
        self.requests.append(request)
        if self._delay:
            await asyncio.sleep(self._delay)
        if self._raises is not None:
            raise self._raises
        return KnowledgeSearchResponse(candidates=self._candidates)


class FakeGapRecorder:
    def __init__(self) -> None:
        self.calls: list[dict[str, object]] = []

    async def record_gap(self, *, tenant_id: UUID, source_id: str | None, query: str, best_score: float | None) -> None:
        self.calls.append({"tenant_id": tenant_id, "source_id": source_id, "query": query, "best_score": best_score})


def make_candidate(**overrides: object) -> KnowledgeSearchCandidate:
    base: dict[str, object] = {
        "chunk_id": "chunk-1",
        "source_id": "source-1",
        "source_name": "returns-policy",
        "text": "Refunds are available within 30 days of delivery.",
        "vector_score": 0.8,
        "keyword_score": 0.7,
        "blend_score": 0.75,
        "passed_filter": True,
    }
    base.update(overrides)
    return KnowledgeSearchCandidate(**base)  # type: ignore[arg-type]


def make_pipeline_config(
    *,
    rewrite_enabled: bool = True,
    rewrite_budget_ms: int = 200,
    context_turns: int = 3,
    hybrid_budget_ms: int = 200,
    candidates: int = 20,
    metadata_filter_enabled: bool = False,
    metadata_filter_condition: MetadataFilterCondition | None = None,
    metadata_filter_budget_ms: int = 20,
    min_score: float = 0.5,
    threshold_budget_ms: int = 10,
    token_cap: int = 1200,
    citation_format: str = "numbered",
    inject_budget_ms: int = 30,
) -> RetrievalPipelineConfig:
    return RetrievalPipelineConfig(
        rewrite=RewriteStage(enabled=rewrite_enabled, context_turns=context_turns, budget_ms=rewrite_budget_ms),
        hybrid_search=HybridSearchStage(vector_weight=0.6, keyword_weight=0.4, candidates=candidates, budget_ms=hybrid_budget_ms),
        metadata_filter=MetadataFilterStage(
            enabled=metadata_filter_enabled, condition=metadata_filter_condition, budget_ms=metadata_filter_budget_ms
        ),
        rerank=RerankStage(),
        threshold=ThresholdStage(min_score=min_score, budget_ms=threshold_budget_ms),
        inject=InjectStage(token_cap=token_cap, citation_format=citation_format, budget_ms=inject_budget_ms),  # type: ignore[arg-type]
    )


def make_input(**overrides: object) -> rp.RetrievalPipelineInput:
    base: dict[str, object] = {
        "query": "refund after 30 days",
        "conversation_context": None,
        "source_refs": ["src-1"],
        "pipeline": make_pipeline_config(),
        "top_k": 5,
        "rewriter": None,
        "embedder": FakeEmbeddingProvider(),
        "searcher": FakeSearcher(candidates=[make_candidate()]),
        "gap_recorder": FakeGapRecorder(),
        "tenant_id": uuid4(),
        "budget_ms": 1000,
    }
    base.update(overrides)
    return rp.RetrievalPipelineInput(**base)  # type: ignore[arg-type]


# --- Rewrite stage -----------------------------------------------------------


async def test_rewrite_disabled_uses_the_original_query_unchanged() -> None:
    rewriter = FakeRewriter()
    cfg = make_pipeline_config(rewrite_enabled=False)
    searcher = FakeSearcher(candidates=[make_candidate()])
    result = await rp.run_retrieval_pipeline(make_input(pipeline=cfg, rewriter=rewriter, searcher=searcher))

    assert result.rewrite == rp.RewriteStageResult(enabled=False, rewritten_query=None, ms=0, timed_out=False)
    assert rewriter.calls == []
    assert searcher.requests[0].query_text == "refund after 30 days"


async def test_rewriter_none_disables_rewrite_even_when_enabled_in_config() -> None:
    """`rewriter=None` (e.g. no LLM leg resolved) is structurally distinct
    from `pipeline.rewrite.enabled=False` but produces the same no-op
    outcome."""
    cfg = make_pipeline_config(rewrite_enabled=True)
    searcher = FakeSearcher(candidates=[make_candidate()])
    result = await rp.run_retrieval_pipeline(make_input(pipeline=cfg, rewriter=None, searcher=searcher))

    assert result.rewrite.rewritten_query is None
    assert result.rewrite.timed_out is False
    assert searcher.requests[0].query_text == "refund after 30 days"


async def test_rewrite_enabled_and_successful_becomes_the_query_used_downstream() -> None:
    rewriter = FakeRewriter(text="refund eligibility after thirty days")
    cfg = make_pipeline_config(rewrite_enabled=True)
    searcher = FakeSearcher(candidates=[make_candidate()])
    result = await rp.run_retrieval_pipeline(
        make_input(pipeline=cfg, rewriter=rewriter, searcher=searcher, conversation_context="caller: hi")
    )

    assert result.rewrite.enabled is True
    assert result.rewrite.rewritten_query == "refund eligibility after thirty days"
    assert result.rewrite.timed_out is False
    assert rewriter.calls == [("refund after 30 days", "caller: hi")]
    assert searcher.requests[0].query_text == "refund eligibility after thirty days"


async def test_rewrite_timeout_falls_back_to_the_original_query() -> None:
    rewriter = FakeRewriter(text="should never be used", delay=1.0)
    cfg = make_pipeline_config(rewrite_enabled=True, rewrite_budget_ms=10)
    searcher = FakeSearcher(candidates=[make_candidate()])
    result = await rp.run_retrieval_pipeline(make_input(pipeline=cfg, rewriter=rewriter, searcher=searcher))

    assert result.rewrite.timed_out is True
    assert result.rewrite.rewritten_query is None
    assert searcher.requests[0].query_text == "refund after 30 days"


async def test_rewrite_exception_falls_back_to_the_original_query_and_never_raises() -> None:
    rewriter = FakeRewriter(raises=RuntimeError("boom"))
    cfg = make_pipeline_config(rewrite_enabled=True)
    searcher = FakeSearcher(candidates=[make_candidate()])
    result = await rp.run_retrieval_pipeline(make_input(pipeline=cfg, rewriter=rewriter, searcher=searcher))

    assert result.rewrite.timed_out is True
    assert result.rewrite.rewritten_query is None
    assert searcher.requests[0].query_text == "refund after 30 days"


# --- Hybrid search stage ------------------------------------------------------


async def test_hybrid_search_timeout_returns_zero_candidates() -> None:
    searcher = FakeSearcher(candidates=[make_candidate()], delay=1.0)
    cfg = make_pipeline_config(hybrid_budget_ms=10)
    result = await rp.run_retrieval_pipeline(make_input(pipeline=cfg, searcher=searcher))

    assert result.hybrid_search.candidates == []
    assert result.hybrid_search.timed_out is True


async def test_hybrid_search_raising_returns_zero_candidates_and_never_raises() -> None:
    searcher = FakeSearcher(raises=RuntimeError("search backend down"))
    result = await rp.run_retrieval_pipeline(make_input(searcher=searcher))

    assert result.hybrid_search.candidates == []
    assert result.hybrid_search.timed_out is True


async def test_hybrid_search_with_no_embedder_returns_zero_candidates_and_never_raises() -> None:
    """`embedder=None` (e.g. embedding resolution failed for this session,
    see `entrypoint._resolve_embedding_provider`) must degrade the same way
    a timeout or a raising searcher does -- never crash the turn."""
    searcher = FakeSearcher(candidates=[make_candidate()])
    result = await rp.run_retrieval_pipeline(make_input(embedder=None, searcher=searcher))

    assert result.hybrid_search.candidates == []
    assert result.hybrid_search.timed_out is True
    assert searcher.requests == []


async def test_hybrid_search_sends_the_configured_weights_and_candidate_count() -> None:
    searcher = FakeSearcher(candidates=[make_candidate()])
    cfg = make_pipeline_config(candidates=7)
    tenant = uuid4()
    await rp.run_retrieval_pipeline(make_input(pipeline=cfg, searcher=searcher, tenant_id=tenant, source_refs=["src-a"]))

    request = searcher.requests[0]
    assert request.tenant_id == tenant
    assert request.source_refs == ["src-a"]
    assert request.candidates == 7
    assert request.vector_weight == 0.6
    assert request.keyword_weight == 0.4
    assert request.filter is None


async def test_hybrid_search_sends_a_filter_only_when_metadata_filter_is_enabled() -> None:
    condition = MetadataFilterCondition(field="section", op="eq", value="refunds")
    searcher = FakeSearcher(candidates=[make_candidate()])
    cfg = make_pipeline_config(metadata_filter_enabled=True, metadata_filter_condition=condition)
    await rp.run_retrieval_pipeline(make_input(pipeline=cfg, searcher=searcher))

    request = searcher.requests[0]
    assert request.filter is not None
    assert request.filter.field == "section"
    assert request.filter.op == "eq"
    assert request.filter.value == "refunds"


# --- Metadata filter stage -----------------------------------------------------


def test_filter_disabled_passes_everything_through_regardless_of_passed_filter() -> None:
    candidates = [make_candidate(chunk_id="a", passed_filter=True), make_candidate(chunk_id="b", passed_filter=False)]
    cfg = make_pipeline_config(metadata_filter_enabled=False)
    filter_result = rp._run_filter(
        [rp.CandidateResult(**_candidate_result_kwargs(c)) for c in candidates],
        cfg,  # noqa: SLF001
    )
    result, kept = filter_result
    assert result.enabled is False
    assert result.before_count == 2
    assert result.after_count == 2
    assert {c.chunk_id for c in kept} == {"a", "b"}


def test_filter_enabled_narrows_to_only_passed_filter_candidates() -> None:
    candidates = [
        rp.CandidateResult(**_candidate_result_kwargs(make_candidate(chunk_id="a", passed_filter=True))),
        rp.CandidateResult(**_candidate_result_kwargs(make_candidate(chunk_id="b", passed_filter=False))),
    ]
    cfg = make_pipeline_config(metadata_filter_enabled=True)
    result, kept = rp._run_filter(candidates, cfg)  # noqa: SLF001

    assert result.enabled is True
    assert result.before_count == 2
    assert result.after_count == 1
    assert [c.chunk_id for c in kept] == ["a"]


def _candidate_result_kwargs(candidate: KnowledgeSearchCandidate) -> dict[str, object]:
    return {
        "chunk_id": candidate.chunk_id,
        "source_id": candidate.source_id,
        "source_name": candidate.source_name,
        "text_excerpt": candidate.text,
        "vector_score": candidate.vector_score,
        "keyword_score": candidate.keyword_score,
        "blend_score": candidate.blend_score,
        "passed_filter": candidate.passed_filter,
    }


# --- Rerank stage (permanent no-op, BL-070) ------------------------------------


def test_rerank_is_always_disabled_and_passes_candidates_through_unchanged() -> None:
    candidates = [rp.CandidateResult(**_candidate_result_kwargs(make_candidate(chunk_id="a")))]
    result, passthrough = rp._run_rerank(candidates)  # noqa: SLF001
    assert result.enabled is False
    assert "BL-070" in result.note
    assert passthrough is candidates


# --- Threshold stage -----------------------------------------------------------


async def test_threshold_drops_candidates_strictly_below_min_score() -> None:
    below = rp.CandidateResult(**_candidate_result_kwargs(make_candidate(chunk_id="below", blend_score=0.4)))
    result, passed = await rp._run_threshold(  # noqa: SLF001
        [below], make_pipeline_config(min_score=0.5), original_query="q", source_refs=["s1"], tenant_id=uuid4(), gap_recorder=None
    )
    assert result.pass_count == 0
    assert result.dropped_count == 1
    assert passed == []


async def test_threshold_keeps_candidates_at_exactly_min_score_boundary() -> None:
    at_boundary = rp.CandidateResult(**_candidate_result_kwargs(make_candidate(chunk_id="boundary", blend_score=0.5)))
    result, passed = await rp._run_threshold(  # noqa: SLF001
        [at_boundary],
        make_pipeline_config(min_score=0.5),
        original_query="q",
        source_refs=["s1"],
        tenant_id=uuid4(),
        gap_recorder=None,
    )
    assert result.pass_count == 1
    assert result.dropped_count == 0
    assert passed == [at_boundary]


async def test_threshold_empty_result_calls_gap_recorder_with_original_query_and_best_score() -> None:
    gap_recorder = FakeGapRecorder()
    low = rp.CandidateResult(**_candidate_result_kwargs(make_candidate(chunk_id="low", blend_score=0.3)))
    tenant = uuid4()
    await rp._run_threshold(  # noqa: SLF001
        [low],
        make_pipeline_config(min_score=0.5),
        original_query="refund after 30 days",
        source_refs=["only-source"],
        tenant_id=tenant,
        gap_recorder=gap_recorder,
    )
    assert gap_recorder.calls == [
        {"tenant_id": tenant, "source_id": "only-source", "query": "refund after 30 days", "best_score": 0.3}
    ]


async def test_threshold_empty_result_with_multiple_source_refs_reports_no_single_source_id() -> None:
    gap_recorder = FakeGapRecorder()
    low = rp.CandidateResult(**_candidate_result_kwargs(make_candidate(chunk_id="low", blend_score=0.3)))
    await rp._run_threshold(  # noqa: SLF001
        [low],
        make_pipeline_config(min_score=0.5),
        original_query="q",
        source_refs=["src-a", "src-b"],
        tenant_id=uuid4(),
        gap_recorder=gap_recorder,
    )
    assert gap_recorder.calls[0]["source_id"] is None


async def test_threshold_empty_result_with_zero_candidates_reports_best_score_none() -> None:
    gap_recorder = FakeGapRecorder()
    await rp._run_threshold(  # noqa: SLF001
        [],
        make_pipeline_config(min_score=0.5),
        original_query="q",
        source_refs=["s1"],
        tenant_id=uuid4(),
        gap_recorder=gap_recorder,
    )
    assert gap_recorder.calls[0]["best_score"] is None


async def test_threshold_does_not_call_gap_recorder_when_something_passed() -> None:
    gap_recorder = FakeGapRecorder()
    passing = rp.CandidateResult(**_candidate_result_kwargs(make_candidate(chunk_id="ok", blend_score=0.9)))
    await rp._run_threshold(  # noqa: SLF001
        [passing],
        make_pipeline_config(min_score=0.5),
        original_query="q",
        source_refs=["s1"],
        tenant_id=uuid4(),
        gap_recorder=gap_recorder,
    )
    assert gap_recorder.calls == []


async def test_threshold_empty_result_with_no_gap_recorder_does_not_raise() -> None:
    """The single most important behavioral assertion in this module: a
    `None` `gap_recorder` (the Playground preview's caller) must genuinely
    never be called. Since `_run_threshold` no longer wraps this call in a
    broad `try/except` (see its own docstring), this test WOULD fail loudly
    with an `AttributeError` if the `gap_recorder is not None` guard were
    ever accidentally removed -- it does not pass vacuously.
    """
    low = rp.CandidateResult(**_candidate_result_kwargs(make_candidate(chunk_id="low", blend_score=0.1)))
    result, passed = await rp._run_threshold(  # noqa: SLF001
        [low], make_pipeline_config(min_score=0.5), original_query="q", source_refs=["s1"], tenant_id=uuid4(), gap_recorder=None
    )
    assert result.pass_count == 0
    assert passed == []


async def test_playground_style_call_with_gap_recorder_none_end_to_end_never_raises() -> None:
    """End-to-end version of the above through the full pipeline (the actual
    shape `ai_service.py`'s `/retrieve-preview` uses -- `gap_recorder=None`
    always)."""
    searcher = FakeSearcher(candidates=[make_candidate(blend_score=0.1)])
    result = await rp.run_retrieval_pipeline(
        make_input(searcher=searcher, gap_recorder=None, pipeline=make_pipeline_config(min_score=0.5))
    )
    assert result.threshold.pass_count == 0
    assert result.inject.chunks == []


# --- Inject stage ----------------------------------------------------------


def test_inject_stops_before_exceeding_the_token_cap() -> None:
    # Each candidate's text is ~44 chars -> ~11 tokens at len//4.
    candidates = [
        rp.CandidateResult(**_candidate_result_kwargs(make_candidate(chunk_id=f"c{i}", blend_score=1.0 - i * 0.01)))
        for i in range(10)
    ]
    cfg = make_pipeline_config(token_cap=20)  # only room for ~1-2 chunks
    result, chunks = rp._run_inject(candidates, cfg, top_k=100)  # noqa: SLF001
    assert result.token_total <= 20
    assert len(chunks) < len(candidates)


def test_inject_respects_top_k_even_under_a_generous_token_cap() -> None:
    candidates = [
        rp.CandidateResult(**_candidate_result_kwargs(make_candidate(chunk_id=f"c{i}", blend_score=1.0 - i * 0.01)))
        for i in range(10)
    ]
    cfg = make_pipeline_config(token_cap=8000)
    result, chunks = rp._run_inject(candidates, cfg, top_k=3)  # noqa: SLF001
    assert len(chunks) == 3
    assert result.token_total == sum(c.token_count for c in chunks)


def test_inject_numbered_citation_labels_increment_per_chunk() -> None:
    candidates = [
        rp.CandidateResult(**_candidate_result_kwargs(make_candidate(chunk_id="a", blend_score=0.9))),
        rp.CandidateResult(**_candidate_result_kwargs(make_candidate(chunk_id="b", blend_score=0.8))),
    ]
    cfg = make_pipeline_config(citation_format="numbered", token_cap=8000)
    _result, chunks = rp._run_inject(candidates, cfg, top_k=10)  # noqa: SLF001
    assert [c.citation_label for c in chunks] == ["[1]", "[2]"]


def test_inject_inline_and_none_citation_formats_produce_no_label() -> None:
    candidate = rp.CandidateResult(**_candidate_result_kwargs(make_candidate(chunk_id="a")))
    for fmt in ("inline", "none"):
        cfg = make_pipeline_config(citation_format=fmt, token_cap=8000)
        _result, chunks = rp._run_inject([candidate], cfg, top_k=10)  # noqa: SLF001
        assert chunks[0].citation_label == ""


def test_format_injected_chunk_matches_each_citation_format() -> None:
    assert rp.format_injected_chunk(
        citation_label="[1]", source_name="policy", text_excerpt="text", citation_format="numbered"
    ) == ("[1] policy — text")
    assert rp.format_injected_chunk(citation_label="", source_name="policy", text_excerpt="text", citation_format="inline") == (
        "policy: text"
    )
    assert (
        rp.format_injected_chunk(citation_label="", source_name="policy", text_excerpt="text", citation_format="none") == "text"
    )


def test_inject_orders_by_blend_score_highest_first_even_if_input_is_unordered() -> None:
    low = rp.CandidateResult(**_candidate_result_kwargs(make_candidate(chunk_id="low", blend_score=0.2)))
    high = rp.CandidateResult(**_candidate_result_kwargs(make_candidate(chunk_id="high", blend_score=0.9)))
    cfg = make_pipeline_config(citation_format="numbered", token_cap=8000)
    _result, chunks = rp._run_inject([low, high], cfg, top_k=10)  # noqa: SLF001
    assert [c.source_name for c in chunks] == ["returns-policy", "returns-policy"]
    # The first injected chunk corresponds to the higher-scoring candidate.
    assert chunks[0].citation_label == "[1]"


# --- Node-level budget tracking ----------------------------------------------


async def test_budget_already_exceeded_before_hybrid_search_skips_the_search_entirely() -> None:
    """R-R3: once the node-level budget is blown by an earlier stage
    (rewrite), hybrid search must never even attempt a call."""
    rewriter = FakeRewriter(text="rewritten", delay=0.05)
    searcher = FakeSearcher(candidates=[make_candidate()])
    cfg = make_pipeline_config(rewrite_enabled=True, rewrite_budget_ms=1000)
    result = await rp.run_retrieval_pipeline(
        make_input(pipeline=cfg, rewriter=rewriter, searcher=searcher, budget_ms=10)  # tiny overall budget
    )

    assert searcher.requests == []
    assert result.hybrid_search.candidates == []
    assert result.hybrid_search.timed_out is True
    assert result.over_budget is True


async def test_over_budget_flag_reflects_total_ms_vs_budget_ms() -> None:
    searcher = FakeSearcher(candidates=[make_candidate()])
    result = await rp.run_retrieval_pipeline(make_input(searcher=searcher, budget_ms=100000))
    assert result.over_budget is False
    assert result.budget_ms == 100000
    assert result.total_ms == (
        result.rewrite.ms + result.hybrid_search.ms + result.filter.ms + result.threshold.ms + result.inject.ms
    )


# --- Whole-pipeline composition ------------------------------------------------


async def test_full_pipeline_happy_path_produces_a_coherent_result() -> None:
    rewriter = FakeRewriter(text="refund eligibility after thirty days")
    candidates = [
        make_candidate(chunk_id="1", source_name="returns-policy", blend_score=0.9, passed_filter=True),
        make_candidate(chunk_id="2", source_name="faq", blend_score=0.2, passed_filter=True),
    ]
    searcher = FakeSearcher(candidates=candidates)
    gap_recorder = FakeGapRecorder()
    cfg = make_pipeline_config(min_score=0.5, citation_format="numbered")
    result = await rp.run_retrieval_pipeline(
        make_input(pipeline=cfg, rewriter=rewriter, searcher=searcher, gap_recorder=gap_recorder)
    )

    assert result.rewrite.rewritten_query == "refund eligibility after thirty days"
    assert len(result.hybrid_search.candidates) == 2
    assert result.filter.enabled is False
    assert result.threshold.pass_count == 1
    assert result.threshold.dropped_count == 1
    assert gap_recorder.calls == []  # something passed -> no gap
    assert len(result.inject.chunks) == 1
    assert result.inject.chunks[0].citation_label == "[1]"
    assert result.inject.chunks[0].source_name == "returns-policy"
    # The full candidate list (not just survivors) carries passed_threshold.
    by_id = {c.chunk_id: c for c in result.hybrid_search.candidates}
    assert by_id["1"].passed_threshold is True
    assert by_id["2"].passed_threshold is False
