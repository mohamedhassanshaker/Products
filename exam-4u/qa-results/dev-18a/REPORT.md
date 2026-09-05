# QA Report -- Dev-18a (BL-14: Lesson generation, reference indexing, subject classification, cost accounting)

Date: 2026-08-10
Scope: Dev-18a ONLY (BL-14, backend). Dev-18b (exam extraction) explicitly out of scope per
orchestrator instruction -- reviewed only insofar as it appears mixed into the currently-checked-out
unit-test totals (noted below), not otherwise evaluated.

## Environment

- Backend: apps/api (NestJS), exercised via Jest unit tests and Jest e2e tests
  (apps/api/test/*.e2e-spec.ts) against:
  - Real MySQL 8 at 127.0.0.1:3306 (existing examland-mysql container, root/YourPassword)
  - Real Qdrant at 127.0.0.1:6333 (existing examland-qdrant container)
  - AiServicePort faked at the DI boundary for orchestration-focused suites (per each suite's own
    documented convention), and exercised for real (real AiServiceClient + real HTTP transport
    against a local fake-HTTP engine) in ai-cost-accounting.e2e-spec.ts.
- No frontend/UI surface in this phase's scope (backend-only phase).
- Test commands used: npm test (unit) / npm run test:e2e (e2e) -- both wrap Jest with
  NODE_OPTIONS=--experimental-vm-modules via cross-env. Note: running jest directly, bypassing those
  wrapper scripts, silently breaks pdf-parse's internal dynamic import and produces false-negative
  timeouts on every test that extracts real PDF text -- this was hit and corrected mid-pass (see D3).

## Traceability matrix

| Requirement | Scenario(s) tested | Result | Evidence |
|---|---|---|---|
| FR-PDF-4 bounded batches (<=10, enforced NestJS-side) | lesson-batch-planner.spec.ts: configured batchSize=25 still yields targetQuestionCount <= 10 on every planned batch | PASS | domain/lesson-batch-planner.spec.ts:37-51; code: lesson-batch-planner.ts:63 (Math.min(input.batchSize, MAX_QUESTIONS_PER_BATCH)) |
| FR-PDF-4 per-item-drop isolation | Unit: batch with droppedItems:1 persists the 2 surviving drafts; code path never inspects droppedItems to gate persistence | PASS | lesson-generation.service.spec.ts:65-86; code: lesson-generation.service.ts:93-98 |
| FR-PDF-4 concept carry-forward, cap-80 dedup | Unit: multi-batch carry-forward test + dedicated cap/FIFO-eviction tests (80-exact, 200-at-once) | PASS | covered-concepts.spec.ts (all 6 cases); lesson-generation.service.spec.ts:123-144 |
| FR-PDF-12/NFR-7 budget-before-call ordering (headline exit gate) | Unit: (a) already-exhausted session never calls generateLessonBatch; (b) mid-loop exhaustion stops before a further call; real call-count assertions, not just final status | PASS | lesson-generation.service.spec.ts:88-121; code: lesson-generation.service.ts:71-76 (check precedes the call inside the loop, structurally) |
| FR-PDF-12 graceful budget-exceeded completion (never Failed) | Real e2e against real MySQL: PDF_MAX_TOKENS_PER_SESSION=250 vs a 300-token-per-batch fake engine; asserts status=Completed, budget_exhausted=1, generateLessonBatch called <=1 time, partial generated_question rows present | PASS | apps/api/test/pdf-generation-budget.e2e-spec.ts -- reran independently, PASS (20.7s) |
| Graceful AI-outage mid-run (resumable, not Failed) | Unit: AiServiceUnavailableError from generateLessonBatch propagates without advancing lastCompletedPage; orchestrator/PdfProcessingService outer catch leaves session at its last real status, records errorCode only, never sets Failed | PASS (unit) | lesson-generation.service.spec.ts:146-155; pdf-processing.service.ts:213-223; pdf-generation-orchestrator.service.ts (status='Completed' write sits after strategy.run(), so a thrown outage error skips it) |
| FR-PDF-6 never-drops (loud failure path) | Unit: no resolvable curriculumId and no subjectId throws SubjectRequiredForIndexingError, no document/insert occurs; traced through PdfProcessingService.processSession's catch -- this error is NOT AiDisabledError/AiServiceUnavailableError, so it falls to the generic branch and the session is marked Failed with a real errorCode, genuinely surfacing (not swallowed) | PASS | reference-indexing.service.spec.ts:82-98; code trace: reference-indexing.service.ts:104-106 -> pdf-processing.service.ts:213-232 |
| FR-PDF-6 auto-Curriculum-creation, real path | Real e2e (real MySQL + real Qdrant, fake embeddings): auto-creates Curriculum named from filename, indexes real chunk count > 0 | PASS | apps/api/test/pdf-reference-indexing.e2e-spec.ts -- reran independently, PASS (20.8s) |
| FR-PDF-7 subject classification (retroactive-safe) | Code + unit tests: maps determinable questions, leaves subjectId:null ones unmapped, no-op on nothing-unmapped, swallows AI outage without failing the session | PASS | subject-classification.service.ts (code matches all four claims); subject-classification.service.spec.ts |
| FR-PDF-12/NFR-7 cost accounting -- every real call logs ai_call_log | Real e2e: real AiServiceClient over a real HTTP fake engine, tenant-scoped, writes exactly one row with correct task/prompt_tokens/completion_tokens/cost_usd/outcome | PASS | apps/api/test/ai-cost-accounting.e2e-spec.ts -- reran independently, PASS (19.6s) |
| Cost accounting -- dropped-item (AI_OUTPUT_INVALID) calls also logged | Code trace: AiServiceClient.invoke()'s AI_OUTPUT_INVALID-class branch calls recordUsage(...) before returning the zero-output result -- same code path as success | PASS (code trace) | ai-service.client.ts:145-149 |
| Full unit regression | Full npm test run | PASS -- 152 suites / 1232 tests, all green | See "Unit test run" below (note on count vs plan doc's "149/1218") |
| Full targeted e2e regression | pdf-generation-budget, pdf-reference-indexing, ai-cost-accounting (run together) | PASS -- 3/3 suites, 4/4 tests | See "E2E test run" below |
| pdf-processing.e2e-spec.ts regression (upload/dedup/classify + Dev-18a dispatch wiring) | Full suite, run in isolation, repeated 6 times | FLAKY -- passed 3/6, failed 3/6, always the same test, always a pure Jest timeout (never an assertion failure) | See Defect D1 below |
| tsc --noEmit | Whole apps/api | PASS, no errors | -- |
| eslint (pdf-processing/, ai/, infrastructure/ai/) | Scoped lint | PASS, 0 warnings/errors (--max-warnings=0) | -- |

## Unit test run

npm test (full suite, apps/api): 152 suites / 1232 tests, all passing. The Dev-18a completion notes
claim "149 unit suites / 1218 tests" for Dev-18a alone; the extra 3 suites / 14 tests are Dev-18b's
later, out-of-scope additions (exam-extraction.service.spec.ts and friends), exactly as the
orchestrator's briefing anticipated ("Dev-18b's later additions may now be mixed in"). Consistent,
not a discrepancy requiring action.

## E2E test run

Ran the three new Dev-18a-specific e2e suites together against real MySQL + real Qdrant:
pdf-generation-budget.e2e-spec.ts, pdf-reference-indexing.e2e-spec.ts, ai-cost-accounting.e2e-spec.ts
-- 3 suites / 4 tests, all green, each independently reproducing this phase's own three named exit
gates (budget-exceeded-still-Completed with a call-count bound, auto-Curriculum-creation with a real
chunk count, and a real ai_call_log row with correct usage fields).

Also ran the pre-existing pdf-processing.e2e-spec.ts (updated by Dev-18a) -- see Defect D1.

## Defects

### D1 -- Non-blocking: pdf-processing.e2e-spec.ts is flaky under real load (roughly 50% failure rate observed)

- Severity: Non-blocking (rough edge). Does not affect the phase's own headline exit gates -- the
  dedicated budget/cost-accounting/reference-indexing e2e suites (which independently prove those
  gates) passed reliably on every run.
- Expected: "Full existing suite... re-run green with no regressions" (Dev-18a completion notes).
- Actual: Running test/pdf-processing.e2e-spec.ts alone, in isolation, 6 times in a row (real MySQL,
  no other suites competing for CPU/DB) produced 3 passes and 3 failures. Every failure was the
  identical test -- "classification (FR-PDF-3) > a contentTypeHint bypasses classification entirely"
  -- failing with a plain Jest test-level timeout ("Exceeded timeout of 5000 ms for a test"), never
  an assertion failure. This test has no explicit per-test timeout override, unlike its sibling test
  two blocks above it (the "202-before-AI-work" test, which explicitly sets 10000ms because it
  already anticipated needing headroom beyond Jest's 5s default). On failing runs, the log also shows
  "Failed to persist Failed status for session <id>: Pool is closed" / "Connection is not
  established with mysql database" -- background setImmediate-scheduled pipeline work from an
  earlier test in the same file racing the suite's own afterAll DB-pool teardown, adding real
  contention around the same window the timing-sensitive test needs to complete in.
- Repro steps:
  1. cd apps/api
  2. DB_HOST=127.0.0.1 DB_PORT=3306 DB_USER=root DB_PASSWORD=YourPassword npm run test:e2e -- test/pdf-processing.e2e-spec.ts --silent
  3. Repeat 4-6 times. Roughly every other run fails on the "contentTypeHint bypasses classification
     entirely" test with a bare 5000ms timeout; the rest pass cleanly.
- Suggested (not applied -- QA does not fix defects) direction for nexus-dev: give that test (and any
  other default-timeout test in this file that does real PDF extraction + DB round-trips + background
  dispatch) the same explicit generous timeout its sibling already uses, and/or make each test in this
  file await full terminal-state settlement before returning so no test leaves background work racing
  the next test's afterAll.

### D2 -- Non-blocking, informational: no ai_call_log row for a call that never received a response

- Severity: Low-likelihood edge case, informational only -- not verified to violate spec wording.
- Observation (code trace, not independently reproduced against a live failure):
  AiServiceClient.invoke()'s retry-exhausted path (transport failure/timeout after MAX_ATTEMPTS, or
  an OUR_BUG_ENGINE_CODES short-circuit) throws AiServiceUnavailableError without ever calling
  usageRecorder.record(...) -- because no AiResponse.usage exists to record (the call never got a
  response body at all). This is a defensible reading of "Every AI call's token usage and cost is
  recorded" (FR-PDF-12) -- there is no usage to record for a call that produced none -- but it does
  mean a transport-outage call site is invisible in ai_call_log for operator/audit purposes, unlike
  the "engine responded but the item was bad" (AI_OUTPUT_INVALID) case, which IS logged (with
  outcome=Failed). Flagging for awareness only; not requesting a fix, since the exit-gate wording
  ("every AI call writes an ai_call_log row") is satisfied by every call that returns a real
  AiResponse, and this project's own ai-cost-accounting.e2e-spec.ts only asserts that case.

### D3 -- Process note (not a code defect): running jest directly (bypassing npm test) produces false failures

- Observed first-hand during this QA pass: invoking npx jest directly (rather than the wrapped npm
  test / npm run test:e2e scripts, which set NODE_OPTIONS=--experimental-vm-modules) causes every
  test that calls extractPdfPages (i.e. anything touching real PDF text extraction) to hang until
  Jest's timeout, because pdf-parse's internal dynamic import of its pdfjs-dist "fake worker" needs
  that flag under Jest's VM sandbox (this is explicitly documented in pdf-text-extractor.ts's own doc
  comment). Recorded here purely so a future QA/dev session doesn't mistake this
  environment-invocation mistake for a real regression, as happened initially in this pass before it
  was caught and corrected.

## Independent verification highlights (the 9 checklist items from the brief)

1. Per-item-drop -- confirmed via lesson-generation.service.spec.ts (unit) with a real droppedItems:1
   mock response; surviving 2/3 drafts are persisted. Code path never branches on droppedItems to
   decide what to keep -- structural, not best-effort.
2. Budget-ordering (headline exit gate) -- confirmed via two dedicated unit tests
   (first-call-blocked, mid-loop-exhausted) using real mock.calls.length assertions, AND via the
   real-MySQL pdf-generation-budget.e2e-spec.ts (generateLessonBatchMock.mock.calls.length <= 1).
   This genuinely holds -- the check is a synchronous if inside the loop, immediately before the
   await this.aiService.generateLessonBatch(...) call, with no code path that could call it after
   decrementing/checking.
3. Graceful budget-exceeded completion -- confirmed via real DB inspection in
   pdf-generation-budget.e2e-spec.ts (budget_exhausted = 1, status = Completed, never Failed, partial
   generated_question rows present).
4. Graceful AI-outage mid-run -- confirmed structurally: LessonGenerationService.generate() lets
   AiServiceUnavailableError/AiDisabledError propagate uncaught; lastCompletedPage is only ever
   written after a batch's insert, so a failing batch never advances the watermark (unit-tested
   directly); PdfGenerationOrchestrator.process()'s own status='Completed' write sits after the
   strategy.run() call, so a thrown outage error skips it entirely and PdfProcessingService's outer
   catch marks neither Failed (leaves prior status, records errorCode for operator visibility only).
5. FR-PDF-6 never-drops -- confirmed both by the negative unit test (throws, never inserts) and trace
   through to PdfProcessingService's catch block, where SubjectRequiredForIndexingError (not being an
   AI-outage type) falls to the generic Failed-with-errorCode branch -- this is a real, observable
   session-level failure a caller/reviewer can see and act on (re-upload with a subject), not a
   swallowed exception.
6. Covered-concepts rolling cap-80 -- confirmed via covered-concepts.spec.ts's dedicated 80-exact and
   200-at-once eviction tests, plus a genuine multi-batch carry-forward test in
   lesson-generation.service.spec.ts proving batch 2 receives batch 1's concept.
7. Cost accounting for every call -- confirmed for success and for AI_OUTPUT_INVALID/dropped calls
   (both hit recordUsage(...) in AiServiceClient.invoke(), same insert path in
   PersistentAiUsageRecorder); see D2 for the one edge case (a call with literally no response) that
   is not logged, judged non-blocking.
8. Bounded batch size -- confirmed via lesson-batch-planner.spec.ts's explicit "configured
   batchSize=25 still yields <=10" test, and via code inspection (Math.min(input.batchSize,
   MAX_QUESTIONS_PER_BATCH)), i.e. enforced NestJS-side regardless of configuration or engine
   behavior.
9. Full suite re-run -- see "Unit test run"/"E2E test run" above; unit suite is 100% green; Dev-18a's
   own three new e2e suites are 100% green on repeated runs; the pre-existing pdf-processing.e2e-spec.ts
   is flaky (D1, non-blocking).

## Verdict

PASS -- Dev-18a is QA-green. All of this phase's own named exit gates (budget-check ordering,
graceful budget-exceeded completion, per-item-drop isolation, FR-PDF-6 loud-failure-not-silent-drop,
cost-accounting persistence, bounded batch size) are independently verified to genuinely hold, both
by unit tests with real ordering/call-count assertions and by real-MySQL/real-Qdrant e2e suites
re-run during this QA pass. tsc/eslint are clean. One non-blocking test-flakiness defect (D1) and one
informational, non-blocking edge case (D2) are reported for awareness -- neither blocks this phase's
exit gate or the FR/NFR requirements in scope.
