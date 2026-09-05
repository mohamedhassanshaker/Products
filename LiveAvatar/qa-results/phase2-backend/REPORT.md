# QA Report -- Phase 2 Backend (BL-005 to BL-009: Provider Registry, Deployment Config / Agent Builder API)

- Date: 2026-08-19
- Scope: apps/api/src/modules/providers, apps/api/src/modules/deployment-config, apps/api/src/modules/jobs, packages/contracts/src/{providers,agent-config,deployment-config}, apps/api/prisma/seed.ts, apps/api/src/common/redis
- Verified against: docs/PRODUCT_SPECIFICATION.md FR-PROVIDER-1..7, FR-CONFIG-1..5; docs/architecture/LLD.md; docs/architecture/adr/ADR-001-stack.md
- Environment: static code review plus an independent code-level test harness (no Docker available in this sandbox, consistent with the Phase 1 carried-forward caveat). Unit test suite run directly against the real backend source (jest --runInBand), not the dev agent numbers taken on faith.

## Verdict: PASS-WITH-CAVEATS

One real defect found (cross-tenant authorization gap on the config-validate endpoint). Everything else in scope, including all five verify-immediately security items, is independently confirmed correct. The defect is a rough edge relative to blocking severity (it leaks metadata, not secret values, and only via an endpoint that requires a valid admin JWT), but it is a genuine violation of FR-TENANT-5 / FR-CONFIG-1 and should be fixed before Final Review.

## Regression / QC results (independently re-run, not trusted from the dev report)

| Check | Dev report claim | QA independent result |
|---|---|---|
| jest --runInBand | 411/411 passed | Confirmed: 72 suites, 411 tests, all passed |
| jest --coverage | 97.92% stmts / 94.81% branch | Confirmed: exactly 97.92% stmts / 94.81% branch, 93.68% funcs, 98.33% lines |
| eslint | clean | Confirmed: eslint over src/**/*.ts and test/**/*.ts -- zero errors/warnings |
| prisma generate && nest build | clean | Confirmed: both commands complete with no errors |

Note: the coverage run logs several ERROR/WARN lines from Nest logger during the test run (TenantScopeViolationError, a "boom" error, an "unexpected" error). These are expected -- they come from the negative-path fixtures in app-exception.filter.spec.ts and run-provider-probe-sweep.use-case.spec.ts deliberately exercising the error-logging path, not real failures. All 411 tests still report pass.

## Verify-immediately items (explicit re-check per orchestrator instructions)

All five were re-verified with a from-scratch integration harness that wires the real ValidateConfigUseCase, SaveConfigUseCase, and CreateProviderCredentialUseCase classes against fake in-memory repository ports (not mocks of the classes under test), so the check exercises the actual Gate A to Gate B pipeline end to end rather than re-running the dev own mocked unit tests.

1. Raw secret in a provider-credential body is rejected, not silently stored or stripped. Confirmed. CreateProviderCredentialUseCase.execute() with extra: { api_key: "sk-live-..." } throws AppError with code PROVIDER_SECRET_IN_BODY, and the fake credential store remains empty (nothing persisted before or after the throw). Traced to apps/api/src/modules/providers/domain/validation.ts assertNoSecretInExtra, which uses the shared containsSecretKey() from @liveavatar/contracts.
2. Secret embedded directly in deployment-config YAML content is rejected at save, not just flagged. Confirmed. SaveConfigUseCase.execute() with a yaml_text containing api_key: "sk-live-raw-secret-value" throws code CONFIG_SECRET_IN_YAML for save_as: draft (and the same code path applies before the draft/published branch, so published is equally blocked); the fake DeploymentConfigRepositoryPort.save() was never called (saved.length === 0) -- rejected before persistence, matching the spec "draft saves persist through 422 but not through 400" rule (LLD section 5.5) exactly, since a secret-bearing document is a 400, not a 422.
3. Example A (openai + deepgram + fish-speech + bithuman + livekit) and Example B (anthropic + faster-whisper + elevenlabs + alibaba-liveavatar + livekit) genuinely validate and publish. Confirmed independently -- both examples, built as full canonical YAML documents (not truncated fixtures) and run through the real SaveConfigUseCase with save_as: published, return status: published and produce exactly one persisted row each with no error.
4. A deliberately invalid combination not in the dev own report is rejected at save time. Confirmed with privacy.send_to_remote_llm: none plus primary LLM openai (hosting remote) on an otherwise-complete, otherwise-valid Example-A-shaped config: publish throws code CONFIG_RESIDENCY_BLOCKS_LLM and nothing is persisted. Traced to combination-rules.ts residencyBlocksRemoteLlmRule.
5. Tenant isolation on provider registry entries and deployment configs reuses the Phase 1 tenantGuard pattern correctly, with one exception (see Defect D-1 below). ProviderCredentialsController five routes (list/create/update/delete/probe) all load the tenant, then call canAccessTenant(actor, tenant.id) and throw 403 TENANT_FORBIDDEN (or 404 TENANT_NOT_FOUND for an unknown/foreign id per FR-TENANT-5) before touching any repository -- confirmed by direct source read of all five use cases. The Prisma tenantGuard extension (apps/api/src/common/prisma/tenant-guard.extension.ts) additionally auto-scopes every ProviderCredential/DeploymentConfig query to the TenantContext ALS value from the URL, so row-level isolation at the data layer is sound. However, DeploymentConfigController.validate() (POST /tenants/:id/config/validate) and its backing ValidateConfigUseCase.execute(tenantId, input) never receive an actor and never call canAccessTenant or even check tenant existence -- see Defect D-1.

## Traceability matrix

| Requirement | Scenario(s) tested | Result | Evidence |
|---|---|---|---|
| FR-PROVIDER-1 (global catalog, seeded, disable-last-in-category blocked) | Seed row-for-row diff vs spec table (10 rows incl. alibaba-liveavatar); unit tests for set-provider-definition-enabled incl. PROVIDER_CATEGORY_EMPTY | Pass | apps/api/prisma/seed.ts; set-provider-definition-enabled.use-case.spec.ts (100% cov) |
| FR-PROVIDER-2 (endpoint+credential ref, https-only, secret-in-body rejection, duplicate) | Independent harness: raw secret in extra rejected, not stored; code read of assertEndpointUrl (https / loopback-http only); dev unit tests for PROVIDER_CREDENTIAL_EXISTS, PROVIDER_ENDPOINT_INVALID | Pass | QA harness run (7/7 passed); providers/domain/validation.ts; create-provider-credential.use-case.spec.ts |
| FR-PROVIDER-3 (health probe, 5s timeout, 30/min rate limit, unreachable still 200) | Code read of HttpProbeStrategy (5000ms AbortController timeout, HEAD, classify 2xx/3xx/401/403 healthy, 5xx degraded, else unreachable) and RedisProbeRateLimiter (fixed 60s window, limit 30, Redis-backed for multi-replica correctness) | Pass | http-probe-strategy.ts; redis-probe-rate-limiter.ts; both have dedicated .spec.ts at 94-100% coverage; jobs sweep interval confirmed at exactly 2 minutes |
| FR-PROVIDER-4 (adapters are config-selected factories; NestJS has no vendor SDK) | Grep for vendor SDK imports (openai, @anthropic-ai/sdk, provider client libs) across apps/api/src and apps/api/package.json dependencies | Pass | No hits beyond literal catalog-key strings used only as config values; ADR-001 section 3 confirms adapters live in Python (apps/agent), out of this phase scope |
| FR-PROVIDER-5 (static combination validation at save) | Independent harness: Example A/B publish; residency=none plus remote-LLM rejected; code read of all 7 COMBINATION_RULES | Pass | QA harness; combination-rules.ts plus combination-rules.spec.ts (100% stmt cov) |
| FR-PROVIDER-6 (hosting badge) | Code read: ProviderDefinitionSchema.hosting, ResolvedLayerDto.hosting returned from /validate | Pass | packages/contracts/src/providers/schemas.ts; validate-config.use-case.ts resolveLayer |
| FR-PROVIDER-7 (secrets never in YAML) | Independent harness: api_key embedded in YAML rejected at save (CONFIG_SECRET_IN_YAML), not persisted even as draft | Pass | QA harness |
| FR-CONFIG-1 (Agent Builder editor -- API side: 403/404 semantics) | Code read of GetConfigUseCase/SaveConfigUseCase (both call canAccessTenant); gap in ValidateConfigUseCase | Fail (partial) | Defect D-1 |
| FR-CONFIG-2 (canonical YAML schema, unknown-key/parse/field errors) | Dev unit tests cover parse errors, unknown-key, CONFIG_MODEL_REQUIRED, CONFIG_VOICE_REQUIRED, CONFIG_AVATAR_ID_REQUIRED, CONFIG_PROMPT_TOO_LARGE (byte-length re-check), CONFIG_RAG_INDEX_REQUIRED, CONFIG_RETRY_INVALID, CONFIG_RETENTION_INVALID; independently re-run via jest | Pass | validate-config.use-case.spec.ts; AgentConfigSchema in packages/contracts/src/agent-config/schema.ts matches spec table field-for-field |
| FR-CONFIG-3 (draft vs published, If-Match concurrency, idempotency of gates) | Independent harness: draft persists a schema-valid-but-incomplete config, publish enforces Gate B; code read of If-Match date-parse leading to CONFIG_CONFLICT | Pass | QA harness; save-config.use-case.ts |
| FR-CONFIG-4 (live preview: resolved keys, hosting, has_secret, redacted YAML) | Code read of ValidateConfigUseCase.execute() return shape; dev unit tests | Pass | validate-config.use-case.ts |
| FR-CONFIG-5 (click-through deep link) | Frontend-owned (parallel agent scope); not re-tested here | Untested (out of this dispatch backend scope) | -- |
| NFR-3 tenant isolation carried into Phase 2 tables | ProviderCredential/DeploymentConfig added to TENANT_SCOPED set in tenant-guard.extension.ts; independent harness proves /config/validate bypasses the actor-level check | Fail (partial) | Defect D-1 |

## Defects

### D-1 -- POST /tenants/:id/config/validate has no tenant-access authorization check (cross-tenant information disclosure)

- Severity: Rough edge, not a hard block. No secret values are ever returned by this endpoint -- only has_secret: boolean, hosting, feature_gaps, and a redacted_yaml built from whatever the caller own request body contains. It does not defeat FR-PROVIDER-7 or FR-PROVIDER-2 since no actual credential value is exposed. It does violate FR-TENANT-5 authorization contract and the explicit FR-CONFIG-1 requirement ("Unauthorized -> 403 TENANT_FORBIDDEN or 404 TENANT_NOT_FOUND per FR-TENANT-5").
- Expected: Same as GetConfigUseCase/SaveConfigUseCase -- load the tenant, 404 TENANT_NOT_FOUND if missing, 403 TENANT_FORBIDDEN (or per FR-TENANT-5, 404 to avoid leaking existence) if the calling admin is not operator and not assigned to that tenant.
- Actual: DeploymentConfigController.validate(tenantId, body) in apps/api/src/modules/deployment-config/interface/deployment-config.controller.ts (lines 38-45) has no actor parameter at all and calls this.validateConfig.execute(tenantId, body) directly. ValidateConfigUseCase.execute(tenantId, input) in apps/api/src/modules/deployment-config/application/validate-config.use-case.ts (lines 183-212) never injects TenantRepositoryPort, never calls canAccessTenant, and never checks that the tenant exists. It loads this.credentials.list(tenantId, {}) directly using the caller-supplied path id. Any authenticated admin (any role, any tenant assignment) can call POST /tenants/{any-other-tenant-uuid}/config/validate and receive that foreign tenant has_secret flags per layer and hosting badges -- crossing the same tenant boundary the Phase 1 tenant-isolation suite exists to guard. A request for a non-existent tenant id also silently succeeds (valid: false from CONFIG_INCOMPLETE) instead of 404 TENANT_NOT_FOUND, which additionally fails FR-TENANT-5 "guessing another tenant UUID returns 404" rule for this one endpoint.
- Repro steps (independent harness, no Docker needed):
  1. Seed a fake ProviderCredentialRepositoryPort with a credential for tenant-B only.
  2. Call new ValidateConfigUseCase(defs, creds).execute('tenant-B', { config: { llm: { primary: { provider: 'openai' } } } }) -- no actor object is even accepted by the signature.
  3. Result: resolved.llm.has_secret is true for tenant B credential, returned to whatever caller supplied tenant-B id, with zero authorization check.
  4. Separately: execute('tenant-does-not-exist', { config: {} }) returns { valid: false, ... } (200-shaped body), not a 404.
- Originating phase: Phase 2 (apps/api/src/modules/deployment-config -- ValidateConfigUseCase / DeploymentConfigController), introduced with this dispatch new POST /tenants/:id/config/validate route.
- Note: the dev own controller unit test (deployment-config.controller.spec.ts, lines 20-25, "delegates validate") documents the same signature -- controller.validate('tenant-1', body) with no actor argument -- so this is a genuine implementation gap, not a QA harness artifact.

## AI boundary / dependency / architecture compliance

- No vendor AI SDK import (openai, @anthropic-ai/sdk, Google/ADK, ElevenLabs, Deepgram, bitHuman clients) anywhere in apps/api/src or apps/api/package.json -- confirmed by grep. Matches ADR-001 section 3 ("the provider-agnostic AI boundary lives in Python"); NestJS holds only config/schema/catalog rows, no adapter calls.
- New dependencies (tsx, bullmq, @nestjs/bullmq, yaml) are all mainstream, maintained, permissively licensed (MIT), and match the LLD stated tooling (BullMQ for the repeatable probe job, yaml for parse/stringify of the canonical schema, tsx for the seed script). No unlisted/undocumented dependency found.
- Module layering follows the established domain / application / infrastructure / interface convention consistently across providers, deployment-config, and jobs, matching the pattern from Phase 1 tenants/auth modules. PublishedConfigLookupPort is a deliberate, documented exception to the "no cross-module class import" rule (a same-shared-table Prisma read, same pattern as PrismaTenantRepository existing DeploymentConfig read) -- acceptable and consistent, not a boundary violation.
- ADR-001 section 6 explicitly states the data-locality decision (on-prem media/speech, text-only to remote LLMs by default) -- not left implicit.

## Overall verdict

PASS-WITH-CAVEATS. All five explicitly flagged verify-immediately security/compliance items check out under independent re-testing. Regression numbers (411/411 tests, 97.92%/94.81% coverage, clean lint, clean build) are independently reproduced exactly as claimed. One real defect (D-1, tenant-isolation gap on POST /tenants/:id/config/validate) should be fixed; it is not blocking for the batched phase as a whole (it does not defeat the secret-handling guarantees, which are the hard constraint named in the dispatch) but must not carry into Final Review unresolved.
