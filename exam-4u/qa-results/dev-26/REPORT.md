# QA Report: Dev-26 (BL-25 Full-Bank Lesson Assessment) + Maintenance Fix (Dev-18a/18b crash-safety)

Date: 2026-08-11
Scope: FR-PDF-13, full FR-REL-2 (durable, per-unit watermark checkpointing across three services:
FullBankAssessmentService, LessonGenerationService, ExamExtractionService). Elevated bar per orchestrator:
independently reproduce every restart-survival claim against real MySQL, not accept it on nexus-dev's word.

## Environment
- Backend: apps/api, real MySQL 8.4-compatible server (docker container `examland-mysql`, reachable at
  127.0.0.1:3306 with root/YourPassword -- NOTE: differs from docker/docker-compose.dev.yml's documented
  `examland_dev_root`/`examland`/`examland_dev` credentials; this appears to be a persistent, shared
  dev/QA MySQL instance from prior sessions, not freshly provisioned by this pass's own compose file).
  No frontend surface exists for this phase (backend-only, matches nexus-dev's own scope note).
- All test schemas created by this pass (t_qa_examrestart_*, plus the three restart e2e specs' own
  t_e2e_fullbank_*/t_e2e_lessonrestart_*/t_e2e_examrestart_* schemas) were dropped by each test's own
  `afterAll`; confirmed no orphaned QA schemas remain after this pass.

## What was independently reproduced (not just re-read)

1. **Dev-26's full-bank restart e2e** (`test/full-bank-assessment-restart.e2e-spec.ts`) -- read the full
   test body. Confirmed genuine methodology: process A and process B use entirely independent
   `DataSource`/connection pools, repository instances, service instances, and `AiServicePort` fakes
   (different `jest.fn()` closures). Batch 1 committed for real (polled via a raw SQL read against
   `dataSourceA.manager`, not an in-memory flag) before `dataSourceA.destroy()` tears down the entire
   pool. Batch 2's AI call is a promise that never resolves and is never awaited -- correctly modeling
   a killed process, not a slow one. Process B is built from scratch and given only the `sessionId`.
   Re-ran against real MySQL: **PASS**.

2. **Maintenance-fix restart e2e for Lesson and Exam** (`test/lesson-generation-restart.e2e-spec.ts`,
   `test/exam-extraction-restart.e2e-spec.ts`) -- read both test bodies in full. Same genuine
   process-A/process-B DataSource-destruction methodology, verbatim, applied to
   `LessonGenerationService.generate()` and `ExamExtractionService.generate()` directly (not through
   the full HTTP pipeline, but the actual service class under actual real-MySQL transactions). Re-ran
   both against real MySQL: **PASS** (both).

3. **My own independent restart scenario** (not a re-run of nexus-dev's tests): a 4-page exam-extraction
   crash scenario where the crash point is placed AFTER a negligible-text-skip page (page 2, the
   zero-row watermark-only checkpoint path nexus-dev's own test does not specifically crash after) --
   page 1 real AI call, page 2 skipped (< MIN_PAGE_TEXT_CHARS), page 3's AI call hangs forever
   (simulated crash), `dataSourceA.destroy()`, brand-new process B resumes. Verified:
   - The skip-page checkpoint itself is durable (watermark reaches page 2 without any AI call for it).
   - After resume, pages 3 and 4 (and only those) are sent to the AI -- pages 1 and 2 are never
     re-requested.
   - Token/cost totals are **not double-counted**: process A commits 150 tokens/$0.05 (page 1 only,
     page 2 contributes zero), process B adds exactly 300 tokens/$0.10 more (pages 3+4), for a correct
     final total of 450 tokens/$0.15 -- proving the atomic `tokens_used + :delta`/`total_cost + :delta`
     SQL-level increments in `persistBatchAndAdvanceWatermark` never re-apply an already-committed
     delta across the process boundary.
   - Result: **PASS** (script written to `apps/api/test/`, run once, then deleted per test-hygiene
     instructions -- not left in the repo).

4. **Never-re-does-completed-work**: confirmed in all three restart tests (Dev-26's own, both
   maintenance-fix tests, and my own) -- the already-completed unit's row id(s) survive byte-identical
   into process B's final read, the AI mock's call count for the already-completed unit is exactly zero
   after resume, and question counts never exceed the expected total.

5. **`session_kind` discrimination** -- read `StaleSessionRecoveryWorker.recoverOne` and
   `SessionKindResumer`/`SESSION_KIND_RESUMERS` directly. Dispatch is a straightforward
   `this.resumers.find(r => r.kind === session.sessionKind) ?? find('pipeline')` -- a `full_bank_assessment`
   session and a `pipeline` (Lesson/Exam) session are routed to genuinely separate resumer
   implementations with no shared mutable state; `stale-session-recovery.worker.spec.ts` (part of the
   full unit suite, reconfirmed green below) already asserts this routing directly. No interference
   found.

6. **Regression check** -- re-ran `reliability-workers.e2e-spec.ts`, `pdf-processing.e2e-spec.ts`,
   `pdf-generation-budget.e2e-spec.ts` against real MySQL: **20/20 tests pass**, exact match to
   nexus-dev's reported figure. Budget-exhaustion-graceful-Completed, AI-outage-resumable-not-Failed,
   and per-item-drop behaviors are all unaffected by the watermark-persistence-frequency change.

7. **Full unit suite** -- re-ran `npm test` from `apps/api`: **172/172 suites, 1457/1457 tests**, exact
   match to nexus-dev's reported figure. `npm run typecheck` (apps/api) and root `npm run lint` both
   clean.

## Code-level review (independent, not a re-read of nexus-dev's own claims)

- `PdfProcessingSessionRepository.persistBatchAndAdvanceWatermark` -- read directly. Genuinely one
  transaction (`tenantContext.transaction`) wrapping both the batch's `generated_question` INSERTs and
  the session row UPDATE; `tokens_used`/`total_cost` use SQL-level `col + :delta` (via TypeORM
  QueryBuilder `.set({ ... : () => \`tokens_used + ${delta}\` })`), never a read-modify-write in
  application code -- this is the correct primitive for "advance only after output is durably
  persisted" (FR-REL-2's exact wording) and for never double-counting across a crash boundary.
- `ExamExtractionService.generate()` -- confirmed the negligible-text-skip path (`< MIN_PAGE_TEXT_CHARS`)
  calls `persistBatchAndAdvanceWatermark` with `entities: []`/`tokensDelta: 0`/`costDelta: 0` and still
  advances the watermark -- exactly the claimed "zero-row transactional checkpoint," independently
  confirmed working under my own crash scenario above (item 3).
- `FR-PDF-13`/`FR-REL-2` (PRODUCT_SPECIFICATION.md) read directly: "the watermark advances only after
  its corresponding output ... is durably persisted, so a crash between 'generated' and 'persisted'
  re-does that one unit of work rather than skipping it" -- this is exactly what all three services now
  implement, verified by direct test.

## Traceability matrix

| Requirement | Scenario(s) tested | Result | Evidence |
|---|---|---|---|
| FR-PDF-13 fixed-shape, resumable full-bank assessment | Dev-26's own restart e2e re-run; unit spec `full-bank-assessment.service.spec.ts` (part of full suite) | PASS | full-bank-assessment-restart.e2e-spec.ts re-run green |
| FR-REL-2 (full-bank) per-batch durable checkpoint | Restart e2e (batch 1 durable, batch 2 crash, resume) | PASS | same as above |
| FR-REL-2 (Lesson) per-batch durable checkpoint (maintenance fix) | lesson-generation-restart.e2e-spec.ts re-run | PASS | see above |
| FR-REL-2 (Exam) per-page durable checkpoint incl. skip path (maintenance fix) | exam-extraction-restart.e2e-spec.ts re-run + my own independent skip-page-crash scenario | PASS | see above |
| Never re-does/loses/double-counts completed work | All 4 restart scenarios (3 re-run + 1 own) | PASS | row-id survival, zero re-calls, exact token/cost totals asserted |
| session_kind discrimination (Full-bank vs pipeline) | Code review of StaleSessionRecoveryWorker/SessionKindResumer + stale-session-recovery.worker.spec.ts (in full suite) | PASS | no shared/interfering state found |
| Regression: budget-exhaustion, AI-outage, per-item-drop (Dev-18a/18b) | reliability-workers/pdf-processing/pdf-generation-budget e2e re-run | PASS | 20/20 |
| Full unit suite | npm test | PASS | 172/172 suites, 1457/1457 tests |
| Lint/typecheck | npm run lint / typecheck | PASS | clean |

No untested requirement gaps identified in scope.

## Defects found

None blocking. No non-blocking defects found either in this scope (this phase's own security
self-review claims -- existing permission reuse, server-side bounds validation, no raw SQL
concatenation -- were spot-checked via the code reads above and found consistent with the claims).

## Verdict

**PASS / READY.** Genuine process-restart survival independently reproduced and holds for all three
services (Full-bank, Lesson, Exam) under real MySQL, including a QA-authored scenario nexus-dev's own
tests did not specifically cover (crash immediately after a negligible-text-skip checkpoint). The
Dev-18a/18b maintenance fix is confirmed to be a real, correctly-implemented closure of the crash-safety
gap it claims to fix, with no regression to previously QA-green budget/outage/drop behaviors.
