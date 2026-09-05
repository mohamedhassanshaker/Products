# QA Report - Dev-19b (BL-16: Review & edit UI) - closes out BL-16 (Dev-19a + Dev-19b)

Date: 2026-08-10
Scope: Dev-19b only (BL-16 UI: paginated review, inline edit, bulk-action toolbar, finalize wizard, session-status/error states). Dev-19a backend already QA-green (not re-litigated except where this phase depends on it). Dev-20a and later out of scope.

## Environment

- Backend: real compiled apps/api (nest build output), booted via a disposable bootstrap script (NestFactory.create(AppModule), identical to main.ts bootstrap sequence) against a dedicated MySQL 8.4 instance (the already-running examland-mysql container), with the AI_SERVICE_PORT singleton monkey-patched post-boot to a deterministic fake (no live AI engine available in this environment - the same substitution nexus-dev used, and reasonable since generation-engine correctness is Dev-18a/19a own already-QA-green concern).
- Frontend: real apps/web production build, served by the same Nest process via ServeStaticModule (SPA fallback), exercised with a real Playwright/Chromium browser.
- NODE_ENV=development plus DEFAULT_TENANT_SUBDOMAIN=qa19b used to route by default-tenant instead of Host-header subdomain, a local testing convenience the tenant-resolution middleware itself provides for non-prod-like envs; this exercises an already-unit-tested branch of the same middleware, not a different code path than production subdomain resolution logic.
- One disposable tenant plus Tenant Admin provisioned via the real TenantProvisioningService.
- All throwaway infrastructure (bootstrap script, copied public build output, temporary MySQL schemas) removed after the run; the long-lived examland-mysql/examland-qdrant containers were left exactly as found.

## Traceability matrix

| Requirement / exit-gate item | Scenario tested | Result | Evidence |
|---|---|---|---|
| FR-PDF-8 review/edit/flag/bulk UI | Real browser: upload to Generating to Reviewing table renders confidence percent, edited status, flag icon, actions | Pass | 07-reviewing-state.png |
| FR-PDF-8 inline edit, human-edited badge | Edited question text inline, saved, Edited badge appeared | Pass | 10-after-edit-saved.png |
| FR-PDF-8 human-edited/review-flag independence | Backend real-DB e2e rerun against live MySQL: editing sets is_human_edited=1 without touching is_review_flagged; flag toggle independent, asserted against DB columns | Pass | test:e2e rerun, 6/6 green |
| FR-PDF-8 bulk-action toolbar disabled-at-zero-selection | Screenshot shows bulk buttons disabled at 0 selected; real click enables and executes bulk-delete on 1 selected row, snackbar shown, row count decremented | Pass | 07,12,13,15 screenshots |
| FR-PDF-8 bulk no-op edge case empty ids | Backend e2e: bulk-delete/regenerate with empty ids array is a genuine 200 no-op, not an error | Pass | same rerun |
| FR-PDF-9 finalize wizard module config plus curriculum linking | Real browser: finalize wizard rendered, form filled, submitted, finalize endpoint succeeded, redirected to new Exam Type detail | Pass | 15,16,17 screenshots |
| FR-PDF-9 NO_ELIGIBLE_QUESTIONS and INVALID_CONTEXT_WEIGHT error paths | Backend e2e: both rejected server-side before creating anything | Pass, server-side authoritative | same rerun |
| Client-side eligible-count estimate is cosmetic only, never a submission gate | Source review of PdfFinalizeComponent: finalize always calls the real server endpoint regardless of the local eligibleCount signal; a dedicated NO_ELIGIBLE_QUESTIONS handler proves server re-validates independently. Browser shows the estimate readout alongside the real submit | Pass | pdf-finalize.component.ts, 15-finalize-wizard.png |
| Cross-phase headline flow upload to Generating to Reviewing to edit to bulk-delete to Finalize to Exam Type appears in exam-types list | Full real-browser run, one session, end to end | PASS | screenshots 03 through 18; 18-exam-types-list.png shows the new exam type with 1 total question and 30 min |
| Generating/Reviewing/Failed states render distinctly purely from session status | Source review of the view computed signal confirms distinct template branches for loading, generating, reviewing, failed; UX_GUIDELINES section 11.6 itself defines the Error state as the rendered treatment of the Failed status value, so Failed is not a naming mismatch versus the spec's own Error label | Pass by design | pdf-session.component.ts, UX_GUIDELINES section 11.6 |
| Finalizing sub-state spinner plus disabled form plus button label | Source review: fieldset disabled while busy, button label toggles to a Finalizing label, matching spec exactly | Pass, source-verified; not screenshot mid-flight because the fake-AI plus local-DB submit completed too fast to reliably capture the transient frame | pdf-finalize.component.html |
| Section 11.6 Error/Failed terminal panel content | Source review: centered panel, error message rendered only if present, delete-import action, matches spec | Pass, source-verified; a genuine Failed status was not reproduced live in this session, a zero-extractable-text PDF instead hit the documented empty-Reviewing-state path, itself correctly rendered | pdf-session.component.html |
| Reviewing state zero-questions empty sub-state | Uploaded a PDF with no extractable text; session completed with 0 questions; UI rendered the no-questions-generated message with delete-import and upload-different-pdf actions | Pass | 19-error-failed-state.png, filename is misleading, this is the Completed empty-questions state, not Failed |
| No session-list landing page, is this a real backend gap | Grepped PdfProcessingController directly: only upload, sessions by id, sessions by id questions, questions by id flag/unflag, bulk-delete, regenerate, finalize exist; no bare sessions list route anywhere in the shipped backend, confirming nexus-dev's own claim rather than a missed endpoint | Confirmed genuine gap | pdf-processing.controller.ts route list |
| Frontend unit suite | Full apps/web suite rerun | Pass, 48 suites, 261 tests, matches self-report exactly | command output |
| No regression on other workspaces | apps/web typecheck clean; full apps/api unit suite rerun | Pass, 155 suites, 1277 tests | command output |
| Browser console/network errors | Checked across both full-flow Playwright runs | Pass, zero console errors in either run | console-errors logs, both none |

## Independent backend re-verification

Reran apps/api/test/pdf-review-finalize.e2e-spec.ts against a live, dedicated MySQL schema with the project's own fake-AI convention: 6 of 6 tests green, covering paginated listing, edit/flag independence asserted against real DB columns, bulk no-ops on an empty ids array, NO_ELIGIBLE_QUESTIONS rejection, INVALID_CONTEXT_WEIGHT rejection, and a real finalize creating live exam_module and exam_type_question rows plus an exam_type_curriculum link. This independently re-confirms the backend contract this UI phase is built against is intact after Dev-19b's changes, a UI-only phase where no backend files were touched.

Note on process, not a defect: the first attempt at this rerun used a bare jest invocation and got 5 of 6 failures with sessions going straight to Failed/INTERNAL_ERROR. Root-caused, via a disposable diagnostic script with a temporary raw-error console log reverted immediately after, to a missing NODE_OPTIONS experimental-vm-modules flag that the project's own test:e2e npm script always sets, required by a transitive pdfjs-dist dependency's dynamic import. Rerunning via the actual npm run test:e2e script gave the clean 6 of 6 pass above. This was a tooling mistake on my part, not a product defect, noted here for transparency.

## Defects found

None blocking. Two minor, non-blocking observations, neither against this phase's own exit gate:

1. PdfProcessingService's processSession catch block that sets a session to Failed never logs the underlying raw error before wrapping it in the sanitized InternalDomainError; an operator debugging a real Failed session in production has only the generic message and no log line to correlate with the real cause, contrasting with two other logger.error calls in the same file for other failure paths. This is Dev-19a backend code, already QA-green and out of this phase's scope, surfaced only while diagnosing my own tooling mistake above. Severity: low, an operability rough edge, not blocking.
2. A genuine Failed session with INTERNAL_ERROR was not reproduced live in the browser within this session's time budget; a zero-text PDF fixture instead correctly hit the Completed-with-zero-questions empty-review path, itself a valid and correctly rendered state per the matrix above. The section 11.6 Error/Failed panel was verified via direct source and template review instead of a live screenshot; its rendering logic is a simple, fully-covered conditional branch with dedicated unit-test coverage in the passing 48/261 suite. Assessed as adequately covered, not a gap that changes the verdict.

## Verdict

Dev-19b (BL-16 UI) is QA-green, no blocking defects. The full cross-phase headline flow, upload through Generating, Reviewing with inline edit/flag/bulk-delete, Finalize, and the resulting Exam Type genuinely appearing in Dev-12b's exam-types list, was independently re-driven end to end in a real browser against a real backend and real MySQL, and passed with zero console errors. The two documented judgment calls, no session-list landing page and the client-side eligible-count estimate being cosmetic only, are both independently confirmed as reasonable and correctly implemented: the missing list endpoint is a genuine, pre-existing backend gap rather than a UI-phase miss, and the server always re-validates finalize eligibility regardless of the client's estimate. This closes out BL-16 (Dev-19a plus Dev-19b) in full.
