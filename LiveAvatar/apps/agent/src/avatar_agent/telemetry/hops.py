"""`HopRecorder` — batches `LatencyHop` rows per utterance cycle (NFR-1).

Every hop (`stt`, `llm`, `tts`, `avatar`) records its own timing fields;
missing a hop metric for a completed cycle is a quality defect (NFR-1), so
`pipeline.py` is expected to call `record()` for every hop it runs, even on
failure (with `error_code` set).
"""

from __future__ import annotations

from uuid import UUID

from avatar_agent.contracts.internal_api import HopItem
from avatar_agent.telemetry.control_plane import ControlPlaneClient


class HopRecorder:
    """Accumulates `HopItem`s for the current utterance cycle and flushes
    them as one batch (`POST /internal/sessions/{id}/hops`).
    """

    def __init__(self, client: ControlPlaneClient, session_id: UUID) -> None:
        self._client = client
        self._session_id = session_id
        self._pending: list[HopItem] = []

    def record(self, item: HopItem) -> None:
        """Queues one hop row for the next `flush()`."""
        self._pending.append(item)

    async def flush(self) -> None:
        """Sends every queued hop as one batch and clears the queue."""
        if not self._pending:
            return
        items, self._pending = self._pending, []
        await self._client.send_hops(self._session_id, items)
