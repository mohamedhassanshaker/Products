# QA Report -- Dev-29 (BL-28): Cross-tenant migration rollout as a dedicated ops tool

**Date:** 2026-08-11
**Scope:** Dev-29 only (closes Phase 5, BL-22..28, in full). Dev-23..28 already QA-green,
not re-litigated. Dev-10 TenantMigrationRunner itself is already QA-green
(qa-results/dev-10/REPORT.md, REPORT-retry1.md) -- not re-litigated; this pass only
verifies the new console surface genuinely exposes it correctly.

## Environment

- Backend: apps/api (NestJS), compiled dist/ + ts-node/jest for tests.
- Frontend: apps/web (Angular 20, vitest via ng test).
- Database: real MySQL (examland-mysql Docker container, 127.0.0.1:3306, root/YourPassword).
- Real-browser verification: real compiled apps/api NestFactory.create(AppModule) process
  booted standalone on port 4099, real built Angular dist/web served as static assets (the
  same single-process shape main.ts uses), two real fixture tenant schemas (RBAC migration
  pre-applied only, genuinely leaving 13 migrations pending), driven with a real headless
  Chromium via Playwright. Boot/browser scripts were throwaway files outside tracked source,
  deleted after the run.

## Requirements in scope

- FR-MT-5 (migration rollout: sequential apply, halt/continue-on-error, per-tenant report
  including dry-run mode).
- Exit gate: operator can trigger a dry run and a real run from the console and see the
  per-tenant report Dev-10 already produces.
- docs/design/UX_GUIDELINES.md Section 15 (nav placement, trigger form, confirm-dialog friction,
  in-flight/error states, five-status badge table).

## Traceability matrix

| # | Requirement | Scenario(s) tested | Result | Evidence |
|---|---|---|---|---|
| 1 | Dry run applies zero DDL, full report still produced | Real HTTP e2e test against real MySQL fixture tenant with 13 genuinely pending migrations; verified via information_schema.TABLES that no stage table exists after | PASS | test/tenant-migrations-console.e2e-spec.ts re-run from cold start, 6/6 green; own real-browser repro | 
| 2 | Real run genuinely applies DDL | Same fixture, dryRun false; information_schema.TABLES shows stage/subject created after | PASS | e2e re-run plus own browser repro (body text contained Succeeded after real run) |
| 3 | Platform-realm auth (not tenant-realm) | 401 with no token; 401 with a structurally-invalid tenant-shaped token | PASS | e2e re-run; code read of PlatformAdminGuard confirms 3-barrier design (secret/aud/typ) |
| 4 | initiatedBy server-derived, never client-supplied | Code read of tenant-migrations.controller.ts -- initiatedBy is hardcoded from admin.adminId, request DTO has no such field | PASS | RunTenantMigrationsDto/controller source read |
| 5 | Audit logging on every trigger | Queried audit_log directly after dry run; row present with correct action/actor_id/null tenant_id | PASS | e2e assertion plus own re-run |
| 6 | Per-tenant report fidelity (success/failure attribution across multiple tenants, incl. one engineered failure) | 3-tenant continue-on-error run, one tenant with a pre-broken FK constraint; asserted per-tenant status array, not just aggregate counts | PASS | e2e re-run: good1 -> Succeeded, multifail -> Failed (error matches education_level), good2 -> Succeeded, unaffected by the failure |
| 7 | Reactivity bug fix (checkbox to button label) | Code read confirms toSignal(valueChanges) bridging; real DOM click via own Playwright script -- unchecking the checkbox changed the button text from Run dry run to the real-run label | PASS | tenant-migrations.component.ts source; own browser repro; unit regression test genuinely clicks the native checkbox input, not setValue |
| 8 | Real-browser end-to-end flow, zero console errors | Login -> migrations page -> dry run -> uncheck -> confirm dialog -> real run -> report | PASS | Own Playwright run: zero console errors; screenshots 01-06 |
| 9 | Backend/frontend regression suite counts match claim | Re-ran both from cold start | PASS backend exact match; minor discrepancy frontend | see below |

## Independent test execution (re-run from scratch, not trusted from the completion note)

- Backend unit suite (npm run test -w apps/api): 176 suites / 1507 tests, all green -- exact
  match to the claimed number.
- Backend e2e suite, this phase own suite (test/tenant-migrations-console.e2e-spec.ts), run
  standalone against real MySQL with correct root credentials: 6/6 green -- 401 no-token,
  401 tenant-shaped-token, 400 invalid mode, DRY RUN zero-DDL plus report plus audit proof,
  REAL RUN genuine-DDL proof, multi-tenant continue-on-error proof. First attempt failed with
  MySQL Access denied -- an environment credential mismatch in my own test invocation, not a
  product defect; resolved by using the container actual root password.
- Frontend unit suite (ng test --watch=false): 59 test files / 332 tests, all green. The
  completion note claims 331; I independently observed 332. This is a minor, non-blocking
  discrepancy (one test more than claimed, not fewer) -- not investigated further since it
  does not indicate a regression (all green either way), but flagged for the record.
- Real-browser Playwright pass (own script, not reusing nexus-dev own): full login -> dry run
  -> uncheck -> confirm -> real run flow reproduced against a live boot plus live MySQL; zero
  console errors; screenshots saved to qa-results/dev-29/20260811/.

## Code-level verification (read directly, not trusted from prose)

- tenant-migrations.controller.ts: confirmed the PlatformAdminGuard decorator is applied (not
  JwtAuthGuard), confirmed initiatedBy is built server-side from admin.adminId and never read
  from the request dto, confirmed one audit.record call per trigger regardless of outcome.
- tenant-migrations-console.module.ts and app.module.ts: confirmed TenantMigrationsConsoleModule
  is genuinely registered in AppModule, not an orphaned module.
- platform-admin.guard.ts: confirmed the three-barrier design (platform secret, aud=platform,
  typ=platform-admin) that makes a tenant-realm token structurally unusable here, matching the
  project realm-separation convention.
- tenant-migrations.component.ts: confirmed the toSignal bridge on control.valueChanges
  genuinely replaces the earlier broken direct FormControl.value reads inside computed() -- a
  correct fix, not a workaround.
- tenant-migrations.component.spec.ts: confirmed the new regression test drives a real native
  checkbox input click, not a programmatic setValue call -- this genuinely would have caught
  the original bug, since the original bug was specifically that a DOM-driven forms value
  change never re-ran computed().
- Nav wiring: confirmed the /platform/migrations route and the sidenav item (build_circle icon,
  last position) both genuinely exist and are wired, not just described in prose.

## Security spot-check

- PlatformAdminGuard genuinely gates the route (verified via both a real 401 e2e test and a
  direct code read) -- consistent with every other platform admin controller.
- initiatedBy unspoofable -- confirmed by code read (no client-supplied field is used).
- mode is validated server-side (a 400 is returned for an invalid value before any tenant is
  touched, confirmed via e2e test).
- No raw SQL in the new code; the controller only calls the already-audited
  TenantMigrationRunner.
- No dedicated rate limit on this endpoint (self-reported, matches Dev-28 precedent for a
  low-frequency, permission-gated, confirm-dialog-gated operator action) -- non-blocking,
  consistent with established project convention, not a new gap.

## Environment note (not a Dev-29 defect)

The shared MySQL instance carries a substantial number of leftover ad hoc schemas from prior
QA and dev passes (catalog, billing, rbac, console fixtures, etc.) predating this pass. These
are pre-existing environment hygiene debt, not created by this QA pass and not in Dev-29
scope -- flagged for the record only. All schemas created during this pass were confirmed
dropped afterward (SHOW DATABASES re-checked). The boot/browser Node process and its throwaway
driver scripts (kept outside tracked source, deleted after the run) left no listener on its
port (netstat showed only TIME_WAIT connections, no LISTENING).

## Defects found

None blocking. No non-blocking defects found in Dev-29 own code either -- the one
discrepancy noted (332 vs. claimed 331 frontend tests) is a documentation-accuracy nit, not a
functional defect, and does not affect the verdict.

## Verdict: READY -- Dev-29 (BL-28) is QA-green. This confirms Phase 5 (BL-22..28) of the dev plan is complete in full.

The exit gate literal wording -- operator can trigger a dry run and a real run from the
console and see the per-tenant report Dev-10 already produces -- holds under independent
re-verification at the unit level, the real-HTTP/real-MySQL e2e level, and via a real Chromium
browser driven by my own script (not reused from nexus-dev own verification pass). The
dry-run/real-run DDL distinction and per-tenant report fidelity (including correct
success/failure attribution in a multi-tenant continue-on-error batch with one genuinely
engineered failure) both genuinely hold.
