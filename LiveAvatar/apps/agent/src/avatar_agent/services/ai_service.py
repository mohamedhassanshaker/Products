"""Standalone embedding process (Phase 12a, BL-044,
ARCHITECTURE_NOTES.md §4.3) — the second Python deployment target, sharing
`ports`/`registry`/`adapters` with the per-call LiveKit worker
(`entrypoint.py`) rather than being a new codebase. Reached by Nest's
`knowledge-ingest` BullMQ job over internal HTTP.

Run with: `uvicorn avatar_agent.services.ai_service:app --host 0.0.0.0 --port 8082`
"""

from __future__ import annotations

from uuid import UUID

import httpx
import structlog
from fastapi import Depends, FastAPI, HTTPException, status
from pydantic import BaseModel, Field

from avatar_agent.contracts.runtime_config import RetrievalPipelineConfig
from avatar_agent.orchestration.retrieval.pipeline import (
    REWRITE_SYSTEM_PROMPT,
    RetrievalPipelineInput,
    RetrievalPipelineResult,
    RewriterPort,
    build_rewrite_prompt,
    consume_text_stream,
    run_retrieval_pipeline,
)
from avatar_agent.ports.embedding import EmbeddingError
from avatar_agent.ports.llm import ChatMessage, ILLMProvider, ResidencyPayload
from avatar_agent.ports.orchestration import (
    KnowledgeSearchRequest,
    KnowledgeSearchResponse,
    knowledge_search_request_payload,
    knowledge_search_response_from_json,
)
from avatar_agent.registry.errors import FactoryLoadError
from avatar_agent.registry.registry import (
    EmbeddingRequestConfig,
    LlmLegRequestConfig,
    resolve_embedding,
    resolve_llm_standalone,
)
from avatar_agent.secrets.directory_store import DirectorySecretStore
from avatar_agent.services.internal_auth import require_internal_token
from avatar_agent.settings import load_settings

logger = structlog.get_logger(__name__)

_MAX_INPUTS = 96
_MAX_INPUT_CHARS = 20_000

# Phase 12b (BL-045/047): no per-node/per-graph context exists in this
# standalone process, so the Playground preview uses a fixed sane default
# for "how many final results" — the request body carries no `top_k` field
# (see the plan doc's Phase 12b task brief / `RetrievalPipelineInput.top_k`
# docstring).
_PREVIEW_TOP_K = 5


class EmbedRequest(BaseModel):
    provider: str = "openai"
    model: str = "text-embedding-3-small"
    credential_ref: str | None = None
    inputs: list[str] = Field(min_length=1, max_length=_MAX_INPUTS)


class EmbedResponse(BaseModel):
    model: str
    dimension: int
    embeddings: list[list[float]]


app = FastAPI(title="avatar-agent embedding service", version="0.1.0")


@app.get("/healthz")
async def healthz() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/embed", response_model=EmbedResponse, dependencies=[Depends(require_internal_token)])
async def embed(body: EmbedRequest) -> EmbedResponse:
    for text in body.inputs:
        if len(text) > _MAX_INPUT_CHARS:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="EMBEDDING_INPUT_TOO_LONG")

    settings = load_settings()
    secrets = DirectorySecretStore(settings.secrets_dir)
    cfg = EmbeddingRequestConfig(
        provider=body.provider,
        model=body.model,
        credential_ref=body.credential_ref,
        endpoint_url=settings.ai_base_url,
    )

    try:
        provider = resolve_embedding(cfg, secrets)
    except FactoryLoadError as err:
        # `err.logical_key` here is only ever a provider-key/credential_ref
        # *name*, never a resolved secret value -- safe to surface.
        logger.warning("embedding_provider_unresolvable", logical_key=err.logical_key)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="EMBEDDING_PROVIDER_UNAVAILABLE") from err

    try:
        vectors = await provider.embed(body.inputs)
    except EmbeddingError as err:
        logger.warning("embedding_failed", code=err.code, retryable=err.retryable)
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="EMBEDDING_PROVIDER_ERROR") from err

    return EmbedResponse(model=body.model, dimension=provider.dimension, embeddings=vectors)


# --- Phase 12b (BL-045/047): POST /retrieve-preview -------------------------
# The Retrieval playground's real code path (R-R9/UC-R1) — runs the exact
# same `orchestration.retrieval.pipeline` module the live Retrieve node
# executor uses (`ARCHITECTURE_NOTES.md` §4.5's "thin dry-run wrapper, no
# duplicate-logic risk"), against a request payload instead of a
# `TurnContext`, and never writes a `KnowledgeGap` row (a playground run is
# an admin's own diagnostic query, not a real caller turn — see the plan
# doc's Phase 12b "Decisions made this phase" #9).


class RetrievePreviewLlmConfig(BaseModel):
    provider: str
    model: str
    credential_ref: str | None = None


class RetrievePreviewRequest(BaseModel):
    tenant_id: UUID
    query: str = Field(min_length=1)
    conversation_context: str | None = None
    source_refs: list[str] = Field(default_factory=list)
    # `None` means rewrite is unavailable regardless of `pipeline.rewrite
    # .enabled` (no credential to run a rewrite call with).
    llm: RetrievePreviewLlmConfig | None = None
    embedding_model: str = "text-embedding-3-small"
    embedding_credential_ref: str | None = None
    pipeline: RetrievalPipelineConfig


class _StandaloneLlmRewriter:
    """`RewriterPort` implementation for the Playground preview — a single
    one-shot `complete_stream` call against whichever leg the request body's
    `llm` field resolved to. Unlike the live turn's `_FailoverRewriter`
    (`orchestration/graph/nodes/retrieve.py`), this never retries/fails
    over — the request body only ever describes one leg, no fallback."""

    def __init__(self, llm: ILLMProvider) -> None:
        self._llm = llm

    async def rewrite(self, *, query: str, conversation_context: str | None) -> str:
        prompt = build_rewrite_prompt(query, conversation_context)
        residency = ResidencyPayload(system_prompt=REWRITE_SYSTEM_PROMPT, messages=(ChatMessage(role="user", content=prompt),))
        stream = await self._llm.complete_stream((ChatMessage(role="user", content=prompt),), (), residency)
        return await consume_text_stream(stream)


class NestKnowledgeSearchClient:
    """Outbound HTTP client from this standalone process to Nest's
    `POST /internal/knowledge/search`. `ai_service.py` has no
    `ControlPlaneClient` instance of its own (no session, no per-call
    construction site) — this is the one new outbound HTTP surface this
    phase adds here, reusing the SAME base-URL/shared-secret environment
    variables `ControlPlaneClient` uses for every other Python -> Nest
    internal call (`settings.control_plane_internal_url`/
    `settings.internal_token`) rather than inventing a new one.
    """

    def __init__(self, base_url: str, internal_token: str) -> None:
        self._base_url = base_url
        self._headers = {"X-Internal-Token": internal_token}

    async def search(self, request: KnowledgeSearchRequest) -> KnowledgeSearchResponse:
        async with httpx.AsyncClient(base_url=self._base_url, timeout=10.0) as client:
            response = await client.post(
                "/internal/knowledge/search", json=knowledge_search_request_payload(request), headers=self._headers
            )
            response.raise_for_status()
            return knowledge_search_response_from_json(response.json())


@app.post("/retrieve-preview", response_model=RetrievalPipelineResult, dependencies=[Depends(require_internal_token)])
async def retrieve_preview(body: RetrievePreviewRequest) -> RetrievalPipelineResult:
    pipeline_cfg = body.pipeline
    settings = load_settings()
    secrets = DirectorySecretStore(settings.secrets_dir)

    rewriter: RewriterPort | None = None
    if body.llm is not None:
        llm_cfg = LlmLegRequestConfig(
            provider=body.llm.provider,
            model=body.llm.model,
            credential_ref=body.llm.credential_ref,
            endpoint_url=settings.ai_base_url,
        )
        try:
            rewriter = _StandaloneLlmRewriter(resolve_llm_standalone(llm_cfg, secrets))
        except Exception as err:  # noqa: BLE001
            # Same non-fatal posture as the live turn's `ctx.default_llm is
            # None` case (`nodes/retrieve.py`) -- an unresolvable rewrite
            # leg silently disables the rewrite stage rather than failing
            # the whole preview request. Broad (not just `FactoryLoadError`):
            # when `credential_ref` is omitted, the vendor SDK itself can
            # raise directly out of the adapter's constructor (a real
            # `openai.OpenAIError`, not something the registry classifies)
            # if no platform-wide API key env var is set either -- see
            # `entrypoint._resolve_embedding_provider`'s docstring for the
            # identical reasoning.
            logger.warning("retrieve_preview_llm_unresolvable", reason=str(err))
            rewriter = None

    embedder_config = EmbeddingRequestConfig(
        provider="openai",
        model=body.embedding_model,
        credential_ref=body.embedding_credential_ref,
        endpoint_url=settings.ai_base_url,
    )
    try:
        embedder = resolve_embedding(embedder_config, secrets)
    except Exception as err:  # noqa: BLE001 - see the rewrite leg's except clause above for why this is broad
        # Same non-fatal posture as the rewrite leg above -- an unresolvable
        # embedding model disables hybrid search (the pipeline's own R-R3
        # handling reports zero candidates) rather than failing the request.
        logger.warning("retrieve_preview_embedding_unresolvable", reason=str(err))
        embedder = None

    searcher = NestKnowledgeSearchClient(settings.control_plane_internal_url, settings.internal_token)

    # No separate node-level budget ceiling exists in this context (see
    # `RetrievalPipelineInput.budget_ms`'s docstring) -- the same five-stage
    # sum V-10 checks against a live Retrieve node's own `budget_ms`.
    budget_ms = (
        pipeline_cfg.rewrite.budget_ms
        + pipeline_cfg.hybrid_search.budget_ms
        + pipeline_cfg.metadata_filter.budget_ms
        + pipeline_cfg.threshold.budget_ms
        + pipeline_cfg.inject.budget_ms
    )

    return await run_retrieval_pipeline(
        RetrievalPipelineInput(
            query=body.query,
            conversation_context=body.conversation_context,
            source_refs=body.source_refs,
            pipeline=pipeline_cfg,
            top_k=_PREVIEW_TOP_K,
            rewriter=rewriter,
            embedder=embedder,
            searcher=searcher,
            gap_recorder=None,  # the Playground never writes a KnowledgeGap row
            tenant_id=body.tenant_id,
            budget_ms=budget_ms,
        )
    )
