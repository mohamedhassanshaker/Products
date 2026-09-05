"""Retrieve node executor (Phase 12b, BL-045/047/048) — real six-stage
retrieval pipeline, replacing the Phase 9 `RETRIEVE_NODE_STUBBED` no-op
(`ARCHITECTURE_NOTES.md` §3.2/§4.4). Delegates the actual stage work to the
shared `orchestration.retrieval.pipeline` module (reused verbatim by
`services/ai_service.py`'s `/retrieve-preview` Playground endpoint — that
module's own docstring), and owns only what is specific to a live turn:
building `conversation_context` from `ctx.residency.messages`, wrapping
`run_with_failover` as this turn's rewrite-stage LLM call, and injecting the
result via `ctx.apply_retrieved_chunks`.
"""

from __future__ import annotations

from collections.abc import Sequence

import structlog

from avatar_agent.contracts.runtime_config import GraphNode, RetrieveNode
from avatar_agent.orchestration.failover import run_with_failover
from avatar_agent.orchestration.graph.edges import resolve_on_error
from avatar_agent.orchestration.graph.ir import NodeResult, TurnContext
from avatar_agent.orchestration.retrieval.pipeline import (
    REWRITE_SYSTEM_PROMPT,
    RetrievalPipelineInput,
    build_rewrite_prompt,
    consume_text_stream,
    format_injected_chunk,
    run_retrieval_pipeline,
)
from avatar_agent.ports.llm import ChatMessage, ResidencyPayload
from avatar_agent.ports.orchestration import ResolvedLlmNode
from avatar_agent.telemetry.control_plane import now_ms

logger = structlog.get_logger(__name__)

_ROLE_LABELS = {"user": "caller", "assistant": "agent"}


class _FailoverRewriter:
    """Wraps `run_with_failover` for the rewrite stage's one-shot LLM call —
    `nodes/llm.py`'s calling pattern, much lighter-weight (a single
    non-tool-calling completion, no retry-round tool-result follow-up).
    """

    def __init__(self, resolved: ResolvedLlmNode) -> None:
        self._resolved = resolved

    async def rewrite(self, *, query: str, conversation_context: str | None) -> str:
        prompt = build_rewrite_prompt(query, conversation_context)
        residency = ResidencyPayload(system_prompt=REWRITE_SYSTEM_PROMPT, messages=(ChatMessage(role="user", content=prompt),))
        result = await run_with_failover(self._resolved.primary, self._resolved.fallback, self._resolved.retry, (), residency)
        return await consume_text_stream(result.stream)


def _build_conversation_context(messages: Sequence[ChatMessage], context_turns: int) -> str | None:
    """Builds the rewrite stage's conversation-context string from
    `ctx.residency.messages`.

    **Documented judgment call**: `residency.filter.build_payload` always
    appends the current utterance as the LAST message before the graph runs
    (it is passed to the rewrite stage separately, as `query`) — excluded
    here via `messages[:-1]`. A "turn" is approximated as one raw message
    (the last `2 * context_turns` of them), not a strict user+assistant
    pair — real turn-pairing would need to assume strict role alternation,
    which `ctx.residency.messages` doesn't guarantee (a tool-result message
    can interleave after a model requests a tool call), so counting raw
    messages is the simpler, always-correct choice; `2 * context_turns` is
    a reasonable approximation of "N turns" under the common case where
    alternation does hold.
    """
    prior = messages[:-1] if messages else ()
    if not prior:
        return None
    window = prior[-(2 * context_turns) :]
    lines = [f"{_ROLE_LABELS.get(m['role'], m['role'])}: {m['content']}" for m in window if m["content"]]
    return "\n".join(lines) if lines else None


class RetrieveNodeExecutor:
    """`NodeExecutor` for `type: retrieve` nodes (Phase 12b)."""

    async def execute(self, node: GraphNode, ctx: TurnContext) -> tuple[NodeResult, str | None]:
        # See `LlmNodeExecutor.execute`'s comment: `GraphNode` (not
        # `RetrieveNode`) to structurally satisfy the `NodeExecutor` Protocol.
        assert isinstance(node, RetrieveNode)
        started = now_ms()
        utterance = str(ctx.turn_state.get("utterance") or "")
        conversation_context = _build_conversation_context(ctx.residency.messages, ctx.knowledge_pipeline.rewrite.context_turns)
        rewriter = _FailoverRewriter(ctx.default_llm) if ctx.default_llm is not None else None

        # Defensive: `run_retrieval_pipeline` shouldn't raise (every stage
        # owns its own try/except per R-R3), but a genuinely unexpected
        # failure here still must not crash the turn -- same defensive
        # posture `nodes/tool.py`/`nodes/llm.py` already show for their own
        # unrecognized-failure paths.
        try:
            result = await run_retrieval_pipeline(
                RetrievalPipelineInput(
                    query=utterance,
                    conversation_context=conversation_context,
                    source_refs=list(node.source_refs),
                    pipeline=ctx.knowledge_pipeline,
                    top_k=node.top_k,
                    rewriter=rewriter,
                    embedder=ctx.embedding_provider,
                    searcher=ctx.knowledge_search,
                    gap_recorder=ctx.knowledge_gap,
                    tenant_id=ctx.tenant_id,
                    budget_ms=node.budget_ms,
                )
            )
        except Exception:  # noqa: BLE001
            logger.exception("RETRIEVE_NODE_FAILED", node_id=node.id, session_id=str(ctx.session_id))
            return (
                NodeResult(
                    node_id=node.id,
                    node_type="retrieve",
                    lane=node.lane,
                    status="failed",
                    total_ms=now_ms() - started,
                    error_code="RETRIEVE_NODE_ERROR",
                ),
                resolve_on_error(node),
            )

        formatted_chunks = [
            format_injected_chunk(
                citation_label=chunk.citation_label,
                source_name=chunk.source_name,
                text_excerpt=chunk.text_excerpt,
                citation_format=ctx.knowledge_pipeline.inject.citation_format,
            )
            for chunk in result.inject.chunks
        ]
        ctx.apply_retrieved_chunks(formatted_chunks)

        # `status="complete"` even with zero chunks injected -- an empty
        # result is a valid, non-error outcome (R-R3/R-R7 exist precisely
        # because "found nothing" is expected and handled, not a failure).
        return (
            NodeResult(node_id=node.id, node_type="retrieve", lane=node.lane, status="complete", total_ms=result.total_ms),
            node.next_node_id,
        )
