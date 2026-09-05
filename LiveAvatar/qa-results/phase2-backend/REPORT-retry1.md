# QA Report -- Phase 2 Backend Retry 1 (BL-005-BL-009, D-1 narrow re-verification)

- Date: 2026-08-19
- Scope: apps/api/src/modules/deployment-config (ValidateConfigUseCase, DeploymentConfigController) and a full backend regression re-run; nothing else in the batched phase was in scope for this retry per the orchestrator dispatch. Admin SPA is covered by a parallel agent.
- Verified against: FR-TENANT-5, FR-CONFIG-1 (authorization semantics: 404 TENANT_NOT_FOUND for both unknown tenant id and unassigned admin, no data disclosure); prior defect D-1 in qa-results/phase2-backend/REPORT.md.
- Environment: static code review of the real, current source (not the dev unit tests taken on faith) plus a from-scratch integration harness instantiating the real ValidateConfigUseCase class against fake in-memory repository ports (same method used in the original QA pass), run via the project's own jest --runInBand. No Docker/Postgres in this sandbox (unchanged, carried-forward environment constraint from every prior Phase 1/2 pass) -- this retry did not require it since D-1 lives entirely in application-layer authorization logic that fake ports exercise correctly.

## Verdict: PASS -- D-1 is FIXED

## 1. Code-level confirmation (real control flow, not just reading the unit tests)

apps/api/src/modules/deployment-config/application/validate-config.use-case.ts:
- Constructor now injects TENANT_REPOSITORY (TenantRepositoryPort) alongside the two provider ports.
- execute(actor: AdminActor, tenantId: string, input) -- the actor parameter is new and is the first thing checked:

    const tenant = await this.tenants.findById(tenantId);
    if (!tenant || !canAccessTenant(actor, tenant.id)) {
      throw AppError.notFound('TENANT_NOT_FOUND');
    }

  This runs before parseInput/runSchemaGate/runCombinationGate and before either this.credentials.list(...) call further down -- no credential/catalog data is touched until the actor is proven authorized. This is byte-for-byte the same pattern as GetConfigUseCase.execute() (confirmed by direct comparison, both call canAccessTenant from common/auth/admin-actor.ts and both fold "tenant missing" and "not accessible" into the same TENANT_NOT_FOUND 404, matching FR-TENANT-5's "don't reveal existence via a different status code" rule) and effectively the same as SaveConfigUseCase.execute() (which splits missing-tenant 404 from forbidden-tenant 403 -- a pre-existing, intentional divergence between the two use cases already present before this fix, not something this pass touched or needs to reconcile).
- apps/api/src/modules/deployment-config/interface/deployment-config.controller.ts: validate() now takes @CurrentUser() actor: AdminActor and forwards it as the first argument to this.validateConfig.execute(actor, tenantId, body). get() and save() were already doing this; validate() is now consistent with both.
- SaveConfigUseCase (which internally reuses ValidateConfigUseCase as a collaborator for parseInput/runSchemaGate/runCombinationGate, not execute()) required no change and was not touched -- confirmed by reading save-config.use-case.ts line by line: it never calls validator.execute(), so the new actor parameter on execute() cannot double-authorize or break that call site. Its own constructor-injected tenants/canAccessTenant check is unchanged and still correct.
- New unit tests added to validate-config.use-case.spec.ts ("404s an unknown tenant", "404s ... an admin not assigned to this tenant") and deployment-config.controller.spec.ts continues to assert the controller forwards actor through to execute. These are consistent with, but not the sole basis for, this pass's verdict -- see the independent live harness below, which does not reuse the dev agent's own mocks/assertions.

## 2. Independent live re-test (real class, fresh harness, not the dev's own spec file)

Built a standalone harness (apps/api/src/__qa_retry1__/d1-live.qa.spec.ts, written, run, then deleted -- no artifact left in the tree) that instantiates the real ValidateConfigUseCase against fake in-memory ProviderDefinitionRepositoryPort/ProviderCredentialRepositoryPort/TenantRepositoryPort implementations (not mocks of the class under test), seeded with a real credential for tenant-B only. Four scenarios, run via npx jest --runInBand, all passed:

| # | Scenario | Result |
|---|---|---|
| 1 | Admin assigned only to tenant-A calls execute() for tenant-B (which has a real openai credential seeded) | Rejects with { code: 'TENANT_NOT_FOUND', httpStatus: 404 } -- confirmed via .rejects.toMatchObject, i.e. no resolved-layer data of any kind is returned to the caller (the promise never fulfills). |
| 2 | Any admin (including an operator) calls execute() for a tenant id that does not exist in the fake tenant store at all | Rejects with { code: 'TENANT_NOT_FOUND', httpStatus: 404 } -- this was the exact original bug (a 200-shaped { valid: false, ... } body). Confirmed genuinely fixed: the promise rejects before parseInput/runSchemaGate even run. |
| 3a | Admin genuinely assigned to tenant-B (tenantIds: ['tenant-B']) calls execute() for tenant-B | Resolves correctly: resolved.llm.has_secret === true, resolved.llm.hosting === 'remote' -- the legitimate path still returns correct data, the fix did not over-block. |
| 3b | Operator role (tenantIds: [], roles: ['operator']) calls execute() for tenant-B | Resolves correctly with the same has_secret/hosting values -- canAccessTenant's operator-sees-all branch still works through the new check. |

Test suite run output: Test Suites: 1 passed, 1 total / Tests: 4 passed, 4 total. Harness file removed after the run; git status on apps/api/src after cleanup shows no residual artifact.

This directly closes both halves of the original D-1 repro (foreign-tenant metadata disclosure, and the unknown-tenant-id 200 leak) and confirms the legitimate/operator path is not broken by the fix.

## 3. Full regression (independently re-run, not trusted from the dev report)

| Check | Dev claim | QA independent result |
|---|---|---|
| jest --runInBand | 413/413 (411 + 2 new) | Confirmed: 72 suites, 413 tests, all passed. (One expected NestJS ERROR-level log line appeared during the run from a negative-path fixture deliberately exercising the error-logging path -- same pattern flagged as benign in the original REPORT.md; all 413 tests still report pass.) |
| jest --coverage | not restated in this dispatch's dev log (prior baseline 97.92%/94.81%) | 97.93% stmts / 94.84% branch / 93.68% funcs / 98.34% lines -- essentially unchanged from the prior pass, marginally higher due to the 2 new D-1 test cases. No coverage regression. |
| eslint (src/**/*.ts test/**/*.ts) | clean | Confirmed clean, exit 0, zero output. |
| prisma generate && nest build | clean | Confirmed: prisma generate regenerates the client cleanly; nest build completes with no errors. |

## 4. Spot-check: nothing else in deployment-config/providers/jobs regressed

- File-touch footprint for this fix pass, by mtime, is exactly: validate-config.use-case.ts, deployment-config.controller.ts, validate-config.use-case.spec.ts, deployment-config.controller.spec.ts, plus save-config.use-case.spec.ts (a consequential, not incidental, change -- see below). No other file under providers/ or jobs/ has a recent mtime; those modules are untouched by this dispatch, consistent with the orchestrator's narrow-retry framing.
- save-config.use-case.spec.ts was touched only because ValidateConfigUseCase's constructor gained a third parameter (tenants); the spec's new ValidateConfigUseCase(definitions, credentials, tenants) call site needed the added argument to keep compiling. Read the full spec and the real SaveConfigUseCase.execute() control flow: SaveConfigUseCase only calls the validator's parseInput/runSchemaGate/runCombinationGate helper methods, never execute(), so the new actor parameter on execute() cannot affect PUT /tenants/:id/config at all -- confirmed no double-authorization, no signature break, no behavior change on the save path. SaveConfigUseCase's own tenant check (404-then-403, a pre-existing and intentionally different split from Validate/GetConfigUseCase's single 404) is unchanged.
- GetConfigUseCase, ProviderCredentialsController and its five use cases, ProviderDefinitionsController, the BullMQ probe job/rate limiter, and combination-rules.ts were not touched by this dispatch and were not re-tested in depth here (out of the narrow retry scope); the full regression suite covering them all still passes at 413/413 with no new failures, which is the only signal this narrow retry needed for "did anything else break."

## Traceability matrix (this retry's scope only)

| Requirement | Scenario(s) tested | Result | Evidence |
|---|---|---|---|
| FR-TENANT-5 / FR-CONFIG-1 -- unassigned admin gets 404 on cross-tenant validate | Live harness scenario 1 | Pass | d1-live.qa.spec.ts scenario 1 (run + deleted); code read of validate-config.use-case.ts lines 199-202 |
| FR-TENANT-5 -- unknown tenant id gets 404 TENANT_NOT_FOUND, not a 200-shaped body | Live harness scenario 2 | Pass | d1-live.qa.spec.ts scenario 2 |
| FR-CONFIG-1 -- assigned admin still gets correct validate results (no over-block) | Live harness scenario 3a | Pass | d1-live.qa.spec.ts scenario 3a |
| FR-TENANT-5 -- operator role still sees all tenants correctly | Live harness scenario 3b | Pass | d1-live.qa.spec.ts scenario 3b |
| Regression: no fallout in save-config, controller wiring, or the rest of the suite | Full jest run, code read of SaveConfigUseCase call sites | Pass | 413/413 tests; save-config.use-case.ts read in full |

## Defects

None found in this retry's scope. D-1 (POST /tenants/:id/config/validate cross-tenant authorization gap, originally reported in qa-results/phase2-backend/REPORT.md) is confirmed FIXED.

## Overall verdict

PASS. D-1 is genuinely fixed: the authorization check exists in the real control-flow path (not just asserted by the dev's own mocked unit tests), matches the established GetConfigUseCase pattern, live-tested correctly for both the cross-tenant-disclosure case and the unknown-tenant-id 200-leak case, and does not regress the legitimate assigned-admin or operator paths. Full regression (413/413 tests, coverage steady at ~97.9%/94.8%, clean lint, clean build) independently reproduced. No new defects found in this narrow retry's scope. Phase 2 backend (BL-005-BL-009) has no outstanding backend defects as of this pass; remaining Phase 2 work, if any, is confined to the admin SPA per the parallel agent's own report.
