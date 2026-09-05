# QA Report - Phase Dev-0a (Skeleton, config, logging, error envelope, health, CI)

**Date:** 2026-08-08
**Scope:** Dev-0a only, per docs/plans/examland-mvp-plan.md and LLD Section 14 "P0-a". No later-phase
functionality exists yet, so full-regression mode does not apply.
**QA agent:** nexus-qa (independent verification, not a rerun of nexus-dev's own checks)

## Environment

- Repo: d:\work\products\exam-4u (no git; working tree as delivered)
- Host toolchain: Node v22.16.0 / npm 10.9.2 (Node 24.13 unavailable on this host, same limitation
  nexus-dev documented; package.json engines.node >= 24.13 asserted, CI pins 24.13, and the
  Docker image is node:24-alpine, verified directly by building/running that image, below)
- Docker: Docker Desktop 4.83.0 / Engine 29.6.2, used to independently build and run
  docker/Dockerfile
- No backend network dependency needed for this phase (no DB/Qdrant/AI adapters exist yet)

## Requirements in scope (Dev-0a exit gate, docs/plans/examland-mvp-plan.md + LLD Section 14)

1. Health endpoints return 200 (GET /api/health, GET /api/health/ready).
2. Config module fails boot on a missing required prod secret (test asserts this).
3. Log file appears under LOG_DIR; a forced write failure does not throw (NFR-6a).
4. ESLint boundary rule fails a deliberately-introduced forbidden import in a test fixture.
5. Dockerfile builds and the resulting image passes its HEALTHCHECK.
6. Blanket requirements: green build/lint/tests, >=80% line/branch coverage on touched files,
   security self-review for any auth/data-access/external-call surface (Dev-0a has none beyond
   config secrets + error envelope, both reviewed below).

## Independent verification performed

| Check | Result | Evidence |
|---|---|---|
| npm install | OK (EBADENGINE warning only, Node 22 vs required 24.13, expected/documented) | - |
| npm run typecheck (3 workspaces) | PASS | clean output, no errors |
| npm run lint (--max-warnings=0) | PASS | 0 errors/warnings |
| npm run test:cov -w apps/api | PASS - 41/41 tests, 100% stmt/func/line, 93.87% branch | matches self-report exactly |
| npm run test:e2e -w apps/api | PASS - 7/7 tests (real AppModule boot via supertest) | matches self-report |
| npm run build (contracts+api+web) | PASS | all three build clean |
| docker build -f docker/Dockerfile . | PASS | image built successfully from a clean context |
| docker run with no prod secrets, NODE_ENV=production (baked-in default) | Fails boot with a single error listing all six violations at once: DB_HOST, DB_USER, JWT_TENANT_SECRET, JWT_PLATFORM_SECRET, FILE_SIGNING_SECRET, OPENROUTER_API_KEY - process exits, never listens | Confirms exit-gate item 2 against the actual shipped image, not just the unit test |
| docker run with required secrets + AI_ENGINE=disabled | Boots cleanly; GET /api/health -> 200 status ok/uptimeSeconds; GET /api/health/ready -> 200 status ok/checks empty, through the running container on a published port | curl output captured during session |
| docker inspect Health.Status | healthy | Docker's own HEALTHCHECK reached healthy state |
| ROLE=worker boot path (node dist/api/worker.js inside the built image) | Boots, logs worker.started, exits cleanly | Confirms the single-image/two-role packaging claim, which the exit gate implies but nexus-dev's self-report did not explicitly re-verify inside the built image |
| ESLint import-boundary rule - read .eslintrc.cjs directly (not just trusting the passing test) | Rule config's path globs match LLD Section 1.4's table exactly: @google/adk confined to infrastructure/ai/adk/**; other SDKs (stripe, @qdrant/js-client-rest, nodemailer, mysql2, google-auth-library, pdfjs-dist, yauzl, bcrypt) confined to infrastructure/**; modules/** blocked from platform/**/infrastructure/**/PlatformDataSource; module api/** blocked from infrastructure/entities/**; module domain/** blocked from all @nestjs/* | Read directly, cross-checked against LLD Section 1.4 table row by row |
| packages/contracts zero-runtime-deps claim | Confirmed structurally: package.json has "dependencies": {} | Read directly |
| ErrorCode union + ERROR_CODE_HTTP_STATUS map | Reproduces LLD Section 13.2's full catalog verbatim; Record<ErrorCode, HttpStatusCode> makes an incomplete map a compile error | Cross-checked every HTTP-status row against LLD Section 13.2 |
| env.schema.ts fail-fast logic | Read directly: REQUIRED_IN_DEPLOYED_ENVS = DB_HOST, DB_USER, JWT_TENANT_SECRET, JWT_PLATFORM_SECRET, FILE_SIGNING_SECRET, plus explicit checks for DB_SYNCHRONIZE, EMBEDDINGS_PROVIDER=null, OPENROUTER_API_KEY unless AI_ENGINE=disabled, and JWT-secret-distinctness - matches LLD Section 2/HLD Section 13.2 exactly; violations are collected and reported together (verified both by reading the code and via the actual container's fail-boot error message above, which lists all six at once) | - |
| process.env confinement to config/ | grep across apps/api/src shows exactly config/config.module.ts and config/env.schema.ts (plus doc comments) reading process.env - no other file does | - |
| No secrets committed | .gitignore/.dockerignore exclude .env*; grepped for hardcoded API-key/password patterns - none found; docker-compose.dev.yml credentials are dev-only, non-production | - |
| npm audit | 13 known vulnerabilities, all in frontend build tooling / Angular (dev-only or fixed-upstream). None in apps/api runtime deps | See defect DEV0A-3 below |

## Traceability matrix

| Requirement | Scenario(s) tested | Result | Evidence |
|---|---|---|---|
| Health liveness/readiness 200 | Unit + e2e (Jest/supertest) + manual curl through built Docker container | PASS | e2e suite; curl output above |
| Config fails boot on missing prod secret | env.schema.spec.ts (unit, all 5 required keys individually + DB_SYNCHRONIZE, EMBEDDINGS_PROVIDER, OPENROUTER_API_KEY) + independently re-run docker run with no secrets against the shipped image | PASS | test output; container fail-boot log |
| Log file under LOG_DIR, forced-failure fallback does not throw | logger.module.spec.ts: real dir gives 2 targets (stdout+file); NUL-byte dir (mkdir failure) falls back to stdout-only without throwing | PASS, with a caveat (see DEV0A-2, non-blocking) - the "forced write failure" tested is a directory-creation failure, not a mid-stream disk-full write failure | test output |
| ESLint boundary rule fires on deliberate forbidden import | eslint-boundary.e2e-spec.ts (virtual-file lint against mysql2 outside infrastructure/**, @google/adk outside infrastructure/ai/adk/**, plus a negative control) + direct read of .eslintrc.cjs confirming path globs match LLD Section 1.4 | PASS | test output; config read |
| Dockerfile builds, image passes HEALTHCHECK | Independent docker build + docker run + docker inspect health status + manual curl of both endpoints through the container + ROLE=worker boot path | PASS | commands/output above |
| Error envelope shape (LLD Section 13.1) | e2e (404 unmatched route) + unit (all-exceptions.filter.spec.ts, 10 cases) | PASS overall, with one real defect found (DEV0A-1 below) | test output; code read |
| packages/contracts zero runtime deps | Structural: empty dependencies object, npm run build (web+api) succeed importing only types | PASS | package.json read |
| CI pipeline (typecheck -> lint -> unit w/coverage -> build -> e2e -> docker build+healthcheck) | Read .github/workflows/ci.yml directly; steps match the described pipeline and were each independently reproduced locally except the GH Actions runner itself (not executed, no CI access in this environment) | PASS (by direct reproduction of each step; the workflow file itself was not executed on GitHub) | workflow file read |
| synchronize hard-off | DB_SYNCHRONIZE defaults false, boolean-coerced, asserted false in prod/staging | PASS | schema read |
| Import-boundary: api/** blocked from entities, domain/** blocked from @nestjs/* | Config read and cross-checked; no live module exists yet to exercise these two rows end-to-end (no modules/**/api or domain/** files exist in Dev-0a) | Config correct; untested against a real fixture for these two specific rows (only the third-party-SDK and @google/adk rows have an executable test) | gap - see DEV0A-4 |

## Defects found

### DEV0A-1 - VALIDATION_FAILED details.fields[].field is always the literal string "unknown" (non-blocking for Dev-0a itself, but a real spec gap that will affect every future endpoint)

- Expected (LLD Section 13.1): VALIDATION_FAILED responses carry details.fields: [{field, constraint}] - i.e. the actual DTO field name that failed validation, "specific enough to act on" per NFR-5.
- Actual: common/pipes/validation-pipe.config.ts configures the global ValidationPipe with no custom exceptionFactory. Nest's default behavior on a class-validator failure is to throw a BadRequestException whose message is a flat array of human-readable strings (e.g. "email must be an email") with the field name discarded. AllExceptionsFilter.resolve() then hardcodes field: 'unknown' for every entry (all-exceptions.filter.ts, in the BadRequestException branch). This is confirmed by both reading the code and by the existing unit test itself, which asserts the hardcoded value as if it were correct: all-exceptions.filter.spec.ts expects { field: 'unknown', constraint: 'email must be an email' }.
- Repro: independently verified that class-validator's validate() already returns ValidationError.property (the real field name) when given a normal DTO - e.g. { property: 'email', constraints: { isEmail: 'email must be an email' } } - so the field name is available and is being discarded, not unrecoverable. A minimal fix is a custom exceptionFactory in validation-pipe.config.ts that maps ValidationError[] to {field: property, constraint: Object.values(constraints)[0]}[] before throwing.
- Why it matters now, in Dev-0a's scope: the error envelope and validation-pipe config are exactly what this phase delivers, and every later phase's DTOs (starting Dev-3's registration/login) will silently inherit this "unknown" placeholder for every validation error unless fixed before then.
- Severity: Non-blocking for Dev-0a's own exit gate (no live DTO-validated endpoint exists yet in this phase, so nothing observable fails today), but flagged as a real, verified defect that should be fixed in this phase or explicitly before Dev-3, since fixing it later means updating a test that currently encodes the wrong value as correct.

### DEV0A-2 - Log-fallback test only exercises a directory-creation failure, not a genuine write-time failure (cosmetic)

- Expected (Dev-0a exit gate): "a forced write failure does not throw."
- Actual: The only test (logger.module.spec.ts) simulates an unusable LOG_DIR via a NUL-byte path, which fails at mkdirSync time, before any file is opened. The stronger claim documented in a code comment - that pino-roll's worker-thread write errors surface as stream 'error' events rather than synchronous throws, so a mid-operation disk-full scenario also would not crash the process - is architecturally reasonable but not independently exercised by any test.
- Severity: Cosmetic / low-likelihood edge case. The tested scenario is a legitimate and common real-world case (unwritable/misconfigured LOG_DIR) and does satisfy the letter of the exit gate; flagging only because the exit-gate wording ("forced write failure") is broader than what is actually tested.

### DEV0A-3 - npm audit: 13 known vulnerabilities, concentrated in Angular/build tooling (non-blocking for Dev-0a)

- 7 high + 6 moderate advisories, all in apps/web's dependency tree: @angular/core, @angular/common, @angular/compiler, @angular/animations (XSS/DoS advisories in the installed 20.0.0-next.0 - 20.3.26 range, fixed in 20.3.27), @angular-devkit/build-angular, @angular/cli, webpack-dev-server, less, image-size, sockjs, uuid (mostly transitive dev/build-tooling deps).
- None are in apps/api's runtime dependency set (nestjs-pino, pino-roll, helmet, zod, class-validator, etc.) - all actively maintained, no open advisories.
- Severity: Non-blocking for Dev-0a (no UI functionality exists yet to exploit, and Angular's own patched version is a simple npm audit fix within the existing ^20.0.0 semver range, no breaking change needed). Recommend running npm audit fix before Dev-5b (first real frontend UI phase) lands.

### DEV0A-4 - Two of the six LLD Section 1.4 import-boundary rows have no executable proof (gap, not a failure)

- eslint-boundary.e2e-spec.ts only exercises the third-party-SDK-confinement row and the @google/adk sub-confinement row (2 of 6). The other four rows (modules/** vs platform/**/infrastructure/**, api/** vs infrastructure/entities/**, domain/** vs @nestjs/*, and the packages/contracts zero-runtime-deps row) are correctly configured on inspection but have no corresponding virtual-file lint test proving they fire.
- The Dev-0a exit gate only requires "ESLint boundary rule fails a deliberately-introduced forbidden import in a test fixture" (singular), which is satisfied - this is reported as a traceability gap for completeness, not a failure of the stated exit gate. No live code exists yet under modules/** or domain/** for these rows to protect, so the risk is low until those directories start filling in (Dev-1 onward).
- Severity: Low - recommend nexus-dev add the remaining 4 virtual-file assertions when convenient, ideally before modules/**/domain/** start filling with real code.

## Overall verdict

Dev-0a: READY / QA-GREEN. All stated exit-gate criteria were independently reproduced and passed, including a from-scratch Docker build/run cycle (not just re-trusting nexus-dev's self-report): health endpoints return 200 through the running container, the container's own HEALTHCHECK reaches healthy, config fails boot on missing prod secrets (verified against the real shipped image, not just the unit test), the ESLint boundary rule's config was read and confirmed to match LLD Section 1.4, and the full lint/typecheck/unit/e2e/build suite is green with coverage matching (and exceeding) the stated numbers exactly.

No blocking defects found. Four non-blocking items reported above (DEV0A-1 through DEV0A-4); DEV0A-1 (validation error field-name loss) is the one worth prioritizing before Dev-3 lands the first real DTO-validated endpoints, since fixing it later requires correcting a test that currently locks in the wrong behavior as expected.
