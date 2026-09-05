# QA Report - Dev-0b Retry 1: Tenant data-access layer (registry, migration split, TENANT_EM provider)

Date: 2026-08-08
Scope: Re-verification of the single blocking defect from `qa-results/dev-0b/REPORT.md`
(ServeStaticModule's ExpressLoader swallowing TenantResolutionMiddleware's rejection and
replacing it with a generic 404 in the real production bootstrap) plus a full regression pass
on Dev-0b's exit gate and self-report. This is retry 1 of 3 for Dev-0b.

## Environment

- Node v22.16.0 (host); engines requires >=24.13 - same known sandbox limitation as prior
  Dev-0a/Dev-0b QA passes. The shipping artifact (`node:24-alpine` Docker image) was independently
  built and run to validate the Node-24-specific runtime claim, as before.
- A dedicated, freshly pulled `mysql:8.4` container (`qa-dev0b-retry1-mysql`, port 3308),
  independent of the pre-existing `examland-mysql` dev container and of any CI database, used for
  unit tests, e2e suite, and all manual live verification, then destroyed at the end of the run.
- `docker/Dockerfile` built independently from scratch (`qa-dev0b-retry1-image`, no cache reuse of
  any prior QA/dev image) and run as a real container (`qa-dev0b-retry1-container`) on a private
  bridge network with the dedicated MySQL container.
- All containers, the image, the network, and the seeded platform/tenant schemas were removed
  after the run. No data left behind; confirmed via `docker ps -a`/`docker images` showing zero
  `qa-dev0b-retry1-*` resources remaining.

## Independent re-verification of nexus-dev's retry-1 self-report

| Check | Self-reported | Independently reproduced |
|---|---|---|
| npm run typecheck (3 workspaces) | clean | clean |
| npm run lint | clean | clean |
| npm run build (contracts+api+web) | clean | clean |
| npm run test:cov -w apps/api | 20 suites / 103 tests, 96.94/95.19/94.68/96.85% | exact match: 20 suites / 103 tests, same coverage numbers |
| npm run test:e2e -w apps/api (real MySQL) | 5 suites / 22 tests | exact match: 5 suites / 22 tests, all green against my own dedicated MySQL 8.4 container, including `tenant-resolution.real-bootstrap.e2e-spec.ts` (3/3) |

## Independent live verification of the fix (not trusting the self-report or the new e2e suite alone)

Per the orchestrator's explicit instruction, I did not rely on re-running nexus-dev's own new
`tenant-resolution.real-bootstrap.e2e-spec.ts` as sufficient proof - I independently seeded a
fresh platform schema and tenant rows in my own dedicated MySQL 8.4 container (via a throwaway
script that itself boots the app the real way, `NestFactory.create(AppModule)`, then runs
`platformDataSource.runMigrations()` and inserts one Active and one Suspended tenant row), then
exercised the actual shipping bootstraps directly with `curl`.

### 1. Bare `node dist/main.js` (fresh `npm run build:api`, `NODE_ENV=production`, real MySQL)

- `GET /api/whatever`, `Host: qaretry1-susp.examland.app` (real Suspended row) -->
  `HTTP/1.1 403 Forbidden`, error.code = `TENANT_SUSPENDED`, message = "This tenant has been suspended."
  - matches the documented exit-gate requirement exactly; this is the exact case that failed as a
  generic 404 pre-fix.
- `GET /api/whatever`, `Host: totally-unknown-ghost.examland.app` (unrecognized subdomain) -->
  `HTTP/1.1 404 Not Found`, error.code = `TENANT_NOT_FOUND`, message = "No such tenant."
  - the structured envelope, not a bare Express 404 HTML/text page.
- `GET /api/whatever`, `Host: qaretry1-active.examland.app` (real Active row, real tenant schema
  created) --> `HTTP/1.1 404 Not Found`, error.code = `NOT_FOUND`, message = "Cannot GET /api/whatever"
  - proves tenant resolution succeeded and handed off to Nest's own router (a resolution failure
  would have produced `TENANT_NOT_FOUND`/`TENANT_SUSPENDED`/`TENANT_UNAVAILABLE` instead), i.e. an
  Active tenant is not blocked by this fix.

### 2. The literal `docker build`-produced image, run as a real container

- Built `docker/Dockerfile` from scratch into `qa-dev0b-retry1-image`; ran it as
  `qa-dev0b-retry1-container` on a private bridge network alongside the same dedicated MySQL
  container (pointed at the same seeded platform schema/rows via `DB_HOST=qa-dev0b-retry1-mysql`).
  `docker inspect --format='{{.State.Health.Status}}'` reported `healthy`.
- Repeated the identical three `curl` checks against the running container (port 3901 -> container
  3000): Suspended -> `403 TENANT_SUSPENDED`, unrecognized subdomain -> `404 TENANT_NOT_FOUND`,
  Active tenant -> `404 NOT_FOUND` (Nest's own routing) - byte-identical results to the bare-node
  run above, and matching nexus-dev's own reported Docker verification.

### 3. Envelope-shape regression check (Dev-0a contract unaffected by the ErrorResponseWriter extraction)

- `GET /api/health/doesnotexist` (an ordinary Nest 404, not tenant-resolution related, produced via
  AllExceptionsFilter -> ErrorResponseWriter inside Nest's router-execution context) returned an
  envelope with the same shape (error.code/message/requestId/timestamp) as the Dev-0a-established
  envelope, and identical in structure to the tenant-resolution-middleware-produced envelopes
  above - confirms ErrorResponseWriter produces one consistent envelope regardless of caller
  (AllExceptionsFilter vs. direct middleware write() call), matching the "byte-for-byte identical"
  claim in nexus-dev's self-report.
- No real VALIDATION_FAILED-producing endpoint exists yet in the codebase (the plan explicitly
  defers the first real DTO-validated endpoint to Dev-3), so this specific error path could only be
  spot-checked via the pre-existing unit test (validation-pipe.config.spec.ts, still 100%
  coverage, still green) - same caveat the original Dev-0b QA report already flagged. Not a new
  gap introduced by this fix.

### Root-cause fix review (code read directly, not just nexus-dev's description)

Read `apps/api/src/tenancy/tenant-resolution.middleware.ts`,
`apps/api/src/common/errors/error-response-writer.ts`,
`apps/api/src/common/errors/error-response.module.ts`, and
`apps/api/src/common/filters/all-exceptions.filter.ts` directly:

- `TenantResolutionMiddleware.use()`'s catch block calls
  `this.errorResponseWriter.write(...)` and returns - it never calls `next(err)` on any rejection
  path. This is structurally correct: since Express only invokes error-handling middleware
  (including ServeStaticModule's ExpressLoader) in response to a `next(err)` call, and nothing
  downstream of this middleware's rejection path ever makes one, no later-registered Express layer
  has anything to intercept.
- `ErrorResponseWriter` is `@Global()`-provided via `ErrorResponseModule`, injected into both
  `AllExceptionsFilter` (thin `@Catch()` adapter, unaffected code path for
  guards/interceptors/controllers) and `TenantResolutionMiddleware` directly - a single source of
  truth for the envelope shape/logging, not two divergent implementations.
- This is a general fix (any future raw NestMiddleware registered via
  `MiddlewareConsumer.apply()` that needs to reject a request under /api/** should follow the
  same pattern), not a narrow tenant-specific patch - confirmed correct by design, not just by
  reading nexus-dev's claim.

## Traceability matrix (delta from original report; unaffected items from the original Dev-0b pass are not re-litigated in full - see qa-results/dev-0b/REPORT.md for the full original matrix)

| Requirement | Scenario(s) tested | Result | Evidence |
|---|---|---|---|
| FR-MT-2 suspended tenant -> 403 TENANT_SUSPENDED (real bootstrap) | curl vs bare node dist/main.js; curl vs literal docker build image/container | PASS (was FAIL pre-fix) | This session's transcript above; reproducible |
| FR-MT-2 unrecognized subdomain -> structured 404 TENANT_NOT_FOUND (real bootstrap) | curl vs bare node process; curl vs Docker container | PASS | This session's transcript above |
| FR-MT-2 Active tenant passes through undisturbed | curl vs bare node process (real tenant schema created); curl vs Docker container | PASS | This session's transcript above |
| FR-MT-2 Provisioning/Failed -> 503 TENANT_UNAVAILABLE (real bootstrap) | covered by tenant-resolution.real-bootstrap.e2e-spec.ts re-run against my own dedicated MySQL | PASS (not separately curl-verified this session beyond the automated suite, since Suspended/NotFound/Active - the three previously-failing/at-risk cases - were the ones independently curl-verified; the fix is status-code-agnostic by construction) | test:e2e output, this session |
| Error envelope shape unchanged for non-tenant-resolution errors (Dev-0a contract) | curl GET /api/health/doesnotexist (ordinary AllExceptionsFilter path) vs. tenant-resolution-middleware-produced envelopes | PASS - identical shape | This session's transcript above |
| ErrorResponseWriter extraction is behavior-preserving | unit tests (error-response-writer.spec.ts, all-exceptions.filter.spec.ts) re-run, still green; envelope shape spot-checked live | PASS | test:cov output; live curl output |
| Regression test boots via real NestFactory.create (not just Test.createTestingModule) | read tenant-resolution.real-bootstrap.e2e-spec.ts; re-ran it against my own dedicated MySQL | PASS - genuinely exercises the real bootstrap, would have failed pre-fix | test:e2e output; source read |
| All previously-fixed Dev-0b defects (PinoLogger DI order, TenancyModule exports, double-global-prefix) still hold | re-ran full unit+e2e suite; multiple live boots this session (bare node x1, Docker x1) with zero DI errors | PASS | test:cov/test:e2e output; live boot logs |
| Tenant-isolation chokepoint (unaffected by this fix, sanity-rechecked) | tenant-registry-cross-schema.e2e-spec.ts re-run against my own dedicated MySQL | PASS | test:e2e output |

## Non-blocking observations (unchanged from prior reports, not re-litigated as new findings)

- npm audit: 13 vulnerabilities reported by `npm install` this session (previously reported as 4
  high-severity, all in apps/web's tree, in the Dev-0a QA report - the count/severity mix appears
  to have shifted, likely due to upstream advisory database changes rather than a new dependency
  added this phase, since no new runtime dependency was introduced by this fix). Worth a fresh
  `npm audit` read before Dev-1 given the numbers moved, but not attributable to this fix and not
  blocking.
- The LegacyRouteConverter warning for `/api/*` still fires at every real boot (cosmetic,
  previously noted as an informative tripwire, unaffected by this fix).

## Verdict

READY - Dev-0b's exit gate is met in the real production bootstrap. The previously-blocking
defect (Suspended tenant receiving a generic 404 instead of the documented 403 TENANT_SUSPENDED
when booted via NestFactory.create/node dist/main.js/the built Docker image) is fixed, and the fix
was independently reproduced this session against a bootstrap and seeded dataset I built myself -
not by re-running nexus-dev's own new test or trusting the self-report. All three of the
previously-fixed Dev-0b defects (PinoLogger DI order, TenancyModule missing exports,
double-global-prefix middleware pattern) remain fixed. Unit tests (20 suites/103 tests,
96.94/95.19/94.68/96.85% stmt/branch/func/line) and e2e tests (5 suites/22 tests) reproduce
exactly against a dedicated, independent MySQL 8.4 instance. Typecheck, lint, and build are clean
across all three workspaces. No new blocking defects found.

This was retry 1 of 3 for Dev-0b. The orchestrator is clear to advance current_phase to Dev-1,
with qa_retry_count reset to 0.
