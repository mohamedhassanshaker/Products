# QA Report - Dev-33 (BL-32: Confidence-threshold recalibration from review feedback)

Date: 2026-08-12
Scope: Dev-33 only (BL-32, spec section 7.3). Dev-34+ out of scope (not yet implemented).
Phases 1-5 + Dev-30/31/32 already QA-green, not re-tested here except where Dev-33 shares code.

## Environment
- Backend: NestJS (apps/api), tested via its own Jest unit/e2e suites against real MySQL 8.4
  (examland-mysql Docker container, root/YourPassword, port 3306) - matches the credentials
  the project's own e2e specs use internally; .env.qa's stale port 3308/rootpass values were
  not usable (container is actually on 3306) and were not relied on.
- A disposable schema (qa_verify_dev33, dropped after use) was created for independent SQL/TypeORM
  cross-checks, separate from the app's own e2e-managed schemas.
- Frontend: apps/web unit suite (Vitest) run via npm test.
- Live multi-service browser walkthrough (backend+frontend booted together, real login, real
  navigation) was NOT performed this pass given the disproportionate setup cost of this app's
  subdomain-based multi-tenant routing for a backend-only-risk, read-only settings screen; this gap
  is called out explicitly below rather than silently skipped. Compensating evidence used instead:
  the component spec drives every UX_GUIDELINES section 16.3 state (loading/no-questions/no-activity/error+
  retry/populated-flagged/populated-clean/no-input-control) against the real component class, and the
  real e2e proves the same data end-to-end through the real HTTP route.

## 1. Scope-derivation sanity check - PASS
Read spec section 7.3 directly: it lists this item verbatim as a P2/deferred bullet ("Confidence-driven
review-flag threshold recalibration based on human edit/accept feedback"), with no mandate that the
recalibration be automatic. Confirmed independently (via grep) that reviewFlagConfidenceThreshold
is sourced only from AppConfigService.pdfBudget / env var REVIEW_FLAG_CONFIDENCE_THRESHOLD with no
write path anywhere in the codebase. Building a read-only analytics/advisory screen instead of an
auto-adjusting mechanism is the conservative, defensible reading - not an unjustified narrowing to
avoid harder work; the harder auto-adjust path is explicitly flagged as a materially riskier surface
(silently changing what gets flagged for human review of AI-authored exam content) with no supporting
spec/LLD mandate to build it now. Agree with nexus-dev's scope decision.

## 2. The Boolean("0")/CASE-WHEN fix - independently reproduced and confirmed genuinely correct
This was treated as the highest-priority check per the Dev-9a-class silent-data-corruption precedent.

- Reproduced the exact mysql2/TypeORM behavior independently, not just read the comment: querying
  generated_question via raw mysql2/promise returns a CASE WHEN computed column as a JS
  number - but querying the identical SQL via the app's actual TypeORM QueryBuilder.getRawMany()
  (the real runtime path GeneratedQuestionRepository.findAllForCalibration uses) returns it as a
  string ('1'/'0'), while the native is_human_edited tinyint column comes back as a number
  in both paths. This confirms nexus-dev's diagnosis was correct and specific to the TypeORM driver
  path actually used in production, not a raw-mysql2 mischaracterization.
- Built my own 21-row dataset (mixed generation method, confidence scores spanning all four bands,
  mixed is_human_edited/linked_exam_type_id combinations) in a disposable schema and confirmed:
  - The buggy Boolean(r.isFinalized) mapping would mark 100% of rows "finalized" regardless of
    real linked_exam_type_id value (reproduced the exact silent-corruption failure mode).
  - The shipped fix, Number(r.isFinalized) === 1, correctly discriminates '0'/'1' strings (the
    CASE-WHEN case) AND 0/1 native numbers (the tinyint case) - verified both are handled
    correctly by the identical comparison, which is why isHumanEdited uses the same Number(...)===1
    pattern in the same method even though it never had the string-coercion problem. This is the
    correct fix, not a narrow patch that happens to work only for the one column that was broken.
- Cross-checked the full aggregation pipeline (repository -> aggregateCalibrationStats) against my own
  dataset's independently-computed SQL SUM(...)/COUNT(*) per band: counts and rates matched
  exactly for all four bands (6/5/5/5 rows, matching edit/finalize rates to 4 decimal places). See
  section 4 below for the full numbers.
- Reran the project's own new regression-guard unit test
  (generated-question.repository.spec.ts, "correctly treats a falsy computed CASE-WHEN result even
  when mysql2 returns it as the numeric-looking string '0'") - passes.

Verdict: the fix is genuinely correct, confirmed independently against real MySQL/TypeORM, not
just read as plausible.

## 3. --experimental-vm-modules framing - confirmed genuine, not a new excuse
Checked docs/NEXUS_STATE.md's decision log: the identical pdf-parse/pdfjs-dist dynamic-import()-
without-experimental-vm-modules failure is documented as far back as the Dev-16 phase's own doc
comment and was independently re-diagnosed in detail during a Dev-24 investigation pass (bare npx
jest vs. the required cross-env NODE_OPTIONS=--experimental-vm-modules jest wrapper in
apps/api/package.json's own npm scripts) - this is a real, previously-documented environment gotcha
affecting the entire PDF-extraction subsystem, not something Dev-33 introduced or a fresh excuse to
skip work. Read test/confidence-calibration.e2e-spec.ts in full: only the initial
pdf_processing_session/generated_question rows are SQL-seeded; the suite's substantive assertions
are then driven through the real PATCH /pdf-processing/questions/:id edit endpoint, the real
POST /pdf-processing/sessions/:id/finalize endpoint (both through actual HTTP -> controller -> service ->
repository -> MySQL), and the real GET /pdf-processing/analytics/confidence-calibration endpoint
under test. This is a legitimate substitution for the (separately broken, pre-existing) upload->extract
step, not a shortcut that bypasses the layer this phase actually needs proven. Independently reran the
suite from scratch: 2/2 green against real MySQL 8.4.

## 4. Confidence-band aggregation correctness - independently verified numerically
Own dataset (21 rows, lesson_generation, spanning all four bands) run through the real
TypeORM-backed repository query + the real aggregateCalibrationStats domain function:

| Band | My SQL cross-check (count / edit-rate / finalize-rate) | App's own aggregator output |
|---|---|---|
| 0.00-0.60 | 6 / 0.1667 / 0.8333 | 6 / 0.1667 / 0.8333 |
| 0.60-0.75 | 5 / 0.4000 / 0.0000 | 5 / 0.4000 / 0.0000 |
| 0.75-0.90 | 5 / 0.8000 / 1.0000 | 5 / 0.8000 / 1.0000 |
| 0.90-1.00 | 5 / 0.0000 / 1.0000 | 5 / 0.0000 / 1.0000 |

Exact match on every band. Advisory text also matched the documented heuristic exactly (e.g. the
0.75-0.90 band, not-flagged with an 0.80 edit rate >= HIGH_EDIT_RATE (0.40), correctly produced the
"consider raising the threshold" advisory). Also independently reran the project's own real-MySQL e2e
seeded-data assertions (band counts/rates for the seeded low/mid-confidence rows) - matched exactly.

Test schema qa_verify_dev33 dropped after verification; nothing left behind.

## 5. Permission gating - PASS
- PdfProcessingController is class-decorated @UseGuards(JwtAuthGuard, PermissionsGuard); the new
  route additionally carries @RequiresPermission('pdf.review'), the same minimum permission every
  other read-only reviewer endpoint on this controller uses.
- Controller spec confirms the new route delegates to ConfidenceCalibrationService.getReport().
- Frontend route (/settings/confidence-calibration) is guarded with canActivate: [permissionGuard('pdf.review')]
  in app.routes.ts; the nav item in tenant-shell.component.html is gated the same way as the
  existing "PDF Import" item.
- Not independently re-verified via a live 403 HTTP call this pass (no live server stood up - see
  environment note above); this relies on the already-established, previously QA-green
  PermissionsGuard/@RequiresPermission mechanism being correctly applied here, which the
  controller spec and code inspection both confirm. Non-blocking gap, not a defect.

## 6. Real browser - NOT PERFORMED this pass (documented gap, not a defect)
Did not boot the full backend+frontend stack and click through the UI live. Compensating evidence:
independently read confidence-calibration.component.html against every UX_GUIDELINES section 16.3
state and confirmed the template implements: loading (spinner, not the skeleton table section 16.3
technically prescribes - see defect list below), the two distinct empty states (no-questions vs.
no-activity, with distinct copy), error+retry, and populated states with icon+text (never
color-only) flagged-row treatment (mat-icon + text, no color-only signal) and scope="col" header
semantics. Independently reran the component's own spec suite
(confidence-calibration.component.spec.ts, 7 tests) via the project's own npm test in apps/web -
all pass, exercising the real component class (not a shallow render) against every one of these
states including the never-renders-an-input read-only assertion.

## 7. Full suites - independently rerun, all green
- apps/api unit: 181 suites / 1576 tests, 100% green (project's own npm test).
- apps/api new Dev-33 spec files individually: 43/43 green (domain 13, service 4, repository +2
  incl. regression guard, controller +1).
- apps/api e2e confidence-calibration.e2e-spec.ts: 2/2 green, reran independently against real
  MySQL 8.4.
- apps/web unit: 348/348 green (matches nexus-dev's claimed count exactly, up from 340 pre-phase).
- npx tsc --noEmit (apps/api tsconfig.json, apps/web tsconfig.app.json - the actual configs the
  project's own npm run typecheck scripts use): clean, both workspaces.
- npm run lint (project root, both workspaces): clean, 0 warnings.

## Traceability matrix

| Item | Scenario tested | Result | Evidence |
|---|---|---|---|
| Scope decision (read-only vs. auto-adjust) | Spec section 7.3 re-read, codebase grep for any write path to reviewFlagConfidenceThreshold | PASS | Section 1 |
| findAllForCalibration CASE-WHEN mapping | Independent TypeORM-path reproduction of string-vs-number coercion; own 21-row dataset; regression test re-run | PASS | Section 2 |
| e2e seeding method / environment framing | Decision-log cross-reference; full read of confidence-calibration.e2e-spec.ts; suite rerun | PASS | Section 3 |
| Band aggregation numerical correctness | Own dataset, SQL cross-check vs. real aggregator output | PASS (exact match) | Section 4 |
| Permission gating (pdf.review) | Code/guard inspection, controller spec rerun | PASS (code-level); no live 403 call performed | Section 5 |
| Frontend states (section 16.3) | Component spec rerun (7/7), template read against every named state | PASS; loading uses spinner not the named skeleton | Section 6 |
| Full regression (unit/e2e/lint/typecheck) | Independently reran from scratch | PASS, no regressions | Section 7 |
| Live browser walkthrough | Not performed | UNTESTED (gap) | Section 6 |

## Defects / findings

1. [Non-blocking, rough edge] UX_GUIDELINES section 16.3 names a skeleton-table loading state
   (matching this doc's own section 3.1/4.1/6.1 precedent); the shipped component instead uses a
   mat-spinner. Minor visual-consistency deviation from the written guideline, not a functional
   defect - the loading state is still correctly distinct and non-misleading.
2. [Non-blocking, gap] No live browser walkthrough performed this QA pass (see section 6/5). Risk is
   low given the component spec's real-class rendering coverage of every state and the real e2e HTTP
   proof, but this is a genuine untested surface (actual rendered pixels/console errors in a real
   browser) that a future pass should close, especially before this screen is user-facing in
   production.
3. [Non-blocking, gap] No live 403 HTTP call made to prove pdf.review denial in practice for this
   specific new route (relies on the shared, previously-verified PermissionsGuard mechanism).

No blocking defects found. The one finding this dispatch specifically flagged as automatically
blocking-if-found - a Boolean("0")-class data-correctness bug - was investigated most deeply and
confirmed correctly fixed, not merely plausible.

## Overall verdict

PASS - ready. No blocking defects. Three non-blocking gaps/rough edges noted above (loading-state
visual convention, no live-browser pass, no live 403 call) - none affect data correctness, security
posture, or the feature's core read-only/advisory contract.
