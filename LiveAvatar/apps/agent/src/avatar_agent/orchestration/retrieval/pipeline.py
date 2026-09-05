"""The shared six-stage retrieval pipeline (Phase 12b, BL-045/047/048;
`ARCHITECTURE_NOTES.md` §4.4, `AgentBuilder_..._RAG_...md` §A7.2's
R-R3..R-R8, the plan doc's Phase 12b "Decisions made this phase" #6-11).

Implements rewrite -> hybrid search -> metadata filter -> rerank(disabled)
-> threshold -> inject **once**, reused by two callers:

1. The live Retrieve node executor (`orchestration/graph/nodes/retrieve.py`)
   — runs inside the LiveKit worker process during a real turn, has a
   `TurnContext`, writes real `KnowledgeGap` rows on low scores, injects
   chunks into `ctx.residency`.
2. `services/ai_service.py`'s `POST /retrieve-preview` (the Playground's
   real code path) — runs this exact same function against a request
   payload, no `TurnContext`/session, **never** writes a `KnowledgeGap` row
   (a playground run is a diagnostic query, not a real caller turn — see
   `RetrievalPipelineInput.gap_recorder`'s docstring), and returns the full
   per-stage breakdown as its HTTP response.

**Node-level budget tracking (R-R3)**: `run_retrieval_pipeline` tracks
cumulative elapsed wall-clock time across stages 1-2 (the only two stages
with real latency — 3 through 6 are synchronous/local) against
`RetrievalPipelineInput.budget_ms`. Before starting rewrite, and again
before starting hybrid search, it checks whether elapsed-so-far already
exceeds the overall budget; if so, it skips straight to inject with
whatever's already available (nothing, at that point) rather than starting a
stage doomed to blow the budget further. This is deliberately simpler than
reusing `interpreter.py`'s whole-node `resolve_on_deadline`/
`asyncio.wait_for` machinery, which hard-cancels a node's entire `execute()`
call on timeout — discarding every chunk already fetched, the opposite of
R-R3's "return whatever's been retrieved so far." Only the two network-bound
stages (rewrite's LLM call, hybrid search's embed+search sequence) are
individually wrapped in their own `asyncio.wait_for`; a stage timeout is
caught locally and treated as "this stage contributed nothing," never as a
node failure.
"""

from __future__ import annotations

import asyncio
import time
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Protocol
from uuid import UUID

import structlog
from pydantic import BaseModel, ConfigDict

from avatar_agent.contracts.runtime_config import CitationFormat, RetrievalPipelineConfig
from avatar_agent.ports.embedding import IEmbeddingProvider
from avatar_agent.ports.llm import LlmChunk
from avatar_agent.ports.orchestration import (
    IKnowledgeGapPort,
    IKnowledgeSearchPort,
    KnowledgeSearchRequest,
    MetadataFilterQuery,
)

logger = structlog.get_logger(__name__)

# 12a's own ingestion-side heuristic (`run-knowledge-ingestion.use-case.ts`)
# has no Python-side equivalent to reuse (no text is chunked/token-budgeted
# anywhere in `apps/agent` today) — `len(text) // 4` is the same
# well-documented, deliberately-approximate estimate, kept here rather than
# invented fresh.
_CHARS_PER_TOKEN = 4

# "a table cell" preview length for the Playground's candidate table (R-R9) —
# a full chunk's text would make that table unreadable. Applied only to the
# hybrid-search stage's own `text_excerpt`; `inject.chunks[].text_excerpt`
# is the same already-truncated string (injection re-truncating would only
# ever shorten further, never lengthen, so one constant suffices).
_TEXT_EXCERPT_MAX_CHARS = 300

REWRITE_SYSTEM_PROMPT = (
    "You rewrite a caller's latest question into a standalone search query "
    "for a knowledge base, using the recent conversation for context. "
    "Respond with ONLY the rewritten query text -- no preamble, no quotes, "
    "no explanation."
)


def build_rewrite_prompt(query: str, conversation_context: str | None) -> str:
    """Builds the one-shot rewrite prompt (R-R5) — shared by both rewriter
    implementations (`nodes/retrieve.py`'s failover-wrapping rewriter,
    `services/ai_service.py`'s single-leg rewriter) so the exact wording
    never drifts between the live path and the Playground preview.
    """
    context_text = conversation_context if conversation_context else "(none)"
    return f"Conversation so far:\n{context_text}\n\nLatest question: {query}\n\nRewritten search query:"


async def consume_text_stream(stream: AsyncIterator[LlmChunk]) -> str:
    """Joins every non-empty delta from an LLM stream into the final text.

    Shared by both rewrite-stage implementations so the accumulation logic
    exists exactly once — a lighter-weight sibling of `nodes/llm.py`'s own
    `_consume_stream` (the main LLM node call), kept separate since a
    rewrite call never needs `first_token_ms` timing or tool-call detection.
    """
    parts: list[str] = []
    async for chunk in stream:
        if chunk["delta"]:
            parts.append(chunk["delta"])
    return "".join(parts).strip()


class RewriterPort(Protocol):
    """A one-shot "rewrite this query" LLM call. `None` (not an instance of
    this Protocol) is how a caller signals rewrite is structurally
    unavailable (e.g. no LLM leg resolved) — distinct from
    `pipeline.rewrite.enabled` being `False`."""

    async def rewrite(self, *, query: str, conversation_context: str | None) -> str: ...


def format_injected_chunk(*, citation_label: str, source_name: str, text_excerpt: str, citation_format: CitationFormat) -> str:
    """Formats one surviving chunk into the plain-text string a live turn
    injects into `ctx.residency` (via `apply_retrieved_chunks`) — the single
    source of truth for citation formatting, used both inside the inject
    stage (to build `InjectStageResult`) and by the live Retrieve node
    executor (to reconstruct the same strings from the returned
    `InjectedChunk`s, since `run_retrieval_pipeline`'s own return type
    carries only structured data, not caller-side text)."""
    if citation_format == "numbered":
        return f"{citation_label} {source_name} — {text_excerpt}"
    if citation_format == "inline":
        return f"{source_name}: {text_excerpt}"
    return text_excerpt


def _estimate_tokens(text: str) -> int:
    return len(text) // _CHARS_PER_TOKEN


@dataclass
class RetrievalPipelineInput:
    query: str
    # `None`, or a compact string built from prior turns. The live caller
    # builds this from `ctx.residency.messages` sliced to the last
    # `pipeline.rewrite.context_turns` turns (see `nodes/retrieve.py`);
    # `ai_service.py` takes it as a plain optional string from the request
    # body.
    conversation_context: str | None
    source_refs: list[str]
    pipeline: RetrievalPipelineConfig
    # `RetrieveNode.top_k` (live) or a sane default e.g. 5 (preview, since
    # there's no graph node).
    top_k: int
    rewriter: RewriterPort | None
    # Already resolved (by `entrypoint.build_pipeline` for the live caller,
    # by `ai_service.py`'s handler itself for the Playground preview) --
    # this module never resolves an embedding adapter itself (see this
    # field's `TurnContext.embedding_provider` counterpart for why). `None`
    # means embedding is unavailable this turn; the hybrid search stage
    # treats that exactly like any other stage failure (R-R3: zero
    # candidates, `timed_out=True`).
    embedder: IEmbeddingProvider | None
    searcher: IKnowledgeSearchPort
    # `None` for the Playground preview -- this IS how "never write gaps
    # from preview" is enforced structurally, not by a boolean flag a future
    # caller could forget to check.
    gap_recorder: IKnowledgeGapPort | None
    tenant_id: UUID
    # The node's own overall retrieval ceiling (`RetrieveNode.budget_ms`,
    # live) or the sum of the pipeline's own five budgeted stages (preview
    # — there's no separate node-level ceiling in that context).
    budget_ms: int


class RewriteStageResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    enabled: bool
    rewritten_query: str | None
    ms: int
    timed_out: bool


class CandidateResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    chunk_id: str
    source_id: str
    source_name: str
    text_excerpt: str
    vector_score: float
    keyword_score: float
    blend_score: float
    passed_filter: bool
    # Computed after stage 5 (threshold) runs, then merged back onto the
    # same candidate objects for display — the Playground's stage-by-stage
    # table needs the FULL candidate list annotated with which stages each
    # one passed/failed, not just the final survivors.
    passed_threshold: bool = False


class HybridSearchStageResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    candidates: list[CandidateResult]
    ms: int
    timed_out: bool


class FilterStageResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    enabled: bool
    before_count: int
    after_count: int
    ms: int


class RerankStageResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    enabled: bool
    note: str


class ThresholdStageResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    min_score: float
    pass_count: int
    dropped_count: int
    ms: int


class InjectedChunk(BaseModel):
    model_config = ConfigDict(extra="forbid")

    citation_label: str
    source_name: str
    text_excerpt: str
    token_count: int


class InjectStageResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    chunks: list[InjectedChunk]
    token_total: int
    token_cap: int
    ms: int


class RetrievalPipelineResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    rewrite: RewriteStageResult
    hybrid_search: HybridSearchStageResult
    filter: FilterStageResult
    rerank: RerankStageResult
    threshold: ThresholdStageResult
    inject: InjectStageResult
    total_ms: int
    budget_ms: int
    over_budget: bool


def _elapsed_ms(started_at: float) -> int:
    return int((time.monotonic() - started_at) * 1000)


async def _run_rewrite(input: RetrievalPipelineInput, elapsed_so_far_ms: float) -> tuple[RewriteStageResult, str]:
    """Stage ①. Never raises, never blocks past its own `budget_ms` (R-R3).
    On timeout or any exception, keeps the ORIGINAL query and reports
    `timed_out=True`; on success the rewritten text becomes the query used
    by every later stage.
    """
    if not input.pipeline.rewrite.enabled or input.rewriter is None:
        return RewriteStageResult(enabled=False, rewritten_query=None, ms=0, timed_out=False), input.query

    if elapsed_so_far_ms >= input.budget_ms:
        # The node-level budget is already exhausted before this stage could
        # even start -- skip it rather than begin a call doomed to blow the
        # budget further.
        return RewriteStageResult(enabled=True, rewritten_query=None, ms=0, timed_out=True), input.query

    started = time.monotonic()
    try:
        rewritten = await asyncio.wait_for(
            input.rewriter.rewrite(query=input.query, conversation_context=input.conversation_context),
            timeout=input.pipeline.rewrite.budget_ms / 1000,
        )
        if not rewritten.strip():
            # An empty rewrite is not useful as a downstream query -- fall
            # back to the original rather than searching for an empty string.
            return RewriteStageResult(enabled=True, rewritten_query=None, ms=_elapsed_ms(started), timed_out=False), input.query
        return RewriteStageResult(enabled=True, rewritten_query=rewritten, ms=_elapsed_ms(started), timed_out=False), rewritten
    except Exception:  # noqa: BLE001 - R-R3: rewrite failure never blocks/fails the turn
        logger.warning("RETRIEVAL_REWRITE_FAILED", exc_info=True)
        return RewriteStageResult(enabled=True, rewritten_query=None, ms=_elapsed_ms(started), timed_out=True), input.query


async def _run_hybrid_search(input: RetrievalPipelineInput, query_text: str, elapsed_so_far_ms: float) -> HybridSearchStageResult:
    """Stage ②. Always on (no toggle). Embeds the (possibly rewritten) query
    in-process via the already-resolved `input.embedder`, inside this
    stage's own budget (the schema has no separate "embed" budget field),
    then calls `searcher.search(...)`. Never raises -- a timeout, a `None`
    embedder, or the searcher raising all yield zero candidates.
    """
    if elapsed_so_far_ms >= input.budget_ms:
        return HybridSearchStageResult(candidates=[], ms=0, timed_out=True)
    if input.embedder is None:
        logger.warning("RETRIEVAL_EMBEDDING_UNAVAILABLE")
        return HybridSearchStageResult(candidates=[], ms=0, timed_out=True)

    started = time.monotonic()
    embedder = input.embedder

    filter_query: MetadataFilterQuery | None = None
    if input.pipeline.metadata_filter.enabled and input.pipeline.metadata_filter.condition is not None:
        condition = input.pipeline.metadata_filter.condition
        filter_query = MetadataFilterQuery(field=condition.field, op=condition.op, value=condition.value)

    async def _embed_and_search() -> list[CandidateResult]:
        vectors = await embedder.embed([query_text])
        embedding = vectors[0] if vectors else []
        response = await input.searcher.search(
            KnowledgeSearchRequest(
                tenant_id=input.tenant_id,
                source_refs=input.source_refs,
                query_text=query_text,
                query_embedding=embedding,
                vector_weight=input.pipeline.hybrid_search.vector_weight,
                keyword_weight=input.pipeline.hybrid_search.keyword_weight,
                candidates=input.pipeline.hybrid_search.candidates,
                filter=filter_query,
            )
        )
        return [
            CandidateResult(
                chunk_id=c.chunk_id,
                source_id=c.source_id,
                source_name=c.source_name,
                text_excerpt=c.text[:_TEXT_EXCERPT_MAX_CHARS],
                vector_score=c.vector_score,
                keyword_score=c.keyword_score,
                blend_score=c.blend_score,
                passed_filter=c.passed_filter,
            )
            for c in response.candidates
        ]

    try:
        candidates = await asyncio.wait_for(_embed_and_search(), timeout=input.pipeline.hybrid_search.budget_ms / 1000)
        return HybridSearchStageResult(candidates=candidates, ms=_elapsed_ms(started), timed_out=False)
    except Exception:  # noqa: BLE001 - R-R3: a search failure never blocks/fails the turn
        logger.warning("RETRIEVAL_HYBRID_SEARCH_FAILED", exc_info=True)
        return HybridSearchStageResult(candidates=[], ms=_elapsed_ms(started), timed_out=True)


def _run_filter(
    candidates: list[CandidateResult], pipeline: RetrievalPipelineConfig
) -> tuple[FilterStageResult, list[CandidateResult]]:
    """Stage ③. Synchronous/local -- nothing here can hang, so no
    `asyncio.wait_for`. Nest's search response already annotates every
    candidate with `passed_filter` (computed server-side); this stage just
    decides whether to honor it (`enabled=True`) or ignore it and keep
    everything (`enabled=False`, defensively, even though the server should
    already agree since `filter` is only ever sent when enabled).
    """
    started = time.monotonic()
    before_count = len(candidates)
    kept = candidates if not pipeline.metadata_filter.enabled else [c for c in candidates if c.passed_filter]
    return (
        FilterStageResult(
            enabled=pipeline.metadata_filter.enabled, before_count=before_count, after_count=len(kept), ms=_elapsed_ms(started)
        ),
        kept,
    )


_RERANK_NOTE = "Reranking is not available yet (BL-070)."


def _run_rerank(candidates: list[CandidateResult]) -> tuple[RerankStageResult, list[CandidateResult]]:
    """Stage ④. Literal no-op passthrough this phase (BL-070 deferred) —
    candidates pass through completely unchanged."""
    return RerankStageResult(enabled=False, note=_RERANK_NOTE), candidates


async def _run_threshold(
    candidates: list[CandidateResult],
    pipeline: RetrievalPipelineConfig,
    *,
    original_query: str,
    source_refs: list[str],
    tenant_id: UUID,
    gap_recorder: IKnowledgeGapPort | None,
) -> tuple[ThresholdStageResult, list[CandidateResult]]:
    """Stage ⑤. Drops every candidate whose `blend_score < min_score`
    (R-R7: dropped, never passed with a low score). Synchronous/local except
    for the gap-recording call. When nothing survives (whether because zero
    candidates existed at all or every one scored below threshold), and
    `gap_recorder` is not `None` (the live caller only — this `is not None`
    check is the entire enforcement mechanism for "the Playground never
    writes gaps," see `RetrievalPipelineInput.gap_recorder`'s docstring),
    records a `KnowledgeGap` with the ORIGINAL, pre-rewrite query text and
    the best score seen among all post-filter candidates.

    Deliberately **not** wrapped in its own try/except: the real
    `IKnowledgeGapPort` implementation (`ControlPlaneKnowledgeGapAdapter` ->
    `ControlPlaneClient.record_knowledge_gap`) is already a buffered,
    non-raising fire-and-forget call by its own design (see that method's
    docstring) — a second defensive layer here would only ever swallow a
    genuine programming error (e.g. a future refactor accidentally dropping
    the `is not None` guard above, which would otherwise raise
    `AttributeError` calling `record_gap` on `None` and be caught silently),
    not a real runtime failure. Letting that class of bug surface as a real
    exception is the point.
    """
    started = time.monotonic()
    min_score = pipeline.threshold.min_score
    passed: list[CandidateResult] = []
    dropped_count = 0
    best_score: float | None = None
    for candidate in candidates:
        if best_score is None or candidate.blend_score > best_score:
            best_score = candidate.blend_score
        if candidate.blend_score >= min_score:
            candidate.passed_threshold = True
            passed.append(candidate)
        else:
            candidate.passed_threshold = False
            dropped_count += 1

    result = ThresholdStageResult(
        min_score=min_score, pass_count=len(passed), dropped_count=dropped_count, ms=_elapsed_ms(started)
    )

    if not passed and gap_recorder is not None:
        source_id = source_refs[0] if len(source_refs) == 1 else None
        await gap_recorder.record_gap(tenant_id=tenant_id, source_id=source_id, query=original_query, best_score=best_score)

    return result, passed


def _run_inject(
    candidates: list[CandidateResult], pipeline: RetrievalPipelineConfig, top_k: int
) -> tuple[InjectStageResult, list[InjectedChunk]]:
    """Stage ⑥. Token-caps the surviving (post-threshold) chunks, walking
    them in score order (highest `blend_score` first), stopping once adding
    the next chunk would exceed `token_cap`. Synchronous/local (pure string
    work).

    **Documented judgment call**: also stops once `top_k` chunks have been
    included, whichever limit binds first. `RetrieveNode.top_k` (A3.2's
    "top-k" node setting, stubbed since Phase 9) has no explicit role in
    this six-stage pipeline's own stage-by-stage semantics (candidate-pool
    size is `pipeline.hybrid_search.candidates`; the final cap is
    `pipeline.inject.token_cap`) — rather than leave the field silently
    unused, it is applied here as an additional final-result-count ceiling,
    the most natural remaining "top-k final results" meaning for it.
    """
    started = time.monotonic()
    ordered = sorted(candidates, key=lambda c: c.blend_score, reverse=True)
    token_cap = pipeline.inject.token_cap
    citation_format = pipeline.inject.citation_format

    chunks: list[InjectedChunk] = []
    token_total = 0
    for index, candidate in enumerate(ordered, start=1):
        if len(chunks) >= top_k:
            break
        token_count = _estimate_tokens(candidate.text_excerpt)
        if token_total + token_count > token_cap:
            break
        citation_label = f"[{index}]" if citation_format == "numbered" else ""
        chunks.append(
            InjectedChunk(
                citation_label=citation_label,
                source_name=candidate.source_name,
                text_excerpt=candidate.text_excerpt,
                token_count=token_count,
            )
        )
        token_total += token_count

    return InjectStageResult(chunks=chunks, token_total=token_total, token_cap=token_cap, ms=_elapsed_ms(started)), chunks


async def run_retrieval_pipeline(input: RetrievalPipelineInput) -> RetrievalPipelineResult:
    """Runs all six stages in order, honoring the node-level budget as
    described in this module's own docstring."""
    turn_started = time.monotonic()

    rewrite_result, query_text = await _run_rewrite(input, 0.0)

    elapsed_ms = (time.monotonic() - turn_started) * 1000
    hybrid_result = await _run_hybrid_search(input, query_text, elapsed_ms)

    filter_result, filtered = _run_filter(hybrid_result.candidates, input.pipeline)
    rerank_result, reranked = _run_rerank(filtered)
    threshold_result, passed = await _run_threshold(
        reranked,
        input.pipeline,
        original_query=input.query,
        source_refs=input.source_refs,
        tenant_id=input.tenant_id,
        gap_recorder=input.gap_recorder,
    )
    inject_result, _inject_chunks = _run_inject(passed, input.pipeline, input.top_k)

    total_ms = rewrite_result.ms + hybrid_result.ms + filter_result.ms + threshold_result.ms + inject_result.ms

    return RetrievalPipelineResult(
        rewrite=rewrite_result,
        hybrid_search=hybrid_result,
        filter=filter_result,
        rerank=rerank_result,
        threshold=threshold_result,
        inject=inject_result,
        total_ms=total_ms,
        budget_ms=input.budget_ms,
        over_budget=total_ms > input.budget_ms,
    )


__all__ = [
    "REWRITE_SYSTEM_PROMPT",
    "build_rewrite_prompt",
    "consume_text_stream",
    "format_injected_chunk",
    "RewriterPort",
    "RetrievalPipelineInput",
    "RewriteStageResult",
    "CandidateResult",
    "HybridSearchStageResult",
    "FilterStageResult",
    "RerankStageResult",
    "ThresholdStageResult",
    "InjectedChunk",
    "InjectStageResult",
    "RetrievalPipelineResult",
    "run_retrieval_pipeline",
]
