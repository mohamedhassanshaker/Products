# QA Report -- Dev-23 (BL-22: Semantic-fingerprint deduplication)

Date: 2026-08-11
Scope: Dev-23 only (FR-PDF-2 semantic tier). Dev-24+ out of scope (not started). Phases 1-4 already QA-green (not re-tested beyond regression suites touched by this phase).

## Environment

- Live MySQL (examland-mysql, mysql:latest, container up 9 days) on 127.0.0.1:3306, root/YourPassword.
- Live Qdrant (examland-qdrant, qdrant/qdrant:latest) on 127.0.0.1:6333.
- No production system touched; every e2e suite provisions its own randomly-suffixed disposable tenant schema/Qdrant tenant scope and cleans it up in afterAll.
- API: apps/api run in-process via Jest e2e harness (Supertest), matching the project's own e2e convention.
- Repo is NOT a git repository in this environment (git status fails with "not a git repository"), so .github/workflows/ci.yml has never actually executed as real CI here -- see coverage-gate findings below.

## Coverage-gate investigation (explicitly requested)

1. Is the aggregate 80% branch-coverage gate really failing, or a Dev-23 regression?
   Independently reran npm run test:cov -w apps/api from scratch (not trusting the self-report). Result:
   Jest: "global" coverage threshold for branches (80%) not met: 76.62% -- confirmed real and reproducible, matching nexus-dev's reported 76.6% almost exactly. Test run: 161 suites / 1368 tests, all green (nexus-dev reported 162/1391 -- a small discrepancy, see Non-blocking findings below; not itself evidence of a hidden failure).

2. Root cause -- is it Dev-23's own code or pre-existing?
   Inspected the full per-file coverage table. Files with 0% coverage dragging the aggregate down are entirely outside pdf-processing / Dev-23's scope:
   - src/modules/attempts/api/attempts.controller.ts (0%, 106 lines), exam-instructions.controller.ts (0%, 22 lines)
   - src/modules/exam-authoring/api/exam-authoring.controller.ts (0%, 82 lines)
   - src/modules/practice/api/practice.controller.ts (0%, 35 lines)
   - src/modules/reliability/.../attempt-timeout-sweeper.worker.ts, outbox-publisher.worker.ts (0%, 134 lines), audit-trail.consumer.ts
   - src/platform/reliability/application/work-hints.service.ts, work-hint.repository.ts (0%)
   - tenant-config controller, smtp.adapter.ts, google-id-token-verifier.adapter.ts, migrate-tenants.ts (all 0%)
   These are "thin controller, tested via e2e not unit" by design per multiple earlier decision-log entries (e.g. Dev-3, Dev-12b), from Phase 2-4 (BL-14..21), NOT from Dev-23.
   Dev-23's own new/touched files individually clear the gate or match the self-report exactly: semantic-dedup.service.ts = 100/85.7/100/100 (stmt/branch/func/line) -- exactly matches nexus-dev's claim. pdf-processing.service.ts = 89.78/80.3/72.41/90.75 (branch clears 80%). pdf-generation-orchestrator.service.ts = 96.87/73.91/100/96.55 -- whole-file branch is below 80%, but the new fingerprint-upsert branches added by this phase are covered by the dedicated "fingerprint upsert" describe block (4 tests); the file's remaining uncovered branches predate Dev-23. Conclusion: root cause confirmed as accumulated pre-existing 0%-covered controllers/workers from earlier phases, not a Dev-23 regression. Self-report's claim is accurate.

3. Is the 80% threshold a hard CI gate, or informational?
   apps/api/jest.config.js sets coverageThreshold.global to 80/80/80/80. This is Jest's own hard gate -- jest --coverage exits non-zero when unmet (reproduced directly: the test:cov npm script failed with exit code 1). .github/workflows/ci.yml's "Unit tests (with coverage)" step runs exactly npm run test:cov -w apps/api, so if this were run against a real CI service on a real git push, the build would fail today.
   However: this working directory is not a git repository. There is no evidence any real GitHub Actions run has ever executed against this codebase -- the workflow file is aspirational/never-triggered infrastructure here, not a currently-operating gate. In practice the "80% gate" has only ever been enforced by whichever agent (nexus-dev or nexus-qa) chose to run test:cov and read its exit code/aggregate number during a given phase's manual verification -- not by an actual blocking CI pipeline.

4. How long has this been accumulating, and does it need remediation?
   The decision log shows the aggregate was already only barely above the gate a while back -- an earlier phase (curricula/RAG-core era) recorded 80.73% branch after an explicit fix-up, and a later phase recorded a 79.71% to fixed-up branch-coverage failure. Since then, multiple phases (attempts, exam-authoring, practice, reliability workers) added new "0%-by-design, e2e-covered" controllers/workers without anyone re-running the global aggregate check as part of those phases' own QA sign-off -- most QA passes since then verified only the touched files' own coverage, not the whole-suite aggregate -- so the aggregate silently crossed below 80% at some point in Phase 3/4 and was not caught by nexus-qa in real time. This is a real, genuine process-integrity gap: the project's own hard-enforced quality gate has been red for an unknown number of prior "QA-green" phases, and nobody flagged it project-wide until Dev-23's self-report did. It does not block Dev-23 specifically (Dev-23's own code is not the cause and clears the gate on its own), but it does need a dedicated remediation phase: either (a) add real unit tests for the 0%-covered controllers/workers, or (b) deliberately exclude "thin, e2e-only" files from collectCoverageFrom with a documented rationale. Recommend the orchestrator schedule this as a backlog item before Final Review, since Final Review's own gate re-check will hit the same failure otherwise.

## Independent functional verification

1. Boundary (headline exit gate): cosine >= 0.97 triggers reuse, below does not. Wrote and ran my own e2e suite against live Qdrant, independent of nexus-dev's fixtures: different (16-dim, non-axis-aligned, deterministic-random) basis vectors, tighter margins (0.9701 vs 0.9699, and 0.972 vs 0.968). Result: PASS -- matches above threshold, misses below, at both margins. Also re-ran nexus-dev's own boundary suite (test/pdf-semantic-dedup.e2e-spec.ts, 5 tests) live: PASS, 5/5.
2. Exact-hash tier runs first; semantic only after a miss. Verified by code inspection of pdf-processing.service.ts: tryExactHashDedup called first inside processSession, trySemanticDedup only reached if it returns false; both share one applyReuse() method. Confirmed as a structural guarantee, not just test assertions.
3. Identical reuse behavior via real HTTP. Re-ran test/pdf-semantic-dedup-fullstack.e2e-spec.ts (2 tests, real MySQL+HTTP+Qdrant, controllable embeddings fake): PASS, 2/2 -- proves upload -> tier-1-miss (different fileHash) -> tier-2-hit -> reuse, plus a negative control (unrelated docs never cross-reused).
4. FINGERPRINT_SIMILARITY_THRESHOLD genuinely configurable. Traced env.schema.ts -> configuration.ts -> config.vector.fingerprintSimilarityThreshold, consumed in SemanticDedupService.findSemanticMatch; e2e suite proves both directions (0.90 makes 0.955 match; 0.995 rejects 0.985). Confirmed.
5. Fingerprint upsert only on Completed, never premature. Verified in pdf-generation-orchestrator.service.ts: upsertFingerprint call is placed after session.status = 'Completed' and await this.sessions.save(session); gated on tenantId && fingerprintVector both present; wrapped in try/catch so a Qdrant failure never flips a completed session back to Failed. Confirmed by code inspection, backed by the "fingerprint upsert" unit describe block (4 tests).
6. Unit suite reproducibility. Ran npm run test:cov -w apps/api myself: 161 suites/1368 tests green (nexus-dev claimed 162/1391 -- see discrepancy note below); coverage gate fails at 76.62% (see coverage section).
7. Regression -- no breakage to adjacent suites. Re-ran pdf-processing.e2e-spec.ts (10/10), vector-tenant-isolation.e2e-spec.ts, vector-bootstrap.e2e-spec.ts live: PASS, 24/24 combined, no regressions.

## Defects / findings

### Blocking
None found in Dev-23's own functional scope. The semantic dedup tier behaves exactly as specified: correct tier ordering, correct threshold semantics (independently re-verified at tighter margins than nexus-dev's own fixtures), identical reuse behavior to the exact-hash path, configurable threshold, and correctly-timed fingerprint upsert.

### Non-blocking

1. Test-count discrepancy in self-report (low severity, reporting-accuracy only). nexus-dev reported "162 suites / 1391 tests, 100% green"; my independent re-run produced 161 suites / 1368 tests, also 100% green. Both indicate a fully passing suite; the exact numbers differ by 1 suite / 23 tests. Plausible causes: a stray/uncommitted spec file (a precedent this same project has hit before -- see the Dev-8 fix-pass entry in NEXUS_STATE.md), environment/Node-version difference (project targets Node 24; this run used Node 22), or test-file drift between when nexus-dev ran vs now. Does not affect the pass/fail verdict but nexus-dev's self-reported counts should be treated as approximate going forward until reconciled.

2. Project-wide 80% branch-coverage gate is currently red (76.62%), confirmed genuine and pre-existing, not caused by Dev-23. See "Coverage-gate investigation" above for full detail. Recommend a dedicated remediation phase (either add real coverage to the 0%-by-design controllers/workers, or formally exclude them from collectCoverageFrom with documented rationale) before Final Review, since Final Review will hit the identical gate failure otherwise. Not a reason to retry Dev-23 itself.

## Traceability matrix (FR-PDF-2 semantic tier, Dev-23 scope)

| Requirement | Scenario(s) tested | Result | Evidence |
|---|---|---|---|
| FR-PDF-2 semantic tier: cosine>=0.97 default threshold | Independent boundary e2e (tight margins) + nexus-dev's own boundary e2e | Pass | This session's e2e run output; test/pdf-semantic-dedup.e2e-spec.ts |
| FR-PDF-2: exact-hash checked first (cheapest) | Code inspection of processSession call order | Pass | pdf-processing.service.ts lines ~229-246 |
| FR-PDF-2: semantic-hit reuse identical to exact-hash reuse | Full-stack HTTP e2e re-run + shared applyReuse code inspection | Pass | test/pdf-semantic-dedup-fullstack.e2e-spec.ts |
| FR-PDF-2: threshold configurable | Code inspection (env->config->service) + e2e both-direction proof | Pass | env.schema.ts, configuration.ts, e2e suite |
| Fingerprint upsert timing (not before Completed) | Code inspection of orchestrator process() | Pass | pdf-generation-orchestrator.service.ts |
| No regression to Dev-16/VEC-BOOT surfaces | Re-ran pdf-processing, vector-tenant-isolation, vector-bootstrap e2e | Pass | This session's e2e run (24/24) |
| Aggregate unit coverage gate (project NFR, jest.config.js) | Full test:cov re-run | Fail (pre-existing, not Dev-23's fault) | 76.62% vs 80% gate; see above |
| Security self-review (tenant scoping, no new endpoint, no raw user-input filter) | Code inspection of SemanticDedupService/VectorStorePort chokepoint | Pass, no findings | semantic-dedup.service.ts |

## Verdict

PASS -- Dev-23 is functionally correct and ready to advance; no blocking defects. The disclosed coverage-gate gap is real, confirmed pre-existing (not introduced by this phase), and does not block Dev-23, but should be scheduled as a dedicated remediation item before Final Review.
