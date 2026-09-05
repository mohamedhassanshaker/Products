# QA Report - Phase 3 Conversation SPA (BL-011/BL-012, Screens 9-10)

**Date:** 2026-08-19
**Scope:** apps/web/projects/conversation (core, features/precall, features/call), shared's PublicApiService, new ESLint isolation zone for livekit-client. Backend (apps/api) run as a dependency only, not re-audited beyond confirming it builds.

## Environment

- Docker/Postgres/LiveKit unreachable in this sandbox (docker version hung, reconfirmed directly - same environment blocker every prior QA pass in this project has hit). No live backend or LiveKit server could be started.
- Frontend: real compiled/dev-served Angular app (ng serve conversation --port 4300, servePath=/c/, matching the app's actual base href /c/ and the production deployment shape) driven by a real headless Chromium via a scripted Playwright pass (no Playwright previously configured in this repo; used as a one-off, not added as a dependency).
- Network boundary stubbed at /api/public/deployments/{slug}/preflight, /api/public/sessions, /api/public/sessions/{id}/end only (disclosed). getUserMedia mocked to grant (silent AudioContext stream) or reject (NotAllowedError) per scenario. LiveKit's actual WebSocket protocol was NOT mocked - a fake ws_url was supplied where a session was issued, so the LiveKit connection itself never completes in this environment (disclosed limitation, not a code defect finding on its own).
- Full regression run independently (not trusting dev's claimed numbers): jest -> 43/43 suites, 278/278 tests. Coverage 94.58%/83.63% line/branch (close to, and not worse than, dev's claimed 94.22%/82.95% - different run, same order of magnitude, no regression). ESLint clean. ng build (both admin and conversation) clean - only the pre-existing, unrelated @liveavatar/contracts CommonJS warning. Backend prisma generate && nest build clean.

## Headline finding

**The entire Screen 9 to Screen 10 golden path is broken in the actual deployed configuration.** Every internal SPA navigation (precall -> call, call -> ended, the reconnect-failure redirect back to Screen 9, and Screen 10's own guard-redirect when reloaded with no in-memory session) uses `this.router.navigate(['/c', slug, ...])` - an absolute router-commands array with a leading `/c` segment. But `app.routes.ts` registers routes starting at `:slug` (no `/c` prefix) because that prefix is already supplied by `<base href="/c/">`. Angular's `Router.navigate()` resolves an absolute commands array against its own internal URL-tree namespace (which is already base-href-relative), not against the document root - so passing `/c` a second time makes the router look for a top-level route literally named `c`, which does not exist, and throws `NG04002: Cannot match any routes. URL Segment: 'c/...'`.

Live-reproduced twice, independently:

1. **Golden-path join:** filled the name field, clicked "Join call" on `/c/demo-tenant` (screenshots 07a/07b) with mocked preflight/session/mic-grant. The mocked session was successfully issued (visible in the mocked API response), but the follow-up `router.navigate(['/c', slug, 'call'], {...})` threw a pageerror (NG04002, full stack in results.json under goldenPath.errs) and the app never left Screen 9 - no error banner, no busy state left showing, the user is silently stranded with no visible indication anything went wrong, even though a LiveKit token was already minted server-side.
2. **Direct-reload guard:** navigated straight to `/c/demo-tenant/call` with no router state (the "reloaded directly" case UX_GUIDELINES section 12 explicitly requires to redirect to Screen 9). The call page's own guard (`if (!this.navState?.session) { this.router.navigate(['/c', this.slug()]); }`) hit the identical bug and threw instead of redirecting - the user is left stuck on a bare black Screen 10 shell (Mute/End call/Camera off controls, no video, no error, no spinner - screenshot 08-direct-call-nav-redirect.png), a dead end.

**Root cause confirmed, not just theorized:** patched precall-page.component.ts's navigate call from `['/c', slug, 'call']` to `[slug, 'call']` (removing the redundant absolute `/c` segment), rebuilt (dev-server hot-reload), and re-ran the identical golden-path script - it now reaches `http://localhost:4300/c/demo-tenant/call` with zero page errors. The patch was reverted immediately after confirming the diagnosis; the repository is unmodified (confirmed via git status and a clean re-run of the full Jest suite, still 43/43 / 278/278 afterward).

All five occurrences of the bug, same fix shape needed for each:
- precall-page.component.ts:94 - `router.navigate(['/c', slug, 'call'], {...})` (Screen 9 to 10 hand-off)
- call-page.component.ts:90 - `router.navigate(['/c', this.slug()])` (no-session-state guard redirect)
- call-page.component.ts:148 - `router.navigate(['/c', this.slug(), 'ended'])` (deliberate end-call)
- call-page.component.ts:180 - `router.navigate(['/c', this.slug()])` (reconnect-failure redirect, inside startReconnectTimer)
- call-ended-page.component.ts:53 - `router.navigate(['/c', slug])` ("Start a new call")

This was not caught by the dev agent's own Jest suite (Angular's test harness doesn't wire up the real base href/servePath, so a base-href-relative absolute-navigation bug is invisible to unit/component tests) or by ng build (a clean production build says nothing about runtime navigation behavior). It is a genuine, novel Phase 3 regression - the admin SPA has no equivalent `router.navigate(['/admin', ...])` pattern anywhere (grepped, zero matches), so this isn't a repeated known-safe convention, it's new and untested-in-the-real-shape code.

**Severity: Blocking.** FR-CALL-1's success criterion ("navigate to Screen 10") and FR-CALL-2's end-call/reconnect-redirect behavior are all unreachable/broken as shipped. Originating phase: development (Phase 3).

## Traceability matrix

| Requirement | Scenario(s) tested | Result | Evidence |
|---|---|---|---|
| FR-CALL-1 step 1-2 - browser feature-detect, preflight (background) | Feature-detect disabled (RTCPeerConnection removed) -> dead-end state | PASS | 06-browser-unsupported.png |
| FR-CALL-1 - nonexistent slug | 404 preflight -> generic "not available" copy shown, no crash | PASS | 01-nonexistent-slug-preflight-error.png |
| FR-CALL-1 - CONFIG_INCOMPLETE | Preflight 422/CONFIG_INCOMPLETE -> verbatim sentence, no retry action | PASS | 02-config-incomplete-loaded.png |
| FR-CALL-1 - TENANT_PAUSED | Preflight 403/TENANT_PAUSED -> identical verbatim sentence to config-incomplete, no retry | PASS | 03-tenant-paused-loaded.png |
| FR-CALL-1 - TRANSPORT_UNAVAILABLE | Preflight 503 first, 200 second -> verbatim sentence, button becomes "Retry", second tap re-runs preflight and clears the error | PASS | 04a-transport-unavailable.png |
| FR-CALL-1 - CALL_MIC_DENIED | getUserMedia rejects on Join tap -> verbatim sentence, stays on screen, no token requested | PASS | 05-mic-denied.png |
| NFR-6 - browser-unsupported dead end, exact sentence + focus management | Feature-detect fails -> heading text matches spec verbatim; document.activeElement confirmed to be the h1 on load | PASS | 06-browser-unsupported.png, results.json |
| FR-CALL-1 step 10 - navigate Screen 9 to Screen 10 on success | Golden path: name + mic grant + mocked session issue -> attempted navigation | FAIL (Blocking) | 07a/07b screenshots, results.json goldenPath.errs (NG04002 stack) - see Headline finding |
| Section 12 - Screen 10 redirects to Screen 9 if reloaded with no session state | Direct nav to /c/:slug/call | FAIL (Blocking), same root cause | 08-direct-call-nav-redirect.png |
| Section 12.2 "Ended" / Screen 11 stand-in | Direct nav to /c/:slug/ended | PASS (content matches spec verbatim: heading, body, single CTA) | 09-ended-standin-phone.png, results.json |
| Section 12.4 control-bar order (mute-left/end-call-center/camera-right), 48x48 hit targets | Code review of .la-call__control CSS (min-width/min-height: 48px) | PASS | code review |
| Section 11.5 - camera toggle hit target >= 48x48 | Code review: input[type=checkbox] { width: 24px; height: 24px; } | FAIL (Low/Moderate) | precall-page.component.scss:90-93 |
| Section 12.2 "Connecting" state - centered spinner | Code review: template renders a spinner span, but no matching CSS rule exists anywhere in call-page.component.scss | FAIL (Low) | call-page.component.scss (full file read, no such selector) |
| Section 12.2/12.4/12.5 - mic-level indicator (visual signal mic is live, esp. for deaf/HoH users) | Code review: LiveKitRoomService.micLevel signal exists and is polled, but is never read/bound anywhere in call-page.component.html/.ts outside its own spec mock | FAIL (Moderate) | call-page.component.html (full file, no micLevel reference); grep confirms no non-test usage |
| Section 12.2 camera toggle "only rendered if the user opted in on Screen 9" | Code review: camera button in call-page.component.html renders unconditionally regardless of cameraEnabled passed from Screen 9 | FAIL (Low/Moderate) | call-page.component.html:48-51 |
| Section 12.2 camera icon changes with state | Code review: both ternary branches render the identical emoji | FAIL (Low, cosmetic) | call-page.component.html:49 |
| Section 12.5 prefers-reduced-motion for meter/spinner | Grepped conversation and shared projects for prefers-reduced-motion | FAIL (Low) | grep, zero matches |
| ESLint isolation: livekit-client importable only from core/livekit-room.service.ts | Live negative-control probes: importing livekit-client into admin/** and conversation/features/** both correctly fire import/no-restricted-paths; importing it into conversation/core/browser-capability.ts (a sibling core/ file) does not fire | FAIL (Medium) | probe added/linted/reverted this pass; working tree confirmed clean afterward |
| Full regression (Jest/ESLint/build) | Independently re-run | PASS | terminal output, this pass |
| Backend build (dependency only) | prisma generate && nest build | PASS | terminal output |

## Defects (ordered by severity)

### D-1 (Blocking) - Every internal SPA navigation is broken by a duplicated base-href segment
See "Headline finding" above for full detail, repro, and root-cause proof. Breaks: Screen 9 to 10 hand-off (FR-CALL-1), Screen 10 to Ended (FR-CALL-2 end-call), reconnect-failure redirect (FR-CALL-2), and Screen 10's own no-session-state guard (section 12). **Fix:** remove the redundant `/c` leading segment from all five router.navigate() calls listed above - either use a relative array (`[slug, 'call']`, no leading slash) or otherwise navigate within the app's actual base-href-relative namespace. Re-verify with a real servePath=/c/ dev server or a served production build, not just Jest, since that is exactly the shape that hides this bug.
**Originating phase:** development (Phase 3).

### D-2 (Moderate) - livekit-client ESLint isolation zone is inert for the rest of core/
The zone meant to enforce "the only file in apps/web allowed to import livekit-client is core/livekit-room.service.ts" does not fire for other files in the same core/ directory (proven live: browser-capability.ts imports livekit-client with zero lint errors, while the identical import in admin/** or conversation/features/** correctly errors). The target entry responsible - `./apps/web/projects/conversation/src/app/core/!(livekit-room.service.ts)` - is a bare-directory-listing extglob with no recursive suffix, the exact class of bug already found and fixed twice in this project's Phase 1 ESLint config (import/no-restricted-paths needs a /**/* shaped target to actually match files). This is currently a false-assurance risk, not an active violation (no file in core/ actually imports livekit-client besides the intended one) - but the guardrail claimed in the dev decision log is not actually enforced for sibling core/ files.
**Fix:** give that target glob a working recursive form (mirroring the fix already applied to the other 7 zones in Phase 1), then re-prove with the same live negative-control probe.
**Originating phase:** development (Phase 3, new zone).

### D-3 (Moderate) - Mic-level indicator required by sections 12.4/12.5 is not implemented in the UI
LiveKitRoomService exposes a working micLevel signal (polled every 100ms from room.localParticipant.audioLevel), but call-page.component.html/.ts never reads or renders it anywhere outside its own spec's test mocks. UX_GUIDELINES section 12.5 calls this out explicitly as the deaf/hard-of-hearing accessibility signal, and section 12.4 specifies its placement (adjacent to the mute button). As shipped there is no visual indicator anywhere on Screen 10 that the user's mic is live, beyond the mute/unmute icon+label itself.
**Originating phase:** development (Phase 3).

### D-4 (Low/Moderate) - Camera toggle on Screen 10 ignores the Screen 9 opt-in, and its hit target is too small on Screen 9
Two related but separable issues:
- Sections 12.2/12.4 state the camera toggle should be "only rendered if the user opted in on Screen 9" - call-page.component.html's camera button renders unconditionally regardless of the cameraEnabled flag passed through router state.
- Section 11.5 requires >= 48x48 CSS px hit targets on Screen 9 "for Join call, the camera toggle, and any icon buttons" - the actual camera checkbox is 24px x 24px (precall-page.component.scss:90-93), meeting only the NFR-4 floor, not this screen's stated higher bar.
**Originating phase:** development (Phase 3).

### D-5 (Low) - Two cosmetic/rendering gaps on Screen 10
- The "Connecting..." state's spinner element has no corresponding CSS rule anywhere in call-page.component.scss - it renders as an invisible, zero-size element; only the "Connecting..." text is actually visible to a sighted user.
- The camera toggle's icon is identical in both states - only the text label changes; a purely-icon glance gives no information (the accessible text label does still change correctly, so this is cosmetic, not an accessibility violation).
- No prefers-reduced-motion handling exists anywhere in the conversation SPA for the connecting spinner (section 12.5 explicitly asks for it); currently moot for the mic-level meter since that isn't rendered at all (D-3).
**Originating phase:** development (Phase 3).

## What was verified correct (no defect)

- All five Screen 9 error-state sentences (CALL_MIC_DENIED, TRANSPORT_UNAVAILABLE, CONFIG_INCOMPLETE, TENANT_PAUSED, CALL_BROWSER_UNSUPPORTED) are byte-identical to both docs/PRODUCT_SPECIFICATION.md and UX_GUIDELINES.md section 11.8, and each is placed/behaves exactly per section 11.3 (no retry for config/paused, retry-in-place for transport, stay-on-screen for mic-denied).
- Browser-unsupported dead end correctly short-circuits before running preflight or requesting permissions, and correctly moves keyboard focus to the heading (verified via document.activeElement).
- Display-name field clamps silently at 40 chars via maxlength, defaults to "Guest" server-side when blank - no validation error UI, matching section 11.2 step 4.
- role="alert" used consistently for all three Screen 9 alert banners.
- Screen 10's control bar CSS meets the >=48x48 hit-target requirement (min-width/min-height: 48px on .la-call__control).
- The CALL_RECONNECT_FAILED full-screen takeover copy is byte-identical to spec, and its 30s/2s timer constants match FR-CALL-2 exactly (code-level confirmation; live reconnect could not be exercised without a real LiveKit server - disclosed).
- The Screen-11 stand-in (/c/:slug/ended) matches its authored, deliberately minimal spec verbatim (heading, body, single CTA) and was not over-graded against full Screen 11 scope, per this dispatch's instruction.
- livekit-client import isolation correctly fires for every file/project outside core/ (admin, shared, conversation's own features/**) - only the sibling-core/-file gap (D-2) is a problem.
- core -> features (must-not-depend-on-lazy-feature) isolation zone fires correctly for the conversation project (live-probed).
- Full regression (Jest, ESLint, both SPA builds, backend build) is clean and matches or exceeds dev's claimed numbers - no regression introduced elsewhere in the codebase by this phase's work.
- AI-boundary / dependency-maturity checks: no vendor LLM/agent-framework SDK import anywhere in this scope (not applicable - no AI subsystem touches this phase); livekit-client is the only new frontend dependency and is named in the architecture docs.
- Security spot-check: no admin JWT or auth header logic anywhere in this unauthenticated surface (correct per design - end users have no accounts); LiveKit tokens are held only in memory (CallSessionStore, never localStorage) and passed via router state, not the URL, matching section 8.1's stated decision; end-call's fire-and-forget POST /public/sessions/{id}/end correctly treats the webhook as authoritative and never blocks navigation on its result.

## Verdict

**NOT READY.** D-1 is a Blocking defect that breaks the entire golden path in the actual deployed base-href configuration (Screen 9 can never successfully reach Screen 10 in production/serve-path-correct environments; Screen 10 cannot redirect back to Screen 9 when required; end-call and reconnect-redirect are equally broken). Recommend an immediate, narrowly-scoped retry to nexus-dev for D-1 (all five call sites, same fix shape, already root-caused and proven above) before this phase can be considered functional at all. D-2/D-3/D-4/D-5 can reasonably batch into the same retry given how localized each is, but D-1 alone is sufficient to block sign-off.
