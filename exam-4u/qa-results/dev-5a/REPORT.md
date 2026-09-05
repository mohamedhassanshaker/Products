# QA Report - Dev-5a (BL-05: Platform Admin auth realm, backend)

Date: 2026-08-08
Scope: Dev-5a only (backend platform-admin auth realm, tenant CRUD console, audit log,
Dev-2 concurrency fix). Dev-5b (UI) and later phases explicitly out of scope.

## Environment

- Dedicated, disposable MySQL 8.4 container named qa-dev5a-mysql (port 3307), destroyed
  after this session -- not the developer persistent examland-mysql container.
- apps/api built from source (npm run build:api) and booted directly via node dist/main.js
  (both NODE_ENV=development for bootstrap/idempotency checks and NODE_ENV=staging for real
  Host-header tenant-subdomain routing, since TenantResolutionMiddleware only derives the
  slug from Host in prod-like envs) on 127.0.0.1:3099, against the dedicated MySQL instance.
  Platform migrations applied via a disposable script calling the real
  createPlatformDataSource().runMigrations() (same code path the app/tests use).
- No production environment touched. All temporary containers, processes, and scripts were
  removed after the run (the dedicated MySQL container was torn down, the node dist/main.js
  process was killed, and the throwaway migration-runner script was deleted).

## 1. Full suite re-run (independent, not trusting the self-report)

| Check | Result |
|---|---|
| npm run typecheck | Clean, all 3 workspaces |
| npm run lint | Clean (0 warnings, --max-warnings=0) |
| npm run test:cov -w apps/api | 62 suites / 411 tests, 93.47/80.54/88.75/93.45% stmt/branch/func/line -- matches self-report exactly |
| npm run test:e2e -w apps/api (live MySQL 8.4) | 12 suites / 76 tests, all green -- matches self-report exactly |
| Leaked schemas after e2e run | None (SHOW DATABASES shows only examland_platform, information_schema, mysql, performance_schema, sys) |

## 2. Cross-realm replay -- the headline exit gate

Read JwtPlatformTokenAdapter, JwtTenantTokenAdapter, PlatformAdminGuard, JwtAuthGuard
source directly. Confirmed the three barriers are genuinely independent:
1. Secret: jwt.verify(token, secret) -- a tenant token (signed JWT_TENANT_SECRET) fails
   signature verification outright against JWT_PLATFORM_SECRET, and vice versa, before any
   claim is inspected.
2. aud: passed as jwt.verify own audience option (platform vs tenant) -- fails inside the
   same jwt.verify call, so a token forged with the right secret but wrong aud still cannot
   reach the typ check.
3. typ: explicit check that decoded.typ matches the expected constant, done after
   jwt.verify succeeds -- the last barrier if secret and aud were both somehow satisfied.

env.schema.ts loadAndValidateEnv additionally fails boot if JWT_TENANT_SECRET equals
JWT_PLATFORM_SECRET, closing the one way barrier #1 could ever be silently defeated. A
token forged with only two of the three barriers satisfied cannot slip through -- each
check is a separate, short-circuiting return-null/exception path with no fallthrough.

Live, real-token verification (not just reading code or trusting the suite):
- Booted the real app, ran platform-admin bootstrap, logged in as the seeded admin, got a
  real platform token.
- Created a real tenant via POST /api/platform/tenants (drove the actual
  TenantProvisioningService to Active), then registered and logged in a real tenant user
  via POST /api/auth/register / POST /api/auth/login (Dev-3 real endpoints, with the
  tenant Host header), got a real tenant token.
- Cross-realm replay, both directions, over real HTTP:
  - Tenant token vs GET /api/platform/tenants -> 401 UNAUTHENTICATED
  - Tenant token vs GET /api/platform/auth/me -> 401 UNAUTHENTICATED
  - Platform token vs GET /api/auth/me (tenant realm, correct tenant Host header) ->
    401 UNAUTHENTICATED
  - Positive controls: platform token vs GET /api/platform/auth/me -> 200 (correct admin);
    tenant token vs GET /api/auth/me -> 200 (correct user) -- proving the rejections above
    are the realm barrier, not a broken guard rejecting everything.

Verdict: cross-realm barrier genuinely holds, independently reproduced with real tokens
against a live server.

## 3. Audit logging

Performed a real mutating action (POST /api/platform/tenants/:id/suspend) through the
live HTTP API and queried audit_log directly via SQL:

actor_type=PlatformAdmin actor_id=REAL_ADMIN_ID tenant_id=REAL_TENANT_ID
action=tenant.suspend target_type=Tenant target_id=REAL_TENANT_ID
ip=::ffff:127.0.0.1 created_at=REAL_TIMESTAMP

Correct actor/action/target/timestamp/IP, and a tenant.create row from the earlier
tenant-creation call was also present with the correct adminEmail/subdomainSlug summary.
Confirmed append-only design (no update/delete path in AuditLogRepository).

Fail-open design -- judged, not just accepted. AuditLogService.record() swallows any write
failure (catch, logger.error) and never propagates it; the controller always calls
audit.record() after the underlying mutation has already completed and already returns
200/201/202 regardless of whether the audit write succeeded. This is a defensible choice
-- an audit-logging outage should not block administrative actions like suspending a
tenant -- but it does create a silent audit-gap risk: if audit_log writes fail (e.g. a
transient DB blip on the platform schema, a full disk, a schema migration lag), a
compliance-relevant platform-admin action proceeds with zero caller-visible indication
that its audit trail is missing, and there is no reconciliation job or alert wired up to
detect or backfill the gap. Given HLD own framing of audit as required to make NFR-9
demonstrable, a silently-incomplete audit trail is a real, if likely rare, compliance
exposure. Non-blocking finding: recommend at minimum structured alerting (not just a
logger.error) on audit_log_write_failed, and/or a periodic reconciliation check
correlating tenant-mutation timestamps against audit rows, before this is relied on for a
real compliance attestation.

## 4. Concurrency fix (Dev-2 Section 6 race)

Read TenantProvisioningLockService and TenantProvisioningService.runSteps/runStepsLocked
directly: the entire step-driving body, including the final
markProvisioningActive/markProvisioningFailed write, executes inside lock.withLock(...),
and the lock is only released in the finally block after fn() (the whole locked body)
resolves or rejects. There is no gap between steps complete and final status write that a
second racer could exploit -- the write happens before release, not after.

Audited (not merely re-ran) test/tenant-provisioning-concurrency.e2e-spec.ts: it uses the
real, shared TenantProvisioningLockService/PlatformTenantRepository/step ledger against
live MySQL (not fakes/mocks for the DB layer), reproduces the exact Dev-2 QA repro shape
(5/6 steps genuinely Completed, two concurrent retry() calls racing on the 6th), and
includes a second, independent test proving GET_LOCK itself serializes two overlapping
withLock() calls (the second callback only runs after the first 300ms hold releases). This
is a genuine live-MySQL test, not a mocked unit test -- confirmed adequate.

Independent reproduction: fired two concurrent POST
/platform/tenants/:id/provisioning/retry HTTP requests at a real, fully-provisioned Active
tenant forced back to Failed via direct SQL (all 6 ledger steps already Completed). Result:
one call succeeded (202, tenant to Active), the other received a benign 409
INVALID_TENANT_STATE (its outer status pre-check read Active after the first had already
finished) -- no corruption, no spurious Failed, no double side-effect. Noted that retry()
outer status guard (current status not Provisioning and not Failed) reads state before
acquiring the lock, so it is itself subject to a benign TOCTOU -- but this is safe by
construction because the actual step work inside the lock is ledger-gated/idempotent
(already-Completed steps are skipped, markProvisioningActive is idempotent), so a stale
outer-check race can only ever produce an extra no-op or a benign 409, never data
corruption or a spurious status regression. Verdict: the concurrency fix genuinely holds
under live, independently-driven concurrent load -- no blocking defect found.

## 5. Bootstrap service idempotency and no public registration surface

- Booted the app twice against the same DB with PLATFORM_ADMIN_BOOTSTRAP_EMAIL/_PASSWORD
  set to a different password on the second boot. Result: login with the new password ->
  401 INVALID_CREDENTIALS; login with the original password -> 200. SELECT COUNT(*) FROM
  platform_admin stayed at 1 across both boots. Genuinely idempotent, does not reset
  credentials out-of-band.
- Grepped the entire platform/** API surface and probed live: POST
  /api/platform/auth/register, /api/platform/register, /api/platform/admins,
  /api/platform/admin/register all -> 404. No public platform-admin self-registration
  endpoint exists anywhere.

## 6. Provisioning-retry endpoint

- POST /platform/tenants/:id/provisioning/retry with no Authorization header -> 401
  UNAUTHENTICATED (guard fails closed).
- With a valid platform token, calling it against a non-retryable tenant status (Suspended)
  correctly returned 409 INVALID_TENANT_STATE with the LLD-documented message shape, and it
  correctly delegates to the real TenantProvisioningService.retry -> runSteps path
  (confirmed above by both source read and live concurrent-call reproduction), not a stub.

## Traceability matrix

| Requirement | Scenario(s) tested | Result | Evidence |
|---|---|---|---|
| FR-MT-9 / NFR-4 -- structurally separate realm | cross-realm replay both directions, real tokens, live HTTP; positive controls | Pass | Section 2 |
| Exit gate -- tenant token never reaches /api/platform/** | live HTTP, real tenant token vs 2 platform routes | Pass | Section 2 |
| Exit gate -- platform token never reaches tenant route | live HTTP, real platform token vs /api/auth/me | Pass | Section 2 |
| Exit gate -- tenant creation drives full provisioning + audit | POST /platform/tenants -> tenant reached Active, tenant.create audit row with correct summary | Pass | Section 2, 3 |
| HLD Section 5.3 audit log (actor/action/target/before-after/ip) | live suspend action, direct SQL read of audit_log | Pass (with non-blocking fail-open gap noted) | Section 3 |
| Concurrency fix (Dev-2 Section 6) | source audit of lock/withLock scope, official e2e suite re-run, independent live double-HTTP-call reproduction | Pass | Section 4 |
| Bootstrap idempotency, no public registration | double-boot with differing password, full endpoint grep+probe | Pass | Section 5 |
| Provisioning-retry guarded and wired to real service | unauth 401, wrong-state 409, source read of delegation | Pass | Section 6 |
| Unit/e2e suite parity with self-report | full local re-run against dedicated MySQL | Pass | Section 1 |
| Lint/typecheck | full local re-run | Pass | Section 1 |

No requirement in scope was left untested.

## Defect list

None blocking.

- Non-blocking (rough edge): Audit-log fail-open design gives zero caller-visible or
  alerted signal when an audit write fails for a compliance-relevant platform-admin action
  -- see Section 3. Recommend structured alerting and/or periodic reconciliation before
  relying on this for a compliance attestation.
- Carried forward, not introduced by this phase: no rate limiting yet on
  /platform/auth/login (same gap already flagged and accepted for the tenant realm
  /auth/login in Dev-3) -- unchanged assessment, still non-blocking pre-production.

## Verdict

Dev-5a is QA-green -- no blocking defects. The cross-realm barrier and the concurrency
fix, the two highest-risk items in this phase dispatch, both independently held up under
live, real-token/real-HTTP/real-MySQL testing, not just a re-run of nexus-dev own suite.
