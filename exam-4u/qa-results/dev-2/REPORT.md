# QA Report -- Dev-2 (BL-02: Schema-per-tenant provisioning workflow)

**Date:** 2026-08-08
**Scope:** Dev-2 only (per orchestrator instruction). Does not evaluate Dev-3+ (not started).
**Verdict: PASS -- Dev-2 QA-green, no blocking defects.** One non-blocking (latent, currently
unreachable) concurrency defect found and reported for awareness before Dev-5a ships the
retry HTTP endpoint / BL-20 ships worker scheduling.

## Environment

- Fresh, dedicated MySQL 8.4 container (qa-dev2-mysql, mysql:8.4, port 3309), created and
  destroyed by this QA session -- not reused from the prior interrupted QA session (a leftover
  qa-dev2-mysql container from that run was found and removed before this session own
  container was created, per the "fresh run, not retry" instruction).
- npm ci (Node 22.16 host, project declares engines.node >= 24.13; same discrepancy already
  accepted at Dev-0a/QA -- the actual shipping artifact is the Docker image, not asserted this
  pass since Dev-2 introduced no Docker-relevant change).
- All commands run from repo root / apps/api against the dedicated container via
  DB_HOST=127.0.0.1 DB_PORT=3309 DB_USER=root DB_PASSWORD=rootpass.

## Requirements in scope

- FR-MT-3 (data-access pattern, proven end-to-end via a real provisioned schema)
- FR-MT-4 (tenant provisioning: atomic/retriable workflow, idempotency, failure handling)
- HLD Section 4.4 (exact step sequence, ledger, retry, forward-recovery model)
- Dev-2 plan section exit gate (examland-mvp-plan.md lines 102-123)

## Verification performed

### 1. Full suite re-run (independent, not trusting the self-report)

| Check | Result |
|---|---|
| npm run typecheck (3 workspaces) | Clean |
| npm run lint | Clean |
| npm run build (contracts+api+web) | Clean |
| npm run test:cov -w apps/api | 35 suites / 225 tests, 95.98/96.79/87.87/95.68% stmt/branch/func/line aggregate -- exact match to self-report |
| npm run test:e2e -w apps/api (live MySQL) | 7 suites / 35 tests, all green -- exact match to self-report |
| SHOW DATABASES after e2e run | No leaked tenant/platform schemas |

### 2. Real end-to-end provisioning, independently verified via direct SQL

Confirmed via the project's own provisioning-workflow.e2e-spec.ts (re-run against my own
dedicated DB, plus read in full) that a freshly provisioned tenant has, verified by raw SQL
against the tenant own schema and the platform schema:
- The tenant schema physically exists (information_schema.SCHEMATA).
- Tenant migrations ran: permission (28 rows, matching the LLD Section 5.1 catalog), role (exactly
  Member + Tenant Admin, both is_system=1), role_permission (Tenant Admin has all 28
  grants; Member has the documented 7-permission subset).
- Exactly one user row (the invited admin), password_hash IS NULL, granted Tenant Admin
  via user_role.
- Exactly one tenant_subscription row (platform schema), status=ACTIVE, against the
  hardcoded bootstrap-free package.
- Every tenant_provisioning_step ledger row is Completed, covering all 6 steps
  (create_schema, run_migrations, seed_rbac, seed_admin_user, create_subscription,
  invite_admin), before status ever became Active.

### 3. Half-provisioned tenant can never become Active -- verified by code read + test

Read TenantProvisioningService.runSteps() directly: markProvisioningActive() is called
exactly once, unconditionally, only after the for loop over every step in this.steps
has completed without throwing (each iteration either skips an already-Completed step or
runs it to completion). Any step throwing immediately marks the tenant Failed and
re-raises, skipping the activation call entirely. There is no other code path that sets
status = Active during provisioning (grepped markProvisioningActive/status across the phase
source -- the tenant repository save() is a thin passthrough with no other caller writing
Active during provisioning). The project own "permanent failure" e2e test independently
confirms a tenant whose seed_rbac always fails stays Failed (0 permissions ever seeded)
across a further retry -- reproduced in my own run. No path exists in the shipped code for a
tenant to reach Active with an incomplete step ledger.

### 4. Idempotency / retry-from-Failed

Re-ran the project own idempotency test (a stateful fake invite_admin that fails once, then
succeeds on retry) against my own DB: confirmed attempts stayed at 1 for every step except
the one that actually re-ran, no duplicate user/permission/tenant_subscription rows were
created, and the tenant reached Active only after the retry. Also independently confirmed via
code read that every step SQL is written idempotently (CREATE DATABASE IF NOT EXISTS,
INSERT IGNORE, ON DUPLICATE KEY UPDATE, or a natural-key SELECT-then-INSERT for
seed_admin_user, guarded by user.email's unique key).

### 5. Failure path -- tenant-resolution treats Failed like Provisioning

Re-ran tenant-resolution.e2e-spec.ts (now provisioning its Active/Suspended fixtures for real
via TenantProvisioningService, per the self-report) against my own DB and confirmed via the
live HTTP responses captured in the test run: a Provisioning host and a Failed host both
return 503 TENANT_UNAVAILABLE (not 404, not silently passed through), while Active passes
through to normal routing and Suspended returns 403 TENANT_SUSPENDED. Confirmed by direct
source read of TenantResolutionMiddleware (line 72): if tenant.status is Provisioning or
Failed, throw DomainError(TENANT_UNAVAILABLE, ...) -- a single shared branch, not two
independently-maintained checks that could drift.

### 6. Concurrency -- independently injected race (not part of nexus-dev own suite)

Found a real, but currently non-exploitable, concurrency defect (see Defects below).
TenantProvisioningService.runSteps() has no locking (no MySQL named lock, no DB-level
optimistic-concurrency/version check, no in-process mutex) guarding against two concurrent
retry() (or a retry() racing a still-in-flight provisionNewTenant()) calls for the same
tenantId. I wrote and ran a disposable QA-authored e2e spec (not merged -- deleted after this
session) that: (1) drove a tenant to Failed at invite_admin with steps 1-5 genuinely
Completed; (2) fired two concurrent retry() calls, one designed to succeed quickly and one
designed to fail after a short delay (simulating a slow straggler). Result: the fast call
completed the tenant to Active first; the slow straggler failure then overwrote the
tenant status back to Failed even though every provisioning step was genuinely
Completed in the ledger by that point -- the reverse of the "half-provisioned tenant reachable"
concern, but an equally real availability/data-integrity bug: a fully, correctly-provisioned
tenant can become spuriously unreachable (503) due to a losing concurrent retry error
clobbering a winning one success, with no mechanism to reconcile status against the ledger
actual completeness afterward.

- Why this is reported non-blocking for Dev-2 specifically: no HTTP endpoint ships this
  phase (by design -- Dev-5a's job), and TenantMaintenanceWorker.sweepStuckProvisioning()'s
  only current caller is direct/manual (no interval scheduler yet, that's BL-20), and its own
  "stuck" query requires a stale heartbeat (default 5 minutes), which a genuinely in-flight
  retry() keeps refreshing before every step -- so no code path shipped in this phase can
  actually trigger two concurrent retry() calls against the same tenant today.
  Exit-gate-tested behavior (idempotent single-threaded retry, ledger-gated activation) is
  correct.
- Why it matters going forward: this becomes live and directly reachable the moment
  Dev-5a's POST /api/platform/tenants/:id/provisioning/retry HTTP endpoint ships (a
  double-click, a retried request after a client timeout, or a Platform Admin clicking retry
  while TenantMaintenanceWorker's sweep happens to also be retrying the same stuck tenant once
  BL-20 adds scheduling) -- recommend adding either a MySQL named lock keyed on tenantId
  (HLD Section 7.3/4.4's own "DDL and multi-schema access... needs raw CREATE DATABASE and named
  locks" already anticipates named locks for this kind of DDL-adjacent coordination) or a
  compare-and-swap guard on the tenant status/updated_at before runSteps() starts, before
  Dev-5a's retry endpoint ships -- flagging now so it is designed in rather than discovered in
  production.
- Repro: available on request (disposable spec, deleted after this session per test-hygiene
  instructions) -- pattern: two TenantProvisioningService instances (or two calls on the same
  instance) call retry(tenantId) concurrently on a tenant in Failed with a controllable step
  fake, one resolving fast, one rejecting after a delay; final tenant.status becomes Failed
  even though the fast call runSteps() had already completed every step and set Active
  moments earlier.

### 7. Deleted tenant_smoke_marker -- no dangling references

Grepped the full source tree: no live reference to tenant_smoke_marker/TenantSmokeMarker
remains anywhere except stale, regenerable coverage/lcov-report/** HTML artifacts from a
before-this-phase coverage run (not source, not shipped, will be overwritten by the next
test:cov). test/tenant-registry-cross-schema.e2e-spec.ts (Dev-0b's cross-schema isolation
suite) was confirmed, by direct read and by re-running it, to now write/read against the real
user table instead of the deleted smoke-marker entity, and still independently proves
cross-schema isolation (two real schemas, two distinguishable rows, each DataSource only ever
sees its own row) plus the structural "registry's public API surface cannot express a
cross-schema query" proof -- the intent of Dev-0b's original test is fully preserved, not
weakened by the swap.

### 8. Package.json / dependency check

No new third-party dependency was introduced this phase beyond what Dev-0b already declared
(mysql2, already in use). No dependency-related findings.

### 9. Architecture / spec compliance

- Step sequence matches HLD Section 4.4 exactly: create_schema -> run_migrations -> seed_rbac ->
  seed_admin_user -> create_subscription -> invite_admin.
- Raw-SQL seeding (not TypeORM entities) for RBAC/admin-user tables matches HLD Section 4.4's own
  sequence-diagram framing and is a deliberate, documented choice to avoid Dev-2 preempting
  Dev-3/Dev-4's entity design -- consistent with LLD's layering intent.
- Every raw-SQL call parameterizes user-supplied values (adminEmail, tenant/package ids);
  only fixed, hardcoded identifier lists are ever string-interpolated. No injection surface
  found on inspection of every step file.
- No new HTTP endpoint (correct, matches the plan's explicit scope and the same judgment call
  Dev-1 made for TenantsService).

## Traceability matrix

| Requirement | Scenario(s) tested | Result | Evidence |
|---|---|---|---|
| FR-MT-4 -- required inputs (name, subdomain, admin email) | Happy-path provisioning test | Pass | provisioning-workflow.e2e-spec.ts happy-path case, re-run |
| FR-MT-4 -- idempotent retry from Provisioning/Failed | Idempotency test (flaky step, retry) | Pass | Re-run; attempts/row counts verified unchanged for already-Completed steps |
| FR-MT-4 -- permanent failure leaves Failed with reason, never Active | Permanent-failure test | Pass | Re-run; 0 permissions ever seeded, status stays Failed across a further retry |
| FR-MT-4 -- never leaves a partially-usable tenant reachable | Code read (single activation call-site) + resolution e2e (503 for Provisioning/Failed) | Pass | tenant-provisioning.service.ts L137; tenant-resolution.middleware.ts L72-73 |
| FR-MT-3 -- data-access pattern proven via real schema | Direct SQL against provisioned schema | Pass | RBAC tables/rows verified via raw mysql2 connection, not the app's own registry |
| Concurrent retry safety | QA-authored race injection | Latent defect found (non-blocking this phase) | See Section 6 above |
| Deleted tenant_smoke_marker -- no dangling refs, cross-schema isolation preserved | Grep + re-run of updated suite | Pass | Section 7 above |
| Unit/e2e coverage vs. self-report | Full re-run on dedicated DB | Pass (exact match) | Section 1 above |

## Defect list (ordered by severity)

1. [Non-blocking, latent] Concurrent retry() calls for the same tenant have no locking/CAS
   guard; a slow, ultimately-failing concurrent retry can overwrite a fast, successful
   concurrent retry's Active status back to Failed, even though every provisioning step is
   genuinely Completed. Not reachable via any code path shipped in Dev-2 (no HTTP endpoint yet,
   worker sweep is heartbeat-gated and unscheduled). Recommend addressing before Dev-5a ships
   the retry HTTP endpoint (e.g. a MySQL named lock keyed on tenantId, or a status/version
   compare-and-swap at the top of runSteps()). See Section 6 for full repro pattern.

No other defects found. No blocking defects.

## Overall verdict

Dev-2 is QA-green -- ready to advance. The phase exit gate (a freshly provisioned tenant
has all seeded RBAC rows, one Tenant Admin user with no password, invite sent via the no-op
EmailPort, and only reaches Active after every step is Completed; retry-from-Failed
proven idempotent) is met and independently re-verified against a fresh, dedicated MySQL 8.4
instance, not merely re-trusted from the self-report. The one defect found is non-blocking for
this phase specifically (unreachable via anything Dev-2 ships) but is flagged with enough detail
that Dev-5a's retry-endpoint work -- the phase that makes it reachable -- should account for it.
