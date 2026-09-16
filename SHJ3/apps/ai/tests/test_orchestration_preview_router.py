"""`orchestration_preview_router.py`'s pure graph/condition validation endpoints —
`POST /v1/orchestration/pipelines/validate` and `.../validate-condition`. Neither takes any
`Depends` (no DB/Redis), so a plain `TestClient` against the router mounted alone is enough;
no fake-port overrides needed, unlike `/trace-preview` (see `test_sandbox_router.py`'s own
convention for that shape).
"""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.testclient import TestClient

from shj3_ai.adapters.inbound import orchestration_preview_router

app = FastAPI()
app.include_router(orchestration_preview_router.router)
client = TestClient(app)


def _linear_pipeline_body(**overrides: object) -> dict[str, object]:
    base: dict[str, object] = {
        "entryNodeKey": "start",
        "nodes": [
            {"key": "start", "kind": "Start"},
            {
                "key": "agent",
                "kind": "Agent",
                "usesTurnBoundAgent": True,
                "isOwningEntity": True,
            },
            {"key": "response", "kind": "Response"},
        ],
        "edges": [
            {"fromNodeKey": "start", "toNodeKey": "agent", "kind": "Sequential", "ordinal": 0},
            {"fromNodeKey": "agent", "toNodeKey": "response", "kind": "Sequential", "ordinal": 0},
        ],
    }
    base.update(overrides)
    return base


class TestValidatePipelineGraph:
    def test_a_well_formed_linear_pipeline_is_valid(self) -> None:
        response = client.post("/v1/orchestration/pipelines/validate", json=_linear_pipeline_body())
        assert response.status_code == 200
        body = response.json()
        assert body["valid"] is True
        assert body["issues"] == []

    def test_a_pipeline_with_no_response_node_is_invalid(self) -> None:
        body = _linear_pipeline_body(
            nodes=[
                {"key": "start", "kind": "Start"},
                {
                    "key": "agent",
                    "kind": "Agent",
                    "usesTurnBoundAgent": True,
                    "isOwningEntity": True,
                },
            ],
            edges=[
                {"fromNodeKey": "start", "toNodeKey": "agent", "kind": "Sequential", "ordinal": 0}
            ],
        )
        response = client.post("/v1/orchestration/pipelines/validate", json=body)
        assert response.status_code == 200
        result = response.json()
        assert result["valid"] is False
        assert any(
            i["code"] == "orchestration.pipeline.terminal_node_required" for i in result["issues"]
        )

    def test_a_cycle_outside_a_loop_back_edge_is_invalid(self) -> None:
        body = _linear_pipeline_body(
            edges=[
                {"fromNodeKey": "start", "toNodeKey": "agent", "kind": "Sequential", "ordinal": 0},
                {"fromNodeKey": "agent", "toNodeKey": "response", "kind": "Sequential", "ordinal": 0},
                # A Sequential edge back to `agent` is a real cycle, not a declared loop.
                {
                    "fromNodeKey": "response",
                    "toNodeKey": "agent",
                    "kind": "Sequential",
                    "ordinal": 0,
                },
            ],
        )
        response = client.post("/v1/orchestration/pipelines/validate", json=body)
        assert response.status_code == 200
        result = response.json()
        assert result["valid"] is False


class TestValidatePipelineCondition:
    def test_a_well_formed_condition_is_valid_and_normalized(self) -> None:
        response = client.post(
            "/v1/orchestration/pipelines/validate-condition",
            json={"expression": "groundingConfidence < 0.6", "knownNodeKeys": []},
        )
        assert response.status_code == 200
        body = response.json()
        assert body["valid"] is True
        assert body["normalized"] == "groundingConfidence < 0.6"
        assert body["issues"] == []

    def test_an_unknown_field_is_rejected_with_a_message(self) -> None:
        response = client.post(
            "/v1/orchestration/pipelines/validate-condition",
            json={"expression": "notARealField == 1", "knownNodeKeys": []},
        )
        assert response.status_code == 200
        body = response.json()
        assert body["valid"] is False
        assert body["normalized"] is None
        assert len(body["issues"]) >= 1
