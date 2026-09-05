# QA Report (Retry 1) - Phase 7, Screen 11 (Post-call summary), BL-025

**Date:** 2026-08-20
**Scope:** Re-verification of D-2 (feedbackSubmitted not initialized from GET .../summary response) and D-3
(star-rating ARIA pattern) on `apps/web/projects/conversation/src/app/features/summary`; confirmation that
D-4 (UX_GUIDELINES section 18.3 vs. LLD 410-contract inconsistency) remains correctly flagged and not silently
resolved either way; regression re-check of everything previously verified in
`qa-results/phase7-conversation-summary/REPORT.md`. D-1 (Python agent summary-generation wiring) is out of
scope for this pass -- covered by the parallel nexus-qa dispatch on apps/agent.

## Environment

- Dedicated, disposable Postgres 16 (postgres:16-alpine, port 8532) + Redis 7 (port 8637) -- new
  containers created for this run only, not reused from any other project's containers on this machine
  (several unrelated projects' Postgres/Redis containers were already running on the default 5432/6379
  ports; avoided entirely rather than risk cross-contamination).
- Reused the already-running livekit --dev container (liveavatar-livekit-1, ports 7880-7881,
  devkey/devsecretdevsecretdevsecret) -- not needed for this HTTP/DB-level pass but left untouched.
- apps/api: built with nest build (dist/main.js present and correct), run as node dist/main.js with env
  vars passed inline (PORT=8095) against the real disposable DB above -- real process, no mocks.
- apps/web conversation SPA: ng serve conversation --port 4300 --proxy-config qa-proxy.conf.json
  (temporary proxy file targeting localhost:8095, removed after the run).
- Real Chromium via a scripted Playwright pass (project has no e2e harness configured for this SPA;
  one-off script only, not added as a dependency) -- driving the real rendered UI (click, type, submit,
  keyboard nav) rather than calling internal Angular services directly.
- Test data seeded directly via Prisma into a disposable qa-retry1 tenant with 7 real Session rows: two
  with feedback pre-seeded directly in the DB (sessions A, B -- to prove the fix reads real backend
  state, not just its own prior in-memory write), one with no feedback yet for a real golden-path submit
  (session C), two used for the D-3 keyboard/AX test (session E is the one whose output is reported below
  after a timing artifact in an earlier attempt on session D, see the note below), one with an
  already-expired summaryTokenExpiresAt (for the expired-token terminal state), one with
  transcriptPurged: true (for the 410 terminal state). All test data (Tenant/Session/Feedback, cascade)
  deleted after the run; both disposable Docker containers removed; qa-proxy.conf.json deleted;
  apps/api/dist and logs removed; both background dev-server processes stopped by PID.
- Screenshots: qa-results/phase7-conversation-summary/20260820T230000Z/qa-shots/*.png.

## Traceability matrix (this pass's scope)

| Item | Scenario | Result | Evidence |
|---|---|---|---|
| D-2 (FR-CALL-4/UX_GUIDELINES 18.2 step 3) | Session A: feedback row pre-seeded directly in DB, fresh page load (never touched by this browser context before) | PASS -- fixed | 01-sessionA-fresh-load-after-preseeded-feedback.png; script output: hasConfirmation:true, hasFormPresent:false |
| D-2 | Session C: submit feedback via the real UI (click 5th star, type comment, click Submit), then reload the same URL in a brand-new browser context (simulating tab reopen) | PASS -- fixed | 02-,03-,04-sessionC-*.png; script output: hasConfirmation:true, hasFormPresent:false; DB query confirmed the Feedback row (rating:5, comment:"Great experience, QA retry1 golden path.") existed before the reload |
| D-2 (2 independent sessions, ruling out coincidence, per dispatch instruction) | Both A (DB-seeded) and C (submitted live through the UI) independently show the calm confirmation on a genuinely fresh page load, never the rating form | PASS | as above |
| D-3 | Keyboard-only: Tab from page load lands directly on the first star (no mouse click needed to reach the control) | PASS | script: Reached first radio star via Tab at press #1 |
| D-3 | Real accessibility-tree inspection (Playwright's getByRole/ariaSnapshot, which reads Chromium's actual AX tree via CDP, not just raw HTML source) confirms role="radiogroup" with name "Rate this call" containing 5 role="radio" children, each with a real accessible name ("1 star".."5 stars") | PASS | script output includes full ariaSnapshot() dump, see below |
| D-3 | ArrowRight moves both the checked state and DOM focus to the next star; ArrowLeft moves back; exactly one radio reports checked at any time (true mutual exclusivity, the actual radiogroup contract) | PASS | 05-,06-D3-star-*.png; retimed script shows focus/checked state agree at every step: star1(unchecked) to star2(checked) to star3(checked) to star2(checked) |
| D-3 | No stray aria-pressed attribute remains anywhere on the control (old toggle-button pattern fully removed, not just partially overridden) | PASS | script: raw aria-pressed attribute count: 0 |
| D-4 | Plan doc (docs/plans/liveavatar-platform-plan.md) still documents this as an open, unresolved cross-document conflict, not silently dropped or silently resolved in a way that contradicts either document | PASS -- correctly still flagged | plan doc lines 1642, 2160-2171 quoted below |
| D-4 | Shipped behavior is internally consistent -- a genuine whole-response 410 TRANSCRIPT_PURGED (LLD-literal), not a half-implemented "let some fields through" hybrid that would create a third, worse behavior | PASS | GetSessionSummaryUseCase/GetTranscriptUseCase both throw a hard AppError('TRANSCRIPT_PURGED', 410) before any body is built; SummaryPageComponent.fetchSummary()'s error handler routes any non-401/404 status straight to the purged terminal signal, which fully replaces the page's else block (no partial summary/transcript/feedback rendering alongside it) |
| Regression: token/session binding -- foreign token (A's id + B's token) | GET .../summary | PASS | curl: 401 CALL_SUMMARY_EXPIRED |
| Regression: token/session binding -- no token | GET .../summary | PASS | curl: 401 CALL_SUMMARY_EXPIRED |
| Regression: token/session binding -- unknown session id | GET .../summary | PASS | curl: 404 SESSION_NOT_FOUND |
| Regression: token/session binding -- expired token (past TTL) | GET .../summary and POST .../feedback | PASS | curl: both 401 CALL_SUMMARY_EXPIRED; 07-expired-token-terminal.png |
| Regression: token/session binding -- feedback endpoint, foreign token | POST .../feedback (A's id + B's token, rating 5) | PASS, no write | curl: 401; DB query afterward confirmed session A's Feedback row unchanged (still the pre-seeded rating:4, no new row) |
| Regression: summary text display | Real summary paragraph renders | PASS | 01-,02-sessionC-before-submit.png |
| Regression: transcript display | Real transcript lines render with role labels | PASS | same screenshots |
| Regression: feedback golden path + genuine persistence | Rate 5 stars + comment via real UI to 201-equivalent to confirmation shown to DB row confirmed | PASS | 02-,03-sessionC-*.png; DB query returned the exact submitted rating/comment |
| Regression: 410 purged transcript terminal state | Distinct copy, no form | PASS | 08-purged-transcript-terminal.png |
| Regression: phone-width (375px) -- confirmation state | Session B (feedback already submitted) at 375px | PASS | 09-phone375-sessionB-confirmation.png; document.documentElement.scrollWidth === 375 (no horizontal overflow) |
| Regression: phone-width (375px) -- feedback form state | Session E (no feedback yet) at 375px | PASS | 10-phone375-sessionE-feedbackform.png; scrollWidth === 375 |
| Regression: frontend jest --coverage (full monorepo, both admin+conversation) | -- | PASS, matches claim exactly | 61/61 suites, 424/424 tests |
| Regression: ESLint (apps/web/projects/**) | -- | PASS | clean, zero output |
| Regression: ng build conversation | -- | PASS | clean build; summary-page-component lazy chunk 9.17 kB raw / 2.86 kB transfer (comparable to the prior pass's 8.65 kB -- the D-3 arrow-key handler code accounts for the small increase) |

## D-3 accessibility-tree evidence (verbatim script output, retimed run)

```
--- initial (after Tab, no selection yet) ---
focused element: {"ariaLabel":"1 star","ariaChecked":"false","tabindex":"0"}
AX checked radio: null (count=0)
- radiogroup "Rate this call":
  - radio "1 star"
  - radio "2 stars"
  - radio "3 stars"
  - radio "4 stars"
  - radio "5 stars"
--- after 1x ArrowRight ---
focused element: {"ariaLabel":"2 stars","ariaChecked":"true","tabindex":"0"}
AX checked radio: 2 stars (count=1)
--- after 2x ArrowRight (total) ---
focused element: {"ariaLabel":"3 stars","ariaChecked":"true","tabindex":"0"}
AX checked radio: 3 stars (count=1)
--- after 1x ArrowLeft (back to star2) ---
focused element: {"ariaLabel":"2 stars","ariaChecked":"true","tabindex":"0"}
AX checked radio: 2 stars (count=1)
raw aria-pressed attribute count on any radio (should be 0): 0
```

Note on process: an earlier, un-retimed run of this same script (reading DOM state in the same
microtask as the keypress, before the component's queueMicrotask-deferred focus move had settled)
showed a transient one-tick lag between "focused" and "checked" element. Re-running with a small
settle delay after each key event showed focus and checked state agree at every step -- this was a
test-script timing artifact, not a product defect; recorded here for transparency since it initially
looked like a real bug.

## D-4 plan-doc evidence (verbatim, docs/plans/liveavatar-platform-plan.md)

Line 1642: "7.f Post-call summary: ... QA fix pass applied -- pending re-QA (D-1/D-2/D-3 fixed; D-4
flagged, unresolved, needs product/architecture decision -- see Phase 7 QA fix pass section below)"

Lines 2160-2171:
> D-4 (conversation-summary, flagged, NOT fixed -- left as-is per explicit instruction):
> UX_GUIDELINES section 18.3's "a purged transcript does not block feedback" sentence cannot be reconciled
> with the LLD's own GET .../summary contract, which returns a whole-response 410 TRANSCRIPT_PURGED
> with no body once purged... This is a genuine, unresolved spec/LLD-vs-UX-guideline inconsistency
> for the orchestrator/architect to reconcile... Not silently picked either way.

Confirmed: this is exactly the same, still-open framing as the original QA finding -- not silently
dropped from the plan doc, and not silently "resolved" in a way that would contradict either source
document. The shipped code (GetSessionSummaryUseCase, GetTranscriptUseCase, SummaryPageComponent)
consistently implements the LLD's literal whole-response-410 contract end to end; there is no
half-LLD/half-UX-guideline hybrid behavior anywhere in the stack.

## Defects

None found in this pass's scope. D-2 and D-3 are genuinely fixed, independently re-verified against a
live backend/live DOM/live accessibility tree, not just a code read. D-4 remains correctly flagged as an
open, unresolved cross-document issue requiring an orchestrator/architect decision -- it was neither
silently dropped nor silently resolved.

## Overall verdict: PASS

D-2 (blocking) and D-3 (low) are both confirmed fixed with independent live evidence (2 distinct sessions
for D-2, one via direct DB seed and one via a real UI submit-then-reload cycle in a fresh browser
context; D-3 via Playwright's role-based queries against the real Chromium accessibility tree, not a
static HTML read). D-4 remains correctly flagged, unresolved, and consistent in the shipped code either
way -- as instructed, no attempt was made to force a resolution. All previously-passing checks
(token/session binding in all four rejection shapes, summary/transcript display, feedback golden path
and genuine DB persistence, 375px phone rendering, full regression suite) were independently re-run and
still pass, with the frontend test count matching the dev's claim exactly (424/424).

This conversation-SPA half of Phase 7/BL-025 is ready to close from a frontend perspective. The overall
BL-025 phase close still depends on the parallel nexus-qa re-verification of D-1 (Python agent
summary-generation wiring, out of scope for this dispatch) -- the orchestrator should combine both retry
reports before advancing the phase.
