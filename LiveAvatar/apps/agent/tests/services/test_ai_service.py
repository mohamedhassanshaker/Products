"""Unit tests for the `/embed` FastAPI service (Phase 12a, BL-044) — the
internal-token guard on the inbound Nest->Python direction, and the
`/embed` endpoint's success/validation/failure paths. Uses FastAPI's
`TestClient` (no existing HTTP-server test precedent in this repo to
mirror — this is the first inbound HTTP surface in `apps/agent`).
"""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient

from avatar_agent.orchestration.retrieval.pipeline import (
    CandidateResult,
    FilterStageResult,
    HybridSearchStageResult,
    InjectedChunk,
    InjectStageResult,
    RerankStageResult,
    RetrievalPipelineResult,
    RewriteStageResult,
    ThresholdStageResult,
)
from avatar_agent.ports.embedding import EmbeddingError
from avatar_agent.registry.errors import FactoryLoadError
from avatar_agent.services.ai_service import app

TOKEN = "test-internal-token"


@pytest.fixture(autouse=True)
def _internal_token_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("INTERNAL_TOKEN", TOKEN)


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


def valid_body() -> dict:
    return {"provider": "openai", "model": "text-embedding-3-small", "inputs": ["hello", "world"]}


def test_healthz_returns_ok_without_a_token(client: TestClient) -> None:
    response = client.get("/healthz")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_embed_with_no_token_header_is_rejected_and_never_invokes_the_provider(client: TestClient) -> None:
    with patch("avatar_agent.services.ai_service.resolve_embedding") as mock_resolve:
        response = client.post("/embed", json=valid_body())
    assert response.status_code == 401
    mock_resolve.assert_not_called()


def test_embed_with_a_wrong_token_is_rejected_and_never_invokes_the_provider(client: TestClient) -> None:
    with patch("avatar_agent.services.ai_service.resolve_embedding") as mock_resolve:
        response = client.post("/embed", json=valid_body(), headers={"X-Internal-Token": "wrong-token"})
    assert response.status_code == 401
    mock_resolve.assert_not_called()


def test_embed_with_the_correct_token_returns_200_with_the_expected_shape(client: TestClient) -> None:
    fake_provider = AsyncMock()
    fake_provider.embed.return_value = [[0.1, 0.2], [0.3, 0.4]]
    fake_provider.dimension = 1536

    with patch("avatar_agent.services.ai_service.resolve_embedding", return_value=fake_provider) as mock_resolve:
        response = client.post("/embed", json=valid_body(), headers={"X-Internal-Token": TOKEN})

    assert response.status_code == 200
    body = response.json()
    assert body == {
        "model": "text-embedding-3-small",
        "dimension": 1536,
        "embeddings": [[0.1, 0.2], [0.3, 0.4]],
    }
    mock_resolve.assert_called_once()
    fake_provider.embed.assert_awaited_once_with(["hello", "world"])


def test_embed_rejects_an_empty_inputs_list_with_422(client: TestClient) -> None:
    with patch("avatar_agent.services.ai_service.resolve_embedding") as mock_resolve:
        response = client.post(
            "/embed",
            json={"provider": "openai", "model": "text-embedding-3-small", "inputs": []},
            headers={"X-Internal-Token": TOKEN},
        )
    assert response.status_code == 422
    mock_resolve.assert_not_called()


def test_embed_maps_an_unresolvable_provider_to_a_400_without_leaking_the_error_message(client: TestClient) -> None:
    with patch(
        "avatar_agent.services.ai_service.resolve_embedding",
        side_effect=FactoryLoadError("credential_ref 'secrets/super-secret-value' not found", logical_key="secrets/x"),
    ):
        response = client.post("/embed", json=valid_body(), headers={"X-Internal-Token": TOKEN})

    assert response.status_code == 400
    assert response.json() == {"detail": "EMBEDDING_PROVIDER_UNAVAILABLE"}
    assert "secrets/super-secret-value" not in response.text


def test_embed_maps_a_provider_embedding_error_to_a_generic_502_without_leaking_details(client: TestClient) -> None:
    fake_provider = AsyncMock()
    fake_provider.embed.side_effect = EmbeddingError("openai authentication failed with key sk-abc123", retryable=False)
    fake_provider.dimension = 1536

    with patch("avatar_agent.services.ai_service.resolve_embedding", return_value=fake_provider):
        response = client.post("/embed", json=valid_body(), headers={"X-Internal-Token": TOKEN})

    assert response.status_code == 502
    assert response.json() == {"detail": "EMBEDDING_PROVIDER_ERROR"}
    assert "sk-abc123" not in response.text


def test_embed_rejects_an_input_longer_than_the_max_char_cap(client: TestClient) -> None:
    with patch("avatar_agent.services.ai_service.resolve_embedding") as mock_resolve:
        response = client.post(
            "/embed",
            json={"provider": "openai", "model": "text-embedding-3-small", "inputs": ["x" * 20_001]},
            headers={"X-Internal-Token": TOKEN},
        )
    assert response.status_code == 400
    assert response.json() == {"detail": "EMBEDDING_INPUT_TOO_LONG"}
    mock_resolve.assert_not_called()


# --- Phase 12b (BL-045/047): POST /retrieve-preview -------------------------


def _pipeline_config_body() -> dict:
    return {
        "rewrite": {"enabled": True, "context_turns": 3, "budget_ms": 150},
        "hybrid_search": {"vector_weight": 0.6, "keyword_weight": 0.4, "candidates": 20, "budget_ms": 100},
        "metadata_filter": {"enabled": False, "budget_ms": 20},
        "rerank": {"enabled": False},
        "threshold": {"min_score": 0.5, "budget_ms": 10},
        "inject": {"token_cap": 1200, "citation_format": "numbered", "budget_ms": 30},
    }


def retrieve_preview_body(**overrides: object) -> dict:
    base = {
        "tenant_id": "11111111-1111-1111-1111-111111111111",
        "query": "refund after 30 days",
        "conversation_context": "caller: my order arrived broken / agent: I'm sorry to hear that",
        "source_refs": ["22222222-2222-2222-2222-222222222222"],
        "llm": None,
        "embedding_model": "text-embedding-3-small",
        "embedding_credential_ref": None,
        "pipeline": _pipeline_config_body(),
    }
    base.update(overrides)
    return base


def canned_pipeline_result() -> RetrievalPipelineResult:
    return RetrievalPipelineResult(
        rewrite=RewriteStageResult(enabled=True, rewritten_query="refund eligibility after thirty days", ms=118, timed_out=False),
        hybrid_search=HybridSearchStageResult(
            candidates=[
                CandidateResult(
                    chunk_id="c1",
                    source_id="s1",
                    source_name="returns-policy",
                    text_excerpt="Refunds available within 30 days.",
                    vector_score=0.81,
                    keyword_score=0.74,
                    blend_score=0.78,
                    passed_filter=True,
                    passed_threshold=True,
                )
            ],
            ms=58,
            timed_out=False,
        ),
        filter=FilterStageResult(enabled=False, before_count=1, after_count=1, ms=1),
        rerank=RerankStageResult(enabled=False, note="Reranking is not available yet (BL-070)."),
        threshold=ThresholdStageResult(min_score=0.75, pass_count=1, dropped_count=0, ms=1),
        inject=InjectStageResult(
            chunks=[
                InjectedChunk(
                    citation_label="[1]",
                    source_name="returns-policy",
                    text_excerpt="Refunds available within 30 days.",
                    token_count=8,
                )
            ],
            token_total=8,
            token_cap=1200,
            ms=1,
        ),
        total_ms=179,
        budget_ms=310,
        over_budget=False,
    )


def test_retrieve_preview_with_no_token_header_is_rejected_and_never_invokes_the_pipeline(client: TestClient) -> None:
    with patch("avatar_agent.services.ai_service.run_retrieval_pipeline") as mock_run:
        response = client.post("/retrieve-preview", json=retrieve_preview_body())
    assert response.status_code == 401
    mock_run.assert_not_called()


def test_retrieve_preview_with_a_wrong_token_is_rejected_and_never_invokes_the_pipeline(client: TestClient) -> None:
    with patch("avatar_agent.services.ai_service.run_retrieval_pipeline") as mock_run:
        response = client.post("/retrieve-preview", json=retrieve_preview_body(), headers={"X-Internal-Token": "wrong-token"})
    assert response.status_code == 401
    mock_run.assert_not_called()


def test_retrieve_preview_happy_path_returns_the_expected_json_shape(client: TestClient) -> None:
    canned = canned_pipeline_result()
    with (
        patch("avatar_agent.services.ai_service.resolve_embedding", return_value=object()),
        patch("avatar_agent.services.ai_service.run_retrieval_pipeline", new_callable=AsyncMock, return_value=canned) as mock_run,
    ):
        response = client.post("/retrieve-preview", json=retrieve_preview_body(), headers={"X-Internal-Token": TOKEN})

    assert response.status_code == 200
    body = response.json()
    assert body["rewrite"]["rewritten_query"] == "refund eligibility after thirty days"
    assert body["hybrid_search"]["candidates"][0]["text_excerpt"] == "Refunds available within 30 days."
    assert body["hybrid_search"]["candidates"][0]["passed_threshold"] is True
    assert body["rerank"] == {"enabled": False, "note": "Reranking is not available yet (BL-070)."}
    assert body["inject"]["chunks"][0]["citation_label"] == "[1]"
    assert body["over_budget"] is False
    mock_run.assert_awaited_once()


def test_retrieve_preview_never_passes_a_real_gap_recorder(client: TestClient) -> None:
    """The single most important behavioral assertion for this endpoint:
    the Playground preview must never write a `KnowledgeGap` row -- enforced
    structurally by always calling `run_retrieval_pipeline` with
    `gap_recorder=None`, not by a boolean flag."""
    canned = canned_pipeline_result()
    with (
        patch("avatar_agent.services.ai_service.resolve_embedding", return_value=object()),
        patch("avatar_agent.services.ai_service.run_retrieval_pipeline", new_callable=AsyncMock, return_value=canned) as mock_run,
    ):
        response = client.post("/retrieve-preview", json=retrieve_preview_body(), headers={"X-Internal-Token": TOKEN})

    assert response.status_code == 200
    _args, kwargs = mock_run.call_args
    pipeline_input = kwargs["input"] if "input" in kwargs else _args[0]
    assert pipeline_input.gap_recorder is None


def test_retrieve_preview_rejects_a_malformed_pipeline_block_with_422(client: TestClient) -> None:
    with patch("avatar_agent.services.ai_service.run_retrieval_pipeline") as mock_run:
        response = client.post(
            "/retrieve-preview",
            json=retrieve_preview_body(pipeline={"rewrite": "not-an-object"}),
            headers={"X-Internal-Token": TOKEN},
        )
    assert response.status_code == 422
    mock_run.assert_not_called()


def test_retrieve_preview_with_an_unresolvable_llm_disables_rewrite_but_still_succeeds(client: TestClient) -> None:
    canned = canned_pipeline_result()
    llm_error = FactoryLoadError("nope", logical_key="cohere")
    with (
        patch("avatar_agent.services.ai_service.resolve_llm_standalone", side_effect=llm_error),
        patch("avatar_agent.services.ai_service.resolve_embedding", return_value=object()),
        patch("avatar_agent.services.ai_service.run_retrieval_pipeline", new_callable=AsyncMock, return_value=canned) as mock_run,
    ):
        response = client.post(
            "/retrieve-preview",
            json=retrieve_preview_body(llm={"provider": "cohere", "model": "x", "credential_ref": None}),
            headers={"X-Internal-Token": TOKEN},
        )

    assert response.status_code == 200
    _args, kwargs = mock_run.call_args
    pipeline_input = kwargs["input"] if "input" in kwargs else _args[0]
    assert pipeline_input.rewriter is None


def test_only_healthz_is_exempt_from_the_internal_token_dependency() -> None:
    """Every app-defined route other than `/healthz` must carry the
    `require_internal_token` dependency (FastAPI's own auto-generated
    `/openapi.json`/`/docs`/`/redoc` introspection routes are plain
    Starlette `Route`s, not `APIRoute`s, and carry no secrets — excluded
    here as framework-level, not application-defined, surface).
    """
    unguarded = []
    for route in app.routes:
        if not isinstance(route, APIRoute):
            continue
        dependency_names = {dep.call.__name__ for dep in route.dependant.dependencies}
        if "require_internal_token" not in dependency_names:
            unguarded.append(route.path)
    assert unguarded == ["/healthz"]
