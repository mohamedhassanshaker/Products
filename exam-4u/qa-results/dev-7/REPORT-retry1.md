# QA Report - Dev-7 retry 1 (re-verification of the Defect 1 fix)

Retry 1 of 3 for Dev-7 (BL-07: registration settings, tenant-branded email, Google sign-in, tenant
brand theming / FR-MT-10). Scope: independently re-verify nexus-dev's fix for the sole blocking
defect reported in qa-results/dev-7/REPORT.md (Defect 1 - a run_migrations-phase migration that
inserted tenant.settings.manage durably even for a permanently-Failed tenant, breaking Dev-2's
"a permanently-Failed tenant has no seeded RBAC data at all" invariant). Not a re-audit of Dev-7's
own registration/Google/branding functionality, which was already found correct in the original pass
(spot-checked per instruction via the branding e2e suite rerun below).

## Environment

- Fresh, dedicated mysql:8.4 Docker container (qa-dev7retry1-mysql, port-mapped 33071:3306), not
  reused from any prior session or the developer's persistent database. Destroyed after this run
  (docker rm -f); no leftover container or schema.
- Dependencies reinstalled (npm install) in the actual working tree, not trusting any pre-existing
  node_modules.
- All suites run against NODE_ENV=test/staging (matching each suite's own beforeAll setup) via a real
  Test.createTestingModule({ imports: [AppModule] }) + platformDataSource.runMigrations(), the same
  real bootstrap path the project's own e2e suites use.

## Independent verification performed

1. Source read confirmed apps/api/src/infrastructure/database/migrations/tenant/index.ts no longer
   references AddTenantSettingsManagePermission1730000000003; TENANT_MIGRATIONS is now
   [CreateRbacTables1730000000002] only. The migration file itself is genuinely deleted from src
   (only stale, regenerated coverage/dist build artifacts from a prior build still mention it, not
   live source).
2. tenant.settings.manage is now seeded exclusively by SeedRbacStep: confirmed by reading
   apps/api/src/tenancy/provisioning/steps/seed-rbac.step.ts, the permission is in the PERMISSIONS
   list, subject to the same transactional per-step seeding as every other permission.
3. Grepped the whole apps/api tree for TENANT_MIGRATIONS and the deleted migration class name. The
   only remaining live-code reference is test/tenant-registry-cross-schema.e2e-spec.ts, which imports
   TENANT_MIGRATIONS dynamically and compares migration name lists with no hardcoded count, so it
   self-corrects and needed no update. No other file hardcodes a migration count or list length.
4. A dedicated, self-authored real-DB integration spec (written independently, run then deleted, not
   left in the repo) directly proved, via raw parameterized SQL against the tenant schema (not via
   the application's own registry/service layer):
   - Golden path: a freshly provisioned, real tenant (via TenantProvisioningService, the real
     workflow, not hand-inserted rows) reaches Active with exactly 29 rows in permission,
     tenant.settings.manage present by name, and granted to Tenant Admin (role_permission join
     count = 1). Console-logged evidence: "QA-RETRY1 golden-path permission count: 29" and
     "QA-RETRY1 tenant.settings.manage present + granted count: 1 1".
   - Permanent failure: SeedRbacStep overridden to always reject (matching nexus-dev's own
     technique) - the provisioning call rejects with TenantProvisioningFailedError, the tenant lands
     Failed, and a direct SQL SELECT COUNT(*) FROM permission against that tenant's real schema
     returns exactly 0 - the precise invariant that was broken before the fix, now genuinely
     holding. Console-logged evidence: "QA-RETRY1 permanent-failure dangling permission-row count: 0".
5. Reran provisioning-workflow.e2e-spec.ts in isolation: 4/4 tests pass (happy path, already-Active
   retry rejection, idempotency-retry-from-Failed, permanent-failure). The permanent-failure
   scenario's own expect(permissionCount[0].n).toBe(0) assertion genuinely passes now. The two
   updated literal counts (28 to 29) in the happy-path and idempotency-retry scenarios pass.
6. Reran tenant-branding-registration-google.e2e-spec.ts in isolation: 15/15 pass, confirming the fix
   did not regress Dev-7's own registration/Google/branding scope (the one spot-check requested,
   since the rest of that scope was already thoroughly verified in the original pass).
7. Full apps/api e2e suite: 16 suites / 134 tests, all green - exact match to nexus-dev's self-report.
   A stray, uncommitted leftover file, apps/api/test/_qa-verify-permission.e2e-spec.ts (evidently an
   artifact left behind by an earlier, interrupted QA attempt at this exact retry, not part of
   nexus-dev's own suite) was present in the working tree at the start of this session and failed
   with an unrelated "Table examland_platform.tenant doesn't exist" error caused by its own
   hardcoded schema name, not a product defect. Deleted as test hygiene; confirmed the real
   16-suite/134-test count is unaffected and exactly matches nexus-dev's claim once that stray file
   is excluded.
8. Full unit suite: npm run test:cov -w apps/api - 76 suites / 562 tests, all green, exact match to
   nexus-dev's self-report; seed-rbac.step.ts confirmed still at 100% stmt/branch/func/line coverage.
9. Static checks: npm run typecheck (3 workspaces) clean; npm run lint clean; npm run build
   (contracts+api+web) clean, same pre-existing 6.10 kB bundle-budget cosmetic warning as before
   (unrelated to this fix, already known/non-blocking).
10. All temporary infrastructure (MySQL container, self-authored verification spec file, the stray
    leftover spec file) removed after the run. No schemas, containers, or test artifacts left behind.

## Traceability matrix (this retry's scope only)

| Item | Scenario | Result | Evidence |
|---|---|---|---|
| Migration genuinely deleted, TENANT_MIGRATIONS no longer references it | Source read + grep across apps/api | Pass | migrations/tenant/index.ts read directly; grep found no other live-code migration-count assumption |
| tenant.settings.manage seeded only via SeedRbacStep, transactional/all-or-nothing | Source read of seed-rbac.step.ts | Pass | PERMISSIONS list includes the entry; no other insertion site |
| Golden path: fresh tenant has exactly 29 permissions incl. tenant.settings.manage, granted to Tenant Admin | Self-authored real-DB e2e spec against a live MySQL 8.4 instance | Pass | console log permission count 29; present+granted count 1 1 |
| Permanent failure: zero dangling permission rows on a tenant that never reaches Active | Self-authored real-DB e2e spec, SeedRbacStep forced to always reject | Pass | console log dangling permission-row count 0 |
| provisioning-workflow.e2e-spec.ts (Dev-2 exit gate) fully green | Reran in isolation | Pass | 4/4 |
| tenant-branding-registration-google.e2e-spec.ts (Dev-7's own scope, spot-check only) | Reran in isolation | Pass | 15/15 |
| Full apps/api e2e suite | Reran in full | Pass | 16 suites/134 tests, matches self-report exactly |
| Full apps/api unit suite | Reran in full | Pass | 76 suites/562 tests, matches self-report exactly |
| typecheck/lint/build | Reran | Pass | all clean |

## Defects

None. No blocking or non-blocking defects found in this retry's scope (the Defect 1 fix). The two
non-blocking UI observations from the original qa-results/dev-7/REPORT.md (decorative accent-preview
button sharing an accessible name with the real submit button; native color-picker swatch not
visually refreshing post-save) were already reported as non-blocking and are out of scope for this
narrowly targeted retry per the orchestrator's instructions - not re-tested here.

## Verdict

Dev-7 retry 1: PASS - QA-green, no blocking defects. The fix for Defect 1 is real and structural
(the migration is deleted, not patched around), independently reproduced against a freshly
provisioned real MySQL 8.4 instance: a golden-path tenant has the correct 29-permission set with
tenant.settings.manage present and granted, and - the specific invariant that was broken - a tenant
that permanently fails provisioning has genuinely zero permission rows in its schema, not the
previously-observed dangling row. All automated suite counts (16 e2e suites/134 tests, 76 unit
suites/562 tests) reproduced exactly. No regression found in Dev-7's own registration/Google/branding
scope. This is retry 1 of 3 for Dev-7.
