# QA Report - Phase 7, Agent Summary Wiring, QA retry #2 (D-5 re-verification)

**Date:** 2026-08-20
**Scope:** Independent re-verification that D-5 (qa-results/phase7-agent-summary-wiring/REPORT-retry1.md)
is genuinely fixed via three claimed independent layers of defense: (1) adapter
exception classification in openai.py/anthropic.py/google.py, (2) a broad catch in
summary/post_call.py::generate_and_send_summary, (3) a teardown guard in
entrypoint.py::handle_job's finally block. Not a general Phase 7 re-review - scoped
exactly to this defect's fix per the dispatch.

## Environment

- Static code reading of the actual current source: adapters/llm/openai.py,
  adapters/llm/anthropic.py, adapters/llm/google.py, adapters/llm/_openai_compatible.py,
  summary/post_call.py, entrypoint.py.
- Independent, freshly-authored reproduction scripts (not the dev's own test fixtures or
  exception classes) run against the real installed openai/anthropic SDKs via
  .venv-agent (repo-root Python 3.13 venv) for Layer 1 and Layer 2; a real drive of the
  actual entrypoint.handle_job coroutine (not calling generate_summary/aclose
  directly) for Layer 3. Scripts kept only in the QA scratchpad, not committed to the repo.
- Full regression: pytest --cov=avatar_agent, ruff check ., lint-imports, mypy
  src/avatar_agent all re-run independently in the same venv.
- Environment note (not a Phase 7 defect): this QA sandbox's .venv-agent did not have
  bithuman installed at the start of this pass (a fresh sandbox instance, unrelated to
  this dispatch), which failed 1 collection + 10 downstream tests purely on
  ModuleNotFoundError for bithuman. Installed bithuman==1.10.7 (same
  version the dev's own docstrings reference as already installed) before the
  regression run below; confirmed 236 (no-bithuman) + 17 (bithuman-only) = 253, matching
  the dev's claimed total exactly - this was purely sandbox/environment drift, not a
  code defect, and does not touch any of the three layers under test.

## Layer 1 - adapter classification (openai.py/anthropic.py/google.py)

Read all three _classify() implementations in full. All three now:
- classify NotFoundError/AuthenticationError/rate-limit/timeout/connection/status
  errors explicitly, and
- fall through to a catch-all non-retryable LlmError for anything else (the fix for
  D-5's actual root cause - no more enumeration-completeness dependency).
- complete_structured's empty-choices guard, parsed is None guard, and
  schema.model_validate(...) re-validation are all now inside the try/except
  block that funnels through _classify, with except LlmError: raise correctly
  placed ahead of the broad except Exception catch in all three adapters and in
  complete_stream too (confirmed by reading each adapter's full try/except chain
  line-by-line - the raise re-raise for the already-classified type sits first in
  every case, so a retryable LLM_MODEL_NOT_FOUND/LLM_UNAVAILABLE classification is
  never flattened into the generic non-retryable fallback).
- _openai_compatible.py subclasses OpenAiLlmAdapter directly (confirmed by
  reading it), so it inherits the same _classify fix with no separate code path.

Independent reproduction (repro_layer1.py, written fresh by QA, not reusing the dev's
test classes/fixtures), run against the real installed SDKs:

1. QA's original D-5 repro - openai.AuthenticationError (via a monkeypatched
   chat.completions.parse raising a real openai.AuthenticationError built from a
   real httpx.Response(401, ...)) raised from complete_structured.
   Result: LlmError(code=LLM_UNAVAILABLE, retryable=False) - genuinely
   classified now, confirmed not to leak.
2. openai.NotFoundError (model deprecated mid-session) becomes
   LlmError(code=LLM_MODEL_NOT_FOUND, retryable=True) - correct.
3. Newly-swept gap in anthropic.py - a fake messages.create response whose
   tool_use block's input does not conform to the target schema, forcing
   schema.model_validate(block.input) to raise a real pydantic.ValidationError.
   Result: genuinely classified into LlmError, not leaked as a raw
   ValidationError - confirms the claimed sweep of anthropic.py/google.py's
   unguarded model_validate calls is real, not just claimed (read google.py's
   equivalent complete_structured and confirmed the same re-validation call sits
   inside the same try/except).
4. except LlmError: raise correctly sits ahead of the broad catch - an empty-choices
   LlmError raised from inside complete_structured's own try body comes back
   verbatim (message and retryable both preserved), not re-wrapped by the catch-all.

All 4 independent checks: PASS (script output: TOTAL 4/4 passed).

## Layer 2 - summary boundary (summary/post_call.py)

Read generate_and_send_summary: catches LlmError (logged as a warning, degrades to
summary_status="unavailable"), and separately catches bare Exception (logged via
logger.exception - a distinct code path with a traceback, matching the claim), also
degrading to "unavailable". _send_unavailable's own send_summary call is itself
wrapped in a try/except Exception so a failure writing the degrade status can't
escape either.

Independent reproduction (repro_layer2.py) using QaNeverSeenBeforeError, a QA-
invented exception class unrelated to the dev's own "never anticipated" test class,
raised from a fake LLM's complete_structured:

Result: generate_and_send_summary did not raise; RecordingControlPlane.send_summary
was called exactly once with summary_status="unavailable". PASS.

## Layer 3 - teardown guard (entrypoint.py _guarded_teardown_step / handle_job)

Read the finally block: _guarded_teardown_step wraps both pipeline.aclose() and
pipeline.generate_summary(), in that order, before control_plane.send_event with
type "ended". The guard's except Exception deliberately does not catch
asyncio.CancelledError (a BaseException subclass), per its own docstring.

Independent reproduction (repro_layer3.py), driving the REAL entrypoint.handle_job
function (not calling generate_summary/_guarded_teardown_step in isolation), with a
QA-invented QaGenuinelyUnclassifiedFailure exception (distinct from the dev's own
NeverAnticipatedError test fixture) injected as pipeline.generate_summary's
side_effect:

- handle_job did not raise.
- control_plane.send_event's final call carried type="ended" - the terminal event
  genuinely still fired.

Second reproduction scenario: called _guarded_teardown_step directly with a coroutine
that raises asyncio.CancelledError. Result: CancelledError genuinely propagated out
uncaught - confirmed NOT silently swallowed alongside ordinary exceptions, matching the
claimed "deliberately NOT caught" behavior; a real job cancellation would still unwind.

Both Layer 3 checks: PASS.

Defense-in-depth question (explicitly asked by the dispatch): would Layer 3 alone have
caught the original D-5 failure even if Layers 1/2 had never been fixed? Yes - Layer 3's
own reproduction above deliberately bypasses both upstream layers (the injected exception
is neither an LlmError nor caught anywhere except _guarded_teardown_step itself) and
still proves the "ended" event is posted and handle_job doesn't raise. The three
layers are genuinely independent: Layer 1 stops the exception at its true source (best),
Layer 2 stops it at the summary boundary if Layer 1 ever regresses, and Layer 3 stops it
at teardown even if both upstream layers regress simultaneously (also protecting the
aclose() step, which neither Layer 1 nor Layer 2 cover).

## Full regression (independently re-run, not trusting the dev's own numbers)

- pytest --cov=avatar_agent: 253 passed, coverage 95.14% - exact match to the
  dev's claim.
- ruff check .: All checks passed - match.
- lint-imports (import-linter): 3 contracts kept, 0 broken, 86 files / 256
  dependencies - match to retry-1's own baseline count.
- mypy src/avatar_agent --no-incremental: 22 errors in 6 files, not the claimed
  "19, unchanged." Discrepancy - see caveat below. All 15 errors inside the three
  touched adapter files (openai.py 6, anthropic.py 4, google.py 5) are argument-type
  mismatches on the vendor SDK calls themselves (model: str-or-None passed where the SDK
  stub expects a narrow Literal of specific model-name strings; messages/tools passed
  as plain dict/list-of-dict instead of the SDK's TypedDict param shapes) - none of
  these lines are inside the _classify methods or the try/except restructuring this fix
  actually changed; they are pre-existing structural typing looseness from the adapters
  being written against installed SDKs with permissive str/dict runtime config values
  rather than the SDK's own narrow static types (the same class of gap this project's own
  decision log has flagged before). The remaining 7 errors are in files this dispatch did
  not touch at all (orchestration/pipeline.py, orchestration/graph_pydantic_ai.py,
  telemetry/logging.py). Could not reconcile the exact 19-vs-22 count against a
  historical baseline (no git history is available in this repo - every file is
  untracked/uncommitted, so no git diff or prior commit exists to compare against) - this
  is a discrepancy in the dev's own regression claim, not a functional defect in the D-5
  fix, since none of the flagged lines fall inside the actual exception-classification
  code this dispatch changed. Recommend the orchestrator ask the dev to reconcile this
  number in its next pass rather than blocking Final Review on it.

## Traceability matrix

| Requirement / claim | Scenario(s) tested | Result | Evidence |
|---|---|---|---|
| Layer 1: openai.AuthenticationError classified (original D-5 repro) | Fresh repro, real SDK exception | PASS | repro_layer1.py output |
| Layer 1: openai.NotFoundError classified correctly (retryable, correct code) | Fresh repro | PASS | repro_layer1.py output |
| Layer 1: newly-swept anthropic.py model_validate gap | Fresh repro, malformed tool-call input | PASS | repro_layer1.py output |
| Layer 1: except LlmError raise ahead of broad catch (not reflattened) | Fresh repro, empty-choices LlmError | PASS | repro_layer1.py output |
| Layer 2: non-LlmError exception degrades to summary_status=unavailable, never raises | Fresh repro, QA's own exception class | PASS | repro_layer2.py output |
| Layer 3: real handle_job survives unclassified exception at generate_summary, still posts ended | Fresh repro, QA's own exception class, real handle_job | PASS | repro_layer3.py output |
| Layer 3: asyncio.CancelledError NOT swallowed by _guarded_teardown_step | Fresh repro, direct CancelledError injection | PASS | repro_layer3.py output |
| Layer 3 alone sufficient (defense-in-depth) | Reasoned from the Layer 3 repro bypassing Layers 1/2 | PASS | see above |
| Full regression: pytest/coverage | Re-run independently | PASS (253/253, 95.14%) | this pass's own run |
| Full regression: ruff | Re-run independently | PASS | this pass's own run |
| Full regression: import-linter | Re-run independently | PASS (3/3, 86/256) | this pass's own run |
| Full regression: mypy | Re-run independently | DISCREPANCY (22 vs claimed 19), non-blocking | this pass's own run |

## Defects

None found in the actual D-5 fix (all three layers are genuinely, independently
effective). One non-blocking finding:

- F-1 (low, cross-cutting / regression-claim-accuracy, not a functional defect):
  mypy src/avatar_agent reports 22 errors in 6 files in this independent run, not the
  claimed "19, unchanged." All errors inside the three touched adapter files are
  pre-existing vendor-SDK argument-typing looseness unrelated to the _classify or
  exception-handling logic this dispatch actually changed; the remaining errors are in
  untouched files. Could not be reconciled against a prior baseline (no git history
  exists in this repo to diff against). Originating phase: indeterminate (pre-existing
  typing gap, not introduced by this D-5 fix pass). Recommend the dev reconcile/restate
  this number in its next regression claim; does not block this phase's closure on its
  own.

## Overall verdict: PASS

D-5 is genuinely fixed, independently, across all three claimed layers:

1. Layer 1 (adapters) - openai.py/anthropic.py/google.py's _classify()
   catch-all fallback genuinely eliminates the original unclassified-exception leak;
   the newly-swept model_validate gap in anthropic.py (and, by code inspection,
   google.py) is also genuinely fixed, not just claimed.
2. Layer 2 (summary boundary) - generate_and_send_summary genuinely degrades to
   summary_status="unavailable" for a QA-invented exception type it was never
   written against, and never raises.
3. Layer 3 (teardown guard) - the real entrypoint.handle_job genuinely survives
   an unclassified exception injected at the real pipeline.generate_summary() call
   site and still posts the terminal "ended" event; asyncio.CancelledError is
   genuinely NOT swallowed, so a cancelled job still unwinds correctly. Layer 3 alone,
   independent of Layers 1/2, would have caught the original D-5 defect.

Full regression independently matches the dev's claims on every axis except mypy's exact
error count (non-blocking discrepancy, see F-1 above). No new functional defects found.
Recommend the orchestrator close this defect and proceed toward Final Review, optionally
asking the dev to reconcile the mypy count in passing.
