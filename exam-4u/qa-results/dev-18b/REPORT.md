# QA Report -- Dev-18b (BL-15: Exam question extraction)

Date: 2026-08-10
Scope: Dev-18b ONLY (BL-15, backend, FR-PDF-5), plus mandatory regression check that the
PdfContentStrategy refactor did not break Dev-18a's already-QA-green Lesson/Reference dispatch
behavior. Dev-19a and later are not evaluated (not yet implemented).

## Environment

- Backend: apps/api (NestJS), exercised via Jest unit tests and Jest e2e tests
  (apps/api/test/*.e2e-spec.ts) against:
  - Real MySQL 8 at 127.0.0.1:3306 (existing examland-mysql container)
  - Real Qdrant at 127.0.0.1:6333 (existing examland-qdrant container)
  - AiServicePort faked at the DI boundary (extractExamPage mock), per this module's established
    convention.
- No frontend/UI surface in this phase's scope (backend-only phase).
- Test commands used: npm test (unit) / npm run test:e2e (e2e), both wrapping Jest with the
  required NODE_OPTIONS=--experimental-vm-modules flag.

## Traceability matrix

| Requirement | Scenario(s) tested | Result | Evidence |
|---|---|---|---|
| FR-PDF-5 per-page extraction (not per-document) | Unit: 2-page doc -> extractExamPage called exactly twice, lastCompletedPage advances to 2 | PASS | exam-extraction.service.spec.ts:65-81; code: exam-extraction.service.ts:67-98 (loop body calls the port once per page) |
| FR-PDF-5 negligible-text-page skip (cost control, <20 chars) | Unit: call-count assertion (1 call, not 2) + explicit page-number assertion; real e2e: 3-page PDF, middle page = 1 char, extractExamPageMock called exactly twice with [1,3], never [2] | PASS | exam-extraction.service.spec.ts:83-99; apps/api/test/pdf-exam-extraction.e2e-spec.ts:210-226 (real MySQL, real HTTP upload) |
| FR-PDF-5 provided (>=0.95) vs inferred (0.60-0.90) confidence distinction, persisted as a real column | Unit: two drafts in one page's result, answerSource/confidenceScore/generationMethod asserted distinct per draft; real e2e: real DB query (SELECT answer_source, confidence_score, generation_method ... WHERE processing_session_id = ?) shows two separately queryable rows, provided >=0.95, inferred <0.95, generation_method = exam_extraction_with_key/exam_extraction_inferred | PASS | exam-extraction.service.spec.ts:101-125; pdf-exam-extraction.e2e-spec.ts:228-241; confidence.ts:72-83 (EXAM_PROVIDED_FLOOR=0.95, EXAM_INFERRED bands 0.6-0.9) |
| Budget-before-call ordering (shared isBudgetExhausted, same rigor as Dev-18a) | Unit: (a) already-exhausted session never calls extractExamPage; (b) mid-loop exhaustion (5 pages, budget hit after page 1) stops with calls.length < 5 | PASS | exam-extraction.service.spec.ts:144-171; code: exam-extraction.service.ts:76-79 (check precedes the await ...extractExamPage call, structurally, inside the loop) |
| Resume watermark on mid-run AI outage (resumable, not Failed) | Unit: AiServiceUnavailableError propagates uncaught, lastCompletedPage never advances past the failing page (asserted still 0); orchestrator's status='Completed' write sits after strategy.run(), so a thrown error skips it -- traced through unchanged from Dev-18a | PASS (unit + code trace) | exam-extraction.service.spec.ts:190-201; pdf-generation-orchestrator.service.ts:54-76 |
| Resume watermark, real DB (page-level) | Unit "resumes from lastCompletedPage" test: session seeded with lastCompletedPage:1, only page 2 sent | PASS (unit) | exam-extraction.service.spec.ts:173-188. Note: no dedicated real-MySQL resume-from-crash e2e for the Exam branch specifically (Dev-18a's own budget e2e covers the DB-level watermark-persistence mechanism, which Exam shares unmodified) -- see Gap G1 below. |
| Per-item parse-failure isolation | Unit: droppedItems: 1, 2 surviving drafts both persisted | PASS | exam-extraction.service.spec.ts:127-142 |
| PdfContentStrategy refactor -- Lesson/Reference dispatch regression | Orchestrator unit spec: Lesson runs Lesson strategy + subject classification + Completed; Reference runs Reference strategy, skips subject classification, Completed; budget-exhausted Lesson session still completes gracefully | PASS | pdf-generation-orchestrator.service.spec.ts (4/4 tests green, re-run independently) |
| PdfContentStrategy refactor -- Exam dispatch wired correctly | Orchestrator unit spec: Exam runs Exam strategy, skips subject classification, marks Completed | PASS | pdf-generation-orchestrator.service.spec.ts:64-85; DI wiring: pdf-processing.module.ts:66-77 (CONTENT_TYPE_STRATEGIES factory maps all three branches by name, run closures call the unchanged generate/index/generate public methods) |
| Dev-18a regression (budget-exceeded-Completed, auto-Curriculum-creation, ai_call_log) | Re-ran all three of Dev-18a's own dedicated e2e suites against real MySQL/Qdrant after the refactor | PASS -- 3/3 suites, 4/4 tests, all green | apps/api/test/pdf-generation-budget.e2e-spec.ts, pdf-reference-indexing.e2e-spec.ts, ai-cost-accounting.e2e-spec.ts (re-run this pass) |
| Full unit regression | npm test | PASS -- 152 suites / 1232 tests, all green (matches nexus-dev's self-report exactly) | this pass's own run |
| pdf-processing.e2e-spec.ts regression (flaky test, D1 carryover) | Re-run 4x in isolation, real MySQL | FLAKY, same test as Dev-18a's D1 -- see Defect D1 below | This pass's own runs |
| Security spot-check | Confirmed no new HTTP endpoints (reuses existing POST /pdf-processing/upload), no new client-input surface (pageText server-derived from already-validated PDF), all new DB access via existing parameterized GeneratedQuestionRepository inside the tenant-scoped EntityManager, no secrets | PASS | Code review: exam-extraction.service.ts, generated-question.repository.ts |
| tsc --noEmit | Whole apps/api | PASS, no errors | -- |
| eslint (pdf-processing/) | Scoped lint, --max-warnings=0 | PASS, 0 warnings/errors | -- |

## Gap (informational, not a defect)

G1 -- No dedicated real-MySQL crash/resume e2e for the Exam branch specifically. Dev-18a's own
QA pass verified the shared watermark/resume mechanism with a real crash-and-resume scenario at
the unit level plus DB-level persistence via the budget e2e; Dev-18b's new e2e
(pdf-exam-extraction.e2e-spec.ts) does not add an equivalent full-crash-and-resume-from-DB test for
the Exam branch, relying instead on the unit-level "resumes from lastCompletedPage" test plus the
fact the underlying resume mechanism is unmodified, shared code. This is consistent with the phase's
own stated scope ("this phase shares BL-14's cost-accounting/budget infrastructure without
modification") and the unit test does genuinely exercise the resume-skip logic with real assertions,
so this is not scored as a blocking gap -- flagged for completeness only.

## Independent verification highlights (the 7 checklist items from the brief)

1. Per-page extraction -- confirmed via a real call-count assertion (toHaveBeenCalledTimes(2) for a
   2-page document), not just a final-result check. The loop in exam-extraction.service.ts iterates
   remainingPages and calls extractExamPage exactly once per qualifying page -- genuinely per-page,
   not per-document.
2. Negligible-text-page skip -- confirmed via both a unit call-count assertion (toHaveBeenCalledTimes(1)
   for a 2-page doc where one page is <20 chars) AND a real e2e run against a real PDF/HTTP/DB stack,
   where the mock is asserted called with exactly [1, 3] (never 2) -- genuinely never sent to the
   engine, matching Dev-16's established cost-control pattern.
3. Provided vs inferred persistence -- confirmed against the real spec wording (FR-PDF-5's own text:
   provided >=0.95, inferred 0.60-0.90) via confidence.ts's EXAM_PROVIDED_FLOOR = 0.95 and
   EXAM_INFERRED_STRONG_MIN/MAX = 0.75/0.9, EXAM_INFERRED_WEAK_MIN/MAX = 0.6/0.75 constants, and
   verified the actual DB row lands in the correct answer_source/generation_method columns via a
   real SELECT against real MySQL after a real HTTP upload -- not just a mocked assertion.
4. Budget ordering and resume watermark -- confirmed with the same rigor as Dev-18a: a synchronous
   isBudgetExhausted check sits immediately before the await this.aiService.extractExamPage(...)
   call inside the loop (no code path can call it after), verified via real mock.calls.length
   assertions for both "already exhausted before page 1" and "exhausted mid-loop by page 1's usage"
   cases; an AiServiceUnavailableError thrown by the port propagates uncaught and leaves
   lastCompletedPage unadvanced (asserted directly), and the orchestrator's status = 'Completed'
   write structurally sits after strategy.run() returns, so a thrown error during any branch (Exam
   included) skips that write entirely -- traced through unchanged code shared with Dev-18a.
5. PdfContentStrategy refactor -- re-ran Dev-18a's own orchestrator unit spec and all three of its
   dedicated e2e suites after the refactor; all green. Confirmed by direct code read that the refactor
   is purely mechanical: LessonGenerationService.generate, ReferenceIndexingService.index, and
   ExamExtractionService.generate's own public signatures are unchanged; the CONTENT_TYPE_STRATEGIES
   factory in pdf-processing.module.ts just wraps each with a run closure keyed by contentType,
   and PdfGenerationOrchestrator.process does a simple .find() lookup instead of an if/else --
   behaviorally identical dispatch, confirmed both by code trace and by test re-run. No regression.
6. Flaky test from Dev-18a's QA report (D1) -- reproduced again this pass (4 isolated runs: 3 failures,
   1 pass -- if anything a higher observed failure rate than Dev-18a's ~50%, though sample size is too
   small across both passes to call this a statistically meaningful worsening). Same exact test
   ("contentTypeHint bypasses classification entirely"), same failure mode (bare 5000ms Jest timeout,
   never an assertion failure), same root cause description holds (missing explicit timeout override on
   a test that does real PDF extraction + DB round-trip + background dispatch, contending with
   background work from an earlier test racing this file's own teardown). Dev-18b's changes did not
   touch this test file, PdfProcessingService, or its classification/dispatch entry point in any way
   that would plausibly affect this timing -- unrelated to Dev-18b, still the same pre-existing,
   non-blocking defect. Not re-filed as a new defect; noted here as informational per the brief.
7. Full suite re-run -- unit: npm test produced 152 suites / 1232 tests, all green, exactly matching
   nexus-dev's self-report. e2e: this phase's own new suite (pdf-exam-extraction.e2e-spec.ts) green;
   Dev-18a's three e2e suites green on re-run; pdf-processing.e2e-spec.ts flaky as already known (D1).

## Defects

### D1 (carried forward from Dev-18a's QA report, informational only -- NOT a new Dev-18b defect)

Non-blocking, pre-existing flaky test in pdf-processing.e2e-spec.ts ("contentTypeHint bypasses
classification entirely", bare 5000ms Jest timeout under load). Confirmed still present and
unrelated to Dev-18b's changes (see item 6 above). No action requested from this phase; original
severity/repro steps stand as documented in qa-results/dev-18a/REPORT.md.

No new defects found in Dev-18b's own scope.

## Verdict

PASS -- Dev-18b (BL-15) is QA-green, no blocking defects. All of this phase's own named exit
gates -- per-page extraction (genuine call-count proof), negligible-text-page cost-control skip
(genuine call-count proof, both unit and real e2e), the provided/inferred confidence-band distinction
persisted as two separately queryable real columns (real DB read-back), budget-before-call ordering,
and mid-run-outage resumability -- are independently verified to genuinely hold, not just trusted from
the self-report. The PdfContentStrategy refactor is confirmed structurally mechanical and does not
regress Dev-18a's already-QA-green Lesson/Reference dispatch behavior (re-run green on both the
orchestrator's own unit spec and all three of Dev-18a's dedicated e2e suites). Full unit suite
(152/1232) and eslint/tsc are clean, matching the self-report exactly. The only defect encountered
(D1) is a pre-existing, non-blocking flakiness issue already known from Dev-18a's QA pass, confirmed
unrelated to this phase's changes.
