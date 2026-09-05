# QA Report -- Dev-12b retry 1 (BL-11: Manual (ZIP) Exam Authoring UI)

**Date:** 2026-08-09
**QA agent:** nexus-qa (independent re-verification pass -- retry 1 of 3 for Dev-12b)
**Scope:** Independent re-verification of the two fixes nexus-dev reports for
`qa-results/dev-12b/REPORT.md`'s findings:
1. Defect 1 -- lint failure (unused rxjs imports in `taxonomy.service.ts`).
2. Defect 2 -- `QUESTION_COUNT_MISMATCH` never validated the ZIP's real parsed content against
   declared per-module counts (Dev-12a-owned gap, closed as a targeted follow-up in this fix pass).

Nothing here is taken on nexus-dev's self-report alone -- every claim below was independently
reproduced against infrastructure I provisioned myself.

## Environment

- Dedicated, disposable MySQL **8.4** Docker container (`qa-dev12b-mysql-retry1`, host port 3322),
  removed after the run -- not the developer's persistent `examland-mysql` container, and a different
  container from the original Dev-12b QA pass's.
- Dedicated, disposable MailHog container for the browser pass, removed after the run.
- Backend: `apps/api`, booted directly via `NestFactory.create(AppModule)` in a throwaway script
  against the real MySQL 8.4 instance (platform schema migrations applied via
  `platformDataSource.runMigrations()`, same documented gap the original Dev-12b pass hit -- no
  automated platform migration-runner exists yet). Also exercised via the project's own
  `apps/api/test/exam-authoring.e2e-spec.ts` and the full `apps/api` e2e suite, both run against this
  same live MySQL 8.4 container (not mocked, not the CI/sandbox default).
- Frontend: `apps/web`, built via `ng build --configuration production` (the project's real
  single-image deployment shape) and served from `apps/api/public/` via the API's own
  `ServeStaticModule` -- removed after the run.
- Real browser: Playwright + Chromium (ad hoc, not added to the project as a dependency).
- A real tenant ("QA Browser Tenant", slug `qab12b`) provisioned via the real
  `TenantProvisioningService`, a real Tenant Admin created via the real provisioning flow (password
  set directly for automation, matching the project's own e2e-suite convention for logging in as a
  provisioning-seeded admin), and a real Education Level ("Secondary") -> Stage ("Grade 10") created
  via the real taxonomy HTTP API.
- Real fixture ZIPs built via `yazl`: `valid.zip`, `structure-mismatch.zip`, `malformed-question.zip`,
  `count-mismatch.zip` (declares 2 questions for module "Algebra"; the ZIP genuinely contains only 1).
- All temporary infrastructure (containers, throwaway boot/test scripts, `.env` files, the built
  `public/` bundle, seeded tenant/data) torn down after the run; nothing left in the repository besides
  this report and its screenshots.

## Independent verification of Defect 1 (lint)

`npm run lint` reproduced clean at the repo root: **0 errors, 0 warnings.** Confirmed fixed.

## Independent verification of Defect 2 (QUESTION_COUNT_MISMATCH real-content validation)

Read `apps/api/src/modules/exam-authoring/application/exam-authoring.service.ts` and
`apps/api/src/modules/exam-authoring/domain/errors.ts` directly (not just nexus-dev's description):
confirmed `assertActualMatchesDeclaredModuleCounts` genuinely cross-checks each declared module's
`questionCount` against `parsed.modules[].questions.length` (the ZIP's real parsed content), throws
`QuestionCountMismatchError.forModule(moduleName, declaredCount, actualCount)` on a mismatch, and that
`buildInsert` now derives the persisted `ExamModuleEntity.questionCount` from `parsed`, not `input` --
a structural fix, not merely an added gate.

**Independent reproduction (not nexus-dev's own test file)**: wrote and ran my own throwaway e2e test
against my own MySQL 8.4 container, driving the real HTTP endpoint exactly as the original QA pass's
Defect 2 repro did:
- Declared `totalQuestions=2` / module `Algebra` `questionCount=2` (self-consistent -- the client-side
  arithmetic pre-check correctly does not block it), but the ZIP genuinely contains only 1 real
  question file for "Algebra".
- Result: **`400 QUESTION_COUNT_MISMATCH`**, response body:
  `{"error":{"code":"QUESTION_COUNT_MISMATCH","message":"Module \"Algebra\" declares 2 question(s), but the ZIP archive actually contains 1 valid question file(s) for that module.","details":{"module":"Algebra","declaredCount":2,"actualCount":1}}}`.
- Direct DB query immediately after: `SELECT COUNT(*) FROM exam_type` / `exam_module` /
  `exam_type_question` -- **all three zero.** No storage artifacts were written (verified the
  `StoragePort.put` was never reached, consistent with the code's own validate-before-write ordering).
- **Happy-path re-check** (per orchestrator instruction #3): declared=2/actual=2 (genuinely matching)
  still succeeds with `201`, and `exam_module.question_count` is persisted as `2` -- the *derived*
  value, proven correct-by-construction rather than merely equal to the client's claim.

Also independently re-ran nexus-dev's own new tests against my own MySQL 8.4 instance (not trusting
their self-reported numbers):
- `apps/api` unit suite: **114 suites / 931 tests, all green** -- matches the self-report exactly.
- `apps/api` e2e suite (all 24 suites, not just `exam-authoring.e2e-spec.ts`): **24 suites / 238 tests,
  all green** -- matches the self-report exactly, run against a real MySQL **8.4** container (the
  developer's own verification note flagged their environment used `mysql:latest`/26.7, not literally
  8.4 -- this QA pass used the real `mysql:8.4` image, closing that gap).
- `apps/web` unit suite: **37 suites / 206 tests, all green** -- matches the self-report exactly.

**Conclusion: Defect 2 is genuinely fixed at the backend/data-integrity level.** The invariant this
phase's own exit gate cares about most -- "no partial/incorrect artifacts are ever persisted" -- holds
under independent, real-HTTP, real-DB verification.

## New defect surfaced by this fix pass (browser-driven re-verification, orchestrator instruction #4)

Per instruction #4, I re-drove the real upload flow in a real browser against the built production
frontend and the same live backend, to confirm no regression from the shared validation-logic change.
`INVALID_ZIP_STRUCTURE`, `INVALID_QUESTION_FILE`, and `EXAM_TYPE_NAME_EXISTS` all still render their
exact, correct, previously-verified copy -- **no regression there.**

However, a genuine browser-driven upload that reaches the **new** module-level `QUESTION_COUNT_MISMATCH`
path surfaces a defect that did not exist before this fix pass:

**Repro (screenshots in `screenshots-retry1/08-D2-count-mismatch-*.png`):**
1. On `/exam-types/new`, filled Name, Total questions = `2`, Total minutes = `30`, Education
   Level = Secondary, Stage = Grade 10, one module row `Algebra` / question count `2` (self-consistent
   -- passes the client-side arithmetic pre-check).
2. Attached a real ZIP whose `Algebra/` folder contains only 1 real question file.
3. Clicked "Create Exam Type". Network capture of the real request/response:
   `POST /api/exam-types/zip` -> `400`,
   `{"error":{"code":"QUESTION_COUNT_MISMATCH","details":{"module":"Algebra","declaredCount":2,"actualCount":1}}}`
   -- the server is doing exactly the right thing.
4. **The rendered error banner reads**: "The total questions you entered (2) doesn't match the number
   of questions found across your modules (0). Update the Total questions field or your modules, then
   try again."

This message is **factually wrong** (the user's own module row plainly shows question count `2`,
matching their Total questions field of `2` -- there is no "0" anywhere on their form) and never names
the offending module ("Algebra") or the real declared/actual numbers (2 vs. 1) the server now provides.

**Root cause** (read directly in
`apps/web/src/app/features/exam-types/exam-type-create/exam-type-create.component.ts`): the
`QUESTION_COUNT_MISMATCH` case in the server-error switch statement was written for the *old*
declared-vs-declared error shape only:

    case 'QUESTION_COUNT_MISMATCH': {
      const declaredTotal = (error.details?.['declaredTotal'] as number | undefined) ?? this.form.controls.totalQuestions.value;
      const actualTotal = (error.details?.['sumOfModules'] as number | undefined) ?? 0;
      this.bannerMessage.set(
        'The total questions you entered (' + declaredTotal + ") doesn't match the number of questions found across your modules (" + actualTotal + '). Update the Total questions field or your modules, then try again.',
      );
      ...
    }

The new module-level error's `details` shape is `{ module, declaredCount, actualCount }` -- none of
those keys match `declaredTotal`/`sumOfModules`, so both `??` fallbacks fire: `declaredTotal` silently
becomes the client's own form value (2) and `actualTotal` becomes a hardcoded `0`, producing a
confusing, actively incorrect message. This component was never updated to handle the new details
shape this same retry's backend fix introduced.

**Impact**: does not regress the safety guarantee -- zero rows/storage artifacts are still persisted on
this path (confirmed above), and the upload is still correctly rejected. But it directly violates
`QuestionCountMismatchError.forModule`'s own doc comment/FR-AUTH-1's "flagged... naming the specific
offending entity" semantics for this specific, now-reachable path -- a real Exam-Type author hitting a
genuine content/declared-count mismatch will see a message that actively misdescribes their own form
state and never learns which module or numbers are actually wrong. This is a direct, immediate side
effect of this retry's own backend change, not a pre-existing, already-accepted gap -- it did not exist
in the original Dev-12b QA pass because the module-level error path was unreachable at that time.

**Severity**: significant, not blocking the underlying data-integrity guarantee, but blocking the
fully-specified user-facing error semantics for this now-reachable path -- recommend fixing before
advancing rather than deferring.

## Traceability matrix (this retry's scope only)

| Item | Scenario tested | Result | Evidence |
|---|---|---|---|
| Lint clean | `npm run lint` | PASS | 0 errors/warnings |
| QUESTION_COUNT_MISMATCH real-content validation (server) | Genuine ZIP-content-vs-declared mismatch, real HTTP + real DB | PASS | Own e2e repro: 400, correct code/details, zero rows persisted |
| Derived `question_count` on genuine match (no regression) | declared=2/actual=2 | PASS | `exam_module.question_count` = 2 (derived), `exam_type_question` count = 2 |
| Full `apps/api` unit suite | All 114 suites | PASS | 114/931, matches self-report |
| Full `apps/api` e2e suite (real MySQL 8.4) | All 24 suites | PASS | 24/238, matches self-report |
| Full `apps/web` unit suite | All 37 suites | PASS | 37/206, matches self-report |
| Browser upload -- valid ZIP -> success | Real browser, real upload | PASS | screenshots 04/05-A |
| Browser upload -- INVALID_ZIP_STRUCTURE | Real browser | PASS, no regression | screenshot 06-B |
| Browser upload -- INVALID_QUESTION_FILE | Real browser | PASS, no regression | screenshot 07-C |
| Browser upload -- EXAM_TYPE_NAME_EXISTS | Real browser | PASS, no regression | screenshot 09-E |
| Browser upload -- QUESTION_COUNT_MISMATCH (module-level, real content) | Real browser | FAIL -- see defect above | screenshots 08-D2, network capture in this report |

## Overall verdict

**NOT READY.** Both originally-reported defects (lint failure, backend real-content validation gap)
are genuinely and independently confirmed fixed. However, this fix pass introduced a new,
previously-unreachable frontend defect: `ExamTypeCreateComponent`'s `QUESTION_COUNT_MISMATCH` handler
was never updated for the new module-level error shape and renders a factually incorrect message on a
now-reachable path. Recommend a narrowly-scoped Dev-12b retry 2: update the frontend handler to render
`error.details.module`/`declaredCount`/`actualCount` when present (falling back to the existing
declared-vs-declared copy only when those keys are absent, for backward compatibility with the
top-level self-consistency case), then re-verify via a real browser upload -- not just a unit/e2e
assertion on the response shape, since that is exactly how this defect went unnoticed by nexus-dev's
own (backend-only) verification.

This was **retry 1 of 3** for Dev-12b.
