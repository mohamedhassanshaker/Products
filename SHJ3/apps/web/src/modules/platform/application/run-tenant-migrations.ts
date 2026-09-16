/**
 * Apply a migration to every tenant schema.
 *
 * Implements FR-PLAT-05. The orchestrator behind `pnpm db:migrate` and RB-07.
 *
 * Prisma owns the schema and all migrations (ADR-0005), but Prisma has no notion
 * of applying one migration N times under different schema names — the tenant
 * set is dynamic, created as government entities are onboarded. So the sequencing,
 * per-tenant status tracking and resumability live here.
 *
 * ## Ordering
 *
 * The `platform` schema migrates first and separately. Tenant schemas reference
 * platform tables (the tenant registry, staff accounts), so a tenant migration
 * that depends on a new platform column must find it already there.
 *
 * ## Fail-fast in production
 *
 * `stopAfterFailures` defaults to 1 in production: if a migration breaks on the
 * first tenant it will break on all of them, and stopping leaves N-1 entities
 * untouched and recoverable rather than N broken. In development it runs to
 * completion so a developer sees every failure at once.
 *
 * The subtlety worth stating: a stopped run is **not** a success. It leaves
 * tenants at different schema versions, which is precisely RISK-014, so the
 * summary reports `notAttempted` and `isRunComplete` is false. Deploys are gated
 * on completeness, not on the absence of errors.
 */

import {
  MigrationChecksumConflictError,
  findSchemaDivergence,
  isRunComplete,
  planMigration,
  type MigrationDefinition,
  type MigrationPlanEntry,
  type MigrationRunSummary,
  type TenantMigrationRecord,
} from "../domain/migration.js";
import type { AuditActor, AuditSink, Clock } from "../ports/provisioning.js";

export interface MigrationExecutor {
  /** Apply the platform-schema migration. Runs once, before any tenant. */
  applyToPlatform(migration: MigrationDefinition): Promise<void>;
  /**
   * Apply the migration to one tenant's schema.
   *
   * Must be idempotent: resumption re-runs anything not recorded `Applied`, and
   * a run that died between the DDL and the status write is indistinguishable
   * from one that never started.
   */
  applyToTenant(tenantSlug: string, migration: MigrationDefinition): Promise<void>;
  /**
   * Compare a tenant's live schema shape against the expected one.
   *
   * Catches drift a status table cannot see — a schema hand-fixed so it merely
   * "looks applied". Called after each apply, because a status row is a claim and
   * the schema is the fact.
   */
  verifyTenantSchema(tenantSlug: string, migration: MigrationDefinition): Promise<boolean>;
}

export interface MigrationStatusStore {
  listRecords(migrationName: string): Promise<readonly TenantMigrationRecord[]>;
  record(entry: TenantMigrationRecord): Promise<void>;
}

export interface RunTenantMigrationsDeps {
  executor: MigrationExecutor;
  status: MigrationStatusStore;
  /** Active tenants only. A suspended tenant still migrates — its schema must
   *  not fall behind, or reactivating it later would break under current code. */
  listTenantSlugs(): Promise<readonly string[]>;
  audit: AuditSink;
  clock: Clock;
}

export interface RunTenantMigrationsInput {
  migration: MigrationDefinition;
  /** The operator or automated pipeline running this. Recorded on every audit entry. */
  actor: AuditActor;
  environment: string;
  /** 1 in production, Infinity in development. */
  stopAfterFailures?: number;
  /** Print the plan and change nothing. RB-07 step 1: never resume blind. */
  dryRun?: boolean;
}

export class RunTenantMigrations {
  constructor(private readonly deps: RunTenantMigrationsDeps) {}

  /** Compute the plan without executing. Safe to call any time. */
  async plan(migration: MigrationDefinition): Promise<readonly MigrationPlanEntry[]> {
    const [slugs, records] = await Promise.all([
      this.deps.listTenantSlugs(),
      this.deps.status.listRecords(migration.name),
    ]);
    return planMigration(slugs, migration, records);
  }

  async execute(input: RunTenantMigrationsInput): Promise<MigrationRunSummary> {
    const { executor, status, audit, clock } = this.deps;
    const { migration } = input;
    const stopAfter =
      input.stopAfterFailures ?? (input.environment === "production" ? 1 : Infinity);

    const plan = await this.plan(migration);

    // An edited migration is refused before anything runs. Every affected
    // tenant's status row claims success while the schemas may already differ,
    // so this cannot be resolved by retrying — it needs a person.
    const conflicts = plan.filter((entry) => entry.action === "conflict");
    if (conflicts.length > 0) {
      const records = await status.listRecords(migration.name);
      const first = conflicts[0]!;
      const record = records.find((r) => r.tenantSlug === first.tenantSlug);
      await audit.record({
        actor: input.actor,
        action: "migration.run",
        target: { kind: "Migration", labelSnapshot: migration.name },
        summary: `Migration "${migration.name}" refused: checksum conflict for ${conflicts.length} tenant(s).`,
        environmentKey: input.environment,
        after: { reason: "checksum conflict", tenants: conflicts.map((c) => c.tenantSlug) },
      });
      throw new MigrationChecksumConflictError(
        first.tenantSlug,
        migration.name,
        record?.checksum ?? "unknown",
        migration.checksum,
      );
    }

    const applied: string[] = [];
    const skipped: string[] = [];
    const failed: { tenantSlug: string; reason: string }[] = [];
    const notAttempted: string[] = [];
    let stoppedEarly = false;

    if (input.dryRun) {
      return {
        migrationName: migration.name,
        applied: [],
        skipped: plan.filter((e) => e.action === "skip").map((e) => e.tenantSlug),
        failed: [],
        notAttempted: plan.filter((e) => e.action !== "skip").map((e) => e.tenantSlug),
        stoppedEarly: false,
      };
    }

    // Platform first: tenant schemas reference platform tables, so a tenant
    // migration depending on a new platform column must find it already there.
    await executor.applyToPlatform(migration);

    for (const entry of plan) {
      if (entry.action === "skip") {
        skipped.push(entry.tenantSlug);
        continue;
      }

      if (stoppedEarly) {
        notAttempted.push(entry.tenantSlug);
        continue;
      }

      await status.record({
        tenantSlug: entry.tenantSlug,
        migrationName: migration.name,
        status: "Running",
        checksum: migration.checksum,
      });

      try {
        await executor.applyToTenant(entry.tenantSlug, migration);

        // A status row is a claim; the schema is the fact.
        const verified = await executor.verifyTenantSchema(entry.tenantSlug, migration);
        if (!verified) {
          throw new Error(
            "post-apply schema verification failed: the live schema does not match the expected shape",
          );
        }

        await status.record({
          tenantSlug: entry.tenantSlug,
          migrationName: migration.name,
          status: "Applied",
          checksum: migration.checksum,
          appliedAt: clock.now(),
        });
        applied.push(entry.tenantSlug);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        await status.record({
          tenantSlug: entry.tenantSlug,
          migrationName: migration.name,
          status: "Failed",
          checksum: migration.checksum,
          failureReason: reason,
        });
        failed.push({ tenantSlug: entry.tenantSlug, reason });

        if (failed.length >= stopAfter) {
          // Stop rather than break every remaining entity the same way.
          stoppedEarly = true;
        }
      }
    }

    const summary: MigrationRunSummary = {
      migrationName: migration.name,
      applied,
      skipped,
      failed,
      notAttempted,
      stoppedEarly,
    };

    const complete = isRunComplete(summary);
    await audit.record({
      actor: input.actor,
      action: "migration.run",
      target: { kind: "Migration", labelSnapshot: migration.name },
      summary: complete
        ? `Migration "${migration.name}" applied to all ${applied.length + skipped.length} tenant(s).`
        : `Migration "${migration.name}" did not complete: ${failed.length} failed, ${notAttempted.length} not attempted.`,
      environmentKey: input.environment,
      after: {
        applied: applied.length,
        skipped: skipped.length,
        failed: failed.length,
        notAttempted: notAttempted.length,
        stoppedEarly,
      },
    });

    return summary;
  }

  /**
   * Assert every active tenant is at this migration.
   *
   * Called by the deploy script as a precondition. Deploying code that expects a
   * column present for only some government entities produces an outage visible
   * to one entity's citizens and nobody else's — the hardest kind to diagnose.
   */
  async assertNoDivergence(migration: MigrationDefinition): Promise<void> {
    const [slugs, records] = await Promise.all([
      this.deps.listTenantSlugs(),
      this.deps.status.listRecords(migration.name),
    ]);

    const behind = findSchemaDivergence(slugs, migration, records);
    if (behind.length > 0) {
      throw new Error(
        `Refusing to proceed: ${behind.length} of ${slugs.length} tenant(s) are not at migration ` +
          `"${migration.name}" — ${behind.join(", ")}. One image serves every tenant, so deploying ` +
          "now would break the entities that are behind (RISK-014). Resume the migration first (RB-07).",
      );
    }
  }
}
