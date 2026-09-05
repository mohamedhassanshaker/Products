# QA Report - Dev-6b (BL-06: Admin user management UI + backend)

Date: 2026-08-08
Scope: Dev-6b only (per orchestrator instruction). FR-IAM-7. Phase 1 and Dev-6a are
already QA-green and out of scope for this pass.
Verdict: PASS - Dev-6b is QA-green, no blocking defects.

## Environment

- Dedicated, freshly provisioned MySQL 8.4 Docker container (qa-dev6b-mysql, port 3307),
  not the developer's persistent examland-mysql container. Removed after the run.
- Backend: apps/api, built (npm run build:api) and run both as node dist/main.js
  (NODE_ENV=production) for the real-browser pass, and via jest --config
  ./test/jest-e2e.json for the e2e suite (NODE_ENV=staging, matching the suite's own
  convention of exercising production-invariant config validation).
- Frontend: apps/web, built (ng build) and served statically from the compiled API
  (apps/api/public/), matching the project's single-image deployment model.
- Real browser: Playwright + Chromium (ad hoc, not added to the project, matching
  nexus-dev's own ad hoc verification convention). Because the app's helmet CSP sends
  upgrade-insecure-requests, plain-HTTP subresource loads under a fake subdomain get
  silently upgraded to HTTPS by Chromium; worked around with a local self-signed
  TLS-terminating proxy (http-proxy + an OpenSSL-generated cert) in front of the app,
  and --host-resolver-rules mapping the fake tenant subdomains to 127.0.0.1 so the
  browser could resolve them without touching the shared/no-admin-rights hosts file.
  This is a test-environment-only workaround; it changes nothing about the app's own
  TLS/CSP behavior, which is correct as shipped.
- Two real tenants provisioned end-to-end via the actual platform provisioning API
  (qabrowser, qatenantb), not hand-inserted rows.
- All temporary infrastructure (MySQL container, Docker/TLS artifacts, seeded tenants,
  local server process, browser scripts, .env) torn down after the run; nothing besides
  this report and its screenshots is left in the repository.

## Automated suites - reproduced, not merely trusted

| Suite | Self-reported | Independently reproduced |
|---|---|---|
| typecheck (3 workspaces) | clean | clean |
| lint | clean | clean |
| build (contracts/api/web) | clean | clean (Angular initial-bundle-budget warning present, see notes) |
| apps/api unit tests | 74 suites / 512 tests | 74 suites / 512 tests, all green |
| apps/api e2e tests | 15 suites / 119 tests | 15 suites / 119 tests, all green, incl. users-admin.e2e-spec.ts (20/20) |
| apps/web vitest | 21 files / 89 tests | 21 files / 89 tests, all green |

## Traceability matrix (FR-IAM-7)

| Requirement / exit-gate item | Result | Evidence |
|---|---|---|
| Every admin user-management endpoint requires @RequiresPermission | Pass | UsersController lines 33-81; users-admin.e2e-spec.ts permission-gating block (403 for zero-role user on all 6 routes, 401 unauthenticated before any check) |
| Tenant Admin can use every endpoint | Pass | Real HTTP list/get/create/update/delete/replaceRoles against two real tenants this session, plus e2e suite |
| List with search/sort/paginate | Pass | 04-users-list.png; e2e suite |
| Create user, optional temp password, optional roles, one-time reveal panel | Pass | 05-10 screenshots; e2e create block (5 tests) |
| WEAK_PASSWORD / EMAIL_ALREADY_REGISTERED / ROLE_NOT_FOUND on create | Pass | e2e suite |
| Update profile fields + isActive toggle; USER_INACTIVE on subsequent login | Pass | e2e suite |
| Role assignment reflected by RBAC engine | Pass | 11-member-after-login.png, 12-member-direct-users-url.png (fresh Member login has no Users nav, route guard blocks direct URL) |
| LAST_ADMIN_PROTECTED on role-replace and delete | Pass | e2e suite |
| Hard delete; user_role cascades; id becomes unresolvable | Pass | e2e suite + direct SQL check |
| Soft-reference-on-delete convention genuinely sound | Pass (judged the proof genuine, not speculation - see notes) | user-display-resolver.service.ts; users-admin.e2e-spec.ts lines 418-459 |
| Tenant scoping / cross-tenant isolation | Pass | Tenant B session sees only its own user; fetching Tenant A's user id from Tenant B returns 404 |
| Realm correctness (tenant vs platform) | Pass | JWT payload typ/aud inspected; cross-realm token use rejected 401 both directions |
| nexus-ux consulted before building | Pass | UX_GUIDELINES.md section 4; screenshots match spec (list columns, role multi-select system-role annotation, password reveal a11y) |
| Real-browser smoke test | Pass | screenshots 01-12, zero console errors |
| Claimed create-user CSS layout fix | Pass, fix holds - see notes | 06-user-create-filled.png vs. follow-up realistic-typing screenshot |

## Notes on the CSS-fix re-verification

An initial pass using Playwright's fill() API showed an apparent floating-label/value
overlap in the create-user form. Before reporting this as a regression of nexus-dev's
claimed fix, the form was re-driven using realistic character-by-character typing (the
event sequence a real user produces), which showed every label floating correctly with
no overlap. Concluded the fill()-observed overlap was a test-tooling artifact (an
instant, non-standard value-set that doesn't trigger the same input-event sequence
Angular Material's floating label depends on), not a reproducing product defect. The
self-reported fix holds under genuine user-like interaction.

## Non-blocking observations (not required before advancing)

1. There is still no automated platform/tenant migration-runner in this build (expected -
   Dev-10/BL-21 is a later, not-yet-started phase). To stand up a real browser session
   this pass, QA had to run the platform schema's migrations manually via a throwaway
   script, mirroring the pattern the project's own e2e suites already use. Not a Dev-6b
   defect.
2. The production web bundle is 651.99 kB against Angular's default 650 kB initial-bundle
   budget (1.99 kB over) - a cosmetic build warning only, no functional impact.

## Defects

None found. No blocking or non-blocking defects attributable to Dev-6b's implementation.

## Overall verdict

Dev-6b is QA-green. All automated suite numbers reproduced exactly; permission gating,
tenant scoping, role-assignment-to-RBAC reflection, soft-reference-on-delete, and realm
correctness were all independently verified against a live MySQL instance and (for the
UI) a real Chromium browser, not merely re-run from nexus-dev's own harness. Ready to
advance to Dev-7.
