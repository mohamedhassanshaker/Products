# QA Report - Phase 4 Conversation Captions (BL-017), Screen 10

- Scope: apps/web/projects/conversation live-captions addition (LiveKitRoomService
  transcription subscription + Screen 10 caption overlay/toggle). NFR-4 accessibility
  treated as a first-class requirement, not decorative. Full Phase 4 regression
  (Jest/ESLint/ng build) independently re-run per dispatch.
- Timestamp: 2026-08-19T13:35:00Z
- Environment: ng serve conversation --port 4300 (real Angular dev server, real
  Chromium via a one-off Playwright script, installed to the QA scratchpad only,
  not added as a permanent dependency). No live LiveKit server, Postgres, or
  apps/agent process was reachable in this sandbox (same carried-forward
  environment gap as every prior Phase 1-3 QA pass).
- Disclosed stub: since no live LiveKit/agent server exists, STT partials/finals
  were simulated by directly driving LiveKitRoomService's own signals
  (_connectionState, _hasAvatarVideo, _captionText, _captionsAvailable, _muted)
  via ng.getComponent() on the real, compiled, running app - the same signals
  RoomEvent.TranscriptionReceived's handler sets in production, so the
  overlay/toggle/aria-live rendering path under test is the real one; only the
  upstream event source is faked. One real-WS attempt was also let run to confirm
  the failure path doesn't corrupt the UI (see D-1's discovery below) - it fails
  fast (ERR_UNSAFE_PORT/serverUnreachable) and the console errors captured are a
  stub artifact, not a product defect.
- Full regression independently re-run (not just re-reading the dev's claim):
  pnpm --filter @liveavatar/web test:cov -> 43/43 suites, 288/288 tests (matches
  claim exactly). pnpm --filter @liveavatar/web lint -> clean, 0 problems.
  ng build admin and ng build conversation -> both clean (only a pre-existing,
  unrelated "@liveavatar/contracts is not ESM" CommonJS-optimization warning on
  both, not an error, not new this phase).

## Traceability matrix

| Requirement | Scenario | Result | Evidence |
|---|---|---|---|
| FR-CALL-3 golden path - captions render from STT partials/finals, update live | Drove _captionText through two successive values while connected | PASS (mechanism) / BLOCKED end-to-end (D-1) | screenshots/03-caption-partial-1.png -> 04-caption-updated-live.png, distinct text confirmed via DOM read |
| FR-CALL-3 toggle default on | Fresh component instance, captionsOn initial value | PASS | call-page.component.ts line 66 signal(true); screenshot 02 shows toggle already "Captions on" pre-interaction |
| FR-CALL-3 toggle keyboard/SR discoverable | Tab from page load reaches the toggle in 2 tabs (Mute -> Captions); aria-pressed true/false; accessible name is visible text "Captions on"/"Captions off", not a bare icon | PASS | screenshots/05-keyboard-focus-captions-toggle.png (visible focus ring); console dump: aria-pressed true -> false on toggle |
| NFR-4 aria-live notifies SR users of new caption text | .la-call__captions carries aria-live="polite" | PASS | Playwright getAttribute = polite |
| FR-CALL-3 "If STT down, hide captions and show 'Captions unavailable.'" | Forced captionsAvailable=false while connected | PASS (template logic) / FAIL (wiring, D-2) | screenshots/08-captions-unavailable-fallback.png shows correct fallback text when manually forced; livekit-room.service.ts never sets _captionsAvailable to false anywhere in real code, confirmed by full-file read and by livekit-room.service.spec.ts (no test exercises a false transition) |
| Screen 10 states without an active STT stream (connecting/reconnecting) don't render captions incorrectly | connectionState cycled through connecting -> connected -> reconnecting | PASS | Caption element count = 0 in both connecting and reconnecting, screenshots 09/10 |
| Muted state doesn't break captions | _muted.set(true) while connected+captioned | PASS (no crash/incorrect render) | Caption element count = 1, screenshot 11 |
| Phone-width (375px) caption/control-bar/avatar overlap | Viewport resized to 375x667 | PASS | screenshots/12-phone-375-connected-with-caption.png; caption bottom=571, controls top=587 - no overlap, 16px clearance |
| Contrast (WCAG 2.2 AA >= 4.5:1) | Computed style of caption box | PASS | bg rgba(0,0,0,0.75), text rgb(255,255,255) - even against a worst-case pure-white video frame behind the 75%-opacity black, contrast approx 10:1 |
| Caption text never sent to an extra remote service (FR-CALL-3) | Grep for any HTTP/network call touching captionText/captionsAvailable | PASS | Only 4 files reference these signals (service, its spec, call-page template, its spec) - no PublicApiService/HTTP call anywhere in the path |
| UX_GUIDELINES section 12 placement/behavior contradiction check | Read section 8.1 Phase 3 table + sections 12.1/12.7 re: captions slot | PASS (no contradiction) | 12.1 step 4 reserved the control-bar slot next to mute (honored, screenshot 05); 12.7 called captions "the first candidate for an optional side/overlay panel" as a forward-looking note, not a mandate - a bottom-anchored overlay is a defensible, not-contradicting interpretation |
| Cross-phase: agent runtime actually publishes STT transcriptions onto the room's transcription channel the JS SDK listener depends on | Read apps/agent/src/avatar_agent/adapters/transport/livekit.py, orchestration/pipeline.py, entrypoint.py; grepped whole apps/agent tree for publish_transcription/transcription | FAIL - D-1, Blocking | See defect below |
| Full regression (Jest/ESLint/ng build) | Independently re-run, not re-quoted from the dev's own numbers | PASS | 43/43 suites, 288/288 tests; lint clean; both builds clean |

## Defects

### D-1 (Blocking, cross-phase - BL-016 agent runtime, surfaced by BL-017's frontend claim)

What was expected: The decision log and livekit-room.service.ts's own doc comment
claim the caption data path is real end-to-end: STT partials/finals flow from the
agent to the room via rtc.LocalParticipant.publish_transcription (referenced by
name in the frontend code comment, pointing at
apps/agent/src/avatar_agent/adapters/transport/livekit.py), and the JS SDK's
RoomEvent.TranscriptionReceived decodes that. FR-CALL-3 requires captions to
actually render from live STT output.

What actually happened: apps/agent's LiveKitTransportAdapter
(adapters/transport/livekit.py) only implements publish_audio_track (TTS output)
and close - there is no publish_transcription method, no reference to it, and no
reference to LiveKit's transcription/data channel anywhere in the entire
apps/agent tree (grep -rn "publish_transcription|transcription" apps/agent/src
returns zero hits outside STT's own internal port/adapter naming). Separately,
orchestration/pipeline.py's on_final_utterance (the method that would receive STT
finals) is never called from anywhere in entrypoint.py/worker.py - there is no
audio-track subscription/STT-streaming wiring at all yet, so STT never even
reaches the pipeline, let alone the room. The result: in the actual, current
codebase, RoomEvent.TranscriptionReceived can never fire in production, because
nothing publishes to it. The caption overlay/toggle built this phase is fully
functional and well-tested against a payload that nothing in this codebase
currently produces.

Repro: grep -rn "publish_transcription" apps/agent/src -> no matches.
grep -n "on_final_utterance" apps/agent/src/avatar_agent/entrypoint.py
apps/agent/src/avatar_agent/worker.py -> no matches. Read
apps/agent/src/avatar_agent/adapters/transport/livekit.py in full (35 lines) -
confirms only publish_audio_track/close exist.

Originating phase: cross-phase - BL-016 (agent runtime/LiveKit glue, Phase 4
Python side) never implemented the STT-ingest -> transcription-publish half of
the loop; BL-017's frontend decision-log entry inaccurately describes this as
already wired ("the standard client decode of the ... topic livekit-agents/
rtc.LocalParticipant.publish_transcription publishes to"), which is not
implemented and should be corrected, not asserted as fact. The parallel QA pass
on the Python agent runtime should independently confirm/own the root cause;
this report surfaces it because it directly determines whether BL-017, as
delivered, can function at all.

Severity: Blocking - the entire captions feature (FR-CALL-3, part of NFR-4) has
no live data source today. This is a functional gap, not a frontend defect; the
frontend implementation itself is correct and ready once the agent-side
publisher exists.

### D-2 (Moderate)

What was expected: FR-CALL-3 verbatim: "If STT down, hide captions and show
'Captions unavailable.'" - a real, reachable UI state.

What actually happened: LiveKitRoomService._captionsAvailable is initialized true
and is the only place set(...) is ever called on it besides the constructor -
inside the TranscriptionReceived handler, which only ever sets it true (never
false). No code path anywhere sets it false. The template's fallback branch
(liveKit.captionsAvailable() ? ... : 'Captions unavailable.') is provably correct
when driven directly (screenshot 08), but is dead code in the shipped product -
the "STT down" case can never surface to a real user. This is disclosed in the
service's own doc comment ("currently only reflects room connectivity... no
dedicated real-time STT health channel exists to the browser yet") as a known
gap, but it is still a real, user-facing divergence from the spec's explicit
sentence, worth tracking as a defect rather than only a comment.

Repro: Read livekit-room.service.ts in full; grep -n "_captionsAvailable" shows
exactly 2 call sites (constructor default, .set(true) in the transcription
handler) and zero .set(false) sites. livekit-room.service.spec.ts has no test
exercising a false transition either.

Originating phase: BL-017 (frontend) - the gap is that no STT-health signal was
plumbed from the agent/control-plane to the browser this phase; compounded by D-1
(no STT is running at all yet, so this state is moot until D-1 is fixed).

Severity: Moderate - spec-explicit behavior is currently unreachable, but not
crash-causing, and it is an honestly-disclosed gap rather than a silent one.

### D-3 (Low/Moderate)

What was expected: A caption overlay that's a coherent, non-confusing visual
element per NFR-4's spirit ("captions available on Screen 10").

What actually happened: The caption container renders (semi-opaque black rounded
box) whenever captionsOn() && connectionState() === 'connected', regardless of
whether any caption text has actually arrived yet - producing a small, empty,
content-less floating dark pill above the control bar the moment the call
connects (screenshot 02-connected-no-caption-yet.png). Combined with D-1 (no
agent-side STT publisher exists yet), this empty box would currently be the
permanent, entire-call visual state for every real call today, not a brief
transient - it could read as a rendering glitch rather than "no caption yet." A
guard on non-empty captionText() (or on captionsAvailable()) before rendering the
container would avoid this.

Repro: screenshots/02-connected-no-caption-yet.png - visible dark rounded
rectangle, no text, above the control bar, immediately after connectionState
flips to connected and before any captionText value is set.

Originating phase: BL-017 (frontend).

Severity: Low in isolation (cosmetic-only, no accessibility harm - the aria-live
region is simply empty, which announces nothing, not incorrect information) but
its real-world frequency (effectively 100% of calls, given D-1) pushes it toward
Moderate in practice.

## Non-defect observations (disclosed, not gating)

- Driving a genuine (bad) LiveKit WebSocket URL surfaced that a connect()
  failure has no dedicated error/retry UI state - the app silently settles into
  disconnected with no banner. This predates this phase's file footprint (it's in
  connect()'s existing lifecycle, not the captions change) and is out of this
  dispatch's scope; noting it for whichever future pass owns Screen 10's
  connect-failure handling, not as a Phase 4 captions defect.
- Docker/Postgres/LiveKit remain unreachable in this sandbox, consistent with
  every prior phase's disclosed environment gap - the LiveKit WebSocket protocol
  and a live apps/agent process have still never been exercised end-to-end
  anywhere in this project's QA history.

## Verdict

FAIL - not ready to close BL-017. The Screen 10 frontend implementation itself
(overlay, toggle, aria-live, keyboard/SR discoverability, contrast, phone layout,
state-machine correctness, full regression) is solid and independently verified
correct. However, D-1 is blocking: the feature has no real data source in the
current codebase because the agent runtime never publishes STT transcriptions
onto the room's transcription channel, so live captions cannot function in any
real deployment today. Recommend: retry nexus-dev on the Python agent side (or
route via the parallel Python-agent QA pass, whichever completes first) to wire
STT ingest -> on_final_utterance/partial-forwarding -> a real
publish_transcription (or LiveKit Agents' built-in transcription-forwarder) call,
and correct the frontend's decision-log/comment claiming this already exists;
then D-2 (a real STT-health signal wired to captionsAvailable) and D-3 (don't
render an empty caption container) as a smaller follow-up batch. No frontend
rework is needed for D-1's fix itself, only re-verification once the agent side
actually publishes.
