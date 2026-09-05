"""Unit tests for `HopRecorder` (NFR-1)."""

from __future__ import annotations

from uuid import UUID

from avatar_agent.contracts.internal_api import HopItem
from avatar_agent.telemetry.hops import HopRecorder

SESSION_ID = UUID("11111111-1111-1111-1111-111111111111")


class FakeControlPlaneClient:
    def __init__(self) -> None:
        self.sent: list[tuple[UUID, list[HopItem]]] = []

    async def send_hops(self, session_id: UUID, items: list[HopItem]) -> None:
        self.sent.append((session_id, items))


async def test_flush_sends_every_queued_hop_as_one_batch() -> None:
    client = FakeControlPlaneClient()
    recorder = HopRecorder(client, SESSION_ID)  # type: ignore[arg-type]
    recorder.record(HopItem(utterance_seq=1, hop="stt", first_partial_ms=100))
    recorder.record(HopItem(utterance_seq=1, hop="llm", first_token_ms=200))

    await recorder.flush()

    assert len(client.sent) == 1
    session_id, items = client.sent[0]
    assert session_id == SESSION_ID
    assert len(items) == 2


async def test_flush_clears_the_queue_so_a_second_flush_sends_nothing() -> None:
    client = FakeControlPlaneClient()
    recorder = HopRecorder(client, SESSION_ID)  # type: ignore[arg-type]
    recorder.record(HopItem(utterance_seq=1, hop="stt"))
    await recorder.flush()
    await recorder.flush()
    assert len(client.sent) == 1


async def test_flush_on_an_empty_queue_sends_nothing() -> None:
    client = FakeControlPlaneClient()
    recorder = HopRecorder(client, SESSION_ID)  # type: ignore[arg-type]
    await recorder.flush()
    assert client.sent == []
