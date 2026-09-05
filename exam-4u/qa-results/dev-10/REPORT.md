# QA Report - Dev-10 (BL-21: Sequential Migration Rollout Mechanism)

Date: 2026-08-09
Scope: Dev-10 only (BL-21, FR-MT-5, HLD Sec 4.5/8.9). No UI (backend/CLI only).
Environment: Dedicated, freshly provisioned MySQL 8.4 Docker container (qa-dev10-mysql,
127.0.0.1:3309), independent of the developer's persistent examland-mysql container and of the
prior qa-dev9c-mysql container. All containers/schemas/temp files removed after the run.

## Verdict: NOT READY - one blocking defect

## Summary

nexus-dev's self-report (104 suites/813 unit tests, 22 e2e suites/211 tests) was independently
reproduced exactly on a clean container. All of nexus-dev's own e2e assertions for continue-on-error,
halt-on-error, dry-run, and real-DataSource entity registration pass and are genuinely proven against
real DDL/information_schema, not mocks. However, independent QA-authored tests (not present in
nexus-dev's suite) found that transaction:'each' does not actually provide the rollback guarantee
the HLD documents and this phase's exit gate implies, because MySQL's DDL statements issue an
implicit commit -- a genuine mid-migration failure (as opposed to a first-statement failure, which is
all nexus-dev's own suite ever tests) leaves partially-applied DDL in the tenant schema while the
report claims appliedMigrations: [] and the migration remains "pending" -- a state a retry cannot
recover from without manual intervention.

## Independent verification performed

1. Reinstalled deps, typecheck/lint clean across all 3 workspaces.
2. Unit tests, dedicated MySQL 8.4 container: 104 suites / 813 tests passed,
   92.52/80.12/88.31/92.61% stmt/branch/func/line aggregate - exact match to nexus-dev's self-report.
3. E2E tests: first run with default (parallel) Jest workers produced 10 failing suites purely from
   afterAll hook timeouts under my single small container's resource contention (not a product
   defect - confirmed by rerunning with --runInBand: 22/22 suites, 211/211 tests, all green,
   including tenant-migration-runner.e2e-spec.ts's continue-on-error/halt-on-error/dry-run/
   real-DataSource-registration suite). Recommend noting this container-resource sensitivity for
   future QA passes (not an action item for nexus-dev).
4. Real-DataSource entity registration (Dev-9a-QA-lesson class): confirmed via nexus-dev's own
   NestFactory.create(AppModule)-based suite, rerun on my container - TenantMigrationRunEntity/
   TenantMigrationRunItemEntity resolve with zero EntityMetadataNotFoundError. Also independently
   confirmed both are present in PLATFORM_ENTITIES (platform-data-source.ts) by direct grep.
5. Continue-on-error / halt-on-error / dry-run: re-ran nexus-dev's real-DB e2e suite (3+ real
   tenant schemas, one genuinely seeded to fail via a pre-created shape-incompatible education_level
   table) on my own container and confirmed all information_schema-based assertions pass exactly as
   self-reported. Holds.
6. Named-lock-per-tenant concurrency (independent test, not in nexus-dev's suite): fired two
   simultaneous runner.runAll({ tenantIds: [sameTenant] }) calls at the same tenant. Result: exactly
   one of the two runs applied the migration (appliedMigrations.length summed to 1 across both), both
   reported Succeeded, and information_schema confirmed the schema ended up with exactly the
   correct final table set (no double-application, no corruption). Holds - TenantMigrationLockService's
   GET_LOCK-per-schema design genuinely serializes concurrent runners.
7. CLI entrypoint (npm run migrate:tenants): independently provisioned a fresh platform schema plus
   one real tenant schema (RBAC migration pre-applied, taxonomy migration pending) outside of any test
   harness, then ran the actual `npm run migrate:tenants -- --mode=continue-on-error --tenant=<id>`
   command as a real subprocess. It booted via the real NestFactory.createApplicationContext path,
   applied the real pending migration, printed a correct JSON report to stdout, and exited 0. Holds.
8. transaction:'each' mid-migration consistency - FAILS. See Defect #1 below.

## Defect #1 (BLOCKING): transaction:'each' does not roll back earlier DDL in the same migration
when a later statement in that migration fails, and the runner's report actively misrepresents the
result as "nothing applied"

Requirement: HLD Sec 4.5 specifies dataSource.runMigrations({ transaction: 'each' }) specifically so
that "a migration that fails partway through leaves the tenant schema in a consistent state" (this
QA pass's explicit charge #6, and the spirit of FR-MT-5's "sequential-apply-and-rollback procedure").

What was tested: CreateTaxonomyTables1730000000003 has 4 raw DDL statements: CREATE TABLE
education_level, CREATE TABLE stage, CREATE TABLE subject, then ALTER TABLE user ADD CONSTRAINT
fk_user_edu .... nexus-dev's own e2e suite only ever seeds a first-statement failure (a
pre-existing incompatible education_level table), which trivially "rolls back" nothing because
nothing had run yet. I instead pre-occupied the constraint name the migration's 4th (last)
statement tries to create (ALTER TABLE user ADD CONSTRAINT fk_user_edu FOREIGN KEY
(education_level_id) REFERENCES role(id), using the tenant schema's own pre-existing, type-compatible
role table), so the first 3 CREATE TABLE statements genuinely execute before the real 4th statement
fails with MySQL's own "Duplicate foreign key constraint name 'fk_user_edu'" error.

What actually happened: education_level, stage, and subject were left behind as real tables
in the tenant schema (confirmed via information_schema.TABLES), and the schema's migrations table
correctly has no row for CreateTaxonomyTables1730000000003 (matching TypeORM's "only inserts the
migrations-table row on full success" behavior). However, TenantMigrationRunner's report for this
tenant was:

    {
      "status": "Failed",
      "appliedMigrations": [],
      "pendingMigrations": ["CreateTaxonomyTables1730000000003"],
      "error": "Duplicate foreign key constraint name 'fk_user_edu'"
    }

This is doubly wrong: (a) the schema is NOT in a consistent pre-migration state - 3 real tables
now exist that didn't before - contradicting the "transactional per-migration" guarantee HLD Sec 4.5
documents; and (b) the report claims appliedMigrations: []/fully "pending", actively misleading an
operator into believing nothing happened and a retry is safe, when in fact a retry of this exact
tenant will now permanently fail with a different, confusing error (Table 'education_level'
already exists) on the first statement, since the migration always starts from statement 1 - this is
a real operational trap requiring manual DBA intervention (dropping the orphaned tables) to unstick,
exactly the "guessing which tenants already received the change" scenario FR-MT-5 says the mechanism
exists to eliminate.

Root cause: MySQL's DDL statements (CREATE TABLE, ALTER TABLE, etc.) each issue an implicit
COMMIT in InnoDB - MySQL has no transactional DDL. Wrapping multiple raw DDL statements in one
TypeORM "migration transaction" (transaction: 'each') cannot undo already-committed DDL once a later
statement in the same migration fails; TypeORM's transaction: 'each' option only genuinely provides
atomicity for migrations whose statements are DML or for database engines with transactional DDL
(e.g., PostgreSQL) - it is not a general MySQL guarantee, and neither the HLD nor nexus-dev's
Dev-10 delivery documents this MySQL-specific limitation or works around it (e.g., by requiring
single-DDL-statement-per-migration-file as a hard convention, or by adding a repair/cleanup step for
partially-applied migrations).

Reproduction steps:
1. Provision a tenant schema with only CreateRbacTables1730000000002 applied (leaves
   CreateTaxonomyTables1730000000003 pending).
2. Run `ALTER TABLE user ADD CONSTRAINT fk_user_edu FOREIGN KEY (education_level_id) REFERENCES
   role(id)` directly against that schema (pre-occupies the constraint name the pending migration's
   last statement will try to create).
3. Run TenantMigrationRunner.runAll({ tenantIds: [thatTenantId] }) (or npm run migrate:tenants
   --tenant=<id>).
4. Observe: the item reports status: 'Failed', appliedMigrations: [], pendingMigrations:
   ['CreateTaxonomyTables1730000000003'] - but information_schema.TABLES for that schema now
   contains education_level, stage, and subject (real DDL, not a partial/corrupt table).
5. Fix the root cause (drop the pre-existing fk_user_edu constraint) and rerun the same migration -
   it now fails again, this time with `Table 'education_level' already exists`, because the first 3
   statements' effects were never rolled back and the migration always restarts from statement 1.

Severity: Blocking. This directly undermines FR-MT-5/HLD Sec 4.5's core safety promise for any
tenant migration with more than one DDL statement (the norm, not the exception - the very migration
used as this phase's own test fixture has 4), and the report's appliedMigrations: [] claim is
actively incorrect, not merely incomplete, which is worse than no report at all for an operator
deciding whether a retry is safe.

Not exercised by nexus-dev's own suite because its only seeded failure is a first-statement
failure (nothing to roll back either way), which cannot reveal this class of bug.

## Traceability matrix

| Requirement | Scenario(s) tested | Result | Evidence |
|---|---|---|---|
| FR-MT-5 sequential/halt-on-error | halt-on-error batch stop, later tenant never touched | Pass | tenant-migration-runner.e2e-spec.ts rerun, information_schema |
| FR-MT-5 continue-on-error | 3 real schemas, 1 genuinely seeded to fail | Pass | same suite, information_schema + persisted report rows |
| FR-MT-5 dry-run + summary | zero DDL applied, full report incl. dry-run | Pass | same suite, information_schema |
| HLD Sec 4.5 named-lock-per-tenant | 2 concurrent runAll() at same tenant | Pass | QA-authored test (removed after run), information_schema |
| HLD Sec 4.5 transaction:'each' consistency | genuine mid-migration (4th-statement) failure | FAIL | QA-authored test (removed after run), information_schema - Defect #1 |
| Dev-9a-QA-lesson: real-DataSource entity registration | NestFactory.create(AppModule) boot, both repos | Pass | nexus-dev's suite, rerun |
| CLI entrypoint (npm run migrate:tenants) | real subprocess run against a real pending tenant | Pass | manual run, stdout report + exit code 0 |
| Unit/e2e suite reproduction | full test:cov + test:e2e | Pass (numbers match self-report) | see above |

## Non-blocking observations

- Stray debug artifacts found and removed: apps/api/qa-boot.js and apps/api/qa-logs/ (two
  dated log files) were present in the repo at the start of this QA pass - leftovers from a prior
  session (same pattern flagged after Dev-9c's QA pass). Removed as part of this pass's cleanup; no
  further action needed, but worth a process reminder for whichever agent leaves ad-hoc bootstrap
  scripts in apps/api/ root instead of a scratch directory.
- Running the e2e suite with Jest's default parallel workers against a small/low-resource MySQL
  container produces spurious afterAll hook timeouts (10 of 22 suites) purely from resource
  contention; --runInBand (or a bigger container) resolves this. Not a product defect, but future QA
  passes on constrained sandboxes should default to --runInBand for this repo's e2e suite.

## Recommendation for nexus-dev's retry

Options to close Defect #1 (any one, or a combination, would satisfy the requirement):
1. Enforce (and lint/CI-check) a hard convention that every tenant migration file contains at most
   one DDL statement, so transaction:'each''s partial-failure case can never leave orphaned
   objects - the "additive-safe" convention HLD Sec 4.5 already documents extends naturally to this.
2. Add a pre-flight/post-failure reconciliation step that inspects information_schema for
   objects the failed migration would have created and drops them before recording Failed
   (restoring true consistency) - more complex, higher risk of its own bugs.
3. At minimum, fix the report itself to not claim appliedMigrations: [] when partial DDL was
   actually committed - even if full rollback isn't feasible for MySQL, the report must not
   misrepresent reality, since that is what FR-MT-5 exists to prevent ("does not require guessing
   which tenants already received the change").

Given CreateTaxonomyTables1730000000003 itself already has 4 statements, option 1 would require
splitting it into 4 separate migration files as well, so retrofitting existing migrations is in scope
for whichever fix nexus-dev chooses.
