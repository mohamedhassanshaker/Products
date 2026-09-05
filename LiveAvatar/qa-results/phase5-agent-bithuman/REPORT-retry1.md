# QA Re-verification Report (retry 1) — Phase 5 (BL-018): bitHuman Avatar Adapter

**Scope:** Re-verification of the dev fix pass for D-1 (blocking, FR-AVATAR-5
mid-session avatar crash) and D-2 (low, mypy-claim accuracy) from
`qa-results/phase5-agent-bithuman/REPORT.md`. Same file scope as the original
pass: `apps/agent/src/avatar_agent/orchestration/pipeline.py`'s avatar
lifecycle (`_cancel_avatar_pump`, `_attempt_avatar_recovery`,
`_pump_avatar_frames`, `_publish_avatar_video`, `aclose`), plus full
regression re-run.

**Environment:** Windows sandbox, `apps/agent/.venv` (Python 3.13.14), same
carried-forward gap as before — no GPU/model asset/network egress to
`api.bithuman.ai`, no live LiveKit server reachable. All verification below
is against the real, current source, run directly (own independent test
script, not the dev's own new regression test), plus independent re-runs of
`pytest`/`ruff`/`mypy`/`import-linter`.

## D-1 — code trace

Read the current `_cancel_avatar_pump` (pipeline.py:567-589) and its three
call sites (`_attempt_avatar_recovery` at line 487, `aclose` at line 599).
The fix genuinely exists:

```python
def _cancel_avatar_pump(self) -> None:
    task = self._avatar_pump_task
    if task is not None and not task.done() and task is not asyncio.current_task():
        task.cancel()
    self._avatar_pump_task = None
```

- **Self-cancel branch** (pump task's own `except AvatarError` ->
  `_attempt_avatar_recovery` -> `_cancel_avatar_pump`, called from *inside*
  the pump task): `task is asyncio.current_task()` is `True`, so `.cancel()`
  is skipped; only the reference is cleared. Correct — the task is already
  unwinding via its own `except AvatarError` clause and doesn't need
  self-cancellation to finish.
- **External-cancel branch** (a concurrent `_drive_avatar_audio`/
  `_safe_avatar_call` push-audio/flush failure calling recovery from the
  main `_speak` task, or `aclose()` during session teardown, while the pump
  task is a genuinely different, still-running task): `task is not
  asyncio.current_task()` is `True`, so `.cancel()` still fires as before.
  Correct.

## Independent verification (own test, not the dev's)

Wrote a standalone script (not part of the shipped test suite, run directly
against the real `apps_agent` source + the dev's own `FakeAvatar`/
`FakeTransport`/`FakeTts` doubles from `tests/orchestration/test_pipeline.py`,
reused only as fixtures — the crash scenarios, assertions, and timing are my
own, distinct from the dev's new regression test). Three scenarios:

### Scenario 1 — mid-stream crash as a real background task, un-shrunk real 2s delay, audio keeps flowing

Differs from the dev's own regression test in three ways: (a) crashes after
**2** frames instead of 1, (b) does **not** monkeypatch
`_AVATAR_RETRY_DELAY_S` — runs against the real, unmodified `2.0s` constant
to independently confirm the actual production delay is genuinely awaited,
not skipped, and (c) calls `_speak()` again afterward and asserts the exact
new byte content reaches `transport.push_audio_frame`, not just "no
exception."

Result: **PASS**.
- `start_avatar_session()` succeeds once, a real background pump task is
  created via `asyncio.ensure_future` (confirmed via `task.done() is
  False` immediately after).
- `frames()` crashes after 2 frames; `avatar.started` reaches 2 (exactly one
  retry); `transport.video_unpublished` becomes `True` at **~2.08-2.09s**
  real elapsed time — matching the spec's 2s delay almost exactly (not the
  ~100ms self-cancellation artifact the original D-1 defect produced).
- `degraded` session event, `provider_unreachable` alert, and a
  `hop="avatar"`/`error_code="AVATAR_UNAVAILABLE"` row all fire.
- `pipeline._avatar_pump_task` is `None` afterward — no dangling reference
  to a finished/cancelled task.
- A subsequent `pipeline._speak(99, "post-crash utterance")` call pushes
  the exact new TTS frames (`[b"post-crash-frame-A", b"post-crash-frame-B"]`)
  onto `transport.pushed_audio_frames` — audio genuinely keeps flowing
  post-degrade, confirmed by content identity, not just absence of an
  exception.

### Scenario 2 — external cancellation via `aclose()` while the pump is genuinely still running (never crashes on its own)

Built an avatar whose `frames()` never raises (an infinite generator with a
real `asyncio.sleep(0.05)` between frames), started a real session, confirmed
the background pump task is alive 0.2s later, then called `pipeline.aclose()`
from the "main" task — a genuinely different task than the pump.

Result: **PASS**. `pump_task.cancelled() is True` after `aclose()` (the
external-cancel path still works correctly — the fix did not regress the
legitimate teardown-cancels-a-hung-pump case), `avatar.closed is True`
(avatar resource released), and `pipeline._avatar_pump_task` is `None`
afterward (no dangling reference).

### Scenario 3 (adjacent probe, not part of the requested D-1 re-verification but directly answering the task's "does the self-clear path risk a double-recovery attempt later?" question) — concurrent recovery race

Constructed a scenario where a live `push_audio_frame` failure (from a
concurrently-running `_speak()` call) and the pump's own `frames()` crash are
timed to land within the same ~20ms window — the realistic shape of "the
underlying bitHuman process actually died," since both the frame stream and
the audio-push call share the same dead connection and would plausibly fail
near-simultaneously in production, not just in the single-failure-source
shape both my Scenario 1 and the dev's own regression test use.

**Finding (new, not a re-opening of D-1):** `_attempt_avatar_recovery` has
no mutual-exclusion guard. When two independent code paths both observe an
`AvatarError` close together and each call `_attempt_avatar_recovery()`
concurrently, both proceed through their own `_cancel_avatar_pump` -> `sleep
2s` -> `start_session()` sequence independently. In my probe run: the first
concurrent call degraded correctly (`avatar.started` reached 2, `degraded`/
`provider_unreachable` fired, video unpublished) — but the **second**
concurrent call's own `start_session()` retry (running ~2s later on its own
independent timer, against the same avatar double) succeeded, silently
**re-published a new video track and started a second live background pump
task** (`avatar.started` reached 3), with **no corresponding "recovered"
signal** sent anywhere (there isn't one in the current design — once
`degraded` fires, nothing ever tells the control plane/frontend the video
came back). End state observed: `transport.video_unpublished` stayed `True`
(the flag is sticky, only ever set by `unpublish_video_track()`) while a
video track and pump task were, in fact, quietly re-established — i.e. the
control-plane/frontend's last-known state (degraded, no video) can diverge
from the backend's actual state (a live, unannounced avatar again) after
this race. `pipeline._avatar_pump_task` and `_cancel_avatar_pump`'s own
task-comparison logic itself did **not** leave a stale/dangling *cancelled*
task reference in this run (that specific concern from the task brief is
clear) — the divergence is a design-level missing-mutex gap in
`_attempt_avatar_recovery`, not a reintroduction of D-1's self-cancellation
bug.

This is a genuinely production-reachable edge case (a real vendor-process
death plausibly fails both the frame stream and an in-flight audio push
around the same moment) but is a **narrower, lower-likelihood** case than
D-1's headline scenario, and FR-AVATAR-5 as quoted to me doesn't specify a
"recovered" signal to send even in the single-recovery-attempt case, so this
isn't a strict regression of anything the spec explicitly requires — it's a
new, disclosed observation. Recommend a follow-up (not blocking): guard
`_attempt_avatar_recovery` with an `asyncio.Lock` or an in-progress flag so
at most one recovery attempt runs at a time.

## D-2 — mypy claim, re-verified

Re-ran `mypy` scoped to the same 7 files named in the dispatch. Confirmed
**exactly 4 pre-existing errors remain in `pipeline.py`**, at the same line
numbers the dev's corrected decision-log entry claims (260, 278, 336×2 —
`"object" has no attribute "run_turn"` / `Name "LlmChunk" is not defined`),
none new, none avatar-related. Whole-project `mypy` run independently
confirms **22 errors in 6 files** total (matches both the original and
corrected claims). D-2's correction is accurate.

## Full regression, independently re-run

- `pytest -q --cov=avatar_agent`: **210/210 passed**, coverage **94.04%**
  (matches dev's claim exactly — up from the prior pass's 209/210 by
  exactly the one new regression test).
- `ruff check .`: clean.
- `mypy` (whole project): **22 errors in 6 files** — matches claim.
- `lint-imports` (import-linter): **3/3 contracts kept, 84 files, 246
  dependencies** — matches claim, unchanged.

## Traceability matrix

| Item | Scenario(s) tested | Result | Evidence |
|---|---|---|---|
| D-1 self-cancel fix (`asyncio.current_task()` comparison) | Code trace of both branches; own fresh test (2-frame crash, real un-shrunk 2s delay, post-crash `_speak()` audio-flow check) | PASS | Scenario 1 above |
| D-1 external-cancel path not regressed | Own fresh test: `aclose()` from a genuinely different task while pump is alive and never crashes on its own | PASS | Scenario 2 above |
| D-1 self-clear path — dangling reference / double-recovery risk | Own fresh test: concurrent push-audio failure + pump crash near-simultaneously | PASS-WITH-CAVEAT — no dangling *cancelled*-task reference, but a real missing-mutex race exists in `_attempt_avatar_recovery` itself (new finding, non-blocking) | Scenario 3 above |
| D-2 mypy-claim accuracy | Re-ran `mypy` scoped to the 7 touched files | PASS — claim accurate | mypy re-run above |
| Full regression (pytest/ruff/mypy/import-linter) | Independently re-run, not trusting dev's reported numbers | PASS — all match claims exactly | Full regression section above |

## Defects / findings

**None blocking.** One new, non-blocking finding:

### F-1 (Low/Moderate, informational — not gating this retry's verdict)

**File:** `apps/agent/src/avatar_agent/orchestration/pipeline.py`,
`_attempt_avatar_recovery` (line ~477).

**Originating phase:** Phase 5 (BL-018) — pre-existing in the new
avatar-lifecycle code since its introduction, previously masked by D-1 (a
concurrent recovery attempt from the pump task used to just die instantly to
the self-cancellation bug, so the race window this finding describes could
never actually complete before the fix).

**What was expected:** not explicitly specified by FR-AVATAR-5, but
implicitly: at most one recovery attempt should determine the session's
avatar-video state at a time, so the control plane's `degraded` signal
stays consistent with the backend's actual video-publish state.

**What actually happened:** `_attempt_avatar_recovery` has no
reentrancy guard. Two independent triggers (a live `push_audio_frame`/
`flush` failure from `_speak`'s call path, and the frame-pump's own stream
crash) firing within roughly the same tens-of-milliseconds window can each
run an independent retry-then-(degrade-or-recover) sequence concurrently.
Observed in my Scenario 3 probe: one attempt correctly degraded (video
unpublished, `degraded` event sent), while the other — running its own
independent `start_session()` retry ~2s later against a double that had by
then recovered — succeeded, silently re-publishing a new video track and
starting a second background pump task with no corresponding signal telling
the control plane/frontend the video is back. Net effect: the frontend's
"no avatar video" banner (driven by the `degraded` event / video
unsubscribe) can remain shown to the user even though the backend has, in
fact, silently re-established a live avatar video track.

**Severity:** Low/Moderate — requires two independent avatar-related
failures within a narrow, timing-dependent window (a real vendor-process
death plausibly causes this, but it's still a narrower, less certain trigger
than D-1's single-failure headline scenario, and FR-AVATAR-5 as quoted to me
doesn't name a "recovered" signal at all, so no explicit requirement is
violated). Not blocking this retry's verdict.

**Suggested direction (not a fix, for nexus-dev's judgment):** guard
`_attempt_avatar_recovery` with an `asyncio.Lock` (or an in-progress
boolean) so a second concurrent call either no-ops or awaits the first
attempt's outcome rather than running its own independent retry sequence.

## Overall verdict: **PASS-WITH-CAVEATS**

D-1 is genuinely fixed for both the case it was filed against (a mid-session
crash on the pump's own currently-executing background task, self-cancelling
before ever recovering — confirmed fixed via an independent test using a
different crash point and the real, un-shrunk 2s delay) and the adjacent
case the fix must not have broken (a genuinely external caller — `aclose()`
during teardown — still correctly cancels a still-running pump task).
D-2's corrected mypy claim is accurate (independently re-confirmed: exactly
4 pre-existing `pipeline.py` errors, same line numbers, none new). Full
regression (pytest 210/210 @ 94.04%, ruff clean, mypy 22/6 unchanged,
import-linter 3/3 kept) independently matches the dev's claims exactly.

The single new finding (F-1, a missing-mutex race in
`_attempt_avatar_recovery` when two independent failure paths trigger
recovery concurrently) is real and worth a follow-up, but is narrower/lower-
likelihood than D-1's headline scenario and isn't a violation of any
explicit FR-AVATAR-5 wording quoted to me — it does not block Phase 5 from
closing on my recommendation, but should be logged as a backlog follow-up
item rather than silently dropped.

Recommend: Phase 5 (BL-018) can advance past this QA retry. F-1 should be
tracked (e.g. a new low-priority backlog item or a note in the plan doc) for
a future pass, not re-dispatched to `nexus-dev` as a blocking retry.
