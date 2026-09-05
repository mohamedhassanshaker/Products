# QA Report - Dev-10 (BL-21: Sequential Migration Rollout Mechanism) -- Retry 1

Date: 2026-08-09
Scope: Re-verification of nexus-dev's fix for the single blocking defect reported in
qa-results/dev-10/REPORT.md (Defect #1: MySQL DDL auto-commit leaves partial DDL committed on a
late-statement migration failure while the runner falsely reports appliedMigrations: []/pending).
This is retry 1 of 3 for Dev-10.

Environment: Dedicated, freshly provisioned MySQL 8.4 Docker container
(qa-dev10-retry1-mysql, 127.0.0.1:3310), independent of the developer's persistent container and
of the original QA pass's container. Container, all created schemas, and my own scratch scripts
(qa-repro-retry1.ts, qa-repro-retry1b.ts) removed after the run.

## Verdict: NOT READY -- one new blocking defect found (different from, but caused by, the fix for the original Defect #1)

## Summary

The originally-reported Defect #1 (partial DDL committed + misleading Failed/appliedMigrations:
[] report) is genuinely fixed: independently reproducing the original repro technique in a
form that causes a real, first-time DDL failure (a type-incompatible column forcing the final
ALTER TABLE to fail with a genuine MySQL error) now correctly reports PartiallyApplied,
names the real committed objects, halts a halt-on-error batch, and a subsequent retry against the same
tenant (after fixing the root cause) completes cleanly with Succeeded and the correct final
schema (all 3 tables + fk_user_edu pointing at education_level). Full unit (104/815) and e2e
(22/212) suite numbers reproduced exactly.

However, independently reproducing the literal original repro technique (pre-occupying the
fk_user_edu constraint name against the wrong target table, role, before the migration is
ever attempted) surfaced a new correctness defect introduced by the idempotency fix itself: the
migration's information_schema.TABLE_CONSTRAINTS existence check only checks the constraint
name, not what it actually references. When a constraint literally named fk_user_edu already
exists but points at the wrong table, the migration's guard treats this as "already applied," skips
the real ALTER TABLE ... ADD CONSTRAINT entirely, and the migration is recorded as fully
Succeeded -- but the real, correct foreign key to education_level is never created, and
nothing in the report or the migrations table gives any signal that anything is wrong. This
directly violates this QA pass's own instructed check #3 ("confirm the idempotent migration still
produces the CORRECT final schema... idempotency should not have silently skipped something that
should exist").

## Independent verification performed

1. Reinstalled deps; npm run typecheck/lint clean across all 3 workspaces.
2. Unit tests, dedicated MySQL 8.4 container: 104 suites / 815 tests, matching nexus-dev's
   self-report exactly. tenant-migration-runner.service.ts at 98.9/89.47/100/98.76%
   stmt/branch/func/line, matching self-report.
3. E2E tests (--runInBand, live MySQL 8.4): 22 suites / 212 tests, all green, matching
   nexus-dev's self-report exactly, including the new PartiallyApplied describe block in
   test/tenant-migration-runner.e2e-spec.ts (real fixture: type-incompatible column forces a
   genuine 4th-statement failure, asserts PartiallyApplied, verifies the 3 committed tables via
   information_schema, then fixes the fault and reruns the same migration against the same
   tenant, confirming a clean Succeeded retry with the FK correctly created).
4. Independent reproduction, exact original repro technique (own script, not reusing
   nexus-dev's test): provisioned a real tenant schema via TenantsService.create() against my own
   dedicated MySQL container, applied only CreateRbacTables1730000000002, then pre-occupied
   fk_user_edu as a real FK from user.education_level_id to role.id (the exact original Defect
   #1 repro technique -- a type-compatible target so the original repro's "Duplicate foreign key
   constraint name" error would fire pre-fix), then called TenantMigrationRunner.runAll() for
   real. Found: the run reports status: "Succeeded", appliedMigrations:
   ["CreateTaxonomyTables1730000000003"], the migrations table has a row for it, all 3 taxonomy
   tables exist -- but fk_user_edu still references role, not education_level (confirmed via
   information_schema.KEY_COLUMN_USAGE.REFERENCED_TABLE_NAME). See Defect #2 below.
5. Confirmed (via nexus-dev's own e2e suite rerun on my container) that the intended fix path --
   a genuine same-migration partial failure with no pre-existing constraint of that name -- correctly
   reports PartiallyApplied and a subsequent retry creates the FK correctly pointing at
   education_level. This is the realistic "retry after a real partial-DDL failure" scenario the
   fix targets, and it works correctly.
6. Spot-checked continue-on-error and dry-run: both reproduced via the full e2e suite rerun,
   matching self-report exactly (continue-on-error genuinely applies DDL to 2 of 3 real schemas and
   correctly skips the seeded-failing one per information_schema; dry-run applies zero DDL while
   still producing a full persisted report). Not independently re-authored this pass since the full
   suite rerun already exercises them against real DDL/information_schema, and the runner's
   core control-flow for these two modes is unchanged by this fix.
7. Did not re-run named-lock concurrency or the CLI entrypoint fresh this pass (both hold
   structurally unchanged code paths untouched by this fix, and were fully verified with disposable
   QA-authored tests in the original Dev-10 QA pass) -- noted per the dispatch's allowance not to
   redo everything from scratch.
8. Checked for stray debug/temp files: none found this time (apps/api/qa-boot.js/qa-logs/
   from the prior two occurrences are not present). Removed my own two scratch reproduction
   scripts (qa-repro-retry1.ts, qa-repro-retry1b.ts) and the dist/coverage/ build artifacts
   my own run produced, after use.

## Defect #2 (BLOCKING, new -- introduced by this fix pass): the fk_user_edu idempotency guard checks constraint name only, not its actual target, so a pre-existing same-named-but-wrong-target constraint causes a silent, falsely-Succeeded migration that never creates the real FK

Requirement: this QA pass's own instructed check #3 -- "Confirm the idempotent migration still
produces the CORRECT final schema (all three tables + the fk_user_edu constraint present and
correct) -- idempotency should not have silently skipped something that should exist." Also
LLD Sec 5's DDL, which specifies fk_user_edu as education_level_id -> education_level(id).

What was tested: 1730000000003-create-taxonomy-tables.ts's existence check before the ALTER
TABLE ... ADD CONSTRAINT fk_user_edu is:

    SELECT COUNT(*) AS cnt FROM information_schema.TABLE_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'user' AND CONSTRAINT_NAME = 'fk_user_edu'

This only checks that a constraint with that literal name exists -- not that it references
education_level(id). I pre-created a real fk_user_edu constraint pointing at role(id) instead
(type-compatible, so it succeeds), then ran the migration for real.

What actually happened: the migration's guard saw cnt > 0, skipped the ALTER TABLE entirely,
and the migration was recorded as fully Succeeded with appliedMigrations:
["CreateTaxonomyTables1730000000003"] and a migrations table row -- but fk_user_edu still
references role, not education_level. Nothing in the report, the persisted
tenant_migration_run_item row, or the migrations table gives any signal this happened; an
operator has no way to discover this short of manually inspecting information_schema on every
tenant.

Root cause: the idempotency fix's existence checks (this file's up()/down()) verify "a
constraint/table of this name exists" as a proxy for "this migration's effect already happened,"
but never verify the actual referenced table/column match what the migration is trying to create.
This is a sound assumption only if nothing else could ever create a same-named object with
different semantics -- which is not guaranteed (e.g., a prior out-of-band schema hotfix, a
future migration reusing the same name by mistake, or exactly this QA pass's own adversarial
fault-injection technique, which the previous QA pass explicitly established as the phase's
canonical repro vector).

Reproduction steps:
1. Provision a tenant schema with only CreateRbacTables1730000000002 applied.
2. Run ALTER TABLE user ADD CONSTRAINT fk_user_edu FOREIGN KEY (education_level_id) REFERENCES
   role(id) directly against that schema (a real, type-compatible FK to the wrong table).
3. Run TenantMigrationRunner.runAll({ tenantIds: [thatTenantId] }).
4. Observe: status: "Succeeded", appliedMigrations: ["CreateTaxonomyTables1730000000003"], no
   error -- but information_schema.KEY_COLUMN_USAGE shows fk_user_edu's
   REFERENCED_TABLE_NAME is still role, not education_level.

Severity: Blocking, though narrower in real-world likelihood than the original Defect #1 --
this specific pre-condition (an unrelated constraint already occupying the exact reserved name with
the wrong target) is unlikely to occur from ordinary operation, but it is exactly the scenario this
QA pass's own dispatch instruction (item 3) asked to be checked, and it demonstrates the general
existence-check-by-name-only idempotency pattern this fix introduced is not sound: it can silently
mask an incorrect/incomplete schema and report success. Given fk_user_edu is itself the DB-level
backstop for FR-TAX-4 ("referenced by ... User cannot be deleted outright"), a silently-missing or
misdirected FK is a real data-integrity gap, and this class of "guarded idempotent DDL papers over
the wrong thing" bug is exactly the kind of subtle regression a fix for a data-safety defect should
not introduce.

Recommend: extend the existence check to also verify REFERENCED_TABLE_NAME/REFERENCED_COLUMN_NAME
(via information_schema.KEY_COLUMN_USAGE or REFERENTIAL_CONSTRAINTS) match education_level/id,
and treat a name-collision with the wrong target as a hard failure (not a silent skip) so this is
surfaced rather than masked. The three CREATE TABLE IF NOT EXISTS guards do not have this specific
problem in the same way (a wrong-shape pre-existing table would still be caught downstream by
stage's FK-creation statement failing, as nexus-dev's own adjusted fixture for the breakTaxonomy
case demonstrates) -- this is specific to the constraint-existence check.

## Traceability matrix (this retry's scope)

| Item | Scenario(s) tested | Result | Evidence |
|---|---|---|---|
| Defect #1 fix: PartiallyApplied reporting on genuine late-statement failure | nexus-dev e2e fixture rerun + source read | Pass | test/tenant-migration-runner.e2e-spec.ts rerun, information_schema |
| Defect #1 fix: retry-from-partial-state is safe and produces correct schema | same suite, genuine partial-failure path | Pass | information_schema (education_level/stage/subject + fk_user_edu -> education_level after retry) |
| QA item 1: real MySQL 8.4, late-statement failure, halt-on-error | nexus-dev suite rerun on my container | Pass | information_schema |
| QA item 2: fix fault + retry same migration/tenant, no collision | nexus-dev suite rerun + my own script (genuine-failure path) | Pass | information_schema, migrations table |
| QA item 3: idempotent migration produces CORRECT final schema | my own independent script, exact original repro technique (name-collision, wrong target) | FAIL | information_schema.KEY_COLUMN_USAGE -- Defect #2 |
| QA item 4: continue-on-error / dry-run spot-check | full e2e suite rerun | Pass | information_schema, persisted report rows |
| QA item 5: full unit+e2e suite reproduction | test:cov (104/815), test:e2e --runInBand (22/212) | Pass | matches self-report exactly |
| QA item 6: stray debug/temp files | directory listing | Pass (none found) | apps/api/ root listing |

## Non-blocking observations

- None new this pass beyond Defect #2 above.

## Recommendation for nexus-dev retry

Harden the fk_user_edu existence check (and, for full rigor, consider whether any future
constraint-guard migrations should follow the same pattern) to verify the referenced
table/column, not just the constraint name, e.g.:

    SELECT COUNT(*) AS cnt FROM information_schema.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'user' AND CONSTRAINT_NAME = 'fk_user_edu'
      AND REFERENCED_TABLE_NAME = 'education_level' AND REFERENCED_COLUMN_NAME = 'id'

If a constraint by that name exists but references something else, that is itself an inconsistent
state the migration should surface as a real failure (not silently skip), so an operator is forced
to resolve the naming collision rather than getting an incorrect silent Succeeded.
