"""Request models for the agent's `/internal` writes (LLD §5.9).

These are the Python-side wire shapes the agent sends to the control
plane's `X-Internal-Token`-guarded routes. They are deliberately simple
(the control plane owns the authoritative TypeBox validation on receipt);
these models exist so the agent never hand-builds an ad-hoc dict for a
network call, and so a shape mistake fails a unit test rather than a
production write.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

SessionEventType = Literal["joined", "active", "degraded", "failed", "ended"]
UtteranceRole = Literal["user", "assistant"]
HopKind = Literal["stt", "llm", "tts", "avatar", "e2e", "node"]
AlertType = Literal["llm_failover", "provider_unreachable", "session_failed", "gpu_unhealthy", "handoff_requested"]
SummaryStatus = Literal["ready", "unavailable"]


class SessionEventRequest(BaseModel):
    """`POST /internal/sessions/{id}/events`."""

    model_config = ConfigDict(extra="forbid")

    type: SessionEventType
    error_code: str | None = None
    at: datetime


class UtteranceItem(BaseModel):
    """One `TranscriptUtterance` row (batch upsert on `(session_id, seq)`)."""

    model_config = ConfigDict(extra="forbid")

    seq: int = Field(ge=0)
    role: UtteranceRole
    text: str | None = None
    started_at: datetime
    ended_at: datetime | None = None


class UtteranceBatchRequest(BaseModel):
    """`POST /internal/sessions/{id}/utterances`."""

    model_config = ConfigDict(extra="forbid")

    items: list[UtteranceItem]


class HopItem(BaseModel):
    """One `LatencyHop` row. Upserted on `(session_id, utterance_seq, hop,
    node_id)` (Phase 9, BL-039 widened the unique key to allow one row per
    graph-node execution) — `node_id` defaults to `""` for the pre-Phase-9
    hop kinds (`stt`/`llm`/`tts`/`avatar`/`e2e`), which keeps their retry
    idempotency unchanged (NFR-1).
    """

    model_config = ConfigDict(extra="forbid")

    utterance_seq: int = Field(ge=0)
    hop: HopKind
    first_partial_ms: int | None = None
    first_token_ms: int | None = None
    first_audio_ms: int | None = None
    first_frame_ms: int | None = None
    total_ms: int | None = None
    provider_key: str | None = None
    used_fallback: bool = False
    error_code: str | None = None
    # Phase 9 (BL-039) — node-level session trace. Only ever set on
    # `hop="node"` rows.
    node_id: str | None = None
    node_type: str | None = None
    lane: Literal["foreground", "background"] | None = None


class HopBatchRequest(BaseModel):
    """`POST /internal/sessions/{id}/hops`."""

    model_config = ConfigDict(extra="forbid")

    items: list[HopItem]


class SummaryRequest(BaseModel):
    """`POST /internal/sessions/{id}/summary` — the agent is the only writer (HLD §7.3)."""

    model_config = ConfigDict(extra="forbid")

    summary_status: SummaryStatus
    summary_text: str | None = Field(default=None, max_length=500)


class AlertRequest(BaseModel):
    """`POST /internal/alerts`."""

    model_config = ConfigDict(extra="forbid")

    tenant_id: UUID
    type: AlertType
    message: str = Field(min_length=1, max_length=500)
