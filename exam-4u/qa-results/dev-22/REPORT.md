# QA Report — Dev-22 (BL-20: outbox pattern, stale session recovery, worker topology)

**Date:** 2026-08-11
**Scope:** Dev-22 only (last phase of Phase 4: BL-14..18, BL-20). Phase 5/Dev-23+ out of scope.
**Verdict: PASS — ready to advance. No blocking defects found.**

## Environment

- Backend: apps/api (NestJS), MySQL 8.4 via existing examland-mysql Docker container (host
  127.0.0.1:3306, root/YourPassword -- the working credentials, distinct from the stale
  .env.qa at repo root which points at a non-existent port 3308/rootpass; flagged below as a
  minor hygiene issue, not a Dev-22 code defect).
- No frontend surface in Dev-22 scope (background workers only) -- no browser/e2e UI testing
  performed for this phase.
- All test data created under disposable, randomly-suffixed tenant/platform schemas, dropped in
  afterAll. My own temporary QA-only e2e spec (qa-dev22-hygiene.e2e-spec.ts) and its temp
  storage directory were deleted after the run; the schema it created was dropped by its own
  afterAll.

## What was independently reproduced (not just read)

1. npm run typecheck -- clean (3 workspaces). npm run lint --max-warnings=0 -- clean.
2. Unit suite: npm run test -> 160 suites / 1346 tests, all green -- matches self-report exactly.
3. E2E suite against live MySQL 8.4, full serial run (--runInBand): 38 suites / 334 tests,
   all green on my run (no flaky timeouts this time -- consistent with the self-report's own
   diagnosis that the previously-seen 2-suite timeout was resource contention, not a real bug;
   those 2 suites -- tenant-migration-runner, tenant-registry-cross-schema -- are outside
   Dev-22 scope regardless).
4. reliability-workers.e2e-spec.ts (part of the above run) read in full and confirmed to
   contain genuine, non-trivial real-MySQL assertions for every Dev-22 deliverable:
   - Outbox enqueue writes tenant_work_hint(kind='outbox') in the same call.
   - At-least-once delivery + idempotent consumer: enqueue -> deliver -> reset row to pending
     (simulated crash-before-ack) -> redeliver -> consumer side effect (calls.push) asserted to
     NOT run twice.
   - Consumer failure -> backoff (available_at pushed into the future via server-side
     NOW(3) comparison, never JS Date) -> message never marked processed.
   - Real concurrent race #1: Promise.all of two live OutboxPublisher.processTenantBatch
     calls against the same 10-row batch -- disjoint claims, zero overlap, exactly 10 delivered.
   - findStaleCandidateIds/claimStale proven against real DB rows (stale vs fresh via
     server-side DATE_SUB, never JS-computed timestamps -- avoids a previously-diagnosed
     host-timezone-drift bug class).
   - Real concurrent race #2: Promise.all of two live claimStale calls on the same stale
     session row -- exactly one wins, verified via re-findById.
   - findTimedOutCandidateIds + closeAndScore('TimedOut') proven against real attempt rows.
5. stale-session-recovery.worker.spec.ts -- confirmed unit coverage of the resume-vs-Failed
   policy branch (resume increments resumeAttempts and calls resumeProcessing; past
   maxResumeAttempts sets Failed/STALE_SESSION_RECOVERY_EXHAUSTED and never resumes) and the
   "one bad candidate never blocks the sweep" tolerance.
6. Dev-6a avatar-cleanup / reset-token pruning -- no dedicated real-DB test existed for these two
   paths in the repo, so I wrote and ran my own temporary e2e spec directly against the live
   MySQL container and real local disk (deleted afterward, not left in the repo):
   - ProfileRepository.setPicture-equivalent scheduling (FileCleanupRepository.schedule) ->
     TenantHygieneService.drainFileCleanupQueue() -> confirmed the on-disk file was genuinely
     deleted (fs.stat throws afterward) and the file_cleanup_queue.deleted_at column was
     genuinely set -- never optimistically before the real delete resolved.
   - TenantHygieneService.pruneExpiredResetTokens() (delegates to
     UserRepository.pruneExpiredResetTokens) -> confirmed an expired token's hash/expiry were
     cleared and a still-valid token on a different row was left untouched, via real DB state
     (server-side DATE_SUB for the expiry, not a JS Date).
   - Both passed. This closes a real independent-verification gap the self-report's own listed
     evidence didn't cover (it named these components but the actual reliability-workers.e2e-spec.ts
     never exercises them -- see Finding QC-1 below, non-blocking).
7. Worker topology (worker.ts): confirmed all four workers scheduled on independent
   setInterval ticks wrapped so one worker's uncaught rejection never stops another's timer, each
   sharing one process-lifetime WORKER_ID for lease claims, graceful SIGTERM/SIGINT shutdown
   clearing all intervals before app.close().

## The specific investigation requested: tenant_work_hint wiring for pdf_session/attempt_timeout

Read StaleSessionRecoveryWorker and AttemptTimeoutSweeper source directly (not just the plan's
prose). Confirmed:

- Neither worker ever consults tenant_work_hint. Both have exactly one sweep entrypoint,
  runFullSweep(), which pages through every Active tenant unconditionally on every tick
  (WORKER_SWEEP_TICK_MS, default 60s). There is no runHintedSweep method on either class, and
  worker.ts only ever calls .runFullSweep(...) for both. Only OutboxPublisher has a genuine
  hinted-sweep path (runHintedSweep, gated on kind='outbox' hints) plus its own separate,
  less-frequent full-sweep safety net.
- This is accurately and explicitly disclosed in both workers' own class-level doc comments and
  in the plan's Dev-22 completion notes -- it is not a hidden gap the self-report tried to obscure.
- Judgment: non-blocking. Reasoning:
  - HLD Section 10.2 frames the hint mechanism purely as a cost optimization ("Naively, every
    tenant-scoped worker must poll every tenant schema... thousands of idle queries per minute")
    to avoid at "tens to low hundreds of tenants" scale -- it explicitly says a lost hint merely
    "delays work by minutes, never loses it" via the safety-net full sweep, i.e. the design itself
    treats full-sweep as a correct (if less efficient) fallback path, not a degraded/incorrect one.
  - Both workers' full sweep runs every tick (not just as an occasional safety net), so
    correctness (FR-REL-3's "no session is left indefinitely ambiguous", FR-TAKE-6's belt-and-braces
    timeout) is fully intact -- every Active tenant's stale sessions/timed-out attempts are checked
    every 60s regardless of hints.
  - The exit gate's own wording ("no session is left indefinitely ambiguous... test simulates a
    stuck session and asserts eventual resolution") is a correctness requirement, not an efficiency
    one, and it is met and tested (see item 5 above and the e2e races).
  - The only real cost is O(tenants) queries every 60s for these two workers instead of O(hinted
    tenants) -- acceptable at the scale HLD Section 10.2 itself calls out, and consistent with
    TenantMaintenanceWorker's own pre-existing full-sweep convention for its duties.
  - Conclusion: an optimization gap, not a missing piece of what Dev-22 was scoped to build.
    Dev-22's own scope line names "the cross-schema tenant_work_hint table avoiding O(tenants)
    polling" as in-scope, and it does exist and is wired for the one path (outbox) that most needs
    it (10s tick, vs 60s for the other two) -- but nothing in the plan's Dev-22 scope/deliverables/exit
    gate commits to hinting all three kinds; the enum simply reserves room for it. This should be
    tracked as a follow-up (wire pdf_session/attempt_timeout hints into uploadPdf and the
    attempt-creation path respectively) but does not block Phase 4 completion.

## Traceability matrix

| Requirement | Scenario(s) tested | Result | Evidence |
|---|---|---|---|
| FR-REL-1 at-least-once outbox delivery, idempotent consumer | crash-before-ack redelivery; consumer-failure backoff; dead-letter logging path | PASS | reliability-workers.e2e-spec.ts (re-run live, this pass) |
| FR-REL-1 multi-replica safety (outbox claim) | 2 concurrent processTenantBatch calls racing 10 rows | PASS | same file, real concurrent race, re-run live |
| FR-REL-3 stale-session detection | findStaleCandidateIds stale-vs-fresh | PASS | same file, re-run live |
| FR-REL-3 stale-session claim safety | 2 concurrent claimStale calls, same row | PASS | same file, real concurrent race, re-run live |
| FR-REL-3 resume vs Failed-after-maxResumeAttempts | unit policy test, both branches | PASS | stale-session-recovery.worker.spec.ts, re-run live |
| FR-TAKE-6 belt-and-braces attempt timeout | findTimedOutCandidateIds + closeAndScore | PASS | reliability-workers.e2e-spec.ts, re-run live |
| Dev-6a avatar-cleanup forward reference (schedule to drain) | enqueue on avatar replace; drain deletes real file + marks row | PASS | my own temporary live e2e spec (deleted after run) -- no pre-existing real-DB test covered this path |
| Expired reset-token pruning | expired token cleared, valid token untouched | PASS | my own temporary live e2e spec (deleted after run) -- same gap as above |
| Worker topology: 4 independent workers, DB-lease claims, graceful shutdown | code review of worker.ts/worker.module.ts | PASS | direct read |
| tenant_work_hint hinted sweep for pdf_session/attempt_timeout | code review -- is it wired? | Not implemented (disclosed) | direct read of both workers + worker.ts; judged non-blocking (see above) |
| Static analysis / typecheck / lint | full run | PASS | this pass |
| No /api/metrics endpoint for dead-letter visibility | disclosed gap, out of Dev-22 exit gate | Untested/N-A | matches self-report, non-blocking, explicitly out of scope |
| ROLE=worker deployment manifest | disclosed gap, nexus-deploy's job | N-A | out of scope for this phase |

## Defects / findings

**QC-1 (non-blocking, process/coverage note).** The self-report's "independently verified" list for
item (4) Dev-6a avatar-cleanup and the reset-token pruning duty cites reading
reliability-workers.e2e-spec.ts's test bodies as evidence, but that file does not actually contain
any test for drainFileCleanupQueue/pruneExpiredResetTokens -- only tenant-maintenance.worker.spec.ts
(a mocked unit test) covers them. The underlying code is correct (verified live by me, see above), so
this is not a functional defect, but the project's own real-DB integration coverage for these two
FR-IAM-4/HLD Section 10.1 duties was thinner than implied. Recommend adding a permanent real-MySQL +
real-disk test for these two paths (my temporary spec, since deleted, can be used as a starting
point) in a future phase's regression pass.

**QC-2 (non-blocking, hygiene).** Repo-root .env.qa points at DB_PORT=3308/DB_PASSWORD=rootpass,
which does not match any running service (only examland-mysql on 3306 with YourPassword is up).
Any automated QA harness relying on .env.qa as-is would fail to even connect. Not a Dev-22 code
defect, but worth fixing before the next QA pass relies on it unattended.

**Optimization gap (non-blocking, tracked above).** tenant_work_hint is wired for kind='outbox'
only; StaleSessionRecoveryWorker/AttemptTimeoutSweeper are full-sweep-only. Disclosed by
nexus-dev, confirmed accurate by me, judged non-blocking (correctness intact, only a cost
optimization deferred). Recommend a small follow-up ticket in Phase 5 or later to wire the remaining
two hint kinds.

No blocking defects found.

## Overall verdict

**PASS.** Dev-22 (BL-20) is QA-green. All FR-REL-1/FR-REL-3 deliverables and exit-gate criteria are
genuinely met and independently reproduced against live MySQL (including both required real
concurrent-claim races). The tenant_work_hint scope-limitation for two of three sweep kinds is
accurately disclosed, does not affect correctness, and is a reasonable, explicitly-scoped deferral --
not a blocking gap. This completes Phase 4 (BL-14..18, BL-20) of the dev plan in full.
