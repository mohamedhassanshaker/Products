# QA Report - Dev-1 (BL-01: Tenant registry and request-time tenant resolution)

Date: 2026-08-08
Scope: Dev-1 only (BL-01), per orchestrator instruction. Dev-0a/Dev-0b are already QA-green
and out of scope here except where Dev-1 extends their surface (tenant resolution middleware,
cache, registry).

## Environment

- Source: working tree at D:\work\products\exam-4u (no VCS in this environment).
- Node: v22.16.0 host-side (project requires >=24.13.0; matches the precedent already accepted
  in qa-results/dev-0a/REPORT.md and qa-results/dev-0b/REPORT-retry1.md - the Node-24-specific
  runtime claim is verified via the Docker image in those phases, not repeated here since Dev-1
  adds no new runtime-version-sensitive code).
- Database: a freshly provisioned, dedicated MySQL 8.4 container (mysql:8.4 image, port
  3307), created and torn down solely for this QA pass - never the developers persistent
  examland-mysql container (which is mysql:latest / 26.7, not the target 8.4) and never a
  shared/CI instance.
- No HTTP surface exists yet for platform/tenants (confirmed below), so all functional
  verification is either (a) nexus-devs existing unit/e2e suites, re-run independently, or
  (b) three QA-authored, disposable Jest e2e specs written to close specific gaps in the
  orchestrators checklist, run once against the dedicated MySQL 8.4 container, then deleted
  after passing (not left in the tree - see Hygiene below).

## Verification performed

1. Static checks - npm run typecheck, npm run lint (all 3 workspaces): clean, matching
   self-report.
2. Unit tests - npx jest --coverage in apps/api: 23 suites / 165 tests, all green,
   97.5%/96.21%/95.68%/97.43% stmt/branch/func/line aggregate. Matches the self-report almost
   exactly (branch coverage measured 96.21% here vs. the reported 95.45% - a trivial, non-material
   difference, not investigated further since both are well above the 80% gate and no file this
   phase touched is below 100%).
3. E2E tests - npx jest --config test/jest-e2e.json against the dedicated MySQL 8.4
   container: 6 suites / 31 tests, all green - exact match to the self-report (including the
   new tenants-crud.e2e-spec.ts and the CRUD-backed tenant-resolution.e2e-spec.ts).
4. Import-cycle claim - read tenancy.module.ts and tenants.module.ts directly:
   TenancyModule imports TenantsModule; TenantsModule imports TenantResolutionCacheModule
   (not TenancyModule). No cycle exists, and the extraction is genuinely what avoids one (if
   TenantsModule needed TenancyModule for the cache instead, that would be a cycle). Confirmed
   correct, not just asserted.
5. HTTP-surface absence claim - grep -r "@Controller" across apps/api/src finds only
   health.controller.ts; apps/api/src/app.module.ts only imports the TenantsModule class (no
   controller registration); no route under /platform/tenants or similar exists anywhere.
   Confirmed: there is genuinely no unguarded tenant CRUD HTTP endpoint.
6. FR-MT-1 validation rules - read TenantsService, tenant-slug.util.ts, errors.ts,
   cross-checked every rule against the FR-MT-1 text and the LLDs RESERVED_SUBDOMAINS/error
   catalog, then independently proved each with three throwaway e2e specs (see below) plus the
   existing suites:
   - Empty/whitespace name -> TENANT_NAME_REQUIRED (existing unit + e2e).
   - Malformed subdomain (invalid chars, leading/trailing/consecutive hyphen, empty) ->
     INVALID_SUBDOMAIN (existing unit + e2e).
   - Exact boundary: 63-char subdomain accepted, 64-char rejected - QA-authored test, passed.
   - All 8 reserved subdomains (admin, www, api, app, auth, static, mail, status) individually
     rejected with INVALID_SUBDOMAIN at create() - QA-authored test (existing suites only
     covered admin), passed.
   - Case handling: mixed-case input is trimmed/lowercased before validation rather than rejected,
     and uniqueness is correctly case-insensitive (ACME collides with existing acme) - QA
     test, passed. This is a judgment call nexus-dev documented (FR-MT-1 is silent on input
     casing); reasonable and does not violate the specs stored-value character-set rule.
   - Duplicate subdomain -> SUBDOMAIN_TAKEN, including a soft-deleted tenants slug staying taken
     through its retention window (existing e2e), and case-insensitively (QA test), passed.
   - Single-hyphen-only slug rejected; minimal valid single-char slug accepted - QA test, passed.
7. Cache/pool invalidation on mutation (HLD Section 9.1) - this was the one claim in the self-report
   not directly proven by any existing test at the full HTTP/middleware level (the existing
   tenants-crud.e2e-spec.ts proves invalidation only by calling cache.get()/cache.setFound()
   directly on the cache object, not by driving real requests through
   TenantResolutionMiddleware). Wrote a dedicated QA e2e spec that: (a) sets
   TENANT_CACHE_TTL_MS=300000 (5 minutes) to rule out "it just happened to expire in time"; (b)
   creates an Active tenant; (c) sends a real HTTP request through the actual middleware to warm
   its cache entry as Active; (d) calls TenantsService.suspend(); (e) immediately sends another
   real HTTP request to the same host. Result: the very next request correctly returned 403
   TENANT_SUSPENDED, not a stale cached Active pass-through. This independently confirms HLD
   Section 9.1's invalidation requirement holds end-to-end, not just at the unit/cache-object level.
   TenantDataSourceRegistry.destroyFor() is proven called with the correct schemaName by the
   existing unit test (tenants.service.spec.ts); a full pool-rebuild proof (acquiring a fresh
   DataSource post-destroyFor) is out of this phases reachable surface since a
   suspended/deleted tenant is rejected before ever reaching registry.acquire() - not something
   this phases own code path can exercise further, so this is not treated as a gap.
8. Soft-delete behavior - wrote a QA e2e spec: soft-deleting a previously-resolvable Active
   tenant makes the very next HTTP request return 404 TENANT_NOT_FOUND (not 403/503, and not a
   generic unhandled error), and independently queried
   information_schema.SCHEMATA afterward to confirm the tenants MySQL schema still exists
   untouched (soft-delete is metadata-only, as FR-MT-1/the phase scope requires). Passed.
9. Error-code -> HTTP-status mapping - cross-checked packages/contracts/src/error-codes.ts
   against the LLD Section 13.2 catalog: INVALID_SUBDOMAIN/TENANT_NAME_REQUIRED -> 400,
   SUBDOMAIN_TAKEN/INVALID_TENANT_STATE -> 409, TENANT_NOT_FOUND -> 404, TENANT_SUSPENDED ->
   403, TENANT_UNAVAILABLE -> 503. All exact matches.
10. Security spot-check - confirmed (by reading, not just trusting the self-report) that every
    PlatformTenantRepository query is a parameterized TypeORM criterion (no raw SQL string
    concatenation of user input); no client-suppliable field (status, schemaName, id) is
    trusted for a state transition without re-fetching the current row server-side first
    (suspend/reactivate/softDelete all re-read via findById before mutating); reserved-slug
    rejection reuses the same INVALID_SUBDOMAIN code as a malformed slug specifically to avoid an
    enumeration signal (verified in errors.ts's own comment and in the middleware, which also
    reuses TENANT_NOT_FOUND for both a reserved and a genuinely unknown subdomain).
11. Architecture compliance - file layout matches LLD Section 1.2's Tier B convention
    (platform/tenants/{domain,application,infrastructure}); domain/errors.ts and tenant.types.ts
    have no NestJS imports; application/tenants.service.ts calls the TypeORM repository directly
    (permitted for Tier B per the LLD, and per the classs own doc comment); no api/** layer
    exists yet to check the infrastructure/entities import-boundary rule against (none needed
    this phase).

## Traceability matrix

| Requirement | Scenario(s) tested | Result | Evidence |
|---|---|---|---|
| FR-MT-1: name required | empty/whitespace name -> TENANT_NAME_REQUIRED | Pass | tenants.service.spec.ts, tenants-crud.e2e-spec.ts |
| FR-MT-1: subdomain char-set/length | malformed slugs, empty, 63/64-char boundary | Pass | existing unit tests + QA boundary spec (this session) |
| FR-MT-1: reserved subdomains rejected | all 8 reserved names individually | Pass | QA boundary spec (this session) |
| FR-MT-1: subdomain uniqueness | duplicate (same-case and cross-case), post-soft-delete | Pass | existing e2e + QA boundary spec (this session) |
| FR-MT-1: status lifecycle (Provisioning/Active/Suspended/Failed) | suspend/reactivate only from valid source states | Pass | tenants.service.spec.ts, tenants-crud.e2e-spec.ts |
| FR-MT-1: soft-delete/retention | deletedAt/purgeAfterAt stamped correctly, idempotency (double-delete rejected), schema untouched | Pass | existing unit/e2e + QA soft-delete spec (this session) |
| FR-MT-2: resolution rejects unrecognized/reserved subdomain | generic 404 TENANT_NOT_FOUND, indistinguishable for both | Pass | tenant-resolution.e2e-spec.ts (re-run) |
| FR-MT-2: Suspended -> 403 TENANT_SUSPENDED | live HTTP request | Pass | tenant-resolution.e2e-spec.ts (re-run) |
| FR-MT-2: Provisioning/Failed -> 503 TENANT_UNAVAILABLE | live HTTP request | Pass | tenant-resolution.e2e-spec.ts (re-run) |
| FR-MT-2: cache invalidation on mutation propagates to live resolution immediately (HLD 9.1) | warm-then-suspend-then-request, long TTL to rule out coincidental expiry | Pass | QA cache-invalidation spec (this session) |
| No unguarded tenant CRUD HTTP endpoint exists | grep for @Controller, app.module.ts review | Pass | direct source read (this session) |
| No TenancyModule/TenantsModule import cycle | direct module source read | Pass | direct source read (this session) |
| Error-code -> HTTP-status mapping matches LLD 13.2 | cross-check error-codes.ts | Pass | direct source read (this session) |

No requirement in scope was left untested.

## Defects found

None - no blocking or non-blocking defects found this phase.

The one real gap identified (cache/pool invalidation being proven only at the cache-object level
in nexus-devs own suite, not via a live HTTP round-trip through the middleware) was independently
closed by QAs own test during this pass and the underlying behavior was confirmed correct - this
is a test-coverage observation, not a functional defect: recommend nexus-dev add an equivalent
"warm cache via real HTTP, mutate via service, re-request via real HTTP" case to
tenants-crud.e2e-spec.ts or tenant-resolution.e2e-spec.ts in a future phase so this exact
end-to-end path is proven by the permanent suite, not just by this one-off QA spec (which was
deleted after this pass per test hygiene, not merged into the codebase).

## Hygiene

- All three QA-authored e2e specs (qa-cache-invalidation.e2e-spec.ts,
  qa-boundary-checks.e2e-spec.ts, qa-softdelete-resolution.e2e-spec.ts) were written under
  apps/api/test/, run once against the dedicated MySQL 8.4 container, confirmed passing, and then
  deleted - they are not part of the shipped test suite.
- The dedicated qa-dev1-mysql Docker container (MySQL 8.4, port 3307) and every schema created
  during this pass (examland_platform_qa_*, t_qa_*, examland_platform_e2e_*, etc., all from
  nexus-devs own e2e suites standard cleanup plus this sessions specs) were removed after the
  run. The developers persistent examland-mysql/examland-qdrant/phpmyadmin containers were
  never touched.

## Verdict

Dev-1 is QA-green. No blocking defects. Ready to advance - orchestrator should dispatch
nexus-dev for Dev-2 (BL-02: schema-per-tenant provisioning workflow) next.
