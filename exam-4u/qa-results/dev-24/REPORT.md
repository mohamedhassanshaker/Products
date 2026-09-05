# QA Report -- Dev-24 (BL-23): Append to existing AI-authored Exam Type

Date: 2026-08-11
Scope: FR-PDF-10 only (append endpoint, idempotency, APPEND_NOT_SUPPORTED_FOR_LEGACY_ZIP,
module/count correctness, reused group-into-modules.ts, security). Dev-25+ explicitly out of scope
(not started).

## Environment

- Backend: NestJS app booted in-process via Test.createTestingModule (same harness nexus-dev own
  e2e suite uses), real HTTP via supertest.
- DB: live MySQL-compatible server already running in this environment (examland-mysql container,
  root/YourPassword, port 3306) -- used real tenant-schema provisioning per test run, each with its own
  disposable schema, dropped in afterAll.
- Vector store: live Qdrant (examland-qdrant container, port 6333).
- AI/embeddings: faked ports (AI_SERVICE_PORT, EMBEDDINGS_PORT) -- matches nexus-dev own e2e
  convention (no live LLM calls needed to validate this phase DB/HTTP logic).
- No production environment touched. All test data created/destroyed by the test run itself.

## What was verified, and how

1. Idempotency after genuine partial failure (headline exit gate).
   - Reran nexus-dev own test/pdf-append.e2e-spec.ts against live MySQL: all 3 tests pass,
     including the exit-gate test that mocks IdempotencyKeyRepository.record to throw exactly once
     after the data-write transaction commits. First request: 500, but exam_type.total_questions,
     exam_module.question_count, and exam_type_question rows are already correctly persisted.
     Retry with the same Idempotency-Key: 200, zero new exam_type_question rows, no duplicate
     question_key values, correct final counts.
   - Independently reviewed the transaction boundary in AppendExamRepository.appendQuestions (source
     read in full): the outbox enqueue (examType.appended) runs inside the same transaction as the
     modules/questions/counts/generated_question.linked_exam_type_id writes, and
     IdempotencyKeyRepository.record is a separate transaction, called only after
     appendQuestions resolves. This means the only genuine partial failure window the design admits
     is exactly the one nexus-dev test simulates (bookkeeping write fails after data commit) -- a
     failure anywhere inside the data transaction (e.g., the outbox insert) would roll back the whole
     transaction atomically, which is the correct, safe behavior and requires no additional retry
     protection. This closes the "is there another partial-failure window the developer own test
     missed" question by inspection of the actual transaction structure, not just by trusting the
     comment. A second, independent live alternate-failure-point repro test (throwing inside the
     data-write transaction to confirm a full rollback) could not be persisted to disk in this session
     due to this sandbox tooling blocking a benign temp-file write that happened to pattern-match a
     destructive shell command signature (see Notes below) -- this is a tooling limitation, not a
     product defect. The code-level review of the transaction boundaries plus the live rerun of the
     developer own exit-gate proof together give high confidence the guarantee holds end to end.
   - Verdict: idempotency-after-partial-failure guarantee holds.

2. APPEND_NOT_SUPPORTED_FOR_LEGACY_ZIP. Verified live via HTTP in the rerun: a real ZIP-authored
   (origin=ZipImport) Exam Type rejects append with exactly this error code (409), and is left
   completely untouched (total_questions unchanged, target question linked_exam_type_id still
   NULL). A real AI-authored (finalize-path) Exam Type accepts append successfully (200, counts
   updated). Confirmed in code (AppendExamService.append) that this check runs first, before any
   other validation/idempotency logic.

3. Content-level idempotency guard, no header. Verified live: re-submitting an append with no
   Idempotency-Key header, containing ids already linked to the target Exam Type (one from finalize,
   one from a prior append), returns 200 with unchanged totalQuestions and no new rows -- confirming
   the guard (generated_question.linked_exam_type_id IS NULL, re-derived from the DB every call) is
   active independent of the header, as documented.

4. Module/total count correctness. Verified live, numerically: after appending 1 question into an
   existing Chapter 2 module, exam_module.question_count for Chapter 2 went from 1 to 2 (not a
   duplicate row), and exam_type.total_questions went from 2 to 3 -- both recomputed from real DB
   state (existing total + newly appended count), not a caller-supplied or blindly-incremented value.

5. Reused group-into-modules.ts -- finalize regression. Reran finalize-exam.service.spec.ts in
   isolation: all 10 tests pass unchanged, including source-section grouping, General fallback for
   ungrouped questions, and explicit modules[] declarations -- confirming the extraction did not alter
   FinalizeExamService own behavior.

6. Security.
   - Confirmed via source: POST .../append sits behind @UseGuards(JwtAuthGuard, PermissionsGuard)
     (class-level, inherited) plus @RequiresPermission(exams.finalize) -- the same chain/permission
     finalize uses.
   - examTypeId is re-resolved server-side against a real row in the tenant own schema
     (AppendExamRepository.findExamType); since this codebase tenancy model uses a genuinely
     separate database/schema per tenant (TenantContextService.entityManager()), an
     examTypeId/generated-question id belonging to a different tenant is not merely permission-checked
     but physically unreachable from the wrong tenant connection -- consistent with every other module
     in this codebase (no explicit tenant_id column pattern needed here).
   - ids[] are filtered through GeneratedQuestionRepository.findManyInSession, which scopes to
     processing_session_id = :sessionId -- an id not genuinely in the given session (even if it exists
     in the same tenant) is silently excluded, not acted upon. Verified this is the same convention
     finalize already uses and is exercised by existing/rerun tests.
   - No SQL string concatenation (query builder / repository methods only, parameterized).

7. Full regression suite. apps/api unit suite: 165 suites / 1392 tests, all green -- matches
   nexus-dev self-report and confirms the previously-flagged curricula.service.spec.ts false
   positive stays resolved when invoked correctly (npm-script-driven jest with
   NODE_OPTIONS=--experimental-vm-modules). npm run typecheck and npm run lint both clean across
   all workspaces.

## Traceability matrix

| Requirement | Scenario(s) tested | Result | Evidence |
|---|---|---|---|
| FR-PDF-10 append core (increase module/total counts on AI-authored Exam Type) | Live append into real AI-authored Exam Type; module increment + total recompute | Pass | test/pdf-append.e2e-spec.ts rerun, live MySQL query assertions |
| FR-PDF-10 APPEND_NOT_SUPPORTED_FOR_LEGACY_ZIP | Live append attempt against real ZIP-authored Exam Type | Pass | Same suite, 409 + untouched state confirmed |
| FR-PDF-10 idempotency -- content-level (no header) | Re-submit already-linked ids, no Idempotency-Key | Pass | Same suite, no-op confirmed |
| FR-PDF-10 idempotency -- request-level, genuine partial failure | Mocked bookkeeping-write failure after data-write commit, then retry with same key | Pass | Same suite, exit-gate test; corroborated by transaction-boundary code review |
| Reused group-into-modules.ts -- finalize non-regression | Full finalize-exam.service.spec.ts rerun | Pass | 10/10 tests green |
| Security -- guard chain + permission | Source review of controller decorators | Pass | pdf-processing.controller.ts L142-147 |
| Security -- cross-tenant/cross-session id scoping | Source review + existing tests exercising findManyInSession/tenant-schema isolation | Pass | Code review, consistent with rest of codebase established pattern |
| Full regression (unit) | npm test (root script, correct invocation) | Pass | 165/165 suites, 1392/1392 tests |
| Static analysis | npm run typecheck, npm run lint | Pass | Clean, no errors/warnings |

No untested requirement gaps identified within Dev-24 declared scope.

## Defects

None found that block this phase exit gate or FR-PDF-10 compliance.

Non-blocking observations (already self-disclosed by nexus-dev as documented judgment calls, no
action required this phase):
- A reused Idempotency-Key with a different examTypeId/ids[] is not rejected (silently
  processes the new request instead of erroring on mismatch). Documented as an intentional
  deferred-scope decision (schema already supports adding the check later via response_hash). Low
  likelihood, non-blocking.
- Append route is not rate-limited beyond existing per-route defaults, consistent with finalize own
  existing exposure. Non-blocking, pre-existing pattern.

Tooling note (not a product defect): attempting to author a second, independent alternate-failure
e2e test in this QA pass was blocked by this environment own destructive-command safety filter
(triggered by an incidental substring pattern-match in unrelated cleanup code, not any real destructive
action). Compensated for via close reading of the actual transaction boundaries in
AppendExamRepository/AppendExamService plus a live rerun of nexus-dev own exit-gate proof. Flagging
for transparency, not as a defect in the product under test.

## Verdict

PASS -- Dev-24 (BL-23) is QA-green. No blocking defects. The idempotency-after-partial-failure
guarantee (this phase stated exit gate) genuinely holds, verified live against MySQL and corroborated
by direct code/transaction-boundary review.
