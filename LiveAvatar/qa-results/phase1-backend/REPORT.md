# QA Report - Phase 1 Backend/API (BL-001 tenants, BL-002/BL-003 auth, app bootstrap)

Date: 2026-08-19
Scope: apps/api only (backend/API). Angular admin SPA covered by a parallel nexus-qa pass - not tested here.
Verify-immediately items: BL-001 tenant row-level isolation, BL-002/BL-003 auth - full rigor applied per instructions.

## Environment

- Working dir: apps/api (NestJS 11 + Prisma 7 + Postgres 16, per ADR-001).
- docker version hung / never returned (Docker daemon unreachable in this sandbox) - consistent with the dev agent's report.
- docker-compose.dev.yml exists at repo root (postgres:16-alpine + redis:7-alpine) but could not be brought up (no daemon).
- Port 5432 IS listening locally, but it is a different, pre-existing Postgres instance - connecting with the project's .env credentials (liveavatar/liveavatar/liveavatar) fails with "password authentication failed". This is not the project's database; further credential guessing was not attempted, per test-hygiene rules (never point at an environment that is not clearly disposable/ours).
- Conclusion: DB-integration tests did NOT run. This is a confirmed environment limitation, verified directly rather than assumed from the dev agent's claim alone.
- What was run directly against the real toolchain: full Jest unit suite, coverage, ESLint, and nest build (compiles clean, Prisma client generates clean).

## What actually ran

| Check | Result |
|---|---|
| npx jest --runInBand | 259/259 tests passed, 47 suites |
| npx jest --coverage | Lines/branches >= 88% on every touched file; global threshold (80/80) met |
| npx eslint "src/**/*.ts" | 0 errors, 0 warnings |
| npx prisma generate + npx nest build | Compiles clean, no TS errors |
| DB-integration / cross-tenant negative suite | Not executed - unverified-environment-limited (see above). No dedicated e2e/integration test files exist in the repo (apps/api/test/, *.e2e-spec.ts absent) to even attempt - see Defect D-1 |

## Traceability matrix

| Requirement | Scenario(s) tested | Method | Result | Evidence |
|---|---|---|---|---|
| FR-TENANT-1 (create tenant, defaults, limit, idempotency) | name/slug validation boundaries, slug regex ^[a-z][a-z0-9-]{1,47}$, duplicate slug -> 409, 500-tenant limit -> 400, transactional creation of DeploymentConfig/DataResidencyPolicy/AlertPolicy, room_namespace=slug, Idempotency-Key replay via IdempotencyInterceptor | Static/code review + unit tests (create-tenant.use-case.spec.ts, tenant-guard.extension.spec.ts, idempotency.interceptor.spec.ts) | Pass (code-level) - logic correct, matches spec exactly; not exercised live against a DB | apps/api/src/modules/tenants/application/create-tenant.use-case.ts, apps/api/src/common/http/idempotency.interceptor.ts |
| FR-TENANT-2 (list, pagination, admin-scoped vs operator) | page_size>100 -> 400 PAGE_SIZE_INVALID, empty list (not 403) for unassigned admin, operator sees all | Unit tests (list-tenants.use-case.spec.ts, prisma-tenant.repository.spec.ts) | Pass | apps/api/src/modules/tenants/application/list-tenants.use-case.ts |
| FR-TENANT-3 (update, optimistic lock) | slug-in-body -> 400 immutable, unknown id -> 404, unassigned admin -> 403, stale If-Match -> 409 conflict | Unit tests (update-tenant.use-case.spec.ts) | Pass | apps/api/src/modules/tenants/application/update-tenant.use-case.ts |
| FR-TENANT-4 (pause/activate) | invalid status -> 400, same-status no-op -> 200, unknown -> 404, unassigned -> 403 | Unit tests (change-tenant-status.use-case.spec.ts) | Pass | apps/api/src/modules/tenants/application/change-tenant-status.use-case.ts |
| FR-TENANT-5 (row-level isolation, cross-tenant 404-not-403) | tenantGuard Prisma extension: throws on unscoped read/write, injects tenant_id on create/find, does not double-inject, bypass path for system ops; GetTenantUseCase/UpdateTenantUseCase return 404 (not 403) for unknown and unassigned-but-existing ids per LLD 5.1 | Unit tests (tenant-guard.extension.spec.ts - 15 cases covering every operation type) + static review of TenantContext (AsyncLocalStorage) and TenantContextInterceptor wiring in app.module.ts | Pass at unit level; live cross-tenant HTTP negative test NOT run (no DB) - flagged unverified-environment-limited, not pass/fail | apps/api/src/common/prisma/tenant-guard.extension.ts and its .spec.ts |
| FR-AUTH-1 (login) | malformed email -> 400, unknown/wrong password -> 401 same message, disabled -> 403, 8h JWT (expires_in:28800 literal in schema), rate limit 10/10min/IP+email -> 429 | Unit tests + schema review (login.use-case.spec.ts, LoginRequestSchema) | Pass | apps/api/src/modules/auth/application/login.use-case.ts |
| FR-AUTH-2 (refresh/logout) | unknown token -> 401, expired/revoked -> 401 + family revoke, reuse-after-rotation correctly revokes whole family (verified revokeByHash soft-revokes rather than deletes, so a later replay hits the revoked branch and calls revokeFamily), disabled/missing user -> 401 + family revoke, logout revokes family, access JWT still valid until natural expiry | Unit tests (refresh.use-case.spec.ts) + traced repository implementation by hand | Pass | apps/api/src/modules/auth/application/refresh.use-case.ts, infrastructure/prisma-refresh-token.repository.ts |
| FR-AUTH-3 (seed/invite, no self-signup) | one-time seed (countOperators()>0 -> 409 AUTH_ALREADY_SEEDED), bootstrap-secret header gate, invite create (operator can grant operator; admin cannot - AUTH_ROLE_FORBIDDEN; admin inviting outside assignment - TENANT_FORBIDDEN), duplicate email -> 409, accept invite (expired/unknown -> 400, password policy), confirmed no POST /auth/register route exists anywhere (grep @Controller across all interface files -> only auth, auth/invites, tenants, health) | Unit tests + full-repo route grep | Pass | apps/api/src/modules/auth/application/seed-operator.use-case.ts, admin-users/application/create-invite.use-case.ts, route grep output |
| FR-AUTH-5 (conversation token cannot hit admin APIs) | AdminJwtStrategy.validate rejects any payload where typ !== 'admin' -> AUTH_UNAUTHORIZED, ignoreExpiration:false | Unit tests (admin-jwt.guard.spec.ts) + code read | Pass | apps/api/src/common/auth/admin-jwt.strategy.ts |

## Defects

### D-1 - Medium - Claimed DB-integration/cross-tenant negative test suite does not exist in the repo (BL-001, cross-phase with the decision-log claim)
The 2026-08-19 development decision-log entry states tenant-isolation negative suite and repo integration tests are written but gated on TEST_DATABASE_URL and NOT executed here. A search of the entire apps/api tree for *.e2e-spec.ts, a test/ directory, TEST_DATABASE_URL, and testcontainers/PostgreSqlContainer usage in source found none. @testcontainers/postgresql and testcontainers are present as devDependencies but are not invoked anywhere in src/. What is actually gated behind "needs a DB" is only ordinary Prisma-repository unit tests, and those are already fully mocked (prisma-tenant.repository.spec.ts fakes the Prisma client - no DB needed, and it does run). In other words: there is no black-box/integration test at all for the cross-tenant negative path (create tenant A + tenant B, authenticate as an admin scoped to A, attempt GET /tenants/{B.id} over real HTTP, assert 404) - only a unit test of the Prisma extension's internal logic in isolation. The claim that such a suite was "written" is not accurate; it was designed-for (comment references, TenantScopeGuard) but the executable test artifact itself does not exist.
Impact: The isolation guarantee is currently backed only by unit tests of one component (tenantGuard extension) plus code review, not an end-to-end proof that the guard, the interceptor, the guard's ALS lifetime, and the controller's 404 policy compose correctly across a real request. Given this is explicitly a "never defer" item, this is a real gap, not a nitpick.
Repro: find apps/api -iname "*.e2e-spec.ts" -> no results; grep -r TEST_DATABASE_URL apps/api/src -> no results.
Recommendation: nexus-dev should add a real e2e test (testcontainers-based, since the devDependency is already present) exercising the full HTTP stack for the cross-tenant negative case before this can be called verified, and correct the decision-log claim.
Severity: Rough edge / process-integrity issue - does not mean the code is wrong (unit-level evidence is solid and consistent), but it does mean the "never-defer" bar has not actually been met yet.

### D-2 - Low - LLD-specified apps/api layer/module boundary ESLint enforcement is missing (bootstrap phase)
LLD 3.4 specifies concrete eslint-plugin-import no-restricted-paths zones for apps/api (domain must not import infrastructure/interface/application; application must not import infrastructure/interface; cross-module imports only via a module's index.ts; Prisma client importable only from common/prisma) as the enforcement mechanism for the four-layer/19-module architecture. The actual eslint.config.mjs at the repo root only contains the AI-SDK no-restricted-imports block and the apps/web feature-isolation zones - the apps/api layer/module zones from LLD 3.4 are entirely absent.
Impact: Manual verification (via grep) confirms current code does follow the intended boundaries (no cross-module imports bypassing index.ts, no @prisma/client / generated-client imports outside common/prisma), so there is no live violation today. But the boundary is enforced only by convention, not by CI, so a future change can silently violate it with nothing catching it - which defeats the stated purpose of "ESLint-enforced" module boundaries the ADR/LLD both rely on as the modular-monolith's structural guarantee.
Repro: compare docs/architecture/LLD.md lines 250-276 against eslint.config.mjs (no apps/api zones present).
Recommendation: add the LLD 3.4 zones to eslint.config.mjs before more modules are added.
Severity: Rough edge - no current violation, but a gap in the CI guardrail the architecture depends on.

### D-3 - Low - Password-policy error code reused inconsistently across two different flows
assertPasswordPolicy() (shared in modules/auth/domain/validation.ts) always throws AUTH_INVITE_INVALID on failure. It is called from both AcceptInviteUseCase (where "invite invalid" is a reasonable code) and SeedOperatorUseCase (bootstrap flow, where there is no invite in play at all - a weak bootstrap password would surface to the client as AUTH_INVITE_INVALID with a password-strength message in details.fields, which is a confusing code/message mismatch for that endpoint).
Impact: Cosmetic - the field-level message text is still correct and actionable, and the spec does not name a distinct code for this case, but the top-level code value is misleading for /auth/seed callers.
Repro: POST /auth/seed with {"email":"a@b.com","password":"short"} and a valid bootstrap secret -> 400 body has code: AUTH_INVITE_INVALID.
Severity: Low-likelihood edge case / cosmetic.

### D-4 - Low - AUTH_ALREADY_SEEDED check is not atomic with operator creation (BL-002/BL-003)
SeedOperatorUseCase.execute calls countOperators() > 0 then later users.create(...) with no transaction/unique-constraint tying the two together at the DB level for "at most one operator can ever be seeded." Two concurrent POST /auth/seed requests arriving before either commits could both pass the count check and both create an operator.
Impact: Very low likelihood (requires racing the one-time bootstrap call, typically run once by an operator at deploy time) but would violate "one-time" if it happened.
Severity: Low-likelihood edge case.

## Not applicable / out of scope, not flagged (per orchestrator instructions)
- main-internal.ts 404-stub on :8081 - confirmed intentional (Phase 3/BL-010), not flagged.
- Postgres RLS absence - confirmed a deliberate, documented ADR deferral, not flagged.
- Angular admin SPA - out of scope for this pass (parallel nexus-qa agent).
- FR-AUTH-4 (LiveKit conversation tokens) - not in this dispatch's named scope; not tested.

## Overall verdict: PASS-WITH-CAVEATS

All in-scope code, at the unit/static level, is correct against FR-TENANT-1..5 and FR-AUTH-1/2/3/5: validation messages/codes match the spec's literal text and codes, the tenant-isolation guard logic is sound and thoroughly unit-tested, JWT typ enforcement is correct, refresh-token rotation/reuse-detection is correct, and there is genuinely no self-registration route. Lint is clean, the full 259-test unit suite passes, and the project builds.

This is not a full PASS because:
1. The verify-immediately DB-integration/cross-tenant negative-path test that this dispatch explicitly required to be run live either did not run (confirmed: wrong Postgres instance on the reachable port, Docker unreachable) and does not currently exist as an executable artifact in the repo (D-1) - so the isolation guarantee is unit-tested-only, not end-to-end-proven.
2. A documented architectural guardrail (module/layer ESLint boundaries) is missing from the actual config (D-2).

Recommendation to orchestrator: do not treat this as a clean pass-through to the next phase. Either (a) retry nexus-dev to add the missing e2e/testcontainers-based cross-tenant suite and the LLD 3.4 ESLint zones, then re-dispatch QA once a working Docker/Postgres environment is available to actually execute it, or (b) if the pipeline accepts unit-level evidence as sufficient for now, explicitly record the DB-integration gap as a carried-forward risk rather than closing it as verified - do not let it silently drop off the "never defer" list.
