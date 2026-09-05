# QA Report - Phase 7, Screen 11 (Post-call summary), BL-025

**Date:** 2026-08-19/20
**Scope:** Conversation SPA's new `summary` feature (`apps/web/projects/conversation/src/app/features/summary`), its backend (`GetSessionSummaryUseCase`, `SubmitFeedbackUseCase`, `PrismaFeedbackRepository`, `apps/api/src/modules/public/interface/public.controller.ts`), and the claimed agent-side wiring (`apps/agent/src/avatar_agent/summary/post_call.py`).
**Verdict: FAIL** (one blocking defect: the LLM-generated summary is never produced in production; a second, spec-contradicting defect on feedback-submitted state on load).

## Environment

- Postgres 16 + Redis 7 + LiveKit dev-mode via `docker compose -f docker-compose.dev.yml` (real, disposable containers - not the developer's own claims).
- `apps/api`: built with `tsc -p tsconfig.build.json`, run as `node dist/main.js` against the real DB on `http://localhost:8095` (custom port to avoid a sandbox conflict; not a config change to the app itself).
- `apps/web` conversation SPA: `ng serve conversation --port 4300 --proxy-config qa-proxy.conf.json` (temporary proxy file, removed after the run) at `http://localhost:4300/c/...`.
- Test data seeded directly via Prisma (not the admin UI) into 4 real `Session` rows covering: normal ended session with real transcript and no agent summary; a session with `summaryStatus=ready`/`summaryText` set (to prove the UI can render a summary, since the agent path that would set this in production never fires - see D-1); an expired-token session; a transcript-purged session. All test data was deleted after the run (`Session`/`Tenant`/`Feedback` cascade-deleted).
- Full live-call path (real audio, LiveKit room, Python agent) was not exercised - no microphone/media device in this sandbox, consistent with every prior phase's disclosed limitation. Where this matters, it's called out per-requirement below; it does not affect this phase's headline finding (D-1), which was proven by static tracing plus a live end-to-end HTTP/DB check of the same code path the agent would use.
- Screenshots: `qa-results/phase7-conversation-summary/20260820-014300/*.png`.

## Traceability matrix

| Requirement | Scenario | Result | Evidence |
|---|---|---|---|
| FR-CALL-4 transcript display | Real transcript renders in order, role labels shown | PASS | `01-desktop-session-b-summary-present.png`, `04-desktop-session-a-no-summary-feedback-already-submitted.png` |
| FR-CALL-4 transcript absent (not purged) | (not separately re-seeded; code path reviewed) empty transcript array shows "No transcript is available for this call." | PASS (code review only) | `summary-page.component.html` line 41 |
| FR-CALL-4 transcript purged (410 TRANSCRIPT_PURGED) | Full-card replacement, distinct end-user copy | PASS | `06-desktop-session-d-transcript-purged.png`; curl HTTP:410 |
| FR-CALL-4 optional summary - generated once on end-call if LLM available | Real call ends with LLM reachable -> summary appears | FAIL - blocking (D-1) | See below |
| FR-CALL-4 optional summary - failure hides summary, non-blocking | summary_status anything but ready -> section omitted silently | PASS (mechanically correct, but unreachable as designed - see D-1) | 04-...png shows no Summary section for session A |
| FR-CALL-4 feedback - golden path | Rate + comment + submit -> 201, persisted, confirmation shown | PASS | `02-`, `03-desktop-session-b-feedback-success.png`; DB row confirmed via direct query |
| FR-CALL-4 feedback - genuinely persisted (not just 200) | Queried Feedback table directly after each submit | PASS | rows confirmed for both sessions with correct rating/comment |
| FR-CALL-4 feedback - already-submitted state on page load | Reload/reopen a summary link after feedback was already submitted -> confirmation shown, no form | FAIL - blocking (D-2) | `04-...png`, `09-phone-375-session-b-after-feedback.png` |
| FR-CALL-4 feedback - duplicate submit (409 FEEDBACK_ALREADY_SUBMITTED) | Submit again via API -> treated as success-equivalent | PASS | curl: HTTP:409, "Feedback was already sent. Thank you."; UI-side catch confirmed in code |
| FR-CALL-4 feedback - invalid (400 FEEDBACK_INVALID) | rating 0, rating 6, comment >1000 chars | PASS | curl: all three return 400 FEEDBACK_INVALID with per-field detail |
| FR-CALL-4 feedback - skip/close without submitting | No forced action, no exit-block | PASS (code review - no beforeunload/guard present) | - |
| FR-CALL-5 - cannot access another session (foreign token) | A's session id + B's token -> rejected | PASS | `08-desktop-cross-session-foreign-token.png`; curl HTTP:401 CALL_SUMMARY_EXPIRED |
| FR-CALL-5 - unknown session id | random UUID -> 404 SESSION_NOT_FOUND, same UI treatment as expired | PASS | `07-desktop-unknown-session-not-found.png`; curl HTTP:404 |
| FR-CALL-5 - no token presented | Missing header -> rejected | PASS | curl HTTP:401 CALL_SUMMARY_EXPIRED |
| FR-CALL-5 - expired token | Past-TTL token -> rejected, full-card, no retry | PASS | `05-desktop-session-c-expired-token.png` |
| Session-token binding (feedback endpoint) | Foreign/expired token on POST .../feedback -> 401, no write | PASS | curl HTTP:401; no Feedback row created for that attempt |
| UX_GUIDELINES 18.5 a11y - star control as WAI-ARIA radiogroup | Each star should be role="radio"/aria-checked, real accessible name | FAIL - non-blocking (D-3) | Code review: role="radiogroup" wraps plain buttons using aria-pressed, not role="radio"/aria-checked |
| Phone-width (375px) rendering | Summary+transcript+feedback and terminal states | PASS | `09-`, `10-`, `11-phone-375-*.png` - single column, no overflow/clipping, "Start a new call" demoted to secondary link as specified |
| 18.3 "purged transcript does not block feedback" vs. LLD's 410-whole-response contract | Backend genuinely can't satisfy this UX line given the LLD's own endpoint shape | Flagged, non-blocking, cross-doc (D-4) | See below |
| Regression - frontend jest --coverage | Full suite | PASS | 403/403, matches shared claim |
| Regression - backend jest --runInBand | Full suite | PASS | 715/715 |
| Regression - ESLint (web + api) | - | PASS | Clean, zero output |
| Regression - ng build conversation | - | PASS | Clean build, summary-page-component chunk 8.65 kB |
| Regression - Python pytest --cov=avatar_agent | - | PASS numerically, but see D-1 | 237/237, 94.39% coverage - post_call.py itself is 100% covered by its own isolated unit test, which is exactly how D-1 stayed hidden |

## Defects

### D-1 (BLOCKING, FR-CALL-4, originating phase: Phase 4/7 seam - Python agent, apps/agent)

**What was expected:** FR-CALL-4: "Optional short summary: if LLM available, one paragraph (max 500 chars) generated once on end-call; failure -> hide summary, still show transcript." The dispatch's own brief explicitly asked for verification that this is "genuinely wired... not a stub," citing this project's repeated "component exists but isn't actually called" bug class (hit twice in Phase 4).

**What actually happened:** `generate_and_send_summary()` in `apps/agent/src/avatar_agent/summary/post_call.py` - the function that calls the LLM and posts `POST /internal/sessions/{id}/summary` - is never called from anywhere in the running agent. Grepped the entire `apps/agent/src` tree: the only two call sites are the function's own file and its own isolated unit test (`tests/summary/test_post_call.py`), which invokes it directly with hand-built fakes. `entrypoint.py::handle_job` (the actual per-call LiveKit job handler) has no reference to `post_call`, `generate_and_send_summary`, or anything in the `summary` package - its `finally` block only sends a `type: "ended"` session event and never triggers summary generation. Confirmed via `apps/agent`'s own coverage report: `entrypoint.py` is 90% covered but none of its covered/uncovered lines touch summary generation, because the call doesn't exist to cover.

**Consequence, confirmed live end-to-end:** `Session.summaryStatus` defaults to `none` in the Prisma schema and is only ever changed by `SetSessionSummaryUseCase` (`POST /internal/sessions/{id}/summary`), which only the agent can call. Since the agent never calls it, every real session that ends will show `summary_status: "none"` forever - the summary section will be silently, permanently absent regardless of whether the LLM is reachable. This was proven against the live API: a genuinely-ended session with real transcript rows returns `"summary_status":"none"` with no `summary_text` field (see `04-desktop-session-a-no-summary-feedback-already-submitted.png` and the accompanying curl trace). The frontend's "silent absence" handling of this state is correct per spec - the underlying bug is that this state is now the only state any real call will ever reach, not a rare LLM-outage fallback.

**Repro:**
1. `curl -H "X-Summary-Token: <valid token for a real ended session>" http://localhost:8095/api/public/sessions/<id>/summary` -> `summary_status: "none"`, no `summary_text`, for a session where the LLM was never even asked.
2. `grep -rn "generate_and_send_summary" apps/agent/src` -> only the definition itself; `grep -rn "generate_and_send_summary" apps/agent/src/avatar_agent/entrypoint.py` -> no matches.

**Originating phase:** Phase 4 built `summary/post_call.py` in isolation (its own docstring says "the agent is the only writer," correctly describing intent) but the wiring into `entrypoint.py`'s end-of-call path was never done - this is the same defect class Phase 4 was already caught on twice for STT and tool-calling, now recurring a third time for the summary feature, this time inside Phase 7's own dispatch since the file lives under this phase's own module layout (`apps/agent/src/avatar_agent/summary/`). Route the fix to nexus-dev for the Python agent side of Phase 7/BL-025: `entrypoint.py::handle_job`'s teardown path (where `pipeline.aclose()` and the "ended" event are currently sent) needs to call `generate_and_send_summary(...)` before or alongside that event, with the LLM instance the pipeline already resolved.

**Severity:** Blocks the requirement - the summary half of FR-CALL-4 is completely non-functional in production, not merely degraded.

### D-2 (BLOCKING, FR-CALL-4, originating phase: Phase 7 - conversation SPA summary feature)

**What was expected:** UX_GUIDELINES section 18.2 step 3 / 18.3: on load, if the summary endpoint's response has `feedback_submitted: true`, "the feedback form is replaced by a calm confirmation line and no form is shown at all." This is not an edge case - it is the documented behavior for a user reopening/reloading the same summary link within its 30-minute TTL after already having rated the call (explicitly named in UX_GUIDELINES section 18.1 as a supported, expected flow: "reachable by the user reopening/reloading that same URL").

**What actually happened:** `SummaryPageComponent.feedbackSubmitted` is a signal initialized to `false` and is only ever set from the feedback-submit response handler (`onSubmitFeedback`'s `next`/`FEEDBACK_ALREADY_SUBMITTED` branches). It is never set from the initial `GET .../summary` response's own `feedback_submitted` field (`fetchSummary()` only calls `this.summary.set(summary)`; nothing reads `summary.feedback_submitted` into the `feedbackSubmitted` signal). Consequence: reloading/reopening a summary link for a session that already has feedback shows the full star-rating form again, not the "Thanks for your feedback." confirmation.

**Repro (live, screenshot evidence):**
1. Submitted feedback for a session via the real UI (`03-desktop-session-b-feedback-success.png` - confirmation correctly shown, DB row confirmed).
2. Reloaded that same summary URL in a fresh browser context (simulating tab reopen/reload) -> the feedback form is shown again, not the confirmation (`09-phone-375-session-b-after-feedback.png`, and independently for a session where feedback was submitted via the raw API in `04-desktop-session-a-no-summary-feedback-already-submitted.png`).
3. Confirmed via direct DB query that Feedback rows existed for both sessions at the time of the reload, so the backend's `feedback_submitted: true` was genuinely present in the response the page ignored.
4. The dev's own test fixture (`summary-page.component.spec.ts`) only ever mocks `feedback_submitted: false` - never exercises the `true` branch on initial load, which is why this shipped uncaught.

**Impact:** if a user resubmits via this now-incorrectly-shown form, the backend correctly returns 409 FEEDBACK_ALREADY_SUBMITTED and the component's error handler does correctly recover to the confirmation state at that point - so there is no double-write risk - but the user is shown a live, interactive rating form asking them to rate a call they already rated, contradicting the guideline's explicit "no form is shown at all" behavior on the single most common repeat-visit path this screen has (reopening the link).

**Originating phase:** Phase 7 (`SummaryPageComponent`, `apps/web/projects/conversation/src/app/features/summary`).

**Severity:** Blocks the requirement as literally written in FR-CALL-4/UX_GUIDELINES section 18.2 step 3, on a mainline (not edge-case) path.

### D-3 (Non-blocking, UX_GUIDELINES section 18.5, Phase 7)

The star rating control uses `role="radiogroup"` on the container but each button inside uses `[attr.aria-pressed]` rather than `role="radio"`/`aria-checked`. UX_GUIDELINES section 18.5 explicitly names "the WAI-ARIA APG 'slider' or 'radio group' pattern," which for a radiogroup requires child elements with `role="radio"` and `aria-checked`, not `aria-pressed` toggle-button semantics on bare buttons inside a `radiogroup` container (this combination is not a recognized ARIA pattern - a screen reader will not announce these as a coherent 1-of-5 selection). The aria-labels ("1 star" ... "5 stars") are correctly present. Low-likelihood-of-user-harm (the control is still operable and each star is still announced by name) but a real accessibility-pattern violation worth a follow-up, not a re-dispatch on its own.

### D-4 (Non-blocking, cross-document finding, not attributable to a specific dev phase)

UX_GUIDELINES section 18.3's "Purged transcript" row states "the rest of the page (summary, feedback form) renders normally regardless - a purged transcript does not block feedback." The LLD's own contract for `GET /public/sessions/{id}/summary` (LLD line ~920) lists `410 TRANSCRIPT_PURGED` as a whole-response error code alongside 401/404, not a per-field flag inside a 200 body - meaning there is structurally no summary_text/feedback_submitted data available to render "normally" when this error fires, since the entire request fails. The dev's implementation (both GetSessionSummaryUseCase and SummaryPageComponent) correctly follows the LLD's literal contract (full-card terminal state, no form) - and the component's own code comment already discloses this exact tension rather than hiding it. This is a genuine inconsistency between the Phase 7 UX guideline text and the pre-existing LLD contract it was supposed to build on top of, not a coding defect - flagged for product/architecture to reconcile (either the LLD needs an amended response shape, or the UX guideline's sentence should be corrected), not routed to nexus-dev as a fix.

## Overall verdict: FAIL

D-1 alone is sufficient to fail this phase: the headline, explicitly-requested-to-verify claim ("the summary text... is genuinely wired, not a stub") is false for the only path that matters - the real per-call agent job handler. D-2 independently fails a named, mainline FR-CALL-4 behavior. Recommend nexus-dev retry targeted at:
1. `apps/agent/src/avatar_agent/entrypoint.py` - call `generate_and_send_summary` from `handle_job`'s end-of-call path.
2. `apps/web/projects/conversation/.../summary-page.component.ts` - initialize `feedbackSubmitted` from `summary().feedback_submitted` in `fetchSummary()`'s success handler.

D-3 (a11y pattern) and D-4 (cross-doc contract mismatch) should be picked up in the same or a follow-up pass; neither blocks on its own but D-4 needs a product/architecture decision before it can be closed either way.
