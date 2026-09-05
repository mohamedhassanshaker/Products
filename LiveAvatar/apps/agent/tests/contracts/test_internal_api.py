"""Unit tests for the `/internal` request models (LLD §5.9)."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from avatar_agent.contracts.internal_api import (
    AlertRequest,
    HopBatchRequest,
    SessionEventRequest,
    SummaryRequest,
    UtteranceBatchRequest,
)


def test_session_event_request_accepts_every_valid_type() -> None:
    for t in ("joined", "active", "degraded", "failed", "ended"):
        SessionEventRequest(type=t, at="2026-01-01T00:00:00Z")


def test_session_event_request_rejects_an_unknown_type() -> None:
    with pytest.raises(ValidationError):
        SessionEventRequest(type="bogus", at="2026-01-01T00:00:00Z")  # type: ignore[arg-type]


def test_utterance_batch_request_accepts_a_batch() -> None:
    batch = UtteranceBatchRequest(items=[{"seq": 1, "role": "user", "text": "hi", "started_at": "2026-01-01T00:00:00Z"}])
    assert batch.items[0].role == "user"


def test_hop_batch_request_defaults_used_fallback_to_false() -> None:
    batch = HopBatchRequest(items=[{"utterance_seq": 1, "hop": "llm"}])
    assert batch.items[0].used_fallback is False


def test_summary_request_rejects_text_over_500_chars() -> None:
    with pytest.raises(ValidationError):
        SummaryRequest(summary_status="ready", summary_text="x" * 501)


def test_alert_request_requires_a_message() -> None:
    with pytest.raises(ValidationError):
        AlertRequest(tenant_id="11111111-1111-1111-1111-111111111111", type="llm_failover", message="")
