# QA Retry #1 Report - Phase 4, apps/agent Python deployable (BL-013-BL-016)

**Date:** 2026-08-19
**Scope:** Re-verification of the dev fix pass against my prior FAIL report
(qa-results/phase4-agent-python/REPORT.md). Focus: D-1 (STT wiring, Blocking)
and D-2 (tool invocation, Blocking) are the critical items; D-3/D-4 batched;
full regression + spot-check of previously-passing items.

**Environment:** Same Windows sandbox, no Docker/LiveKit/Postgres reachable
(carried-forward limitation, unchanged). Used the real Python 3.13 venv
already present at apps/agent/.venv (built by the dev agent with the same
real vendor SDKs as my prior pass - openai, anthropic, google-genai,
deepgram-sdk, faster-whisper, elevenlabs, livekit-agents, langgraph,
pydantic-ai) rather than rebuilding one, since a fresh pip install of the
identical lockfile would only reproduce the same environment. Ran the real
TS jest suite for the cross-language contract test via npx jest in
apps/api (already had node_modules).

## Full regression - independently re-run

| Check | Dev claim | QA result (retry 1) |
|---|---|---|
| pytest | 160/160 passed | Confirmed: 160 passed |
| Coverage | 92.26% | Confirmed: 92.26% exactly, fail_under=80 gate passes |
| ruff check . | clean | Confirmed: "All checks passed!" |
| lint-imports | 3/3 contracts kept, 231 deps | Confirmed: 3 kept, 0 broken, 82 files/231 dependencies |

No regression in the numbers versus the dev's claim.

## D-1 (was BLOCKING) - STT wiring: FIXED, independently confirmed

Read the real, current entrypoint.py, orchestration/pipeline.py, and
adapters/transport/livekit.py line by line (not trusting the dev's own
summary):

- entrypoint.handle_job genuinely registers ctx.room.on("track_subscribed",
  _on_track_subscribed), and _on_track_subscribed schedules
  pipeline.run_stt_loop(_pump_track_audio(track), participant_identity=...,
  track_sid=...) for every audio track - not a stub, not commented out.
- _pump_track_audio genuinely wraps rtc.AudioStream(track,
  sample_rate=16000, num_channels=1) and yields raw PCM bytes - this is real
  LiveKit Agents API surface, not invented.
- ConversationPipeline.run_stt_loop genuinely calls
  self._stt.transcribe_stream(audio_pcm), publishes every partial/final via
  self._transport.publish_transcription(...) when a transport is present,
  forwards finals into self.on_final_utterance(text), and records a real
  HopItem(hop="stt", first_partial_ms=..., total_ms=...) via
  self._hop_recorder.record(...) + .flush() - HopRecorder (previously
  confirmed dead code in my first pass) is genuinely instantiated in
  ConversationPipeline.__init__ and invoked here.
- LiveKitTransportAdapter.publish_transcription genuinely builds a real
  rtc.Transcription/rtc.TranscriptionSegment and calls
  self._room.local_participant.publish_transcription(transcription) - the
  exact call shape RoomEvent.TranscriptionReceived on the JS SDK side
  decodes (confirmed by reading ports/transport.py's docstring cross-
  reference to the frontend's LiveKitRoomService).

Dev's own trace test (test_full_conversation_loop_audio_in_to_caption_and_
speech_out in tests/orchestration/test_pipeline.py) genuinely drives
pipeline.run_stt_loop(...) -> pipeline.run_consumer_loop() (as a real
asyncio task, not a mock) -> asserts real stt/llm/tts hops and a real
assistant reply. This is a legitimate integration test at the
ConversationPipeline level, not tautological - it exercises the pipeline's
own public methods end to end with fake STT/LLM/TTS/transport doubles, not
by calling on_final_utterance directly. Ran it: PASSED.

Separately, tests/test_entrypoint.py::test_handle_job_subscribes_to_the_
remote_audio_track_and_runs_the_stt_loop genuinely exercises handle_job's
own track_subscribed registration/dispatch logic (a MagicMock
ConversationPipeline is substituted, so this test does NOT exercise the
real pipeline, but it does prove handle_job's own code - not the dev's
description of it - correctly wires the LiveKit event to
pipeline.run_stt_loop with the right participant_identity/track_sid).
Ran it: PASSED.

### My own independent trace test (fresh fixture, different from the dev's)

Per the dispatch's explicit ask, I wrote and ran my own end-to-end test
(qa-results/phase4-agent-python/retry1-evidence/qa_independent_trace_test.py,
not left in the shipped test suite - see Test hygiene below) that differs
from the dev's own tests in every way that matters for tautology-proofing:

- Drives the REAL handle_job entrypoint (not ConversationPipeline
  directly like the dev's pipeline-level trace test).
- Uses a REAL ConversationPipeline (not a MagicMock stand-in like the
  dev's own test_handle_job_... entrypoint test) - i.e. it is the union of
  what the dev's two separate tests each cover individually, exercised as
  one single chain.
- Monkeypatches only rtc.AudioStream (the one real LiveKit surface
  _pump_track_audio touches) - _pump_track_audio itself genuinely runs,
  unlike the dev's test_handle_job_... test, which mocks
  pipeline.run_stt_loop itself and therefore never executes
  _pump_track_audio at all.
- Fresh session/tenant ids, fresh fixture text ("testing one two three" /
  "QA reply chunk one. QA reply chunk two."), fresh Fake* doubles (not
  imported from the dev's test modules).

Chain genuinely exercised: handle_job -> real track_subscribed handler ->
real _pump_track_audio (real rtc.AudioStream iteration, monkeypatched
only at the LiveKit-SDK boundary) -> real ConversationPipeline.run_stt_loop
-> fake STT partial+final -> real publish_transcription call recorded ->
real on_final_utterance -> real queue -> real run_consumer_loop (a real,
live asyncio task - NOT the dev's own _NoopTask/no-op stand-in pattern,
which closes the coroutine without ever running it) -> real
_process_utterance -> real residency.build_payload (asserted the QA
utterance text genuinely appears in the residency payload the fake
orchestrator receives) -> fake LangGraphOrchestrator.run_turn -> real
_consume_llm_stream -> real _speak/TTS -> real hops sent for
stt/llm/tts -> real utterances sent for both roles.

Result: PASSED, after two iterations to get my own fixture's event-loop
plumbing right (documented as findings below, not dev defects):

1. My fake Room.local_participant initially used a bare MagicMock() -
   LiveKitTransportAdapter.publish_transcription's real await
   self._room.local_participant.publish_transcription(...) correctly raised
   TypeError: object MagicMock can't be used in 'await' expression until I
   gave it AsyncMock() - this is a self-test bug, not a product defect (a
   real rtc.LocalParticipant.publish_transcription is a real coroutine).
2. Genuine observation worth flagging (not a defect, but explains why
   both the dev's tests needed to mock around it): entrypoint.handle_job
   awaits ctx.room.disconnected if hasattr(ctx.room, "disconnected") else
   None to keep the job alive. In any fake Room without a real
   disconnected future (as both the dev's FakeRoom and my first attempt
   at one had it), handle_job falls straight through this line and
   immediately proceeds to the finally block, cancelling the STT/consumer
   background tasks before they get more than a couple of event-loop turns.
   This is why the dev's own test_handle_job_... test could only assert
   "was called" (a synchronous fact, true the instant
   pipeline.run_stt_loop(...) is invoked to build the coroutine object)
   rather than "ran to completion" - with that FakeRoom shape, it
   couldn't have asserted the latter even if it tried. I fixed this in my
   own fixture by giving QaFakeRoom.disconnected a real, never-resolving
   asyncio.Future, which lets handle_job stay "connected" long enough
   for the full chain to actually run before I cancel the job task myself.
   This is not a product bug (a real LiveKit Room always has a real
   disconnected awaitable) - it is a carried-forward observation that
   the currently-shipped test suite cannot, by construction, prove the
   background STT/consumer tasks survive past the very first scheduling
   tick of handle_job. Recommend nexus-dev's next iteration give FakeRoom
   a real future too, so the entrypoint-level test can assert on task
   completion, not just invocation.

Verdict: D-1 is FIXED. The STT half of the loop is genuinely wired
end-to-end in production code, proven by three independent tests (the dev's
two, plus my fresh one) exercising three different slices of the same real
chain, with no component substituted out that the original defect
(on_final_utterance never called, HopRecorder dead) depended on.

## D-2 (was BLOCKING) - Tool invocation: FIXED, independently confirmed

- entrypoint._resolve_tools genuinely reads cfg.tool_definitions
  (confirmed present as a real field on AgentRuntimeConfig in
  contracts/runtime_config.py, mirrored by ToolDefinitionDtoSchema/
  tool_definitions in packages/contracts/src/internal/schemas.ts -
  read both sides, field names/types/optionality line up field-for-field)
  and builds real ToolDefinition/ToolSpec instances, no longer
  hardcoding []. A tool whose credential_ref fails to resolve is
  registered anyway with api_key=None (matches FR-AGENT-2/5's
  "conversation continues" semantics; confirmed by
  test_build_pipeline_does_not_fail_the_whole_job_when_a_tool_credential_
  is_unresolvable).
- ports/llm.py's LlmChunk genuinely gained a tool_calls:
  NotRequired[list[ToolCallRequest]] field, and ToolCallRequest is a
  real TypedDict (id/name/arguments), not a loose dict.
- Read all three LLM adapters in full (not just grepped for the field name):
  - OpenAI (adapters/llm/openai.py): accumulates streamed tool-call
    deltas keyed by call_delta.index, concatenating function.arguments
    JSON-string fragments across multiple chunks before parsing on the
    terminal done=True chunk - this is the real shape OpenAI's streaming
    API actually uses (parallel tool calls each get their own index,
    arguments arrive fragmented). A malformed-JSON tool call is dropped, not
    raised. Adapter-level test
    test_complete_stream_accumulates_a_streamed_tool_call_across_deltas_
    and_parses_arguments genuinely simulates 3 separate chunks
    (name-only, then two arguments fragments) and asserts the final,
    correctly-reassembled {"city": "nyc"} - a realistic streaming shape,
    not a single-shot fake.
  - Anthropic (adapters/llm/anthropic.py): reads tool_use content
    blocks from stream.get_final_message() (the SDK's own accumulated-
    result accessor) after draining text_stream - correctly reflects that
    Anthropic never puts tool_use blocks in the incremental text stream,
    only in the final assembled message. Adapter test
    test_complete_stream_extracts_tool_use_blocks_from_the_final_message
    confirmed real.
  - Google/Gemini (adapters/llm/google.py): reads the SDK's
    chunk.function_calls convenience accessor, synthesizing a call id
    since Gemini's protocol has none. Read-confirmed correct; not required
    by the dispatch to independently re-test beyond the 2 providers above,
    but code-reviewed and consistent with the same pattern.
  - This satisfies the dispatch's "at least 2 of the 3 providers" ask with
    both OpenAI and Anthropic genuinely exercised against realistic
    per-provider streaming shapes, not a single generic fake.
- orchestration/pipeline.py::_process_utterance genuinely detects
  tool_calls from _consume_llm_stream's return, and (if any) calls
  self._apply_tool_results(...), which calls
  self._tool_executor.invoke(definition, call["arguments"]) for each -
  confirmed by reading the code (not just grepping for .invoke() - the
  definition passed is looked up from self._tools_by_name[call["name"]],
  the model-visible tool name, matching FR-AGENT-2. An unknown tool name or
  a ToolError both fold into a role="tool" message rather than raising,
  and the follow-up turn is bounded to exactly one round
  (_MAX_TOOL_ROUNDS = 1).
- tests/orchestration/test_pipeline.py's tool-call tests
  (test_tool_call_is_invoked_and_its_result_fed_back_for_a_second_turn,
  test_unknown_tool_name_feeds_back_an_error_message_instead_of_raising,
  test_tool_execution_failure_feeds_back_an_error_message_instead_of_
  raising, test_tool_round_trip_is_bounded_to_one_follow_up_turn)
  genuinely assert tool_executor.calls[0] == (tool, {"city": "nyc"})-shape
  invocations and that the SECOND turn's output (not a stale first-turn
  value) is what reaches send_utterances. Ran all four: PASSED.

Verdict: D-2 is FIXED. Tool registration, model-visible exposure,
call detection (2/3 providers deep-verified against realistic streaming
shapes), invocation with correct arguments, and the bounded follow-up-turn
feedback loop are all genuinely wired end-to-end, not merely present as an
isolated, never-invoked class the way my first pass found.

## D-3 (Moderate, import-linter loophole) - FIXED, independently re-probed

Read .importlinter: orchestration-uses-ports's source_modules is now
orchestration, telemetry, residency, summary, contracts, ports (was just
orchestration), closing exactly the gap my first pass proved.

Live-probed myself with a different violation than the dev's own probe
(dev's probe targeted telemetry/hops.py; mine targeted
residency/filter.py, a different one of the five now-covered modules) -
added "from avatar_agent.adapters.stt.deepgram import DeepgramSttAdapter"
to the top of residency/filter.py and ran lint-imports:

  Only entrypoint/registry compose adapters directly BROKEN
  avatar_agent.orchestration is not allowed to import avatar_agent.adapters:
  -   avatar_agent.orchestration.pipeline -> avatar_agent.residency.filter (l.37)
      avatar_agent.residency.filter -> avatar_agent.adapters.stt.deepgram (l.1)
  avatar_agent.residency is not allowed to import avatar_agent.adapters:
  -   avatar_agent.residency.filter -> avatar_agent.adapters.stt.deepgram (l.1)

Caught correctly, on the first violating line, and (as a bonus) also caught
transitively through orchestration.pipeline's import of residency.filter,
confirming the contract's reach is broader than just the directly-probed
module. Reverted (diff confirmed byte-identical restoration); re-ran
lint-imports: back to 3 kept, 0 broken, 231 dependencies - exact match to
the pre-probe baseline, confirming the probe left no residue and that
legitimate imports elsewhere (entrypoint -> adapters.transport.livekit,
registry -> every adapter) are untouched by the broadened contract (already
independently confirmed by the unmodified codebase's own green lint-imports
run above).

Verdict: D-3 is FIXED.

## D-4 (Low) - ResidencyBlockedError handling - code genuinely correct, but UNTESTED

- pipeline.py::_process_utterance now wraps build_payload(...) in a
  try/except ResidencyBlockedError, logging RESIDENCY_BLOCKED and calling
  self._enter_degraded_mode(seq) (which sends a degraded session event,
  an llm_failover-typed alert, an error_code="LLM_UNAVAILABLE" hop, and
  speaks the degraded message) instead of letting the exception propagate
  into run_consumer_loop's blanket except Exception (which would have
  only logged and silently dropped the turn, per my original finding).
- However: grepped tests/orchestration/test_pipeline.py for
  ResidencyBlockedError / residency_mode="none" / any exercise of this new
  branch - zero matches. Cross-checked against the coverage report I
  independently generated: pipeline.py lines 224-234 (the entire new
  except ResidencyBlockedError block, including the _enter_degraded_mode
  call) are listed as uncovered. The dev's decision-log entry does not
  claim a test for this path either ("added a ResidencyBlockedError
  handler... left build_payload's raise itself unconditional") - so this
  isn't a misrepresentation, just an unverified-by-the-dev's-own-suite gap
  that the dispatch specifically asked me to check for.
- I independently wrote and ran a small test
  (test_qa_d4_residency_blocked_error_genuinely_degrades_the_session in my
  own scratch file, reusing the dev's own make_pipeline(residency_mode=
  "none") fixture factory since it already exists and is not itself in
  question here) confirming the code does work correctly: a degraded
  event is sent, an llm_failover alert is raised, the llm hop carries
  error_code="LLM_UNAVAILABLE", and - critically - orch.calls == 0,
  proving the short-circuit happens before the LLM is ever invoked (a
  residency-policy block, not a mislabeled downstream LLM failure). Ran it:
  PASSED.

Verdict: D-4's underlying defect is genuinely fixed and I independently
proved the fix works, but flagging as a new, small finding (not reopening
D-4 itself) that the dev shipped this fix with zero test coverage of the
new code path - recommend a permanent regression test be added in the
next dev pass so this doesn't silently regress; not blocking given this
path remains unreachable in production today (same reasoning as the
original D-4 write-up: the TS backend's CONFIG_RESIDENCY_BLOCKS_LLM rule
still prevents any real config from reaching this state).

## Spot-check of previously-passing items (not redone at full depth)

- Vendor-SDK boundary: re-grepped the whole apps/agent/src tree for
  vendor SDK imports outside adapters/** - all hits are logical-key
  literals, comments, or adapter-submodule imports from registry.py
  (legitimate). Confirmed by lint-imports (Vendor SDKs only inside
  adapters KEPT) unchanged from before.
- Residency sole-path enforcement: re-confirmed via the D-4 test above
  that build_payload is still the only path _process_utterance uses to
  construct a ResidencyPayload, and it still correctly gates on
  residency_mode.
- Failover (FR-LLM-2): re-ran tests/orchestration/test_failover.py
  directly - all 7 tests pass, unchanged from my first pass.
- Secrets handling: re-ran tests/secrets/test_directory_store.py - all
  4 pass (path-traversal rejection, nested credential_ref resolution
  unchanged).
- Cross-language contract test: re-ran both halves independently -
  Python tests/contracts/ (28 tests) all pass; TS
  agent-config-cross-language.contract.spec.ts via npx jest in
  apps/api - 11/11 pass, matching my first pass's count exactly. No
  regression.

## Traceability matrix (retry 1, changed rows only - see original REPORT.md for full matrix)

| Requirement | Scenario(s) tested | Result | Evidence |
|---|---|---|---|
| FR-STT-3 (streaming partials, zero-length drop) | Dev's run_stt_loop tests + full-loop trace test + my own independent entrypoint-to-pipeline trace | PASS | tests/orchestration/test_pipeline.py, qa_independent_trace_test.py |
| FR-STT-4 (instrument STT hop) | Same as above; hop_by_name["stt"].first_partial_ms asserted in my own test | PASS | as above |
| FR-AGENT-1 (STT->LLM(+tools)->TTS->avatar) | Full real-code trace of entrypoint.py/pipeline.py; my own independent end-to-end test | PASS (avatar leg still deliberately out of scope, unchanged/disclosed) | as above |
| FR-AGENT-2 (tool invocation) | Code trace of all 3 adapters + pipeline.py; dev's 4 tool tests re-run; 2/3 providers deep-verified against realistic streaming shapes | PASS | tests/orchestration/test_pipeline.py, tests/adapters/llm/test_openai.py, tests/adapters/llm/test_anthropic.py |
| FR-AGENT-5 (customer internal APIs via tools) | Same as FR-AGENT-2, now genuinely reachable at runtime (previously isolated-class-only) | PASS | as above |

All other rows from the original matrix are unchanged and were spot-checked,
not redone at full depth, per the dispatch's scope guidance.

## Test hygiene

My own independent trace/probe artifacts:
- qa-results/phase4-agent-python/retry1-evidence/qa_independent_trace_test.py
  - a copy of the exact test file I wrote and ran (originally at
  apps/agent/tests/qa_retry1/), kept here as evidence rather than left in
  the shipped test suite (not asked to permanently extend the dev's test
  suite; the dev/orchestrator can promote it if desired).
- The .importlinter D-3 re-probe (residency/filter.py edit) was made,
  run, and reverted within the same tool-call sequence; diff confirmed
  byte-identical restoration before moving on.
- No data was created in any database/external service (no Docker/Postgres/
  LiveKit reachable in this sandbox, same carried-forward gap as every prior
  phase).

## Overall verdict: PASS

Both blocking defects from my prior FAIL report are genuinely fixed and
independently re-verified against the real, current code (not the dev's
description of it), including a fresh, non-tautological trace test of my
own that exercises a superset of the chain either of the dev's own two tests
covers alone. D-3 is genuinely fixed and re-probed with a different
violation. D-4's underlying code fix is genuinely correct (independently
proven by a test I wrote), though it shipped with no permanent test
coverage of its own - a small, non-blocking follow-up recommendation, not a
reason to fail this retry.

Full regression matches the dev's claim exactly (160/160 pytest, 92.26%
coverage, ruff clean, import-linter 3/3 kept/231 deps), and every previously-
passing item I spot-checked (vendor-SDK boundary, residency sole-path,
failover, secrets, cross-language contract) shows no regression.

Recommendation to the orchestrator: Phase 4's Python agent half (BL-013-
BL-016) is ready to close from a QA standpoint, pending the other two
parallel dispatches' (TS /internal, frontend captions) own verdicts on
their respective scopes - the cross-phase captions dependency on this half
(publish_transcription, which I re-confirmed genuinely fires) should now
also be reachable if not already re-verified by that dispatch. One
non-blocking follow-up recommended for the next dev iteration: add a real
test for the ResidencyBlockedError pipeline-level handler (D-4) and
consider giving FakeRoom in tests/test_entrypoint.py a real
disconnected future so entrypoint-level tests can assert background-task
completion, not just invocation.
