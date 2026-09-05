# QA Report - Dev-0b: Tenant data-access layer (registry, migration split, TENANT_EM provider)

Date: 2026-08-08
Scope: Dev-0b only (LLD section 14 "P0-b"), per docs/plans/examland-mvp-plan.md. Dev-0a not
re-validated (already QA-green, see qa-results/dev-0a/REPORT.md). Also spot-checked the
opportunistic DEV0A-1 validation-pipe fix since it touches shared infrastructure.

## Environment

- Node v22.16.0 (host) - engines requires >=24.13; consistent with Dev-0a's own finding that this
  sandbox lacks a Node 24 toolchain. As with Dev-0a QA, the shipping artifact (node:24-alpine
  Docker image) was independently built and run to validate the Node-24-specific claim.
- MySQL 8.4 - a dedicated, freshly pulled mysql:8.4 container (qa-dev0b-mysql, port 3307),
  independent of any pre-existing dev/CI database, used for all unit/e2e/manual verification, then
  destroyed at the end of the run.
- Docker image built independently from docker/Dockerfile (qa-dev0b-image), run as a real
  container (qa-dev0b-container) on a private bridge network with the dedicated MySQL container,
  to test the literal artifact that would ship, not just npm run start:dev.
- All temporary schemas, containers, network, and image removed after the run. No data left behind.

## Independent re-verification of nexus-dev's self-report

| Check | Self-reported | Independently reproduced |
|---|---|---|
| npm run typecheck (3 workspaces) | clean | clean |
| npm run lint | clean | clean |
| npm run build (contracts+api+web) | clean | clean |
| npm run test:cov -w apps/api | 19 suites / 99 tests, 96.88/95.19/94.5/96.79% | exact match: 19 suites / 99 tests, same coverage numbers |
| npm run test:e2e -w apps/api (real MySQL 8.4) | 4 suites / 19 tests | exact match: 4 suites / 19 tests, all green against my own dedicated MySQL 8.4 container |

## The three self-reported defect fixes - independently verified

1. InjectPinoLogger DI-order failure fixed via plain PinoLogger + setContext(). Confirmed by
   grep: zero occurrences of the InjectPinoLogger decorator anywhere in apps/api/src; every logger-holding
   class (AllExceptionsFilter, TenantDataSourceRegistry, TenantResolutionMiddleware) uses plain
   PinoLogger + setContext(). Directly re-confirmed live: the app booted cleanly via NestFactory.create
   (bare node process and the built Docker image) with no DI resolution errors, multiple times
   across this session.
2. TenancyModule missing TenantResolutionCache/TenantsModule re-exports - fixed. Confirmed by
   reading tenancy.module.ts - both are present in the exports array. Live-verified: the app boots and
   TenantResolutionMiddleware's constructor (which depends on both, transitively) resolves without
   a DI error in every boot performed during this session (bare process and container).
3. Double-global-prefix middleware route pattern changed to be prefix-relative (no literal "api"
   segment written into it). Confirmed by reading app.module.ts - the "api" segment is not written
   into any consumer.apply() pattern, matching the documented fix. This specific defect is fixed -
   see below for a different, newly-found defect in the same area that the fix did not address.

## Critical finding: tenant-rejection responses are silently discarded in the real production boot (BLOCKING)

This is the finding the orchestrator specifically asked to be proven live, not just read from code -
and independent live testing surfaced a real, currently-shipping defect, distinct from (but in
the same failure family as) the double-prefix bug nexus-dev already found and fixed.

### What I found

Booting the app via Test.createTestingModule (the project's own e2e harness) produces the
documented behavior exactly:

  GET /api/whatever, Host: admin.examland.app
  -> 404, error.code = TENANT_NOT_FOUND, message = "No such tenant."

Booting the identical AppModule via NestFactory.create - i.e. main.ts, the actual production
entrypoint, run both as a bare node dist/main.js process and inside the literal built
Docker image - produces a different, wrong result for the exact same request:

  GET /api/whatever, Host: admin.examland.app
  -> 404, error.code = NOT_FOUND, message = "Cannot GET /api/whatever"

More importantly, for a Suspended tenant, which the Dev-0b exit gate explicitly requires to
receive 403 TENANT_SUSPENDED:

  GET /api/whatever, Host: qalive-susp.examland.app   (real Suspended row, seeded in platform.tenant)
  -> NestFactory / Docker image: 404, error.code = NOT_FOUND, message = "Cannot GET /api/whatever"
  -> Test.createTestingModule:   403, error.code = TENANT_SUSPENDED   (correct)

I reproduced this three independent ways against three independently-provisioned real MySQL 8.4
instances/processes: (1) curl against a bare node dist/main.js process, (2) an in-process
supertest request against an app built with NestFactory.create (ruling out anything
transport/TCP-specific), (3) curl against the actual docker-build-produced image running as a
container. All three show the same wrong result; only the project's own Jest testing-module harness
shows the correct result.

### Root cause (independently diagnosed, not guessed)

I instrumented TenantResolutionMiddleware in the compiled dist output (no source changes) and
confirmed the middleware itself works correctly in every case: deriveSlug returns the right slug,
isReservedSlug/tenant lookup/status checks all evaluate correctly, and it calls next() with a
DomainError of code TENANT_SUSPENDED or TENANT_NOT_FOUND exactly as designed. The middleware is
not the bug.

The actual cause is the @nestjs/serve-static package's ExpressLoader, at
node_modules/@nestjs/serve-static/dist/loaders/express.loader.js (lines 93-111), which
ServeStaticModule (wired in Dev-0a, imported before TenancyModule in app.module.ts) installs as
its own Express error-handling middleware. In simplified form, that installed handler is:

  app.use(function (err, req, res, next) {
    if (isRouteExcluded(req, options.exclude)) {
      // unconditionally replaces any in-flight error with a fresh generic 404 - this branch
      // does not inspect err at all before doing this
      return next(new NotFoundException("Cannot " + method + " " + url));
    }
    ...
  });

app.module.ts configures ServeStaticModule.forRoot with an exclude list containing the api prefix
wildcard, so the SPA fallback does not try to serve /api/** as a static asset - a reasonable
intent. But this same exclude check is reused, unconditionally, in the error-handling middleware
above: for any request whose path is under /api/**, any error at all that reaches this handler,
regardless of type, is discarded and replaced with a generic NotFoundException. Since
ServeStaticModule is imported before TenancyModule in AppModule's imports array, its error
middleware is registered into the Express stack earlier than Nest's own exception-filter wiring, so
it wins the race and swallows the DomainError before AllExceptionsFilter ever sees the real one.

This reproduces under NestFactory.create (main.ts / the real Docker image) because that bootstrap
path fully wires ServeStaticModule's onModuleInit hook, which calls ExpressLoader.register(), into
the real Express app. It does not reproduce under the project's own Test.createTestingModule-based
e2e suite - I dumped the live Express middleware stack (the app's internal router stack) for both
bootstrap paths side-by-side in the same process and confirmed the testing-module app never
registers ServeStaticModule's static/fallback/error-handling layers at all, while the
NestFactory/Docker-image app does. This means test/tenant-resolution.e2e-spec.ts, despite being a
real-DB, real-HTTP-boot integration test, is not exercising the same Express middleware pipeline the
shipped application actually runs, which is exactly why this bug shipped as "e2e-green."

### Why this matters (and what it does not mean)

- It is not a tenant-isolation data-leak: because next() still propagates an error (just the
  wrong one), Express skips the router/controller layer entirely - a rejected request never reaches
  a controller or touches another tenant's DataSource. TenantDataSourceRegistry's own chokepoint
  design (verified separately, see below) is not implicated by this bug.
- It does mean the Dev-0b exit gate is not actually met in the real deployed artifact:
  "suspended tenant -> 403 TENANT_SUSPENDED" fails outright (the client gets 404 NOT_FOUND
  instead), and "unrecognized subdomain -> generic 404" only happens to still be a 404 by
  coincidence - the client-visible code/message (TENANT_NOT_FOUND / "No such tenant.") that the LLD
  documents and later phases will presumably build client handling around is silently lost.
- It generalizes far beyond tenant resolution: any middleware/guard in the request pipeline that
  throws before the router matches a route (auth guards, RBAC guards, rate limiters, etc, several
  of which land in the very next phases) will have its specific error code/status silently replaced
  with a generic 404 the moment it's exercised via the real main.ts bootstrap. This is a
  foundational, cross-cutting defect in AppModule's wiring (introduced by Dev-0a's ServeStaticModule
  setup, first made observable by Dev-0b's middleware being the first thing to actually throw
  DomainErrors on the request path), not specific to tenant code.

### Severity: Blocking

Fails Dev-0b's own explicit exit gate ("suspended tenant -> 403 TENANT_SUSPENDED") against the real
production bootstrap, is trivially reproducible, and will silently corrupt error responses for every
future phase's guards/middleware until fixed. Recommend nexus-dev fix at the AppModule/bootstrap
level (e.g., move ServeStaticModule after all API-owning modules, make its exclude-aware error
handler check whether the error is already a recognized DomainError/HttpException and pass it
through unmodified, or move the SPA fallback into a dedicated final-fallback route rather than a
global error middleware) and add a regression test that boots via NestFactory.create (or otherwise
reproduces the exact Express middleware stack the Docker image uses) rather than solely via
Test.createTestingModule.

### Evidence trail (reproducible)

1. A curl request with Host header qalive-susp.examland.app against a bare node dist/main.js
   process wired to a dedicated MySQL 8.4 instance with a real Suspended row seeded in
   platform.tenant returned 404 NOT_FOUND (expected 403 TENANT_SUSPENDED).
2. The same request via an in-process supertest client against an app built with
   NestFactory.create(AppModule) produced an identical wrong result (rules out any TCP/curl
   artifact).
3. The same request against the actual docker build image (built from docker/Dockerfile), run as a
   real container against the same dedicated MySQL instance over a Docker bridge network, produced
   an identical wrong result.
4. The same request via Test.createTestingModule with AppModule (i.e., literally re-running the
   project's own tenant-resolution.e2e-spec.ts approach) produced the correct result
   (403 TENANT_SUSPENDED), proving the divergence is in bootstrap mechanism, not tenant data.
5. An instrumented (non-source-modifying, dist-level monkey-patch) trace of
   TenantResolutionMiddleware.use() confirmed it computes the correct decision and calls next()
   with the correct DomainError in both bootstraps - the middleware itself is correct.
6. Root-caused to node_modules/@nestjs/serve-static/dist/loaders/express.loader.js lines 93-111 by
   reading the installed dependency's source and confirming its unconditional
   "isRouteExcluded then replace with NotFoundException" behavior for any /api/** request
   regardless of the in-flight error's identity.

## Tenant-isolation guarantee - proven live, and it holds (separately from the finding above)

Independently proved the ALS/registry chokepoint claims, via my own scripted live requests (not
solely the project's e2e suite):

- Manually seeded platform + tenant schemas (a real Active tenant, schema t_qalive_acme_00000001,
  and a real Suspended tenant), migrated both, booted the real app via NestFactory.create, and
  confirmed via the request logs that a request to the Active tenant's subdomain populates
  tenantId/tenantSchema in the AsyncLocalStorage-backed request context end-to-end (visible on
  every subsequent log line for that request) - i.e., when tenant resolution does succeed, the
  context genuinely propagates through the real middleware chain, not just in a test harness.
- test/tenant-registry-cross-schema.e2e-spec.ts (re-run myself against my own dedicated MySQL 8.4
  container) empirically proves two real, distinct schemas' rows never cross (each DataSource only
  ever sees its own row) and structurally proves the registry's entire public API surface
  (acquire, release, destroyFor, stats, reapIdle, onModuleDestroy) cannot express a cross-schema
  query - I read tenant-data-source-registry.ts directly and confirmed no method accepts a raw
  query/schema-crossing parameter, matching the Qdrant chokepoint pattern.
- Confirmed the finding above does not compromise this guarantee: a rejected request never
  reaches a controller regardless of which error code is ultimately reported to the client (Express
  still short-circuits the router once any error, even the wrong one, is in flight).

## Traceability matrix

| Requirement | Scenario(s) tested | Result | Evidence |
|---|---|---|---|
| FR-MT-2 unrecognized subdomain to generic 404 | curl/supertest to unknown host, real DB | Pass on status code; Fail on documented error code/message (see blocking finding) | Session transcript; reproducible via curl/supertest/Docker |
| FR-MT-2 suspended tenant to 403 TENANT_SUSPENDED | curl/supertest/Docker to Suspended tenant host, real DB | FAIL in real bootstrap (404 instead of 403) | Session transcript; reproducible |
| FR-MT-2 Provisioning/Failed to 503 TENANT_UNAVAILABLE | e2e suite (Test.createTestingModule) | Pass under test harness; not separately curl-verified under real bootstrap, but the root cause is bootstrap-wide and status-agnostic so it is presumed also affected | test/tenant-resolution.e2e-spec.ts; root-cause analysis above |
| FR-MT-2 resolution runs before any guard | ordering-proof e2e test; live NestFactory instrumentation | Pass - middleware executes and decides correctly in both bootstraps | test/tenant-resolution.e2e-spec.ts; dist-level instrumentation |
| FR-MT-3 registry chokepoint (no cross-schema query expressible) | structural reflection test + live 2-schema smoke test (own MySQL instance) | Pass | test/tenant-registry-cross-schema.e2e-spec.ts, re-run independently |
| NFR-4 registry never exceeds TENANT_REGISTRY_MAX | unit test (40 sequential tenants vs cap) | Pass | tenant-data-source-registry.spec.ts |
| Registry: idle reaping, refCount-safe eviction, in-flight de-dup | unit tests | Pass | tenant-data-source-registry.spec.ts |
| Migration split (platform vs tenant, independently versioned) | directory/registration check, both migrations run live during this session | Pass | migrations/platform/index.ts, migrations/tenant/index.ts, live migration runs |
| TENANT_EM request-scoped provider | unit test + live ALS propagation (see above) | Pass | tenant-entity-manager.provider.spec.ts; live log evidence |
| DEV0A-1 fix (validation pipe field names) | code review of flattenValidationErrors/exceptionFactory | Pass structurally (no live endpoint yet to exercise end-to-end; none exists until Dev-3). Caveat: once a real endpoint throws VALIDATION_FAILED from a middleware/guard ahead of routing, it is likely subject to the same ServeStaticModule-swallow defect above | validation-pipe.config.ts, validation-pipe.config.spec.ts (100% coverage) |
| Boot-order DI fixes (PinoLogger, TenancyModule exports) | code review + live multi-boot confirmation | Pass | grep + every successful boot this session |

## Other observations (non-blocking)

- npm audit unchanged from Dev-0a's report: 4 high-severity advisories, all in apps/web's Angular
  tree, none in apps/api's runtime dependencies (typeorm, mysql2, newly added this phase, are both
  actively maintained with no known critical advisories).
- The LegacyRouteConverter warning ("Unsupported route path ... attempting to auto-convert") fires
  twice at every real (NestFactory) boot. It is cosmetic/non-fatal on its own - the auto-conversion
  itself lands on the correct final pattern - but its presence is a useful tripwire: it appears only
  when the real bootstrap path materially differs from the testing module's internal route
  resolution, which is the same divergence underlying the blocking finding above. Worth keeping an
  eye on rather than suppressing.

## Verdict

NOT READY - one blocking defect. TenantDataSourceRegistry, the ALS-based TENANT_EM provider, the
platform/tenant migration split, and the isolation chokepoint design are all independently verified
sound and working correctly end-to-end against a real, live MySQL 8.4 instance. However, the
tenant-resolution middleware's rejection responses (most importantly, TENANT_SUSPENDED) are silently
replaced with a generic 404 by a pre-existing ServeStaticModule wiring defect the moment the
application is booted the way it will actually run in production (verified against a real
node dist/main.js process and the literal built Docker image) - a discrepancy the project's own e2e
suite does not catch because it does not reproduce the same Express middleware stack. This fails
Dev-0b's own exit gate for suspended tenants and is a foundational defect that will affect every
future phase's error handling under /api/**. Recommend the orchestrator dispatch nexus-dev for a
retry targeting AppModule's ServeStaticModule/error-middleware wiring, with a new regression test
that boots via NestFactory.create (or otherwise reproduces the real Express stack) rather than
solely Test.createTestingModule.
