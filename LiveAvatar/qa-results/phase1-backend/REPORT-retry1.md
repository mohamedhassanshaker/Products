# QA Retry #1 - Phase 1 Backend/API (BL-001-BL-003 + bootstrap)

Date: 2026-08-19
Scope: apps/api only (backend/API). Angular admin SPA covered by a parallel nexus-qa pass, not tested here.
This is a re-verification of the dev fix pass targeting D-1..D-4 from `qa-results/phase1-backend/REPORT.md`.

## Environment

- Working dir: apps/api (NestJS 11 + Prisma 7 + Postgres 16, per ADR-001).
- Docker Desktop processes ARE running in this sandbox this round (Docker Desktop.exe, com.docker.backend.exe etc. visible in the process list, and `docker context ls` returns instantly) - a change from the prior pass where the daemon looked entirely absent.
- However, `docker version` / `docker info` still hang and never return (tested twice, 30s and 40s bounded timeouts, both timed out) - the daemon control-plane surface (info/version) is unreachable even though the process tree exists and the context list works. Independently reproduced twice, not a one-off fluke.
- Directly executed `pnpm run test:e2e` (jest --config test/jest-e2e.config.cjs --runInBand) in apps/api rather than accepting the dev agent claim at face value. It ran for 135.7s and failed with "Exceeded timeout of 120000ms for a hook" inside beforeAll, at the exact line `container = await new PostgreSqlContainer(postgres:16-alpine).start()`. This is concrete, first-hand proof that testcontainers itself cannot reach the Docker engine here - the suite got far enough to attempt the container start and hung exactly where you would expect if the engine were unreachable, not some earlier config or compile error.
- Conclusion: DB-integration/e2e execution genuinely could not be completed in this sandbox. Confirmed directly (not assumed) via a real bounded-timeout run of the actual suite, matching the dev agent own disclosure.
- What was run directly against the real toolchain this round: full Jest unit suite, ESLint (with a live negative-control test of the new zones), prisma generate + nest build, and a live attempted test:e2e execution.

## What actually ran

| Check | Result |
|---|---|
| npx jest --runInBand (apps/api) | 262/262 tests passed, 47 suites (up from 259/47 last round - net +3 new tests from the fix pass) |
| npx eslint apps/api/src and apps/api/test | 0 errors, 0 warnings |
| npx prisma generate + npx nest build | Compiles clean, no TS errors |
| npx jest --config test/jest-e2e.config.cjs --runInBand (real attempt) | Ran, did not pass - failed after 135.7s with a beforeAll timeout inside PostgreSqlContainer(...).start(). Confirms Docker/testcontainers is still unreachable end-to-end in this sandbox; the suite itself progressed correctly up to the point of needing a live daemon. |
| Live negative-control test of the LLD S3.4 ESLint zones | Failed - see D-2 below. A deliberately introduced real cross-boundary import was NOT flagged; root-caused to a missing import/resolver settings block. |

## Traceability matrix (defects only - the full FR matrix is unchanged from the original report; nothing in this fix pass touched FR-TENANT-1..4/FR-AUTH-1/2/3/5 behavior beyond the two error-code/atomicity nits, both re-verified below)

| Item | Scenario tested | Method | Result | Evidence |
|---|---|---|---|---|
| D-1 (BL-001, FR-TENANT-5, never-defer) | Does the claimed e2e suite exist, is it a real black-box test (not a mock), does it assert the correct 404-not-403 semantics, and does it actually execute green? | Read apps/api/test/tenant-isolation.e2e-spec.ts and test/jest-e2e.config.cjs line by line; ran pnpm run test:e2e for real with a bounded background run (135.7s, then confirmed hang location) | Suite quality: PASS. Execution: did not complete - genuinely blocked by environment, not a suite defect | apps/api/test/tenant-isolation.e2e-spec.ts; captured run output (135.7s timeout in beforeAll at the PostgreSqlContainer(...).start() line) |
| D-2 (bootstrap, LLD S3.4) | Do the new import/no-restricted-paths zones in eslint.config.mjs actually catch a real cross-boundary import? | Live negative-control: created a temporary file apps/api/src/modules/tenants/domain/__qa_violation_test.ts importing PrismaTenantRepository from ../infrastructure/... (a textbook domain-importing-infrastructure violation), ran the real project ESLint config against it, then root-caused via an isolated harness | FAIL - the zones do not fire. 0 errors/warnings on a real violation. Root cause confirmed: import/no-restricted-paths requires eslint-plugin-import to resolve the import specifier to a file before it can test the zone; the config has no settings block for import/resolver, so the bundled eslint-import-resolver-node (default extensions .js/.json/.node only) cannot resolve any relative .ts import and the rule silently no-ops on every TypeScript file in the project. Confirmed with an isolated harness: adding a settings block with import/resolver node extensions .js and .ts made the exact same violation get flagged correctly. | temp file created then deleted, no residue (verified via ls); isolated repro scripts (not committed) |
| D-3 (BL-002/003) | /auth/seed with a weak password returns AUTH_PASSWORD_INVALID, not AUTH_INVITE_INVALID | Code read (assertPasswordPolicy takes an errorCode param in modules/auth/domain/validation.ts, called with AUTH_PASSWORD_INVALID from seed-operator.use-case.ts line 38) + existing unit test assertion + confirmed the code is registered in packages/contracts/src/error-codes.ts (both as a valid code and with a real message) | PASS - fixed correctly | apps/api/src/modules/auth/application/seed-operator.use-case.ts:38, packages/contracts/src/error-codes.ts:30,108 |
| D-4 (BL-002/003) | Concurrent /auth/seed calls cannot both create an operator | Code read of PrismaAdminUserRepository.createFirstOperator: wraps pg_advisory_xact_lock plus the operator-count check plus the create inside one Prisma transaction, so the lock is held for the whole check-then-act window and is transaction-scoped (auto-released on commit/rollback) | PASS - fixed correctly, genuinely atomic (the lock is acquired before the count check inside the same tx, not just before the write, so the race window is fully closed) | apps/api/src/modules/auth/infrastructure/prisma-admin-user.repository.ts lines 80-101 |

## Defects

### D-1 (carried forward) - Medium - Tenant-isolation e2e suite: WRITTEN AND CORRECT, still UNEXECUTED (environment-blocked, not a code defect)
The e2e suite that did not exist last round now genuinely exists and is well-designed: real @testcontainers/postgresql container, real Supertest HTTP calls against the fully-booted AppModule (not a unit-level mock), and it asserts the things that actually matter for FR-TENANT-5 - cross-tenant GET returns 404 with code TENANT_NOT_FOUND (never 403), the unknown-id and cross-tenant-id 404 bodies are byte-identical (no side channel leaks existence), a cross-tenant PATCH is also rejected, and the target tenant data is read back afterward to prove the rejected write did not land. It also incidentally re-proves D-4 end-to-end (asserts the second /auth/seed call gets 409 AUTH_ALREADY_SEEDED).

This was not accepted on "it compiles" this time. It was run for real: pnpm run test:e2e executed for 135.7 seconds and failed with a Jest hook timeout exactly at `new PostgreSqlContainer(postgres:16-alpine).start()` inside beforeAll - i.e., it got past module resolution/compilation/ts-jest transform and hung trying to actually talk to Docker, which independently reproduces the docker version/docker info hang seen when testing the daemon directly (Docker Desktop processes are running, docker context ls answers instantly, but info/version - and now testcontainers - never get a response from the engine).

Verdict: WRITTEN AND CORRECT, but still UNEXECUTED (unproven). This is an environment limitation, confirmed independently rather than taken on faith, not a code or test defect. Per the dispatch three-way framing, this lands squarely in the WRITTEN-BUT-UNEXECUTED state. The never-defer isolation guarantee for BL-001 still cannot be signed off as end-to-end-proven from this sandbox.
Recommendation: do not retry nexus-dev for this item - there is nothing left for dev to fix here; the suite is correct. This needs a CI runner or sandbox with a working Docker engine to execute the e2e suite before BL-001 can be marked fully verified. Track as a carried-forward environment risk, not a code defect.
Severity: Medium (down from the effectively-missing state of the original D-1, since the artifact now exists and is demonstrably well-formed; still not closed because it has never gone green anywhere).

### D-2 (new form of a carried-forward issue) - Medium - LLD S3.4 apps/api ESLint zones are present in config but do not actually enforce anything (silently inert)
The dev fix pass added import/no-restricted-paths zones to eslint.config.mjs matching LLD S3.4 stated boundaries (domain cannot import infrastructure/interface/application; application cannot import infrastructure/interface; cross-module imports only via index.ts; Prisma client only from common/prisma). On paper this closes the original D-2 finding (the zones were simply absent). In practice, live testing proved they do not work at all:

1. Created apps/api/src/modules/tenants/domain/__qa_violation_test.ts containing an import of PrismaTenantRepository from ../infrastructure/prisma-tenant.repository - a direct, unambiguous violation of the first zone in the config.
2. Ran npx eslint against it with the project real eslint.config.mjs (both the CLI and a scripted ESLint API call, to rule out CLI glob quirks): 0 errors, 0 warnings, exit 0.
3. Root-caused it: import/no-restricted-paths needs eslint-plugin-import resolver to turn the relative specifier into a real file path before it can test that path against the zone from pattern. The config has no settings block for import/resolver, so eslint-plugin-import falls back to its bundled eslint-import-resolver-node, whose default extension list is .js/.json/.node - it cannot resolve an extensionless import to a .ts file at all. Independently confirmed the resolver failure: running import/no-unresolved (a different, simpler eslint-plugin-import rule) against the same file and config produces an "Unable to resolve path to module" error - i.e. the plugin resolution machinery is provably broken for this project .ts files, config-wide, not just for this one rule.
4. Confirmed the fix: in an isolated harness with a settings block (import/resolver node extensions .js and .ts) added, the identical violation is correctly flagged.

Impact: this is arguably a step backward from the original D-2, not a fix. The original finding was "the guardrail does not exist yet, so nothing catches a violation, be aware." The new state is "the guardrail exists, looks correct, adds a maintenance/review burden, and reviewers/CI will reasonably believe cross-module and layer boundaries are enforced - but a real violation produces a clean lint run" - i.e., false assurance, which is worse for a never-silently-regress architectural guardrail than an honestly-absent one. The temp violation file was deleted after the test; no residue left in the repo (verified via ls).
Repro: create any file under apps/api/src/modules/*/domain that imports from a sibling ../infrastructure path, run npx eslint on it with the shipped config - it passes with zero findings.
Recommendation: nexus-dev must add an import/resolver settings block (e.g. node resolver with extensions .ts and .js, or adopt eslint-import-resolver-typescript for path-alias correctness) to eslint.config.mjs, then re-run the same negative-control test (a real cross-boundary import must fail lint) before this can be marked fixed. Do not accept "the config contains the zones" as sufficient - the rule must be independently demonstrated to fire on a real violation, which is exactly the gap this retry exposed.
Severity: Medium (elevated from the original Low, precisely because it is silently non-functional rather than honestly absent - it is now a false-assurance risk on top of an unenforced-boundary risk).
Originating phase: bootstrap / architecture-tooling (introduced in the fix pass responding to the original D-2).

### D-3 - Verified fixed (no defect)
/auth/seed with a weak password now correctly returns AUTH_PASSWORD_INVALID with its own message, distinct from the invite-accept flow AUTH_INVITE_INVALID. Confirmed in code and in the registered error-code table.

### D-4 - Verified fixed (no defect)
The one-time-operator bootstrap check is now genuinely atomic: pg_advisory_xact_lock is acquired first, inside the same transaction as both the count check and the create, so two concurrent /auth/seed calls can no longer both pass the check. This is also exercised end-to-end by the still-unexecuted e2e suite second-seed-attempt assertion (D-1), which would provide live proof once Docker is reachable.

## Regression check
No regressions found. 262/262 unit tests green (259 -> 262, net +3 from the fix pass: seed-operator error-code assertion, advisory-lock repository test, and related coverage - the new e2e spec file is excluded from the unit run via the separate jest-e2e.config.cjs testRegex, not counted in this figure). ESLint clean on the ruleset that actually fires (the S3.4 zones being inert means "clean" here does not prove architecture compliance - see D-2). Build and Prisma generate both clean. Files the dispatch named as touched (eslint.config.mjs, packages/contracts/src/error-codes.ts, apps/api/src/modules/auth/{domain,application,infrastructure}/*, apps/api/test/*, apps/api/package.json) were all reviewed directly; no unexpected changes outside that footprint were needed to explain the observed behavior.

## Not applicable / out of scope, not flagged
- main-internal.ts 404-stub on :8081 - confirmed intentional (Phase 3/BL-010), not re-flagged.
- Postgres RLS absence - confirmed a deliberate, documented ADR deferral, not flagged.
- Angular admin SPA - out of scope for this pass (parallel nexus-qa agent covers BL-004).
- FR-AUTH-4 (LiveKit conversation tokens) - not in this dispatch named scope; not tested.

## Overall verdict: PASS-WITH-CAVEATS (unchanged classification from the prior round, but the substance has shifted)

D-3 and D-4 are cleanly fixed and verified. D-1 suite quality is now genuinely good (a real defect from last round - claimed but did not exist - is resolved), but it remains WRITTEN-BUT-UNEXECUTED, confirmed by an actual 135.7s run that hung on the real Docker dependency, not assumed. D-2, however, is not actually fixed - the zones exist syntactically but were proven live to not catch a real violation, due to a missing resolver configuration; this is a new, independently-confirmed defect that supersedes the original D-2 wording.

Explicit status per the dispatch three-way framing:
- D-1: WRITTEN-BUT-UNEXECUTED. Suite is correct and would very likely pass in a Docker-enabled environment (its structure and assertions are sound), but has never gone green anywhere. Needs a Docker-capable runner, not further dev work.
- D-2: NOT-FIXED in effect (the artifact exists but does not function). Needs a real code change (resolver settings) plus a live negative-control re-test before being marked fixed.
- D-3 / D-4: FIXED, PROVEN at the unit/code level (D-4 true concurrency proof is still gated behind D-1 Docker dependency, but the transaction/lock ordering is unambiguous by inspection).

Recommendation to orchestrator: retry nexus-dev once more, scoped narrowly to D-2 (add the missing import/resolver settings and demonstrate the zones fire on a real violation before claiming it fixed again). D-1 should not go back to nexus-dev - it needs a Docker-enabled execution environment (CI or a working local daemon), not more code. Do not close BL-001 isolation guarantee as proven until that e2e run has actually gone green somewhere.
