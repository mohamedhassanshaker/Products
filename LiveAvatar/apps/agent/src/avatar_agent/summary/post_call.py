"""FR-CALL-4 post-call summary — the agent is the only writer (HLD §7.3).

Generated once at end-call via `ILLMProvider.complete_structured` (never a
hand-parsed free-text completion — ADR-001 §3). Failure is not blocking:
`SUMMARY_UNAVAILABLE` is written and the transcript is still shown.
"""

from __future__ import annotations

from uuid import UUID

import structlog

from avatar_agent.contracts.internal_api import SummaryRequest
from avatar_agent.contracts.structured import PostCallSummary
from avatar_agent.ports.llm import ILLMProvider, LlmError, ResidencyPayload
from avatar_agent.telemetry.control_plane import ControlPlaneClient

logger = structlog.get_logger(__name__)

_SUMMARY_PROMPT = (
    "Summarize this conversation in one short paragraph (max 500 characters) for the end user who just finished the call."
)


async def generate_and_send_summary(
    llm: ILLMProvider,
    session_id: UUID,
    residency: ResidencyPayload,
    control_plane: ControlPlaneClient,
) -> None:
    """Generates the summary (if the LLM is reachable) and posts it via
    `POST /internal/sessions/{id}/summary`. Never raises — a failed summary
    degrades to `summary_status=unavailable`, per FR-CALL-4.

    "Never raises" is enforced here structurally, not assumed: this function
    is called from `entrypoint.handle_job`'s teardown `finally`, where an
    escaping exception would skip the terminal `"ended"` session event
    (QA D-5, phase7-agent-summary-wiring retry 1 — an `AuthenticationError`
    the `openai` adapter didn't classify into `LlmError` did exactly that).
    The adapters are now the first line of defence (each classifies every
    failure into `LlmError`); the broad catch below is the second, so a
    future unclassified exception type can never again break session end.

    @param llm: the session's primary LLM provider.
    @param session_id: the session the summary belongs to.
    @param residency: the already-residency-filtered conversation payload.
    @param control_plane: client for the internal summary write.
    @returns nothing; failures are logged and degraded, never raised.
    """
    try:
        summary = await llm.complete_structured(
            [*residency.messages, {"role": "user", "content": _SUMMARY_PROMPT}],
            PostCallSummary,
            residency,
        )
        await control_plane.send_summary(session_id, SummaryRequest(summary_status="ready", summary_text=summary.summary_text))
    except LlmError:
        # The expected/classified failure: the LLM was unreachable or
        # rejected the request. Degrade to an explicit "unavailable" write.
        logger.warning("SUMMARY_UNAVAILABLE", session_id=str(session_id))
        await _send_unavailable(session_id, control_plane)
    except Exception:  # noqa: BLE001 - teardown boundary: nothing above may escape
        # Anything else — an adapter that failed to classify, a malformed
        # vendor response, a bug in this module. Logged with a traceback
        # (unlike the expected `LlmError` path, this one is a defect signal),
        # still degraded, still never raised.
        logger.exception("SUMMARY_FAILED_UNEXPECTEDLY", session_id=str(session_id))
        await _send_unavailable(session_id, control_plane)


async def _send_unavailable(session_id: UUID, control_plane: ControlPlaneClient) -> None:
    """Writes `summary_status="unavailable"` for a failed summary, swallowing
    a failure of that write itself.

    `ControlPlaneClient.send_summary` is already best-effort (LLD §10.8), but
    this degrade path runs from inside an `except` block in session teardown —
    if the internal API is the very thing that is down, this must not be what
    turns a missing summary into a skipped `"ended"` event.

    @param session_id: the session whose summary could not be generated.
    @param control_plane: client for the internal summary write.
    """
    try:
        await control_plane.send_summary(session_id, SummaryRequest(summary_status="unavailable"))
    except Exception:  # noqa: BLE001 - best-effort degrade write
        logger.exception("SUMMARY_UNAVAILABLE_WRITE_FAILED", session_id=str(session_id))
