# QA Report — Dev-12b (BL-11: Manual (ZIP) Exam Authoring UI)

**Date:** 2026-08-09
**QA agent:** nexus-qa (independent verification pass)
**Scope:** Dev-12b only (BL-11 UI: exam-type-list, exam-type-detail, exam-type-create/upload
flow, delete flow, FR-AUTH-1/FR-AUTH-5 UI surface). Dev-13+ do not exist yet and are out of
scope. Phase 1/2, Dev-11, Dev-12a are already QA-green and were not re-litigated except where
this phase's behavior depends on them (ZIP validation semantics).

## Environment

- Dedicated, disposable MySQL 8.4 Docker container (qa-dev12b-mysql, port 3321) and a
  disposable MailHog container (qa-dev12b-mailhog, SMTP 1026 / web UI 8026), both removed
  after the run. Not the developer's persistent examland-mysql container.
- Backend: apps/api, run via nest start against the real MySQL instance (platform schema
  migrations applied via a throwaway TypeORM script, deleted after the run - no automated
  platform migration-runner exists yet, same documented gap Dev-6b's QA pass hit).
- Frontend: apps/web, built via ng build (production config) and served statically from
  apps/api/public/ (the project's real single-image deployment shape) - removed after the run.
- Real browser: Playwright + Chromium (ad hoc, not added to the project as a dependency).
- Real tenant ("QA Dev12b Tenant", slug qadev12b) provisioned end-to-end via the actual
  platform provisioning API, not hand-inserted rows. DEFAULT_TENANT_SUBDOMAIN was set to this
  slug for local (non-prod) tenant resolution, per TenantResolutionMiddleware's own documented
  dev-mode convention - no host-mapping/TLS workaround was needed this pass since NODE_ENV
  stayed development.
- Two real tenant users: a Tenant Admin (qa-tenant-admin@example.com, full permission set via
  the seeded "Tenant Admin" role) and a Member (qa-member@example.com, exams.read only, no
  exams.create/exams.delete) - both created via the real users/roles API, passwords set via
  the real forgot/reset-password flow (invite emails retrieved from the real MailHog inbox, not
  faked).
- Two real taxonomy Education Levels ("Secondary" -> Grade 10/Grade 11, "Primary" -> Grade 4/Grade
  5) created via the real taxonomy API, to exercise the cascading Stage picker.
- Real fixture ZIPs built with yazl/hand-rolled entries (valid, structure-mismatch, malformed
  question file, content/declared-count mismatch, duplicate-name reupload).
- All temporary infrastructure (containers, .env.local, built public/ bundle, throwaway
  scripts, seeded tenant/users/data) torn down after the run; nothing left in the repository
  besides this report.

## Automated suites - reproduced, not merely trusted

| Suite | Self-reported | Independently reproduced |
|---|---|---|
| npm run typecheck (3 workspaces) | clean | clean |
| npm run lint | not explicitly reported clean for this phase | FAILS - 5 errors (see Defect 1) |
| apps/web unit suite | 37 suites / 206 tests | 37 suites / 206 tests, all green (exact match) |
| apps/api unit suite | (Dev-12a baseline: 114/929) | 114 suites / 929 tests, all green - confirmed unaffected by Dev-12b (UI-only phase) |

## Traceability matrix

| Requirement / UX_GUIDELINES section 9 item | Scenario(s) tested | Result | Evidence |
|---|---|---|---|
| List screen: skeleton/empty/error/success states, sidebar peer of Users | Fresh tenant, no Exam Types yet | PASS | 02-exam-types-empty-list.png - exact copy match |
| List table columns (Name/Description/Stage/Total questions/Duration/Created/Actions) | Real list with 1-2 rows | PASS | 01-C-list-before-delete.png |
| Mobile card degradation (below 599.98px) | Resized to 375px viewport | PASS | 01-mobile-list.png - table hidden, card shown, correct breakpoint toggle |
| Create flow: dedicated route, field order, cascading Education-Level to Stage select | Real interaction, 2 education levels x 2 stages each | PASS | STAGE_OPTIONS_FOR_PRIMARY=[Grade 4, Grade 5], STAGE_OPTIONS_FOR_SECONDARY=[Grade 10, Grade 11] - cascading filter genuinely works, not just renders |
| Upload state machine: idle -> uploading (determinate percent) -> validating -> success/error | Real ZIP upload via real input type=file | PASS (idle/uploading/success directly observed; validating/indeterminate transition not visually distinguishable at this fixture's small size/fast localhost round-trip, consistent with the spec's own "no separate step required if fast" allowance) | 07-A-during-submit-1.png shows "Uploading... 0%" with form disabled |
| Valid ZIP upload -> Exam Type appears in list, redirect to detail, snackbar | Real upload, valid.zip (1 module, 2 real questions) | PASS | 09-A-after-success-detail.png, 10-A-list-after-create.png, URL redirected to /exam-types/{id} |
| INVALID_ZIP_STRUCTURE -> specific, non-generic error shown | Real upload, folder name not matching declared module | PASS - exact spec copy rendered verbatim in a role=alert banner | 01-B2-invalid-structure-error-state.png; alert text matches section 9.3 table exactly |
| INVALID_QUESTION_FILE -> specific error naming file/field | Real upload, malformed JSON question file | PASS - server's fileName/field passed through verbatim | 02-B2-invalid-question-file-error-state.png: "The question file 'Algebra/q1.json' is missing or has an invalid 'body' value..." |
| EXAM_TYPE_NAME_EXISTS -> per-field error on Name | Real upload, duplicate name | PASS - exact spec copy, per-field (not banner) | 01-B3-duplicate-name-retry.png |
| QUESTION_COUNT_MISMATCH -> specific error naming both numbers | Attempted: genuine ZIP-content-vs-declared-count mismatch | Could not be triggered - see Defect 2 (backend gap, not a Dev-12b UI defect) | See below |
| Error state preserves form values (no clear/refill) | Checked name field value after every failure above | PASS - value preserved verbatim in every case | Console log: name field after error = "Bad Structure Exam" etc. |
| Nothing created on any failed upload (list unaffected) | Checked GET /exam-types after each failed attempt | PASS for INVALID_ZIP_STRUCTURE/INVALID_QUESTION_FILE/EXAM_TYPE_NAME_EXISTS; not true for the content/count-mismatch case - see Defect 2 | DB row counts checked directly |
| Detail screen: read-only metadata + modules table | Real GET /exam-types/:id render | PASS (single "Declared question count" column, matching the documented, verified-real API constraint - see Notes) | 03-C-delete-confirm-dialog.png (pre-delete state), 12-B-mismatch screenshot |
| Delete flow: confirm dialog, destructive styling, cascade copy | Real delete via UI | PASS | 04-C-after-delete.png - snackbar "Exam Type deleted.", row removed, redirected correctly |
| EXAM_TYPE_HAS_ACTIVE_ATTEMPTS stub | Not re-tested this pass (Dev-12a's QA already proved the stub is correctly vacuous; Dev-12b adds no new logic here) | Not re-verified (low risk, out of incremental scope) | - |
| Permission gating: exams.create/exams.delete hidden for an exams.read-only user | Real Member-role login | PASS - buttons genuinely absent (not disabled-and-visible), direct URL to /exam-types/new redirects to /dashboard | MEMBER_CREATE_BUTTON_COUNT 0, MEMBER_DELETE_BUTTON_COUNT_ON_LIST 0, MEMBER direct exam-types-new URL result: .../dashboard |
| Browser console/network errors across all 3 screens | Checked on every scenario above (admin + member sessions) | PASS - zero console errors/CSP violations across every scenario run | CONSOLE_ERRORS [] (aggregated per script run) |
| Lint clean | npm run lint | FAIL | See Defect 1 |

## Defects found

### Defect 1 - Lint failure introduced this phase (blocking for CI, non-functional)
Severity: blocking (breaks npm run lint, the project's zero-warning gate) but low functional risk.

npm run lint fails with 5 errors, all in apps/web/src/app/core/taxonomy/taxonomy.service.ts:

  3:22  error  'catchError' is defined but never used  @typescript-eslint/no-unused-vars
  3:34  error  'forkJoin' is defined but never used     @typescript-eslint/no-unused-vars
  3:44  error  'map' is defined but never used          @typescript-eslint/no-unused-vars
  3:49  error  'of' is defined but never used            @typescript-eslint/no-unused-vars
  3:53  error  'switchMap' is defined but never used     @typescript-eslint/no-unused-vars

This file is a pre-existing shared service, but its stray unused-import line is orphaned dev
debris from this phase: the real forkJoin/of/switchMap/map "best-effort stageId to Stage-name
aggregation" logic nexus-dev's own notes describe was actually implemented directly inside the new
exam-type-list/exam-type-detail components (confirmed by reading both - they import and use
forkJoin/of/switchMap/map from rxjs themselves), not in taxonomy.service.ts. This strongly
suggests an earlier draft touched this shared file and the import line was never cleaned up before
this phase's stated "clean typecheck/build" self-report - which is true (unused imports don't fail
tsc) but the self-report never explicitly claims npm run lint was run for this phase, and it
demonstrably is not clean.

Repro: npm run lint at the repo root.
Impact: breaks the project's own --max-warnings=0 CI gate; zero runtime/functional impact
(unused imports only, no logic touched).

### Defect 2 - QUESTION_COUNT_MISMATCH does not actually validate ZIP content against declared counts (backend gap, Dev-12a-owned, not Dev-12b)
Severity: not blocking for Dev-12b's own deliverables (the UI correctly implements whatever the
server contract provides), but a significant, previously-undetected correctness gap that
materially affects whether this phase's own stated exit-gate scenario ("upload an invalid ZIP ->
specific error shown, nothing created") is actually achievable for this particular error code.
Recommend escalating as a Dev-12a follow-up fix, not a Dev-12b retry.

Independently verified end-to-end, via both the real browser UI and direct DB inspection:

1. Built a ZIP declaring one module "Algebra" with a real, valid single question file
   (Algebra/q1.json), then submitted it through the real create form with Total questions=2
   and module "Algebra" question count=2 (self-consistent numbers, so the client-side
   arithmetic pre-check per section 9.3 correctly does not block it).
2. The server accepted this as a successful creation (201, "Mismatch Exam" appears in the
   list) - no QUESTION_COUNT_MISMATCH (or any) error was raised, despite the ZIP's actual
   content (1 question) not matching the declared per-module count (2).
3. Confirmed directly against the tenant's real MySQL schema:
   SELECT module_name, COUNT(*) FROM exam_type_question WHERE exam_type_id=... GROUP BY
   module_name -> Algebra: 1 row, while exam_module.question_count for that same module is
   stored as 2.
4. Read exam-authoring.service.ts to confirm the root cause: assertTotalMatchesModules (the
   function that throws QUESTION_COUNT_MISMATCH) only checks that the request DTO's declared
   totalQuestions equals the sum of the request DTO's own declared per-module questionCount
   values - a pure self-consistency check on client-submitted numbers. It never cross-checks
   either number against parsed.modules[].questions.length (the ZIP's actual, parsed question
   count). assertFoldersMatchDeclaredModules similarly only checks folder-name/module-name
   correspondence, never per-folder question counts. The ExamModuleEntity.questionCount column
   is populated directly from the client's declared value (module.questionCount = m.questionCount),
   never derived from the actually-parsed/stored question rows.

Consequence for this Dev-12b QA pass specifically: because the client's own pre-check (section
9.3 step 3, "declared-vs-sum-of-modules arithmetic") enforces the exact same self-consistency
rule the server enforces, QUESTION_COUNT_MISMATCH can only ever be triggered by a client that
bypasses its own form validation (e.g. a raw API call with internally-inconsistent numbers) - it
can never be triggered by the scenario the requirement is actually meant to catch (a ZIP whose
real content doesn't match what was declared). I was unable to demonstrate this error code firing
via a genuine browser upload for that reason; every content-based mismatch I constructed was
silently accepted instead. This also confirms nexus-dev's documented "no separate
declared-vs-actually-stored field on the wire" deviation is, in practice, worse than described: it
isn't just that the UI can't display a second number - the second number is never even
computed/validated at write time, so "declared vs. actually stored" drift (which UX_GUIDELINES
section 9.2 frames as expected, benign, post-authoring drift) can in fact be introduced silently
and immediately at authoring time, with zero error surfaced anywhere.

I could not confirm whether this is exercised any differently in Dev-12a's own e2e suite (their QA
report's "QUESTION_COUNT_MISMATCH - PASS" line most likely also exercised the same
declared-vs-declared arithmetic check, not a real content mismatch, since that's the only
condition the code path actually supports) - recommend the orchestrator have nexus-dev
re-examine exam-authoring.service.ts's parseAndPersist/assertTotalMatchesModules to decide
whether real per-module question-count reconciliation should be added, independent of this UI
phase.

## Non-blocking observations (not defects)

1. section 9.2's "declared vs. actually stored" modules-table framing - verified nexus-dev's
   documented deviation is accurate: GET /exam-types/:id genuinely exposes only one per-module
   count field (confirmed by reading ExamAuthoringService.toSummary/ExamModuleEntity), so the
   detail screen correctly ships a single "Declared question count" column instead of the
   two-column table UX_GUIDELINES section 9.2 assumed. This is a legitimate, accurately-documented,
   low-risk deviation on the UI side - the real problem is one level deeper (Defect 2 above), not
   in how Dev-12b rendered what the API gives it.
2. Stage-picker reuse claim - verified no shared Stage-picker component exists anywhere under
   apps/web/src/app/shared; the minimal two-step cascading Education-Level to Stage select
   nexus-dev built is a reasonable, working substitute (cascading behavior independently confirmed
   correct via real interaction, not just rendering).
3. FeatureLimitGuard/exams.create usage metering counts failed upload attempts toward the
   plan quota - discovered incidentally while testing (5 rapid attempts, including failed ones,
   exhausted a 5-per-period limit and returned 429 FEATURE_LIMIT_REACHED, mapped to this phase's
   generic network/5xx banner copy, which is a reasonable fallback since 429 isn't one of the
   named codes in section 9.3's table). This guard runs and increments before ZIP
   parsing/validation even happens (FeatureLimitGuard then controller), so a manager who fails a
   few uploads while fixing typos in their ZIP could burn through their plan's exam-creation quota
   before ever succeeding once. This is Dev-9a/Dev-12a-owned wiring (@UseGuards(FeatureLimitGuard)
   on the ZIP-upload route), not a Dev-12b defect - flagging for awareness only.
4. Upload-progress determinate-to-indeterminate transition (section 9.3) could not be visually
   distinguished in this environment because localhost round-trips for a small fixture ZIP
   complete too fast to observe an intermediate "Processing..." frame - this is an
   environment/fixture-size limitation of this QA pass, not evidence of a defect (the "Uploading...
   0%" determinate state and the disabled form during upload were directly observed and are
   correct).
5. EXAM_TYPE_HAS_ACTIVE_ATTEMPTS and FILE_TOO_LARGE were not independently re-exercised this
   pass (the former was already proven vacuous-but-non-crashing in Dev-12a's QA and Dev-12b adds no
   new logic to it; the latter requires a large binary fixture and the copy is explicitly
   documented as deployment-configurable/placeholder pending a later phase) - low risk, noted as
   untested rather than assumed passing.

## Overall verdict

NOT READY - one blocking defect (Defect 1, lint failure) attributable to this phase.

Defect 1 is a small, mechanical, low-risk fix (delete 5 unused imports from
taxonomy.service.ts) but it is a genuine regression this phase introduced against the project's
own zero-warning lint gate and should be fixed before advancing.

Defect 2 is a real and more consequential finding, but it lives entirely in Dev-12a's
already-merged, already-QA-approved backend logic - Dev-12b's UI correctly implements the
documented contract and correctly renders every error code the server is actually capable of
producing. I am not recommending a Dev-12b retry for it; I recommend the orchestrator route it to
nexus-dev as a targeted Dev-12a follow-up (re-examine QUESTION_COUNT_MISMATCH's real trigger
condition and whether per-module actual-vs-declared reconciliation should be added), separately
from whatever fixes Dev-12b's lint failure.

Everything else independently tested - real ZIP upload success path, INVALID_ZIP_STRUCTURE,
INVALID_QUESTION_FILE, EXAM_TYPE_NAME_EXISTS (all three rendering exact, distinct, non-generic
copy per section 9.3/9.6, form state preserved on every failure, nothing created on any of these
three failures), the cascading Education-Level to Stage select, list/detail/delete real CRUD
flows, mobile card degradation, and frontend permission gating (buttons genuinely absent, route
guard redirect) - passed cleanly with zero browser console errors across every scenario.
