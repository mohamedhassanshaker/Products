# QA Report - Dev-20b (BL-17: Exam taking & review UI)

**Date:** 2026-08-10
**Scope:** Dev-20b only (closes out BL-17 = Dev-20a + Dev-20b). FR-TAKE-1/4/5/8 UI surfaces,
docs/design/UX_GUIDELINES.md section 12, WCAG 2.2 AA per NFR-5.
**Verdict: NOT READY - one blocking defect found.**

## Environment

- Backend: real AppModule boot (NestJS) against live MySQL 8.4 (examland-mysql docker
  container), a freshly provisioned tenant (qa32b1f0.localhost), a real Member/Admin, one
  real Exam Type authored via POST /exam-types/zip (2 questions, 1 module), NODE_ENV=staging
  so real subdomain-based tenant resolution was exercised (not the dev-mode default-tenant
  shortcut). Listened on 127.0.0.1:4310.
- Frontend: ng serve (dev server) on port 4210 with a proxy config forwarding /api/** to
  the backend above with the incoming Host header preserved unchanged, so
  TenantResolutionMiddleware's subdomain derivation worked against qa32b1f0.localhost:4210
  in a real Chromium browser (Playwright).
- All temporary provisioning script, proxy config, and screenshots were disposable; the tenant
  schemas were dropped and ad hoc servers killed after the run. Screenshots retained at
  C:\Users\M0DFF~1.HAS\AppData\Local\Temp\qa-screens-dev20b\ (Windows temp, not in the repo).
- Also ran, unmodified: apps/api/test/attempts.e2e-spec.ts (real DB, real HTTP) - 8/8 passed.
  ng test (54 suites / 286 tests) - all passed. ng build - clean except the pre-existing,
  disclosed 674 kB/650 kB initial-bundle budget warning.

## Traceability matrix

| Requirement | Scenario(s) tested | Result | Evidence |
|---|---|---|---|
| FR-TAKE-1 (discovery + instructions) | Real browser: login -> /exams/available shows the exam -> instructions screen | Pass | Screenshots 02-discovery, 03-instructions, 10-golden-instructions |
| FR-TAKE-4 (timed one-question navigation, persistent header, Next->Submit on last question) | Golden path drove Next across both questions, confirmed header updates, confirmed final-question button relabels to Submit | Pass | Screenshots 21, 23, 24 (dialog on last question) |
| FR-TAKE-4 / HLD 10.4 (server-authoritative deadline, client timer display-only) | Code read of attempt-take.component.ts: tick() never calls submit/navigate, only formats display; confirmed via reproduction below that the client never blocks on its own clock | Pass (client behaves correctly) | attempt-take.component.ts lines 129-174 |
| **12.3a named edge case - mid-navigation server-side timeout** | Real DB-backdated deadline_at (same technique as Dev-20a's own e2e), then drove the UI's "Next" action mid-attempt | **FAIL - blocking** | See Defect 1 below; screenshots 04-06, raw HTTP repro below |
| FR-TAKE-5 (answering, autosave-on-select, changeable) | Keyboard-driven Space-select on a radio fired autosave (confirmed via mat-mdc-radio-checked after Space, no mouse used); component tests also assert POST fires on select | Pass | Screenshot 40-kb-selected |
| FR-TAKE-5 (ATTEMPT_ALREADY_IN_PROGRESS resume) | Started an attempt via raw API, then drove the UI's "Start" button for the same exam as the same Member - got the genuine 409 resume dialog, clicked Resume, landed back on the correct in-progress attempt (same attemptId in the URL, correct remaining time) | Pass | Screenshot 20-resume-dialog, 21-resumed-q; URL .../attempts/cc30daba.../take unchanged after resume |
| FR-TAKE-7 (submit, confirm dialog, cannot resubmit) | Confirm dialog showed accurate "answered X of 2" count; submit succeeded; backend e2e's own resubmit-rejection test passed independently | Pass | Screenshot 31-confirm2; attempts.e2e-spec.ts line 284 |
| FR-TAKE-8 (review, full vs. wrong-only toggle) | Real browser: submitted (100% by luck of a 2-question exam), opened review - full view showed both questions with correct/incorrect markers and explanations; toggled "Wrong answers only" - correctly showed the "You got every question right" empty state. (nexus-dev's own prior real-browser run additionally exercised the non-trivial case: 66.7%, wrong-only correctly narrowing to exactly the one wrong question - not re-duplicated here, but independently plausible given this pass's own toggle mechanics check.) | Pass | Screenshot 33-review-full2, 34-review-wrongonly2 |
| Keyboard-only operability (dispatch's specific ask) | Tabbed through the taking screen with no mouse: single stop into the radio group, Space selects, Tab reaches Next, Enter activates it | Pass | Script log: "checked radios after click 1: 1"; "after tab to next-ish: BUTTON Next" |
| Focus management on question transitions (dispatch's specific ask) | After a keyboard-driven Enter on "Next", document.activeElement was confirmed to be the new question's h2 tabindex=-1 | Pass | Script log: active element after Next via keyboard: H2 / "Q1: 2+2?" / tabindex -1 |
| Timer aria-live discipline (dispatch's specific ask) | Code read: exactly one aria-live="polite" sr-only span, updated only at 3 lifecycle points (entry, 5-min, 1-min crossing), each guarded by a once-only flag; the visible per-second timer text itself is not in a live region | Pass | attempt-take.component.ts lines 79-163; attempt-take.component.html line 38 |
| Client timer never enforces (dispatch's specific ask) | Code read confirms tick() only sets display signals; no submit()/navigation call anywhere in the timer path; enforcement is 100% server-side per the Defect 1 finding itself (the server did correctly compute and persist TimedOut, scoring, end_time - see raw repro) | Pass | attempt-take.component.ts; attempts.service.ts loadWithLazyTimeout usage |
| 2 self-reported dev fixes (MatDialogModule shadowing; NG8011) | Re-ran full ng test (54/54, 286/286 - the 2 previously-failing dialog specs now pass) and a real ng build (no NG8011 warning, only the pre-existing bundle-budget warning) | Pass | This pass's own ng test/ng build output |
| WCAG 2.2 AA - color contrast on status indicators | Code/visual check: timer "running low" state adds a color class but the text itself always states remaining time in words (never color-alone); save-confirmation/error use icon+text, not color alone | Pass (spot-check, not a full axe-core audit) | attempt-take.component.html lines 26, 54-59 |

## Defects

### Defect 1 - BLOCKING: mid-navigation server-side timeout is silently swallowed by GET /attempts/:id/questions/:index, so the named "Time's up" interstitial never fires on ordinary Next/Previous navigation

**Severity:** Blocking. This is the single most explicitly named exit-gate scenario for this
phase ("what the UI does on a server-side auto-submit while the Member is mid-navigation") and
it does not work for the single most common in-attempt action (moving between questions).

**Root cause** (backend, apps/api/src/modules/attempts/application/attempts.service.ts,
getQuestion(), lines 215-221):

    async getQuestion(attemptId: string, questionIndex: number): Promise<AttemptQuestionView> {
      const attempt = await this.loadWithLazyTimeout(attemptId);
      this.assertOwner(attempt);
      const question = await this.repository.findQuestionByIndex(attemptId, questionIndex);
      if (!question) throw new AttemptQuestionNotFoundError();
      return toQuestionView(question);
    }

loadWithLazyTimeout() does correctly detect the expired deadline_at, close the attempt,
and persist status = 'TimedOut' with a real score - exactly as answer() and submit()'s
equivalent calls do. But unlike answer() (line 233) and submit() (line 257), both of which
re-check attempt.status after the lazy-timeout path runs and throw AttemptNotInProgressError
if it is no longer 'InProgress', getQuestion() never performs that re-check - it just
serves the requested question's stale data with a 200 OK, as if the attempt were still live.

The frontend's AttemptTakeComponent only knows to show the 12.3a "Time's up" interstitial
when a Next/Previous/answer/submit call surfaces the ATTEMPT_NOT_IN_PROGRESS error code
(handlePossibleTimeout()). Since GET .../questions/:index - the endpoint backing every
"Next"/"Previous" click - never produces that error, a Member navigating between questions
after their deadline has passed never learns the exam is over. They can keep clicking
"Next"/"Previous" through a TimedOut attempt indefinitely, seeing normal-looking question
content and a normal "Submit" button on the last question, with no indication anything is
wrong - a materially worse and more confusing experience than the interstitial this phase was
specifically built to provide, and a direct contradiction of 12.3a's "any in-flight action on
the taking screen" framing (this endpoint is exactly such an action).

**Repro** (both a real-browser Playwright run and raw HTTP, independently, same result):

1. Start a real attempt: POST /api/attempts with a valid examTypeId -> attemptId.
2. Backdate the real, persisted deadline into the past (same technique
   attempts.e2e-spec.ts itself uses): UPDATE attempt SET deadline_at = DATE_SUB(NOW(3),
   INTERVAL 1 MINUTE) WHERE id = '<attemptId>'.
3. GET /api/attempts/<attemptId>/questions/1 (any index other than the one already loaded)
   returns 200 OK with a normal AttemptQuestionView body ({"questionIndex":1,
   "questionText":"Q1: 2+2?", ...}), not 409 ATTEMPT_NOT_IN_PROGRESS.
4. GET /api/attempts/<attemptId> (the header) confirms the attempt was actually closed
   server-side: {"status":"TimedOut", ...}.
5. In the real browser: after the same backdating, clicking the visible "Next" button on the
   taking screen silently advances to the next question as if nothing happened - no
   interstitial, timer still shows a plausible remaining time (client display is
   cosmetic/independent, as designed), "Submit" appears normally on the final question. Only
   an actual answer or submit call eventually surfaces the interstitial - a Member who
   just clicks through remaining questions via "Next"/"Previous" without re-answering never
   sees it before reaching the review/result screens in a confusing state.

**Expected per spec** (UX_GUIDELINES 12.3a): "on receiving ATTEMPT_NOT_IN_PROGRESS from
any in-flight action on the taking screen (Next, Previous, Submit, or an answer-save call),
immediately replace the entire question-taking screen ... with a dedicated full-screen
interstitial."

**Fix scope note (not performed by QA):** this is a backend defect in Dev-20a's own
AttemptsService.getQuestion() (missing the same status !== 'InProgress' guard answer()/
submit() already have), surfaced by Dev-20b's UI relying on it - since BL-17 = Dev-20a +
Dev-20b together and this is squarely the phase's own named exit-gate scenario, it blocks
closing out BL-17 regardless of which of the two sub-phases technically owns the line of code.

### Non-blocking observations (not defects, recorded for completeness)

- ng build's pre-existing initial-bundle-budget warning (674 kB vs. 650 kB budget) persists,
  as nexus-dev already disclosed and the plan already flagged as pre-existing/not this
  phase's regression to fix.
- doSubmit()'s error handler (attempt-take.component.ts line 309-314) calls
  handlePossibleTimeout(error) and does nothing else if that returns false - an ordinary
  network/5xx failure on Submit leaves the Member on the screen with buttons re-enabled but no
  visible error message (unlike the inline error UX 12.3 specifies for answer-save failures).
  Low likelihood (submit failures are rare relative to answer-save failures) and not itself
  covered by the named exit-gate scenarios, but worth a follow-up ticket. Not blocking on its
  own.

## What passed cleanly

- Full golden path (discovery -> instructions -> start -> answer -> submit -> result -> review
  full -> review wrong-only toggle) works correctly end to end in a real browser against a real
  backend.
- ATTEMPT_ALREADY_IN_PROGRESS resume dialog is genuine and resumes the correct attempt at the
  correct point, not a restart.
- Client timer is genuinely display-only; no client-side enforcement exists anywhere in
  AttemptTakeComponent.
- Keyboard-only operability and post-navigation focus management both work as specified in a
  real browser, not just in component tests.
- Timer's aria-live discipline matches the spec's explicit "3 checkpoints only, never
  per-tick" requirement.
- Both of nexus-dev's self-reported defect fixes (unused MatDialogModule import shadowing
  test stubs; NG8011 content-projection warning) are genuinely fixed: 286/286 tests green, a
  clean ng build.
- Backend attempts.e2e-spec.ts (8/8, including its own real-DB lazy-timeout test at the
  getHeader/submit level) passes unmodified - the underlying lazy-timeout mechanism is
  real and correct; only the getQuestion code path was missed.

## Overall verdict

**NOT READY.** One blocking defect (Defect 1 above) directly contradicts this phase's own
named exit-gate scenario and the core spec section (12.3a) written specifically for it. Every
other checked requirement - golden path, resume, review toggle, WCAG keyboard/focus/aria-live
spot-checks, the two self-reported fixes, and the full regression suites - passed. Recommend
nexus-dev retry scoped to AttemptsService.getQuestion()'s missing status guard (and a
targeted regression test asserting GET .../questions/:index returns 409
ATTEMPT_NOT_IN_PROGRESS once loadWithLazyTimeout has closed the attempt, mirroring the
existing answer()/submit() tests) before BL-17 can close.
