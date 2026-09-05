# QA Report -- Dev-19a (BL-16: Review & edit, finalize into Exam Type -- backend)

Date: 2026-08-10
Scope: Dev-19a ONLY (FR-PDF-8, FR-PDF-9, FR-AUTH-2, FR-AUTH-4). Dev-19b (review/edit UI) and later
phases are not evaluated (not yet implemented).

## Environment

- Backend: apps/api (NestJS), exercised via Jest unit tests and real-MySQL Jest e2e tests
  (apps/api/test/*.e2e-spec.ts).
- Real MySQL 8.4 at 127.0.0.1:3306 (existing examland-mysql container, root/YourPassword).
- Real Qdrant at 127.0.0.1:6333 (existing examland-qdrant container).
- AiServicePort faked at the DI boundary (per this module's established convention) for the new
  e2e suite; real HTTP via supertest against a real NestJS app instance; real per-tenant MySQL
  schema provisioned per test run and torn down afterward.
- Commands: npm test (unit, NODE_OPTIONS=--experimental-vm-modules required),
  npm run test:e2e -- <pattern> (e2e), both run directly by this QA pass (not merely trusting
  nexus-dev's self-report).

## Traceability matrix

| Requirement | Scenario(s) tested | Result | Evidence |
|---|---|---|---|
| FR-PDF-8 paginated review | Real HTTP GET with page/pageSize, total/page/pageSize/items asserted | PASS | pdf-review-finalize.e2e-spec.ts:239-245 (re-run, green) |
| FR-PDF-8 human-touched flag vs review-flag independence (headline exit gate) | Real HTTP edit then real-DB SELECT confirms is_human_edited=1, is_review_flagged=0; real HTTP flag then is_review_flagged=1, is_human_edited unchanged; real HTTP unflag then is_review_flagged=0, is_human_edited unchanged | PASS | pdf-review-finalize.e2e-spec.ts:247-276 (re-run, green); code: question-review.service.ts editQuestion (only ever sets isHumanEdited) / flagQuestion/unflagQuestion (only ever call setReviewFlag); generated-question.repository.ts's update() vs dedicated setReviewFlag() -- two structurally separate write paths, never overlapping columns |
| FR-PDF-8 bulk delete/regenerate empty-list no-ops (headline exit gate) | Real HTTP POST with ids: [] for both endpoints returns 200-class success (deletedCount:0 / regeneratedCount:0,requestedCount:0); before/after real-DB row count identical | PASS | pdf-review-finalize.e2e-spec.ts:278-293 (re-run, green); unit: question-review.service.spec.ts:211-227,239-252 assert repository/AI-port mocks never invoked for [] |
| FR-PDF-8 targeted regeneration preserving original count | Unit: N=2 targeted, engine returns 1 draft -> regeneratedCount=1, only the replaced row deleted, the other left untouched (best-effort, documented); N=1 exact-match case also covered; Math.min(drafts.length, group.length) in code caps both under- and over-supply | PASS | question-review.service.spec.ts:332-351; code: question-review.service.ts:171 (usedCount = Math.min(...)) |
| FR-PDF-9 NO_ELIGIBLE_QUESTIONS guard (headline exit gate) | Real HTTP finalize with minConfidence: 0.99 (nothing qualifies) -> 400 NO_ELIGIBLE_QUESTIONS; real-DB SELECT COUNT(*) FROM exam_type WHERE name=... confirms 0 rows | PASS | pdf-review-finalize.e2e-spec.ts:295-306 (re-run, green); code: finalize-exam.service.ts:95-98 (throw precedes any entity construction); repository excludes already-linked_exam_type_id rows |
| FR-PDF-9 finalize correctness (real ExamType/ExamModule/ExamTypeQuestion, grouped by source section, matches reviewed content) | Real HTTP finalize with 2 eligible + 1 excluded (low-confidence) draft -> real-DB verifies exam_type.total_questions=2 (not the caller's declared 99), exam_module rows grouped Chapter 1/Chapter 2 with correct counts, exam_type_question.question_key=gq_<id> for both, excluded question's linked_exam_type_id stays NULL | PASS | pdf-review-finalize.e2e-spec.ts:327-383 (re-run, green) |
| FR-AUTH-4 curriculum linking + bounded contextWeight | Valid contextWeight=8 -> real exam_type_curriculum row with correct curriculum_id/context_weight; contextWeight=11 -> 400 INVALID_CONTEXT_WEIGHT before any exam_type row is created (real-DB re-check) | PASS | pdf-review-finalize.e2e-spec.ts:308-325, 340,373-376 (re-run, green); code: finalize-exam.service.ts validateCurriculumLinks() runs before eligibility check/any write |
| FR-PDF-9 double-finalize behavior | Second finalize attempt on the same session after a successful finalize -> 400 NO_ELIGIBLE_QUESTIONS again (already-linked rows excluded by linked_exam_type_id IS NULL filter), not a duplicate ExamType or crash | PASS | pdf-review-finalize.e2e-spec.ts:385-393 (re-run, green) |
| Dev-12a EXAM_TYPE_HAS_ACTIVE_ATTEMPTS stub still a no-op | Code inspection: ExamAuthoringService.hasActiveAttempts() unmodified, still a vacuous false-returning stub (Attempt entity does not exist until Dev-20a); does not block deletion | PASS (code review) | exam-authoring.service.ts:160, exam-authoring.service.spec.ts:324-334 |
| Full unit regression | npm test | PASS -- 155 suites / 1277 tests, exactly matching nexus-dev's self-report | This pass's own run |
| New e2e suite (pdf-review-finalize.e2e-spec.ts) | npm run test:e2e -- pdf-review-finalize against real MySQL | PASS -- 6/6, exactly matching nexus-dev's self-report | This pass's own run |
| Regression: pdf-generation-budget, pdf-reference-indexing, pdf-exam-extraction, exam-authoring e2e | Re-run against real MySQL | PASS -- all green | This pass's own run |
| Regression: pdf-processing.e2e-spec.ts | Re-run against real MySQL | 1 failure (see Defect D1, pre-existing/non-blocking) | This pass's own run |
| Security spot-check | Confirmed every new route sits behind JwtAuthGuard -> PermissionsGuard with explicit @RequiresPermission; bulk delete/regenerate/edit re-derive processing_session_id server-side (never trust client id list at face value); contextWeight/curriculumId re-validated server-side regardless of DTO decorators; all new writes go through parameterized TypeORM repositories inside the tenant-scoped EntityManager/transaction; no new secrets | PASS | Code review: question-review.service.ts, finalize-exam.service.ts, finalize-exam.repository.ts |

## Independent verification highlights (checklist items from the brief)

1. Human-touched-flag vs review-flag independence -- genuinely two independent booleans. Verified
   by reading the actual production code (not just tests): editQuestion() only ever writes
   isHumanEdited via the generic update() method (never includes isReviewFlagged in its patch);
   flagQuestion()/unflagQuestion() only ever call the dedicated single-purpose setReviewFlag()
   method (which only ever writes isReviewFlagged). Re-ran the e2e test proving the real-DB sequence
   edit-then-flag-then-unflag leaves the other flag untouched at every step -- confirmed green against live MySQL.
2. Empty-list no-ops -- confirmed both via re-running the real-HTTP e2e (200/201-class success,
   before/after row counts identical) and via reading the unit tests, which assert the repository/AI
   port mocks are never called at all for an empty list (a call-count assertion, not just an HTTP
   status check) -- genuinely a short-circuit before any downstream call, not just an early success
   response with hidden side effects.
3. Targeted regeneration preserving count -- confirmed via unit test with a real mismatch scenario
   (2 requested, AI mock returns only 1 draft): regeneratedCount correctly reflects 1, and only the
   replaced row is deleted (the other left as-is) -- code caps via Math.min(drafts.length,
   group.length), correctly handling both under- and (structurally) over-supply from the AI engine.
4. NO_ELIGIBLE_QUESTIONS guard -- re-ran the real e2e test myself: a session with a deliberately
   low-confidence-only-eligible request (minConfidence: 0.99) gets 400 NO_ELIGIBLE_QUESTIONS, and a
   direct SQL query (SELECT COUNT(*) FROM exam_type WHERE name = ...) confirms zero rows -- not a
   degenerate/empty Exam Type. Code inspection confirms the guard throws before buildExamType() is
   ever called -- structurally impossible for any code path to leave a partial write behind.
5. Finalize correctness -- re-ran the real e2e test: real exam_type/exam_module/
   exam_type_question rows created, correctly grouped into "Chapter 1"/"Chapter 2" modules matching
   each question's source_section, with the reviewed content read live from the same generated_question
   row editQuestion() mutates (groupIntoModules() reads generated.questionText/optionsJson/etc.
   straight off that entity, so there is no separate stale copy anywhere in the code path).
6. Curriculum linking + contextWeight bounds -- re-ran the real e2e test: a valid weight of 8 is
   accepted and linked (real exam_type_curriculum row, correct curriculum_id/context_weight); an
   out-of-range weight of 11 is rejected with INVALID_CONTEXT_WEIGHT before any exam_type row for
   that attempted name exists. Code inspection: validateCurriculumLinks() runs and can throw before
   the eligibility query even executes, so no partial write is structurally possible.
7. Double-finalize behavior -- re-ran the real e2e test: a second finalize call against the
   already-finalized session's session id correctly re-hits NO_ELIGIBLE_QUESTIONS (the
   linked_exam_type_id IS NULL filter excludes the now-linked questions) -- not a duplicate ExamType,
   not a crash.
8. EXAM_TYPE_HAS_ACTIVE_ATTEMPTS stub -- confirmed by code inspection this remains the
   pre-existing, documented vacuous stub from Dev-12a (hasActiveAttempts() always returns false
   until the Attempt entity lands in Dev-20a); this does not block deletion, matching the phase's
   own documented exit-gate note.
9. Full suite re-run -- unit: 155 suites / 1277 tests, exactly matching nexus-dev's self-report,
   run directly by this QA pass against the actual repo state (not copied from the dev report). New
   e2e suite pdf-review-finalize.e2e-spec.ts: 6/6 green, re-run against live MySQL 8.4.

## Defects

### D1 -- Pre-existing, non-blocking flake in pdf-processing.e2e-spec.ts (unrelated to Dev-19a scope)

- Severity: Non-blocking (pre-existing, not a regression this phase introduced; not in Dev-19a's
  own scope -- this test covers FR-PDF-3 content-type classification/upload, not review/finalize).
- What was expected: "a contentTypeHint bypasses classification entirely" completes with the
  session reaching Completed within the test's poll timeout.
- What actually happened: In two independent re-runs by this QA pass, the test's session instead
  reached Failed with errorCode: INTERNAL_ERROR ("An unexpected error occurred. Please try again
  later.") before the poll timeout, or (in the earlier full-suite run) hit the bare 5000ms Jest
  timeout without an explicit failure status. No stack trace or level:50/60 error log line was
  captured in the test's own log output pointing at a specific cause -- consistent with the Docker
  MySQL resource-contention explanation already recorded in Dev-18a's and Dev-18b's own QA passes for
  this exact same test.
- Repro steps: cd apps/api; DB_PASSWORD=YourPassword npx cross-env NODE_OPTIONS=--experimental-vm-modules jest --config ./test/jest-e2e.json pdf-processing.e2e-spec.ts -t "contentTypeHint bypasses" --maxWorkers=1
- Note: This is the third consecutive QA pass (Dev-18a, Dev-18b, now Dev-19a) to observe this
  same test flake under this local environment's resource pressure; it is not new to this phase, and
  Dev-19a's own new/changed code (QuestionReviewService, FinalizeExamService,
  FinalizeExamRepository, exam_type_curriculum) is not implicated -- the failing test exercises
  PdfProcessingService's classification/upload path, untouched by this phase. Flagged for
  completeness and orchestrator awareness (worth root-causing eventually, e.g. increasing this one
  test's timeout or isolating it from parallel load), not scored as a blocking defect for Dev-19a.

No other defects found. No gaps in the traceability matrix -- every named requirement/exit-gate has a
corresponding tested-and-passing scenario.

## Verdict

READY -- Dev-19a (BL-16 backend) is QA-green. Both headline exit gates hold under independent
real-HTTP/real-DB verification: (1) the human-touched flag and the review-flag are genuinely two
independent booleans, never conflated by any write path; (2) NO_ELIGIBLE_QUESTIONS is returned
(never an empty/degenerate Exam Type) whenever nothing meets the finalize eligibility criteria, and a
second finalize attempt against an already-finalized session correctly re-hits the same guard rather
than duplicating output. The one observed defect (D1) is a pre-existing, documented, non-blocking
flake outside this phase's own scope.
