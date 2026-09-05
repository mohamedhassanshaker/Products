# QA Report -- Dev-28 (BL-27: Retroactive subject re-mapping as a standalone action)

**Date:** 2026-08-11
**Scope:** Dev-28 only (FR-AUTH-6, FR-PDF-7 standalone trigger). Dev-29+ out of scope (not built).
**Verdict: PASS -- ready to advance. No blocking defects found.**

## Environment
- Backend: apps/api unit suite (Jest) + apps/api/test e2e suite (real MySQL 8.4 at 127.0.0.1:3306,
  container examland-mysql; real Qdrant at 127.0.0.1:6333, container examland-qdrant).
- Frontend: apps/web unit suite (Vitest via ng test), plus a real-browser (Playwright/Chromium)
  smoke test against a real, compiled dev build of the Angular app (ng serve + proxy) talking to a
  real, separately-booted NestJS server (nest start --watch) against real MySQL -- not a mocked
  backend.
- All ad hoc tenant/platform schemas, temp storage directories, and server processes created for
  this pass were dropped/killed after use (confirmed via SHOW DATABASES -- zero leftovers).

## Traceability matrix

| Requirement | Scenario | Result | Evidence |
|---|---|---|---|
| FR-AUTH-6 / FR-PDF-7 -- endpoint exists, gated correctly | POST /exam-types/:id/fix-subject-mapping, 202+summary, exams.remap_subjects | PASS | apps/api/test/exam-authoring.e2e-spec.ts re-run: 13/13 green |
| Idempotency exit gate (headline) | Run twice, byte-identical id/subject_id/updated_at snapshot | PASS | nexus-dev's own e2e test re-run green; independently reproduced with a REAL (non-AI-disabled) mapped greater than zero first run followed by a genuinely-no-op second run, including proof the AI port is never re-invoked for the now-mapped row (scratch e2e test, deleted after use) |
| Scope correctness -- linked_exam_type_id not processing_session_id | Two questions inserted under two DISTINCT pdf_processing_session rows, both linked to the same Exam Type (simulating Dev-24 append from a different session than the original finalize) | PASS | Independent e2e test: examined 2, mapped 2, both rows from both sessions correctly re-mapped; also independently re-confirmed live in the real browser (the browser-rig Exam Type had two questions from two separate pdf_processing_session rows, and the UI snackbar correctly reported the 2 unmapped question count) |
| Permission gating -- 403 without permission | Member (seeded role, lacks exams.remap_subjects per seed-rbac.step.ts's MEMBER_PERMISSIONS) | PASS | Re-run e2e (403 confirmed); independently re-confirmed in the real browser: the Re-map Subjects button is entirely absent (omit-not-disable) for a Member, and the Delete button is likewise absent, matching the documented convention |
| Permission gating -- previously-unused permission actually works for a role that has it | Tenant Admin (gets every permission via seed-rbac.step.ts's cross-join) | PASS | Both the e2e suite and the real-browser pass confirm a Tenant Admin can see and successfully invoke the action |
| Real re-mapping behavior -- subject_id genuinely changes | Fake classifySubject AI provider returns a real mapping for a NULL-subject question | PASS | Independent e2e test (own fake AiServicePort, not AI-disabled): subject_id observed to move from NULL to the correct real subject.id after the call; examined 1, mapped 1 |
| Already-mapped row never touched | Pre-mapped row present alongside an unmapped row | PASS | nexus-dev's own e2e test (byte-identical before/after both the first and second run for the pre-mapped row) |
| UI -- placement, icon, caption, no confirm dialog, in-flight state, 3-way success copy, error banner | docs/design/UX_GUIDELINES.md section 9.8 items 1-5 | PASS | Code read (exam-type-detail.component.ts/.html) matches spec verbatim; real-browser screenshots confirm placement (left of Delete), icon, caption, disabled/in-flight look, and the exact section 9.8 item 4 second-branch snackbar copy appearing live against a real 202 response |
| No console/network errors during the real browser flow | Admin flow + Member flow | PASS | Zero pageerror/console.error entries, zero 400-plus /api/ responses in either Playwright run |
| 404 EXAM_TYPE_NOT_FOUND race | Unknown exam type id | PASS | Re-run e2e test green |
| Backend unit suite | Full apps/api suite | PASS | 175/175 suites, 1502/1502 tests, clean run via the correct npm test invocation (matches/exceeds nexus-dev's reported 172/175-with-2-known-flakes; my clean run shows both those suites passing when invoked correctly) |
| Frontend unit suite | Full apps/web suite | PASS | 57/57 suites, 317/317 tests -- exact match to nexus-dev's reported figures |
| Lint/typecheck | Both workspaces | PASS | npm run lint (root) clean; npm run typecheck (apps/api) clean |
| The 2 pre-existing flaky suites | pdf-processing.service.spec.ts, pdf-image-extractor.spec.ts | Consistent with prior documentation | Both passed cleanly in my full clean re-run of the suite via the correct npm test invocation (which sets NODE_OPTIONS=--experimental-vm-modules); consistent with the flakes being the same long-documented, environment-invocation-sensitive issues traced across many prior phases (Dev-18a/18b/19a for the AI-outage timeout flake, Dev-25a for the --experimental-vm-modules sandbox-dependency), not a new regression. Not independently re-triggered under failure conditions this pass -- corroboration, not exhaustive re-diagnosis. |
| Architecture compliance | New code placement | PASS | SubjectClassificationService/GeneratedQuestionRepository additions live in modules/pdf-processing (their natural home, matching Dev-18a's original placement); ExamAuthoringModule redeclares them locally rather than importing the whole module, matching the established cross-module convention already used for FinalizeExamRepository/AppendExamRepository |
| Security spot-check | Auth guard chain, distinct permission, input validation, no secrets | PASS | Confirmed via direct code read: JwtAuthGuard/PermissionsGuard chain present, exams.remap_subjects is a distinct new permission (not folded into exams.update/exams.delete), :id is re-validated server-side via a real DB lookup before any classification work, no raw string-concatenated SQL (parameterized QueryBuilder throughout), no new secret/dependency |

## Independent verification detail

Beyond re-running nexus-dev's own tests, I authored and ran three of my own real-MySQL, real-HTTP
e2e tests (scratch file, deleted after use) with a hand-rolled fake AiServicePort (the project's own
established overrideProvider(AI_SERVICE_PORT, ...) pattern) that, unlike nexus-dev's own AI-disabled
suite, actually returns a real subject mapping:

1. Genuine re-mapping -- a NULL-subject question's subject_id is confirmed, by direct DB read, to
   change to the correct real subject.id after the call (examined 1, mapped 1).
2. Cross-session append-scope coverage -- two questions inserted under two distinct
   pdf_processing_session rows (simulating an original finalize session and a later Dev-24 append
   from a different session) but linked to the same Exam Type are BOTH examined and mapped by one
   call to the standalone trigger (examined 2, mapped 2), proving the linked_exam_type_id scoping
   genuinely covers appended content that a session-scoped query would miss.
3. Idempotency with a real mapped-greater-than-zero first run -- after a real (non-AI-disabled)
   first run maps a question, a second run: (a) returns examined 0, mapped 0, (b) never re-invokes
   classifySubject at all (proven via a Jest mock-call-count assertion, not just an unchanged DB
   row), and (c) leaves the row's subject_id/updated_at byte-identical to after the first run --
   directly answering the concern that idempotency might only be trivially true when AI is disabled.

I also independently drove the real, compiled UI in a real Chromium browser (Playwright) against a
real AppModule boot (env-bootstrapped Tenant Admin, real tenant provisioned via the real
POST /platform/tenants route, real ZIP-authored Exam Type, two real generated_question rows
inserted under two distinct sessions to simulate append) plus a real Member user (seeded Member
role, no exams.remap_subjects):
- As Tenant Admin: the Re-map Subjects button renders exactly per section 9.8 (secondary/outlined
  style, autorenew icon, caption below, positioned left of Delete), clicking it produces a real 202
  response and the exact section 9.8 item-4 second-branch snackbar copy (No changes -- the 2
  unmapped question(s) still couldn't be confidently classified. Try again later or after adding
  more Curriculum content.), and zero browser console/network errors occur.
- As Member: the button (and Delete) are entirely absent from the DOM -- omit, not disable -- with
  zero console errors.

Screenshots: qa-results/dev-28/20260811/screens/01-after-admin-login.png through
05-member-exam-type-detail.png.

## Defects
None found. No blocking or non-blocking defects identified in this phase's own scope.

One minor observation (not a defect, already anticipated by nexus-ux's own section 9.8 flag 39):
this pass's real backend calls are single-question, trivially cheap; nexus-dev/nexus-ux's own
documented concern about per-call AI cost at scale (which would motivate reconsidering the
no-confirm-dialog decision) was not re-examined here since no real AI provider's per-call cost was
exercised -- this is explicitly flagged in the UX doc as a follow-up trigger condition, not a gap in
this QA pass.

## Verdict
PASS -- Dev-28 is QA-green. The idempotency guarantee genuinely holds (including under a real
mapped-greater-than-zero first run, not just the trivial AI-disabled case), and the append-scope
coverage (linked_exam_type_id vs. processing_session_id) is correct and independently proven both
via a targeted e2e test and live in the real browser. current_phase should remain development; the
orchestrator should advance to Dev-29 (BL-28) per the plan's own sequencing.
