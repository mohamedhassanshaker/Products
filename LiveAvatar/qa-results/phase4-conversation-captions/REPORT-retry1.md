# QA Report - Phase 4 Conversation Captions (BL-017), Screen 10 - Retry 1

- Scope: re-verification of dev's claimed fixes for D-1 (frontend-visible half),
  D-2, and D-3 from the original QA pass
  (qa-results/phase4-conversation-captions/20260819T133500Z/REPORT.md). Full
  Phase 4 frontend regression independently re-run. Accessibility spot-check
  (no full redo) per dispatch scope.
- Timestamp: 2026-08-19T15:05:00Z (approx, this pass)
- Environment: `ng serve conversation --port 4300` (real Angular dev server,
  real Chromium via Playwright, one-off scratchpad install/reused from a
  prior session's scratchpad node_modules, not added as a permanent
  dependency). No live LiveKit server, Postgres, or apps/agent process was
  reachable in this sandbox (same carried-forward environment gap as every
  prior Phase 1-4 QA pass) - confirmed by attempting a real `wss://fake.invalid`
  connect() call, which correctly stalls in `connecting` (screenshot
  01-connecting-state.png) rather than crashing.
- Disclosed technique (stronger than the original pass's): since no live
  LiveKit/agent server exists, the real `CallPageComponent`/`LiveKitRoomService`
  were reached via genuine Angular in-app navigation (`Router.navigate` with
  router `state`, invoked through Angular DevTools' `ng.getComponent`/
  `ng.\u0275getRouterInstance` globals on the real running app - not a
  synthetic harness), and `RoomEvent.TranscriptionReceived`/`RoomEvent.Reconnecting`
  were fired as **real events on the real `Room` instance** created by
  `connect()` (`room.emit("transcriptionReceived", segments)` /
  `room.emit("reconnecting")`) - i.e. the actual event subscription registered
  in `LiveKitRoomService.connect()` is what receives and handles these events,
  not a hand-set signal. Only the upstream LiveKit server/transport itself is
  faked; the subscription -> handler -> signal -> template chain under test is
  the real, shipped code path. `_connectionState`/`_hasAvatarVideo` were
  directly signal-set only to simulate a successful `room.connect()` resolving
  (unreachable in this sandbox), which is the same class of disclosed stub as
  the original pass.
- Full regression independently re-run:
  `pnpm --filter @liveavatar/web test:cov` -> 43/43 suites, 292/292 tests
  (matches dev's claimed 292, up from 288). `pnpm --filter @liveavatar/web lint`
  -> clean, 0 problems. `ng build admin` and `ng build conversation` -> both
  clean (only the pre-existing, unrelated "@liveavatar/contracts is not ESM"
  CommonJS-optimization warning on both, unchanged from every prior phase).

## Traceability matrix

| Requirement / prior defect | Scenario | Result | Evidence |
|---|---|---|---|
| D-1 (frontend half): `RoomEvent.TranscriptionReceived` subscription still correctly wired | Fired a real `transcriptionReceived` event on the real `Room` instance created by `connect()`, with a genuine `TranscriptionSegment[]` payload | PASS | screenshots/03-caption-partial-1.png; `captionText()`/`captionsAvailable()` read back correctly from the component |
| D-1: caption text renders correctly | DOM `.la-call__captions` innerText read after the event fired | PASS | `"Hello, this is a live caption test."` matched exactly |
| D-1: caption updates live (second, distinct value) | Fired a second `transcriptionReceived` event with different text | PASS | screenshots/04-caption-updated-live.png; DOM text updated to the new value |
| D-1: `aria-live="polite"` present and correctly announces | Read `aria-live` attribute on the caption container | PASS | attribute value `polite` confirmed |
| D-2: `captionsAvailable` genuinely starts `false` on `connect()` | Read `liveKit.captionsAvailable()` immediately after `connect()` is invoked, before any transcription event | PASS | signal value `false` confirmed (was `true` in the original defect) |
| D-2: `captionsAvailable` flips `true` only on a real `TranscriptionReceived` event | Same event as above; read `captionsAvailable()` after | PASS | flipped to `true`, confirmed via the real event path, not a manually-set signal |
| D-2: "Captions unavailable." fallback genuinely reachable via a real state transition | Fired a real `reconnecting` event on the real `Room` (not a manually forced signal as the original pass did), then restored `connectionState` to `connected` without a new transcription | PASS | screenshots/05-reconnecting-captions-available-false.png (during reconnect), 06-captions-unavailable-fallback.png (fallback text after returning to connected with STT not re-proven) - DOM text exactly `"Captions unavailable."` |
| D-2 @ 375px: fallback text renders correctly at phone width | Same real-event-driven fallback, viewport 375x667 | PASS | screenshots/12-phone-375-captions-unavailable.png |
| D-3: caption container never renders as an empty, content-less box | Checked `.la-call__captions` element count and innerText immediately upon a fresh `connect()` -> `connected` transition, before any transcription event, at both viewports | PASS (see note below) | screenshots/02-connected-no-caption-yet.png, 07-fresh-connect-no-empty-box.png, 11-phone-375-pristine-no-empty-box.png - container is present but never empty; it immediately shows `"Captions unavailable."` (real text), never a blank shell |
| D-3: toggle-off hides the container even with valid caption text present | Set real caption text via a transcription event, then clicked the captions toggle off | PASS | screenshots/08-captions-toggled-off-text-hidden.png - 0 `.la-call__captions` elements while toggled off |
| Accessibility spot-check: captions toggle keyboard-reachable in 2 tabs, visible focus ring, correct accessible name/`aria-pressed` | Tabbed from a fresh page load/click-to-focus-body baseline | PASS, no regression | screenshots/09-keyboard-focus-captions-toggle.png, 13-keyboard-focus-recheck.png; focus order Mute -> Captions confirmed, `aria-pressed="true"` confirmed both via keyboard focus and direct attribute read |
| Accessibility spot-check: contrast unchanged | Read computed `background-color`/`color` of the caption container | PASS, no regression | `rgba(0,0,0,~0.75)` background, `rgb(255,255,255)` text - unchanged from the original pass's ~10:1 measurement |
| Full regression (Jest/ESLint/ng build) | Independently re-run | PASS | 43/43 suites/292/292 tests (up from 288, matches dev claim exactly); lint clean; both builds clean |

## Confirmed fixes (re-verified independently, not re-quoted from dev claim)

- **D-1 (frontend-visible half)**: `LiveKitRoomService`'s `RoomEvent.TranscriptionReceived`
  subscription (registered in `connect()`) genuinely receives and correctly
  handles a real transcription event fired on the real `Room` instance: caption
  text renders, updates live across two distinct values, and
  `aria-live="polite"` is present on the container so screen readers are
  notified of updates. This is the frontend's half of D-1 and it is solid; the
  Python/agent-side half (whether `apps/agent` now actually publishes onto this
  channel in production) is out of this report's scope and owned by the
  parallel Python-agent QA pass per the dispatch.
- **D-2**: `captionsAvailable` genuinely defaults `false` on every `connect()`
  (previously `true`, making the fallback unreachable) and only flips `true` on
  a real `TranscriptionReceived` event - confirmed via the actual event path,
  not a hand-set signal. It also correctly flips back to `false` on a real
  `Reconnecting` event, and the "Captions unavailable." fallback text was
  triggered via that real state transition (not by manually forcing the signal
  as the original pass had to), and displays correctly at both desktop and
  375px.
- **D-3**: the caption container never renders as an empty, content-less box.
  The specific defect reported originally (a floating dark pill with no text
  inside it) is genuinely gone at both viewports tested.

## New observation (not gating, flagged for the record)

Because `captionsAvailable` now correctly defaults `false` and the template's
fallback condition is `captionText() || !captionsAvailable()`, the direct,
intended consequence is that **"Captions unavailable." now renders immediately
on every single call**, the instant `connectionState` reaches `connected`,
before the agent's STT has had any real chance to publish its first
transcription (see screenshots 02/07/11, all captured immediately after a
fresh connected transition with zero elapsed STT time). This is not the
original D-3 defect (an empty box) recurring - the box always has real,
correct text in it - and it is explicitly anticipated and reasoned about in
`livekit-room.service.ts`'s own doc comment ("a brief false right after
connecting... is expected and correct, not a bug"). It is also a defensible,
literal reading of FR-CALL-3 ("if STT down, hide captions and show 'Captions
unavailable.'" - STT is, in fact, not yet proven up at that instant). Flagging
as a low-severity UX rough edge rather than a defect: once BL-016's agent-side
STT publisher is confirmed live (parallel QA pass), this should resolve to a
sub-second flash on every call rather than a persistent state, but that
duration has not been measured against a live agent in any sandbox to date
(same class of environment gap as D-1's agent-side half). If the STT-to-first-partial
latency turns out to be more than a second or two in production, a short grace
window before showing the fallback (e.g. only show "unavailable" if still
`false` N seconds after connecting) would be a low-cost follow-up worth
considering - not filed as a blocking defect here since it is a judgment call,
not a spec violation.

## Cross-reference: parallel Python-agent QA retry

`qa-results/phase4-agent-python/REPORT-retry1.md` independently confirms D-1's
agent-side half is genuinely fixed: `LiveKitTransportAdapter.publish_transcription`
is called with real STT partials/finals from the wired `run_stt_loop`, verified
with a real end-to-end trace test (fake STT input -> real
`publish_transcription` call recorded). Combined with this report's frontend
finding, **D-1 is now fully fixed end-to-end** across both halves - the
caption feature has a real, live data source in the current codebase, unlike
the original QA pass where it had none. This also means the "New observation"
above (an immediate "Captions unavailable." flash on connect) will actually
occur in production rather than being moot - worth the orchestrator noting,
though not gating per the reasoning above.

## Non-defect observations (carried forward, disclosed, not gating)

- Docker/Postgres/LiveKit remain unreachable in this sandbox, consistent with
  every prior phase's disclosed environment gap - the real LiveKit WebSocket
  protocol has still never been exercised end-to-end anywhere in this
  project's QA history. This retry's verification, like the original pass's,
  relies on firing real LiveKit SDK events on a real (but not
  network-connected) `Room` object plus real in-app Angular navigation - the
  strongest verification achievable without a reachable LiveKit
  server/Postgres/agent process.
- The connect()-failure-has-no-dedicated-error-UI observation from the
  original pass (pre-existing, out of BL-017's file footprint) is unchanged
  and still out of this dispatch's scope.

## Verdict

**PASS.** All three defects from the original QA pass are independently
confirmed genuinely fixed:

- D-1 (frontend-visible half): `RoomEvent.TranscriptionReceived` subscription
  correctly wired, caption text renders/updates live, `aria-live="polite"`
  present - confirmed via real events fired on the real `Room` instance, not
  hand-set signals. Combined with the parallel Python-agent QA's independent
  confirmation of the agent-side publish half, BL-017 now has a genuine,
  functional end-to-end data path.
- D-2: `captionsAvailable` genuinely defaults `false` and only flips `true` on
  a real `TranscriptionReceived` event; the "Captions unavailable." fallback
  is now reachable via a real state transition (reconnect), not just
  manually-forced, and renders correctly at both desktop and 375px.
- D-3: the caption container no longer renders as an empty, content-less box
  at any point tested, at either viewport.

Full regression independently re-run and matches the dev's claim exactly:
Jest 292/292 tests (up from 288), ESLint clean, `ng build admin`/`ng build
conversation` both clean. Accessibility spot-check (keyboard reachability,
`aria-pressed`, contrast) shows no regression from the D-2/D-3 changes.

One non-blocking caveat for the record (not a fix regression, a judgment
call): fixing D-2 correctly means "Captions unavailable." now flashes on
every call for the brief window between connect and the agent's first
published transcription (see "New observation" above) - recommend the
orchestrator note this for a possible follow-up (a short grace window before
showing the fallback) but it does not block closing BL-017.
