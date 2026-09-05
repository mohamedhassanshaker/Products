"""Unit tests for FR-CALL-4 post-call summary generation."""

from __future__ import annotations

from uuid import UUID

from avatar_agent.contracts.internal_api import SummaryRequest
from avatar_agent.contracts.structured import PostCallSummary
from avatar_agent.ports.llm import LlmError, ResidencyPayload
from avatar_agent.summary.post_call import generate_and_send_summary

SESSION_ID = UUID("11111111-1111-1111-1111-111111111111")


def residency() -> ResidencyPayload:
    return ResidencyPayload(system_prompt="sys", messages=[{"role": "user", "content": "hi"}])


class FakeLlm:
    def __init__(self, result: PostCallSummary | None = None, error: BaseException | None = None) -> None:
        self._result = result
        self._error = error

    async def complete_stream(self, *a, **k):  # noqa: ANN002, ANN003
        raise NotImplementedError

    async def complete_structured(self, messages, schema, residency):  # noqa: ANN001
        if self._error:
            raise self._error
        return self._result

    @property
    def first_token_ms(self):
        return None


class FakeControlPlane:
    def __init__(self) -> None:
        self.sent: list[tuple[UUID, SummaryRequest]] = []

    async def send_summary(self, session_id: UUID, request: SummaryRequest) -> None:
        self.sent.append((session_id, request))


async def test_sends_a_ready_summary_on_success() -> None:
    llm = FakeLlm(result=PostCallSummary(summary_text="A great call."))
    control_plane = FakeControlPlane()

    await generate_and_send_summary(llm, SESSION_ID, residency(), control_plane)  # type: ignore[arg-type]

    session_id, request = control_plane.sent[0]
    assert session_id == SESSION_ID
    assert request.summary_status == "ready"
    assert request.summary_text == "A great call."


async def test_sends_unavailable_on_llm_failure_never_raises() -> None:
    llm = FakeLlm(error=LlmError("down", retryable=False))
    control_plane = FakeControlPlane()

    await generate_and_send_summary(llm, SESSION_ID, residency(), control_plane)  # type: ignore[arg-type]

    _session_id, request = control_plane.sent[0]
    assert request.summary_status == "unavailable"
    assert request.summary_text is None


async def test_sends_unavailable_and_never_raises_on_a_non_llm_error_exception() -> None:
    """QA D-5 (phase7-agent-summary-wiring retry 1), layer 2 of 3.

    This function is called from `entrypoint.handle_job`'s teardown
    `finally`, so an escaping exception skips the terminal `"ended"` event.
    Before the fix only `LlmError` was caught, and a real reachable
    `openai.AuthenticationError` (credential revoked mid-call) that the
    adapter never classified propagated straight out. Deliberately raises a
    plain, never-anticipated exception type here — NOT an SDK error — so
    this assertion keeps holding independently of the adapter-level
    classification fix (layer 1, `tests/adapters/llm/test_openai.py`).
    """

    class NeverAnticipatedError(RuntimeError):
        pass

    llm = FakeLlm(error=NeverAnticipatedError("revoked credential, unclassified"))
    control_plane = FakeControlPlane()

    await generate_and_send_summary(llm, SESSION_ID, residency(), control_plane)  # type: ignore[arg-type]

    _session_id, request = control_plane.sent[0]
    assert request.summary_status == "unavailable"


async def test_never_raises_even_when_the_degrade_write_itself_fails() -> None:
    """The `summary_status="unavailable"` degrade write runs from inside an
    `except` block during teardown — if the internal API is the very thing
    that is down, that failure must not be what escapes instead.
    """

    class BrokenControlPlane:
        async def send_summary(self, session_id: UUID, request: SummaryRequest) -> None:
            raise ConnectionError("internal API unreachable")

    llm = FakeLlm(error=LlmError("down", retryable=False))

    # No exception expected; the assertion is simply that this returns.
    await generate_and_send_summary(llm, SESSION_ID, residency(), BrokenControlPlane())  # type: ignore[arg-type]
