# QA Retry 1 Report - Phase 3 Conversation SPA (BL-011/BL-012, Screens 9-10)

**Date:** 2026-08-19
**Scope:** `apps/web/projects/conversation` re-verification only (D-1 through D-5 from the prior pass). Backend covered by a parallel QA agent, not re-audited here beyond confirming it still builds/lints as a dependency.
**Prior report:** `qa-results/phase3-conversation-spa/20260819T101500Z/REPORT.md`

## Environment

- Docker/Postgres/LiveKit still unreachable in this sandbox (same disclosed blocker every prior pass in this project has hit; not re-tested directly this pass since it was already exhaustively reconfirmed in the prior report and has not changed).
- Frontend: real `ng serve conversation --port 4300` dev server (no `--serve-path` override), confirmed against `apps/web/angular.json`'s `serve.options.servePath: "/c/"` -- the identical base-href/servePath shape as the production build's `<base href="/c/">` in `index.html`. This is the exact configuration the original D-1 defect required to reproduce and the dev's own fix needed to be proven against; not a synthetic Jest harness.
- Browser: real headless Chromium (Playwright 1.55.0, installed as a one-off dev-tool in a scratch directory, not added to the repo's `package.json`/lockfile -- confirmed via `git status` that `apps/web`, `apps/api`, `eslint.config.mjs`, `pnpm-lock.yaml` show only the pre-existing untracked project directories, no new diffs from this pass).
- Network boundary stubbed at `/api/public/deployments/{slug}/preflight`, `/api/public/sessions`, `/api/public/sessions/{id}/end` only (disclosed, same three routes as the original pass). `getUserMedia` mocked to grant a real `AudioContext`-generated audio track plus a `canvas.captureStream()` video track, or reject `NotAllowedError`, per scenario. LiveKit's actual WebSocket protocol was NOT mocked -- session issuance returns a fake `ws_url`, so the LiveKit connection itself never reaches `connected` in this environment (disclosed limitation carried forward from the original pass, not a code defect on its own).
- All Playwright scripts, screenshots (`retry1-screenshots/`), and `results.json` are this pass's own fresh artifacts -- none reused from the dev agent's own one-off Playwright script.

## D-1 (Blocking) -- Duplicated /c base-href segment in every internal SPA navigation

**Verdict: FIXED. Independently confirmed against a real ng serve conversation dev server with the real /c/ servePath -- zero NG04002 / page errors across all five call sites and every named scenario.**

Code-level: all five previously-broken `router.navigate()` calls now use a relative commands array with no leading `/c` segment:
- `precall-page.component.ts:99` -> `router.navigate([slug, 'call'], {...})`
- `call-page.component.ts:99` -> `router.navigate([this.slug()])` (no-session guard)
- `call-page.component.ts:157` -> `router.navigate([this.slug(), 'ended'])` (end-call)
- `call-page.component.ts:189` -> `router.navigate([this.slug()])` (reconnect-failure redirect)
- `call-ended-page.component.ts:54` -> `router.navigate([slug])` ("Start a new call")

Live-reproduced, this pass, independently (fresh Playwright script, not the dev's):

1. **Golden-path join (Screen 9 -> 10):** filled display name, opted into camera, clicked "Join call" against mocked preflight/session -- navigated cleanly to `/c/demo-tenant/call` with zero pageerror events. Screenshot: `02-golden-call-page-arrived.png`.
2. **Direct-reload guard redirect:** navigated straight to `/c/demo-tenant/call` with no router state -- correctly redirected to `/c/demo-tenant` (Screen 9), zero page errors. Screenshot: `05-direct-load-guard-redirect.png`.
3. **Deliberate end-call -> Ended:** clicked "End call" on Screen 10 -- navigated cleanly to `/c/demo-tenant/ended`, matching the byte-identical "You've left the call" / "Thanks for calling in." / "Start a new call" content from the original pass. Screenshot: `04-golden-ended-page.png`.
4. **Reconnect-failure redirect:** since no live LiveKit server is reachable in this sandbox to organically produce a reconnect, the real (fake-ws_url) Room was first torn down via `liveKit.disconnect()` to prevent its own background connection-failure events from racing the test, then `LiveKitRoomService`'s `connectionState` signal was set to `'reconnecting'` directly via Angular's dev-mode `ng.getComponent()` handle (the same private signal the real `RoomEvent.Reconnecting` handler would set -- this bypasses only the trigger, not the redirect code path itself, which is identical production code). The "Reconnecting..." banner appeared correctly (screenshot `06-reconnecting-banner.png`), the real 30s timeout + 2s takeover-display timer chain ran to completion, and the app redirected cleanly to `/c/demo-tenant` with zero page errors (screenshot `07-reconnect-failed-redirected.png`).
5. **"Start a new call" (Ended -> Screen 9):** separately confirmed this fifth call site redirects cleanly with zero errors (screenshot `13-ended-start-new-call.png`).

All five call sites -- every one named in the original defect -- are independently confirmed fixed. `results.json` (`goldenPathErrorsAtHandoff`, `goldenPathErrorsFull`, `directLoadGuardErrors`, `reconnectFailedErrors`) shows zero page errors across every scenario; the only console entry captured anywhere in the full run is a benign `ConnectionError: Client initiated disconnect` from tearing down the fake-URL LiveKit room on end-call -- not a routing error, not NG04002.

## D-2 (Moderate) -- livekit-client/livekit-server-sdk ESLint isolation zones inert for sibling files

**Verdict: FIXED. Live-probed all 3 claimed fixes with fresh violation files (different from the dev's own probes), all 3 fired correctly; full pnpm lint on the real, unmodified codebase stays clean.**

Probed (added a one-line `import 'livekit-client'` / `import 'livekit-server-sdk'`, ran eslint directly, then restored the exact original file content and diffed to confirm zero residual changes):

| File probed (deliberately different from dev's own probe files) | Zone | Result |
|---|---|---|
| `apps/web/projects/conversation/src/app/core/call-session.store.ts` (sibling core/ file to the exempted livekit-room.service.ts) | conversation core livekit-client exemption | Fired: `Unexpected path "livekit-client" imported in restricted zone` |
| `apps/web/projects/conversation/src/app/app.component.ts` (flat file directly in app/, the class of gap D-2 called out) | conversation flat-file gap | Fired: same error |
| `apps/api/src/modules/transport/index.ts` (flat sibling file to transport/infrastructure/) | apps/api transport livekit-server-sdk exemption | Fired: `Unexpected path "livekit-server-sdk" imported in restricted zone` |

Manual byte-for-byte restore plus `diff` confirmed all three probe files were returned to their exact original content afterward. Full `pnpm lint` (contracts + api + web) is clean (exit 0) after this probing.

## D-3 (Moderate) -- Mic-level indicator not rendered

**Verdict: FIXED. Visible, correctly placed, and reactively bound to LiveKitRoomService.micLevel() -- confirmed with a real DOM-level reactivity check.**

- `.la-call__mic-meter` renders adjacent to the Mute button (per UX_GUIDELINES section 12.4) -- confirmed present via `results.micMeterPresent: true` and visible in every Screen 10 screenshot (e.g. `02-golden-call-page-arrived.png`).
- Reactivity: no live LiveKit server is reachable in this sandbox, so real microphone audio cannot flow through an actual `room.localParticipant.audioLevel` (same disclosed environment gap as D-1's reconnect scenario). To independently prove the meter is genuinely data-bound rather than static, I read the fill bar's width before and after directly setting the service's underlying micLevel signal (`comp.liveKit['_micLevel'].set(0.8)`, the exact signal `startMicLevelPolling()` writes to every 100ms from real audioLevel reads) via `ng.getComponent()`: width went from 0% to 80% in the DOM (`results.micLevelReactiveTest`), confirming the template's `[style.width.%]="liveKit.micLevel() * 100"` binding is live, not a one-time render. Screenshot: `03-golden-call-mic-meter-set.png`.
- `prefers-reduced-motion: reduce` correctly suppresses the meter's width transition (`getComputedStyle(...).transition === "none"`, `results.reducedMotionMicMeterTransition`) -- see D-5 below for the full reduced-motion pass.

## D-4 (Low/Moderate) -- Camera toggle ignores Screen 9 opt-in; 24x24 hit target

**Verdict: FIXED, both parts.**

- **Opt-in respected:** with the Screen 9 camera checkbox checked, Screen 10's camera button renders (`results.cameraButtonVisibleWhenOptedIn: true`, screenshot `02-golden-call-page-arrived.png`). With it left unchecked (default state -- confirmed `results.cameraDefaultUnchecked: true`), Screen 10's camera button does not render at all (`results.cameraButtonHiddenWhenOptedOut: true`, screenshots `08-camera-optout-precall.png` / `09-camera-optout-call-page.png`).
- **Hit target:** `input[name=camera]`'s `getBoundingClientRect()` now reports `{ width: 48, height: 48 }` (`results.cameraCheckboxHitTarget`), meeting section 11.5's explicit >=48x48 CSS-px requirement (up from the original 24x24).

## D-5 (Low) -- Invisible spinner, static camera icon, no reduced-motion

**Verdict: FIXED, all three.**

- **Spinner visible:** `.la-call__spinner`'s boundingBox() now reports a real ~52x52px element (non-zero, non-invisible -- `results.spinnerVisibleBox`), visibly rendered and spinning in `02-golden-call-page-arrived.png`.
- **Camera icon changes with state:** toggling the camera button flips both icon (camera emoji to no-entry emoji) and label ("Camera on" to "Camera off") -- `results.cameraIconChanges.iconChanged: true`, screenshot `11-camera-icon-toggle.png`.
- **prefers-reduced-motion: reduce respected:** with the browser context emulating `reducedMotion: 'reduce'`, the spinner's computed `animationName` is `"none"` (`results.reducedMotionSpinnerStyle`, screenshot `10-reduced-motion-connecting.png`) and the mic meter's transition is `"none"` (confirmed above under D-3) -- both correctly suppressed, matching the `@media (prefers-reduced-motion: reduce)` rules added to `call-page.component.scss`.

## Regression spot-check -- 5 Screen 9 error states (no regression expected, reconfirmed)

All five verbatim per UX_GUIDELINES section 11.8, byte-identical to the original pass, driven end-to-end this pass with fresh mocks:

| Error | Mechanism | Sentence shown | Result |
|---|---|---|---|
| CALL_MIC_DENIED | getUserMedia rejects NotAllowedError on Join tap | "Microphone access is required to start. Allow the microphone in your browser and retry." | PASS |
| TRANSPORT_UNAVAILABLE | preflight 503 | "Cannot reach the media server. Check your network or try again." | PASS |
| CONFIG_INCOMPLETE | preflight 422 | "This assistant is not available right now." | PASS |
| TENANT_PAUSED | preflight 403 | "This assistant is not available right now." | PASS |
| Unknown tenant (TENANT_NOT_FOUND) | preflight 404 | "This assistant is not available right now." | PASS |

Screenshots: `12-error-mic-denied.png`, `12-error-transport-unavailable.png`, `12-error-config-incomplete.png`, `12-error-tenant-paused.png`, `12-error-not-found.png`. Zero page errors in any of the five (`results.json`, `errorState_*_pageErrors`).

*(Note: an earlier iteration of this pass's own script mistakenly mocked TRANSPORT_UNAVAILABLE/CONFIG_INCOMPLETE as 200-status bodies with reachable:false/complete:false instead of real HTTP error statuses -- that produced a false "no alert shown" result on the first run. This was a test-harness mistake on my part, not a product defect: CallSessionStore.runPreflight() only ever derives preflightError from a thrown HTTP error via firstValueFrom, exactly as the original pass tested it with 503/422/403. Corrected the mock shapes and re-ran; all five states pass as shown above.)*

## Full regression (independently re-run, not trusting dev's claimed numbers)

- **Jest:** `pnpm --filter @liveavatar/web test` -> 43/43 suites, 280/280 tests, matches dev's claim exactly.
- **ESLint:** `pnpm lint` (contracts + api + web) -> clean, exit 0.
- **ng build admin:** clean (only the pre-existing, unrelated @liveavatar/contracts CommonJS warning).
- **ng build conversation:** clean (same pre-existing warning only).
- Repo diff after all probing/build/test activity: `git status --porcelain` on `apps/web`, `apps/api`, `eslint.config.mjs`, `pnpm-lock.yaml` shows only the pre-existing untracked project directories -- no residual changes from this QA pass.

## Traceability matrix

| Defect | Scenario(s) tested | Result | Evidence |
|---|---|---|---|
| D-1 golden-path hand-off (Screen 9 to 10) | Real dev server, real base href, mocked preflight/session/mic-grant, full Join flow | FIXED | 02-golden-call-page-arrived.png, results.json |
| D-1 direct-reload no-session guard | Direct nav to /c/:slug/call with no state | FIXED | 05-direct-load-guard-redirect.png |
| D-1 end-call to Ended | Click "End call" on Screen 10 | FIXED | 04-golden-ended-page.png |
| D-1 reconnect-failure redirect | Forced reconnecting state, real 30s+2s timer chain | FIXED | 06-reconnecting-banner.png, 07-reconnect-failed-redirected.png |
| D-1 "Start a new call" (Ended to Screen 9) | Click CTA on Ended page | FIXED | 13-ended-start-new-call.png |
| D-2 core sibling-file gap | Fresh probe: call-session.store.ts | FIXED | terminal output, this pass |
| D-2 flat-file gap | Fresh probe: app.component.ts | FIXED | terminal output, this pass |
| D-2 apps/api transport sibling gap | Fresh probe: transport/index.ts | FIXED | terminal output, this pass |
| D-3 mic-level meter render + placement | Screen 10 live render | FIXED | 02-golden-call-page-arrived.png |
| D-3 mic-level meter reactivity | Direct signal manipulation + DOM width read | FIXED | 03-golden-call-mic-meter-set.png, results.json |
| D-4 camera opt-in respected | Screen 9 checked -> Screen 10 button visible | FIXED | 02-golden-call-page-arrived.png |
| D-4 camera opt-out respected | Screen 9 unchecked -> Screen 10 button absent | FIXED | 09-camera-optout-call-page.png |
| D-4 camera checkbox hit target | getBoundingClientRect() | FIXED (48x48) | results.json |
| D-5 connecting spinner visible | Bounding box measurement | FIXED | 02-golden-call-page-arrived.png |
| D-5 camera icon changes | Toggle + before/after text | FIXED | 11-camera-icon-toggle.png |
| D-5 reduced-motion (spinner + meter) | reducedMotion: 'reduce' context emulation | FIXED | 10-reduced-motion-connecting.png |
| 5 Screen 9 error states (regression) | Real HTTP error statuses per code | PASS, no regression | 12-error-*.png |
| Full regression (Jest/ESLint/builds) | Independently re-run | PASS, matches dev's claim | terminal output |

## Verdict

**PASS.** All five defects from the prior QA pass (D-1 Blocking, D-2/D-3/D-4 Moderate, D-5 Low) are independently confirmed genuinely fixed, including D-1 -- the golden-path blocker -- verified against a real ng serve conversation dev server with the actual production-matching /c/ base-href/servePath shape, exactly the configuration that hid the original defect from Jest and ng build. No new defects found in this scope. Full regression (Jest, ESLint, both SPA builds) is clean and matches the dev agent's claimed numbers. Recommend Phase 3's conversation-SPA scope (BL-011/BL-012) be treated as closed pending the parallel backend QA agent's own sign-off.

**Carried-forward disclosed limitation (not a code defect, unchanged from every prior pass):** Docker/Postgres/LiveKit remain unreachable in this sandbox, so the LiveKit WebSocket protocol itself was never exercised end-to-end (fake ws_url, real connection never completes) and the mic-level meter's reactivity was proven via direct signal manipulation rather than genuine live microphone audio flowing through a real LiveKit room. This needs a Docker/LiveKit-capable environment for a final end-to-end confirmation before production sign-off, but does not reopen any of the five defects above -- each was independently, concretely verified within the constraints of this sandbox.
