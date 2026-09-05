# QA Report — Phase 5 (BL-018): bitHuman Avatar Adapter

**Scope:** `apps/agent` only — IAvatarProvider port, bitHuman adapter, LiveKit
transport avatar-video methods, registry wiring, and `orchestration/pipeline.py`
avatar lifecycle (`_speak`, `start_avatar_session`, `_attempt_avatar_recovery`,
`_publish_avatar_video`, `_pump_avatar_frames`, `aclose`), plus `entrypoint.py`'s
AVATAR_NOT_FOUND fatal path. No control-plane/TS or frontend changes this phase.

**Environment:** Windows sandbox, `apps/agent/.venv` (Python 3.13.14), real
installed `bithuman==1.10.7` SDK (no GPU/model asset/network egress to
`api.bithuman.ai` — same disclosed limitation carried since this package was
added). No live LiveKit server reachable in this sandbox (unchanged,
carried-forward gap since Phase 1). All verification below is against the
real, current source, run directly, not against the dev's description of it.

## Traceability matrix

| Requirement | Scenario(s) tested | Result | Evidence |
|---|---|---|---|
| FR-AVATAR-1 (unknown avatar_id fatal / config problem non-fatal) | Real `_resolve_model_path` path-traversal probe (7 payloads); real `build_pipeline` avatar resolution; fresh test driving a REAL `ConversationPipeline` (not mocked) whose avatar raises `AVATAR_NOT_FOUND` from `start_session()` through real `entrypoint.handle_job` | PASS | See "Verification detail" §1, §4 below |
| FR-AVATAR-3 (avatar driven by the same TTS audio that reaches the room; frames published) | Traced `_speak` call path by hand; fresh test proving byte-identical PCM objects reach both `transport.push_audio_frame` and `avatar.push_audio_frame`; fresh test proving `frames()` is genuinely consumed and forwarded to `transport.publish_video_track`/`push_video_frame`, with a real (non-hardcoded) measured `first_frame_ms` | PASS | See §2, §3 below |
| FR-AVATAR-4 (`hop="avatar"`, `first_frame_ms` metric) | Fresh test asserting `control_plane.send_hops` receives a `hop="avatar"` row whose `first_frame_ms` equals the adapter's own genuinely time-measured value | PASS | See §3 below |
| FR-AVATAR-5 (avatar crash: retry once after 2s, then unpublish video + degrade, audio continues) | (a) Start-time failure -> retry -> recovers: re-ran dev's own real-timed (~2s) test, confirms good. (b) Start-time failure -> retry -> still fails -> degrade: re-ran dev's own test, confirms good. (c) **Mid-session crash while `_pump_avatar_frames` is running as its own real background task (the actual "avatar worker dies mid-session" case)**: fresh test — **FAILS**. See defect D-1 below. | **FAIL** | See §3/D-1 below |

## Verification detail

### §1 — AI-boundary / vendor-SDK isolation
`grep`-verified: `bithuman`/`bithuman.exceptions` are imported only in
`adapters/avatar/bithuman.py` (plus the test file, for exception-type
assertions only) across the whole `apps/agent` and `apps/api` trees.
`import-linter` independently re-run: **3/3 contracts kept, 84 files, 246
dependencies** — `vendor-sdk-isolation` already lists `bithuman` in its
forbidden-modules set. No unlisted dependency found; `bithuman` is the one
new dependency this phase adds and is consistent with the ADR's already-used
vendor-SDK maturity bar (same class as Deepgram/ElevenLabs/faster-whisper —
actively maintained, real production adoption, licensing consistent with
already-accepted vendor SDKs).

### §2 — bitHuman SDK-shape claims, independently re-verified
Ran `inspect.signature`/`dir()` myself against the real installed
`bithuman==1.10.7` package (not trusting the dev's own inspection):
- `AsyncBithuman.create(*, model_path=None, token=None, api_secret=None, ...)` — confirmed.
- `push_audio(self, data: bytes, sample_rate: int, last_chunk: bool = True)` — confirmed.
- `flush(self) -> None`, `run(self, ...) -> AsyncIterator[VideoFrame]`, `stop(self) -> None` — confirmed.
- `VideoFrame.rgb_image` / `.has_image` — confirmed present.
- `bithuman.exceptions.{BithumanError, ModelNotFoundError, ModelLoadError, ...}` — confirmed, and `ModelNotFoundError`/`ModelLoadError`/other `ModelError` subclasses map correctly onto `AvatarError(code="AVATAR_NOT_FOUND")` vs `AVATAR_UNAVAILABLE` in `bithuman.py`.
- Read `runtime_async.py`'s own docstring: `model_path` is literally described as "the path to the avatar model" (a local filesystem path) — this confirms the adapter's own flagged assumption (`avatar_id` -> `{endpoint_url}/{avatar_id}.imx`) is a **reasonable, not risky**, interpretation of a genuinely file-path-shaped SDK parameter, not a wild guess. The exact tenant-asset-addressing convention is still unverified against a real deployed model file/directory layout (disclosed by dev, not silently accepted) — this remains an open item for a GPU-capable smoke-test environment, not a QA-blocking defect.

Path-traversal guard, tested directly with `../../etc/passwd`, `/etc/passwd`,
`a/../../b`, a null-byte payload, a Windows absolute path, and an empty
string — **all 7 rejected** with `AVATAR_NOT_FOUND` before any filesystem
path is constructed; only a bare `[A-Za-z0-9_-]+` token is accepted. PASS.

### §3 — Fresh, independent integration tests (not reusing dev's fakes/tests)
Wrote a standalone test module (`QaAvatar`/`QaTransport`/`QaTts`/`QaOrchestrator`/
`QaControlPlane` — all new, not `FakeAvatar`/`FakeTransport` from
`tests/orchestration/test_pipeline.py`) driving the real `ConversationPipeline`
and, for the AVATAR_NOT_FOUND scenario, the real `entrypoint.handle_job`.

- **`_speak` wiring is genuinely end-to-end, not two disconnected paths.**
  Confirmed the exact same PCM chunk objects (`is` identity, not just `==`)
  produced by one `tts.synthesize_stream()` call reach both
  `transport.push_audio_frame` and `avatar.push_audio_frame`, in the same
  order, and `avatar.flush()` is called exactly once at end-of-utterance.
  PASS.
- **Avatar frames genuinely reach the transport.** With a `frames()`
  implementation that has a real 50ms `asyncio.sleep` before each of 4
  frames (so `first_frame_ms` is a real measured value, not a stub
  constant), confirmed: `transport.publish_video_track` is called with the
  first frame's real dimensions, all 4 frames land on
  `transport.push_video_frame` in order (frame 0 published synchronously by
  `_publish_avatar_video`, frames 1-3 via the background
  `_pump_avatar_frames` task), and `control_plane.send_hops` receives a
  `hop="avatar"` row whose `first_frame_ms` (~30-500ms window asserted)
  **equals** the value the adapter itself measured via its own
  `time.monotonic()` clock — proving this is a real, propagated
  measurement, not a coincidence of two independently-stubbed numbers.
  PASS.
- **FR-AVATAR-5 mid-session crash — FAIL, see D-1.**

### §4 — AVATAR_NOT_FOUND fatal / non-fatal wiring, re-verified with a REAL pipeline
Dev's own `test_handle_job_fails_the_session_when_the_avatar_id_is_unknown`
mocks the entire `ConversationPipeline` with a `MagicMock` whose
`start_avatar_session` is scripted with `side_effect=AvatarError(...)` — it
only proves `entrypoint.py`'s own `try/except` shape, not that a REAL
`ConversationPipeline.start_avatar_session()` calling a REAL avatar
adapter's `start_session()` actually propagates `AVATAR_NOT_FOUND` all the
way up. I closed that gap: built a fresh test that monkeypatches only
`resolve_stt`/`resolve_llm`/`resolve_tts`/`resolve_avatar` (the vendor
factories) and lets `entrypoint.build_pipeline` construct a **real**
`ConversationPipeline`, whose avatar's `start_session()` raises
`AvatarError(code="AVATAR_NOT_FOUND")`. Result: `handle_job` correctly
sends a single `type="failed", error_code="AVATAR_NOT_FOUND"` event and
never starts `run_consumer_loop`. **PASS** — the fatal path is genuinely
wired end-to-end, not just at the entrypoint's own exception-handling
surface.
Construction-time issues (missing credential, malformed `avatar_id`)
independently re-confirmed via dev's own `build_pipeline` tests (re-run,
still green) to collapse to `pipeline._avatar is None`, the same non-fatal
path `FactoryLoadError` already used — consistent with FR-AVATAR-5.

## Defects

### D-1 (BLOCKING, FR-AVATAR-5) — mid-session avatar crash self-cancels its own recovery task, so the video track is never unpublished and the session is never marked degraded

**File:** `apps/agent/src/avatar_agent/orchestration/pipeline.py`, `_pump_avatar_frames` (line ~565) / `_attempt_avatar_recovery` (line ~477) / `_cancel_avatar_pump` (line ~567).

**Originating phase:** Phase 5 (BL-018) — this is new code (`_pump_avatar_frames`, `_attempt_avatar_recovery`, `_cancel_avatar_pump`) introduced by this dispatch.

**What was expected:** FR-AVATAR-5: "if the avatar worker dies mid-session
... retry start once (2s delay); second failure -> keep audio-only,
unpublish video, mark the session `degraded`." The dispatch's own decision
log and dev's own test docstring (`test_a_mid_stream_avatar_crash_...`)
explicitly claim this is implemented and tested for the *mid-stream*
crash case, i.e. when `frames()` raises while a previously-started avatar
session's frame-pump task is actually running in the background (the
normal production shape, since `_publish_avatar_video` starts the pump via
`self._avatar_pump_task = asyncio.ensure_future(self._pump_avatar_frames(frame_iter))`).

**What actually happened:** When `_pump_avatar_frames` is running as that
real background task and its `frame_iter` raises `AvatarError`, the
`except AvatarError` handler calls `await self._attempt_avatar_recovery()`.
That method's first action is `self._cancel_avatar_pump()`, which — because
`self._avatar_pump_task` **is the currently-executing task itself** at this
point — calls `.cancel()` on the task from within its own coroutine. Python
delivers that pending cancellation at the very next `await`, which is
`await asyncio.sleep(_AVATAR_RETRY_DELAY_S)` two lines later inside
`_attempt_avatar_recovery`. Since nothing in `_attempt_avatar_recovery` (or
in `_pump_avatar_frames`'s `except AvatarError` clause, which has already
been entered) catches `CancelledError`, the task terminates as
**cancelled** at that point — before it ever calls `avatar.start_session()`
again, before sending the `degraded` session event, before sending the
`provider_unreachable` alert, before recording the `hop="avatar"`
`error_code="AVATAR_UNAVAILABLE"` row, and — the user-visible failure mode
— **before ever calling `transport.unpublish_video_track()`**. The result in
production: a crashed avatar leaves a stale, no-longer-updating video track
published indefinitely (the frontend's Screen 10 never gets the
`TrackUnsubscribed` event FR-AVATAR-5/Phase 3's banner logic depends on),
the session is silently never marked `degraded`, and no alert fires.

Confirmed via a dedicated debug script instrumenting the actual
`asyncio.Task` object: after the crash, `task.done() is True` and
`task.cancelled() is True` within ~100ms (not the 2s the code claims to
wait), and `transport.video_unpublish_calls` stays at `0` even after
waiting 5+ real seconds.

**Why the existing test suite missed this:**
`tests/orchestration/test_pipeline.py::test_a_mid_stream_avatar_crash_triggers_recovery_and_unpublishes_video`
constructs its `CrashingAvatar` with `start_raises=AvatarError(...)` set
**unconditionally** (every call to `start_session()` raises, not just the
first) — so in that test, the very first `pipeline.start_avatar_session()`
call already fails and degrades *before* `_publish_avatar_video`/the
background pump task is ever created; the test's later polling loops for
`video_track_published`/`video_unpublished` pass vacuously (the degrade
already completed synchronously inside the initial call, and
`FakeTransport.unpublish_video_track` sets `video_unpublished = True`
unconditionally even with no track ever published). The crash-while-
actually-pumping-in-the-background scenario this test's own docstring
claims to cover is never actually reached.
`tests/orchestration/test_pipeline.py::test_pump_avatar_frames_recovers_on_a_mid_stream_crash`
calls `await pipeline._pump_avatar_frames(_frames())` **directly** (not via
`asyncio.ensure_future`), so `self._avatar_pump_task` is never set to that
coroutine at all, and the self-cancellation this defect depends on can
never trigger in that test either. Coverage evidence corroborates this: the
independently re-run coverage report shows `pipeline.py` lines 562
(`except asyncio.CancelledError: raise`) and 569
(`self._avatar_pump_task.cancel()`) as **uncovered** — i.e. no existing
test ever exercises cancelling a real, still-running pump task.

**Repro:** Fresh QA test (`QaAvatar` with `frame_delay_s=0.01, num_frames=5,
crash_after_n_frames=1, fail_starts_after=1` — i.e. the *first*
`start_session()` succeeds, a real video track gets published, and only
the *second* `frames()` call/subsequent starts fail) driven through the
real `pipeline.start_avatar_session()` → real background pump task →
real crash → wait up to 6s real time for
`transport.video_unpublish_calls > 0`. Assertion
`transport.video_unpublish_calls == 1` fails (`0` observed). This test
artifact was written under a scratch directory during this QA pass and has
been deleted afterward per test-hygiene practice (not left in the repo);
the repro steps above are sufficient to reconstruct it.

**Severity:** Blocking — this is the exact scenario FR-AVATAR-5 names
("if the avatar worker dies mid-session") and the dispatch's own decision
log claims is implemented; it silently fails in the one case that matters
most (a live, already-working avatar crashing), while all the "fails at
start" variants (already covered by dev's other tests) work correctly.

**Suggested direction (not a fix, for nexus-dev's judgment):** avoid
self-cancelling the currently-running pump task from within its own
exception handler — e.g. only call `_cancel_avatar_pump()` when recovery is
invoked from a context other than the pump task itself (compare
`asyncio.current_task()` against `self._avatar_pump_task`, or simply have
`_pump_avatar_frames`'s own `except AvatarError` clear
`self._avatar_pump_task` to `None` before awaiting recovery, since the task
finishing is implicit once its own coroutine returns).

### D-2 (Low, documentation/verification-accuracy only, not a functional defect) — dev's mypy regression claim is inaccurate for a file this phase touched

**File:** `apps/agent/src/avatar_agent/orchestration/pipeline.py`; claim is in `docs/NEXUS_STATE.md`'s Phase 5 decision-log entry.

**Originating phase:** Phase 5 (BL-018), verification-claim only — the underlying mypy errors themselves pre-date this phase (Phase 4 tool-calling/orchestrator typing) and are not new.

**What was expected:** the decision log claims "`mypy` scoped to the 7
files this phase touched is clean (whole-project count moved from Phase
4's disclosed 17 to 22, entirely in files this dispatch never touched —
`openai.py`/`anthropic.py`/`google.py`/`graph_pydantic_ai.py`)".

**What actually happened:** independently re-ran
`mypy` scoped to exactly the 7 files named in the dispatch
(`ports/avatar.py`, `adapters/avatar/bithuman.py`, `ports/transport.py`,
`adapters/transport/livekit.py`, `registry/registry.py`,
`orchestration/pipeline.py`, `entrypoint.py`) and found **4 pre-existing
errors in `pipeline.py`** (lines 260, 278, 336×2 — `"object" has no
attribute "run_turn"`/`Name "LlmChunk" is not defined` — from the
`orchestrator: object`-typed constructor param and an unimported
`LlmChunk` type, both dating to Phase 4's tool-calling work).
`pipeline.py` is unambiguously one of the 7 files this phase touched
(the entire avatar lifecycle was added to it) and is not in the "never
touched" list the decision log names. The whole-project total (22, up
from 17) is numerically correct and I confirmed none of the *new* count is
attributable to avatar code specifically — but the claim "scoped to the 7
files this phase touched is clean" is false as literally written.

**Severity:** Low — no functional impact (these are pre-existing
type-stub/generic-typing gaps unrelated to the avatar feature, already
disclosed as "expected given the logical-role architecture" in Phase 4's
own decision log), but it is an inaccurate verification claim that a
Final-Review pass should not take at face value without re-checking.

## Full regression, independently re-run

- `pytest -q --cov=avatar_agent`: **209/209 passed**, coverage **94.04%** —
  matches dev's claim exactly (per-file breakdown also matches:
  `bithuman.py`/`livekit.py`/`ports/avatar.py`/`ports/transport.py` all
  100%, `pipeline.py` 95%, `entrypoint.py` 90%).
- `ruff check .`: clean, matches claim.
- `mypy` (whole project): **22 errors in 6 files**, matches the claimed
  count exactly, but see D-2 above re: the "which files" breakdown.
- `import-linter`: **3/3 contracts kept, 84 files, 246 dependencies** —
  matches claim exactly.

## Overall verdict: **FAIL**

FR-AVATAR-1, FR-AVATAR-3, and FR-AVATAR-4 are genuinely, verifiably wired
end-to-end — `_speak`'s avatar wiring is real, not a repeat of Phase 4's
"built but never called" bug class; I traced and independently tested the
actual call path myself and it holds up. However, **FR-AVATAR-5's
headline scenario — the avatar dying mid-session — is broken by a
self-cancellation bug in the new avatar-lifecycle code**, meaning a crashed
avatar can leave a stale video track published indefinitely with no
degrade signal, which is worse for the end user than what a bare `try/except`
around a dead code path would produce (Phase 4's stub, which never even
attempted video). This blocks the phase from closing; recommend retrying
`nexus-dev` on `pipeline.py`'s `_attempt_avatar_recovery`/
`_cancel_avatar_pump` interaction, then a fresh QA pass re-verifying
specifically the mid-session-crash-as-a-real-background-task scenario
(not the at-start-failure variant, which already works) before Phase 5 can
close. D-2 (mypy-claim accuracy) is non-blocking and can be folded into the
same or a later pass.
