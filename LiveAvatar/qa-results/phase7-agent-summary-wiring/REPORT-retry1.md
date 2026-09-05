# QA Report - Phase 7, Agent Summary Wiring (D-1 re-verification), QA retry #1

**Date:** 2026-08-20
**Scope:** Re-verification of the claimed fix for D-1 (BLOCKING, 3rd recurrence of the
"built but never wired" bug class) in `qa-results/phase7-conversation-summary/REPORT.md`
- the Python agent post-call summary wiring
(`apps/agent/src/avatar_agent/summary/post_call.py`,
`orchestration/pipeline.py::ConversationPipeline.generate_summary`,
`entrypoint.py::handle_job`s finally teardown) - plus a spot-check that the backend
(`apps/api`) remains clean. Parallel agents this cycle cover the admin SPA and
conversation-summary-screen fixes, not re-verified here.

## Environment

- Static code reading of the actual current source for `entrypoint.py`,
  `orchestration/pipeline.py`, `summary/post_call.py`, `telemetry/control_plane.py`,
  and the real vendor LLM adapters (openai/anthropic/google).
- apps/agent: ran the existing pytest suite plus my own new independent test module
  (written to the QA scratch directory, copied temporarily into apps/agent/tests only
  to execute via the projects own pytest config, then deleted immediately after the
  run; git status confirms it is not present in the tree post-run).
- apps/api: ran the existing jest --runInBand suite as a spot-check (no backend code
  changed this cycle).
- No browser/UI exercised in this pass (out of scope for this dispatch).

## 1. Is generate_and_send_summary genuinely called from handle_jobs real teardown

Yes, confirmed by direct code reading. entrypoint.py handle_job finally block now
calls, in order: stt task cancellation, consumer task cancellation, pipeline.aclose(),
pipeline.generate_summary(), then control_plane.send_event(ended). generate_summary
builds a real ResidencyPayload from the session memory window, respects the
residency_mode none guard, and calls summary.post_call.generate_and_send_summary. This
is a real call graph from the real per-job entrypoint. D-1s headline claim is TRUE for
the golden path.

## 2. My own independent test

The devs own new regression test drives handle_job with a hand rolled fake control
plane that bypasses ControlPlaneClient entirely. I re-ran it: PASS.

I then wrote my own test with a different session id, different tenant id and
different summary text, using the REAL ControlPlaneClient class with respx
intercepting the HTTP transport at the wire level, standing in for the real internal
API. Result: PASS. The real POST /internal/sessions/id/summary request genuinely
fires with the correct body and X-Internal-Token header, driven through the real
handle_job -> pipeline.generate_summary -> generate_and_send_summary ->
ControlPlaneClient.send_summary -> real httpx POST chain.

## 3. Edge case: generate_and_send_summary failing for a reason other than LlmError

generate_and_send_summary only catches LlmError. pipeline.pys own docstring claims
generate_and_send_summary never raises. I checked the real openai adapter used as the
default LLM provider: its complete_structured only catches RateLimitError,
APITimeoutError, APIConnectionError and APIStatusError into LlmError. It does NOT
catch AuthenticationError, NotFoundError, an empty choices IndexError, or a
ValidationError from its own re-validation step, unlike its sibling complete_stream,
and unlike anthropic.py/google.py which both catch bare Exception defensively.

I wrote a test simulating a non-LlmError exception from complete_structured (standing
in for a real AuthenticationError, e.g. a revoked credential at end of call), driven
through the real handle_job path.

Result: the exception is NOT swallowed. It propagates out of
generate_and_send_summary, out of pipeline.generate_summary, and out of handle_jobs
finally block itself. Teardown steps that ran BEFORE generate_summary in the same
finally block (stt task cancel, consumer loop cancel, pipeline.aclose, confirming
avatar/track cleanup from earlier phases) DID complete correctly. But the trailing
send_event ended call is never reached, and handle_job itself raises out to its
caller. This contradicts the explicit ask of whether the finally blocks call to
generate_summary can crash the whole teardown path: it can, for this real reachable
exception family.

## 4. Spot check: rest of entrypoint.pys teardown sequence

No regression found. Code reading plus my edge case test (which asserted aclose still
ran) confirm the ordering and behavior of stt task cancellation, consumer loop
cancellation, and pipeline.aclose/avatar aclose are unchanged and still execute before
the new generate_summary call.

## 5. Full regression

Python pytest: 241 passed (claimed 241/241) - MATCH
Python coverage: 94.41% total (claimed 94.41%) - MATCH
ruff check: All checks passed - MATCH
import-linter: 3 kept, 0 broken, 86 files/256 deps (claimed 3/3 kept) - MATCH
Backend jest --runInBand: 128 suites passed/128, 715 tests passed/715 (claimed 715/715
unchanged) - MATCH
Vendor SDK isolation: openai/anthropic imports confirmed only inside adapters/llm,
import-linter Vendor SDKs only inside adapters contract KEPT - PASS

## Traceability matrix

- D-1 golden path, code trace of finally block plus generate_summary: PASS
- D-1 golden path, independent test with real ControlPlaneClient + respx, distinct
  session/data: PASS
- D-1 devs own regression test re-run: PASS
- D-1 edge case, non-LlmError exception during teardown: FAIL, new defect D-5
- Teardown ordering regression (stt/consumer/avatar aclose): PASS
- Backend spot check jest: PASS
- Full agent regression pytest/coverage/ruff/import-linter: PASS

## New defect: D-5

Originating phase: Phase 7 QA fix pass, apps/agent. Not a re-recurrence of never
wired (the wiring genuinely exists), but a real gap in the never raises safety claim
the fix relies on.

What was expected: the dispatch explicitly asked whether the finally blocks call to
generate_summary can crash the whole teardown/exit path, and pipeline.pys own
docstring asserts generate_and_send_summary never raises.

What actually happened: generate_and_send_summary only catches LlmError. The real,
already shipped openai adapter (the projects primary/default LLM provider per its own
test fixtures) does not classify AuthenticationError, NotFoundError, an empty choices
response, or a ValidationError from its own re-validation step into LlmError, unlike
its sibling complete_stream and unlike anthropic/google which both defensively catch
bare Exception. Any of these real reachable failure modes (an OpenAI credential
revoked or a model deprecated between session start and call end) propagates a
non-LlmError exception all the way out of handle_jobs own finally block, skipping the
trailing ended event and raising out of the entrypoint itself, unlike every other step
in that same teardown block.

Repro: my independent test (kept in the QA scratch directory, not committed to the
repo) raises a bare Exception subclass from a fake complete_structured, drives it
through the real handle_job, and asserts the exception propagates out of handle_job
and the ended event POST is never made.

Impact: a real session hitting this failure mode would have its summary correctly
degrade attempted, but would never receive its terminal ended event, and the job
entrypoint coroutine would raise during room teardown. Narrower likelihood than D-1s
original scenario, but real and testable.

Recommended fix (not performed by QA): widen generate_and_send_summarys except clause
to catch bare Exception, mirroring anthropic.py/google.pys own defensive pattern, or
wrap the pipeline.generate_summary() call itself in a try/except at the entrypoint.py
call site.

Severity: moderate to blocking. Does not reproduce D-1s original summary-never-
generated defect, but blocks full confidence in the specific thing this dispatch asked
to be verified, and has a real, if narrower, production consequence. Recommend
routing to nexus-dev before this phase closes given this exact subsystems history of
three prior wiring defects.

## Overall verdict: PASS-WITH-CAVEATS

D-1, the blocking defect from the original QA pass, is now genuinely fixed for the
golden/production path. generate_and_send_summary is verifiably reachable from the
real handle_job teardown, independently confirmed with a different test than the devs
own, and the pre-existing teardown steps are confirmed unregressed. Full agent and
backend regression independently matches the devs claims exactly.

However, this pass found one new, real, reproducible gap (D-5): the never raises
safety property the fix explicitly relies on is false for a real, already shipped LLM
adapter and a realistic failure mode, with a genuine production consequence (a raised
exception out of the job entrypoint plus a skipped terminal ended event). Given this
projects specific history, recommend NOT closing this phase yet: route D-5 to
nexus-dev for a small, targeted fix before Final Review rather than accepting it as a
carried-forward caveat.

D-2/D-3 (conversation-summary SPA) and the admin-SPA findings are out of this
dispatchs scope and were not re-verified here - covered by the parallel QA passes
dispatched in this same retry round.
