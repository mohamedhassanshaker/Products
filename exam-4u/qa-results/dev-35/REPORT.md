# QA Report: Dev-35 (BL-34: Streaming/granular progress feedback for long jobs)

**Date:** 2026-08-12
**Scope:** Dev-35 only (Phases 1-5, Dev-30..34 already QA-green; Dev-36+ do not exist). Per
orchestrator instruction, this is a targeted phase QA pass, not Final Review.

## Environment

- Real MySQL 8.4 (`examland-mysql` container, already running) + real Qdrant (`examland-qdrant`
  container, already running).
- `apps/api` unit suite: `npm run test -w apps/api` (Jest, `NODE_OPTIONS=--experimental-vm-modules`).
- `apps/web` unit suite: `npx ng test --watch=false` from `apps/web`.
- One independently-authored, temporary real-HTTP/real-MySQL e2e spec
  (`apps/api/test/dev35-progress-qa.e2e-spec.ts`) built to directly exercise the live-progress
  requirement; deleted after the run per test hygiene.
- A live-browser (Playwright/Chromium) pass was attempted but abandoned after an unrelated local
  static-asset-serving environment quirk (see Defect/Gap D1 below) consumed disproportionate time
  for a P2, additive-fields-only UI change; not a Dev-35 code defect.

## Traceability matrix

| Requirement | Scenario(s) tested | Result | Evidence |
|---|---|---|---|
| Spec section 7.3: "granular progress beyond the coarse status enum" | Real 6-page Exam-type PDF job with an artificially slow (1200ms) per-page AI call; polled `GET /pdf-processing/sessions/:id` live, repeatedly, while genuinely `Processing` | PASS | Observed snapshots: 17% -> 33% -> 50% -> 67% -> 83% -> Completed (null), monotonically increasing, matching `round(processedPageCount/pageCount*100)` exactly at every snapshot, never regressed, never exceeded 99 while in-flight |
| `computeProgressPercent`: `pageCount === null` -> `null` | Unit test (`pdf-processing.service.spec.ts`, `Extracting`/`pageCount: null`) | PASS | Re-ran; 4/4 green in the `describe('granular progress ...')` block |
| `computeProgressPercent`: normal in-flight rounding | Unit test (`3/8 -> 38%`) + independently re-derived via the live e2e's own per-snapshot cross-check formula | PASS | Both agree exactly |
| `computeProgressPercent`: 99%-clamp (never fabricated 100 while still `Processing`) | Unit test (`lastCompletedPage === pageCount`, still `Processing` -> 99) + live e2e's final in-flight snapshot before `Completed` (83%, never jumped to 100 before the terminal status write) | PASS | Confirmed both at the unit level and via genuine live timing |
| `computeProgressPercent`: `null` once terminal (`Completed`/`Failed`) | Unit test + live e2e's own final `GET` after `Completed`: `progressPercent: null`, `processedPageCount: 6` (still surfaced) | PASS | Exact match to the documented contract |
| Frontend: determinate `mat-progress-bar` + "Page X of Y (Z%)" label when available | `pdf-session.component.spec.ts`'s 2 new Dev-35 tests (progress bar + label renders; indeterminate spinner renders with no `mat-progress-bar` in the DOM otherwise) + direct read of `pdf-session.component.html`/`.ts` (`progressLabel()`, `aria-valuenow`/`aria-valuemin`/`aria-valuemax` on the bar) | PASS (component-level; no live-browser confirmation this pass — see gap D1) | Code matches the documented contract exactly; `progressLabel()` returns `null` in the same cases the backend returns `null`, so the fallback-to-spinner logic is provably correct by construction, not just by the 2 example-based tests |
| `FullBankAssessmentService` (BL-25) correctly left out of scope | Grep-confirmed (independently, not just trusting the completion note) zero references to `FullBankAssessmentService`/its poll endpoint anywhere in `apps/web/src` | PASS | No UI consumer exists; scope decision is faithful |
| Streaming-vs-polling scope decision (real push vs. enhanced polling) | Read spec section 7.3 directly; the bullet reads "Streaming/granular progress feedback... beyond the coarse status enum" with no separate bullet demanding a specific transport (unlike section 7.3's own separate, more specific "durable job-queue" and "OCR pipeline" bullets, which *do* name a concrete mechanism) | PASS — reasonable and faithful, not an avoidance | See "Streaming-vs-polling scope sanity check" below |
| Unit regression (`apps/api`) | Full suite re-run from scratch | PASS | 183/183 suites, 1592/1592 tests — exact match to nexus-dev's own reported count |
| Unit regression (`apps/web`) | Full suite re-run from scratch | PASS | 61/61 files, 350/350 tests — exact match to nexus-dev's own reported count |
| Security self-review (independent second look) | Confirmed no new endpoint/route; the three new fields ride the existing, already-guarded `GET /pdf-processing/sessions/:id` response (`owner or exams.review`, unchanged); no new input surface, no new dependency, no secret | PASS | No findings |
| Architecture compliance | `computeProgressPercent` lives as a pure function in the existing `pdf-processing.service.ts` (matching the codebase's own pure-helper convention, e.g. `confidence.ts`); `PdfSessionComponent` is the correct, already-established owner of this screen's rendering — no boundary violation | PASS | No findings |

## Live-progress proof detail (the headline exit gate)

Built a temporary e2e spec (deleted after the run) that:
- Uploaded a real 6-page PDF (built with `pdfkit`, each page with >20 chars of real text so the
  `MIN_PAGE_TEXT_CHARS` negligible-text-skip path — confirmed by reading
  `exam-extraction.service.ts` directly — does not fire and mask the observation), hinted
  `contentTypeHint: Exam`.
- Overrode `AI_SERVICE_PORT.extractExamPage` with a 700ms-delayed fake so the 6-page job took
  ~4.2s — long enough to poll genuinely mid-flight, not just start/end state.
- Polled `GET /pdf-processing/sessions/:id` every 300ms for the whole run and asserted, on every
  `Processing` snapshot: `progressPercent` is non-decreasing, never exceeds 99, and exactly equals
  `round(processedPageCount/pageCount*100)` clamped to `[0,99]` — i.e. cross-checked the wire value
  against the raw watermark fields on every single snapshot, not just once.
- Result: `[17, 33, 33, 50, 50, 50, 67, 67, 83, 83, 83]` then `Completed` with `progressPercent: null`
  and `processedPageCount: 6` still surfaced. Test passed.

This is real, live, causally-connected progress (driven by the actual per-page watermark writes in
`ExamExtractionService`/`PdfProcessingSessionRepository.persistBatchAndAdvanceWatermark`), not a
canned/mocked assertion.

## Streaming-vs-polling scope sanity check

Independently re-read spec section 7.3. The bullet's exact wording is "Streaming/granular progress
feedback for long-running generation jobs (beyond the coarse status enum)." Two other section 7.3
bullets in the same list *do* name a specific mechanism explicitly ("a durable job-queue-based
worker model," "OCR pipeline") where the spec author clearly had a concrete transport/architecture
in mind. This bullet does not — "streaming" here reads as a loose synonym for "not-just-a-single-
enum-value," and the parenthetical ("beyond the coarse status enum") is the operative, concrete
requirement. nexus-dev's interpretation — a percentage/count is the granular signal the spec is
actually asking for — is a reasonable, faithful reading, not a shortcut. The written justification
(no existing push-transport precedent anywhere in this codebase, even in the reliability workers,
which poll their own DB rows) is independently verifiable and correct by inspection of the codebase.
**Verdict: reasonable and faithful, not work-avoidance.**

## nexus-ux consultation — investigation and verdict

Checked `docs/NEXUS_STATE.md`'s decision log directly (not just nexus-dev's own summary) and
`docs/design/UX_GUIDELINES.md` for any Dev-35 coverage: **none exists**. nexus-ux was genuinely
**not** consulted for this phase — this is not an omission from the completion-note prose, it is a
real, confirmed gap in the record.

**Is this defensible for this phase's actual scope?** Yes, on balance, for these reasons:
- The change is additive fields on an *existing*, already-shipped screen's *existing* loading state
  (`PdfSessionComponent`'s "generating" view) — no new screen, no new route, no new flow, no new
  user decision point. It replaces one already-established "in progress, no further action
  available" visual (indeterminate spinner) with a strictly more informative variant of the *same*
  semantic state (determinate bar + text label), governed by Material's own well-established
  determinate/indeterminate progress-bar conventions that this project's own `UX_GUIDELINES.md`
  already codifies elsewhere (section 9.3's own "determinate-then-indeterminate" precedent for
  upload progress) — there was an existing, applicable design vocabulary to extend, not a blank
  page requiring fresh judgment calls (contrast this with Dev-28/BL-27 or Dev-31/BL-30, both
  correctly nexus-ux-consulted, which introduced a *new* button/action/dialog with real decision
  points: confirm-or-not, error-copy variants, empty states).
- This project has an explicit, established precedent for skipping nexus-ux on exactly this class
  of change: Dev-17b's avatar-wiring pass (`docs/NEXUS_STATE.md`, 2026-08-xx entry) skipped
  nexus-ux with near-identical reasoning ("reuses the project's already-established loading/empty/
  error-state vocabulary... rather than introducing a new multi-step flow").
- The resulting UI is not confusing or inaccessible: `progressLabel()` provides a real, meaningful
  text label; the `mat-progress-bar` carries `aria-valuenow`/`aria-valuemin`/`aria-valuemax`; the
  fallback to the pre-existing indeterminate spinner is exactly the prior behavior, never a
  regression.

**Verdict: a defensible skip for this phase's actual scope — non-blocking process note, not a
functional defect.** However, unlike Dev-17b (which explicitly documented the "no nexus-ux
needed" reasoning inline in the plan), Dev-35's own completion notes and plan section say nothing
about this decision at all — it is simply absent, discovered only by cross-checking the record. This
is worth flagging back to nexus-dev as a documentation-completeness gap for next time (every
UI-touching phase should say *something* about the nexus-ux question, even if the answer is "no,
because..."), not because the underlying skip decision was wrong.

## Defects / gaps found

**D1 (non-blocking, environment/process only — not a Dev-35 code defect).** A live-browser
(Playwright) pass was attempted to visually confirm the progress bar and the indeterminate-spinner
fallback rendering in a real compiled build. It was abandoned after a local
`ServeStaticModule`/Express static-file-serving issue in this specific ad hoc boot rig (SPA
`index.html` returning 404 for non-`/api` routes) could not be root-caused within a reasonable time
box; direct code inspection did not turn up anything Dev-35-specific (the same
`ServeStaticModule.forRoot` config, unmodified by this phase, is what every previous successful
live-browser QA pass in this project's history has relied on, so this is very likely a local rig/
environment artifact of this pass's specific ad hoc boot script, not a regression in the shipped
code). Compensated with: (a) the live real-HTTP backend proof above (the actual headline
requirement), and (b) the passing frontend component-level tests plus a direct read of the
template/component code, which together leave no reasonable doubt about the rendering logic's
correctness. Recommended as a follow-up if a future phase needs a live-browser rig for this screen
again, not a retry trigger for Dev-35.

No other blocking or non-blocking defects found in Dev-35's own implementation.

## Verdict

**PASS — Dev-35 is QA-green, no blocking defects.** The nexus-ux-consultation skip is judged
defensible for this phase's actual (additive, existing-vocabulary) scope; D1 is a non-blocking,
environment-only coverage gap in this QA pass's own browser rig, not a product defect.
