/**
 * N-tenant migration domain.
 *
 * Schema-per-tenant (ADR-0002) means a migration is not one operation — it is N,
 * once per Sharjah government entity, against one shared codebase. That changes
 * the failure model completely, and the change is the reason this module exists
 * rather than a single `prisma migrate deploy`.
 *
 * ## The failure that matters
 *
 * A partially applied migration leaves tenants on **divergent schemas** while a
 * single deployed image serves all of them (RISK-014). Worse, it compounds with
 * RISK-011: if a `--no-verify` commit also skipped the Prisma→SQLAlchemy drift
 * check, `shj3-ai` ends up reading columns that exist for some entities and not
 * others. The symptom is conversations failing for one government entity only —
 * which is a genuinely hard thing to diagnose from a support ticket, and with no
 * CI (ADR-0008) nothing catches it earlier.
 *
 * So the design goals here are, in order:
 *
 *   1. **Never leave divergence undetected.** Per-tenant status with checksums,
 *      and an equality assertion that gates deploys.
 *   2. **Be resumable.** An operator will re-run this after a failure (RB-07),
 *      so a completed tenant must be skipped rather than reapplied.
 *   3. **Fail fast in production.** Stop after the first failure rather than
 *      breaking every remaining tenant the same way.
 *
 * No vendor imports (architecture.md §4) — the orchestration logic is pure, so
 * it is tested against fakes and run against real schemas unchanged.
 */

export type TenantMigrationStatus = "Pending" | "Running" | "Applied" | "Failed" | "Skipped";

export interface MigrationDefinition {
  /** Ordered identifier, e.g. `20260908120000_add_agent_fallback_model`. */
  readonly name: string;
  /**
   * Checksum of the migration's SQL.
   *
   * Recorded per tenant so an *edited* migration is detectable. A migration
   * whose content changed after being applied somewhere is the quiet version of
   * schema divergence: every status row says `Applied`, and the schemas differ.
   */
  readonly checksum: string;
  /** True when the migration cannot run without exclusive access. */
  readonly requiresMaintenanceWindow: boolean;
}

export interface TenantMigrationRecord {
  readonly tenantSlug: string;
  readonly migrationName: string;
  readonly status: TenantMigrationStatus;
  readonly checksum?: string;
  readonly appliedAt?: Date;
  readonly failureReason?: string;
}

export interface MigrationPlanEntry {
  readonly tenantSlug: string;
  readonly action: "apply" | "skip" | "retry" | "conflict";
  readonly reason: string;
}

export class MigrationChecksumConflictError extends Error {
  constructor(
    readonly tenantSlug: string,
    readonly migrationName: string,
    readonly recorded: string,
    readonly current: string,
  ) {
    super(
      `Migration "${migrationName}" was already applied to tenant "${tenantSlug}" with a different checksum ` +
        `(recorded ${recorded.slice(0, 12)}…, current ${current.slice(0, 12)}…). ` +
        "An applied migration has been edited, which means tenant schemas may already differ " +
        "while every status row claims success. Do not proceed: create a new migration instead of " +
        "editing an applied one, and reconcile the affected schemas by hand.",
    );
    this.name = "MigrationChecksumConflictError";
  }
}

/**
 * Decide what to do for each tenant, given what has already happened.
 *
 * This is the resumability logic, and it is deliberately a pure function of
 * (tenants, migration, existing records) so that "what will this run do?" can be
 * answered — and asserted — before anything is executed. RB-07's first
 * instruction is "see exactly where it stopped; never resume blind", and a
 * printable plan is what makes that possible.
 */
export function planMigration(
  tenantSlugs: readonly string[],
  migration: MigrationDefinition,
  records: readonly TenantMigrationRecord[],
): readonly MigrationPlanEntry[] {
  const byTenant = new Map(
    records
      .filter((r) => r.migrationName === migration.name)
      .map((r) => [r.tenantSlug, r] as const),
  );

  return tenantSlugs.map((tenantSlug) => {
    const record = byTenant.get(tenantSlug);

    if (!record) {
      return { tenantSlug, action: "apply", reason: "no record for this migration" };
    }

    switch (record.status) {
      case "Applied":
        // A checksum mismatch on an applied migration is the dangerous case:
        // the status says success and the schema may nonetheless differ.
        if (record.checksum && record.checksum !== migration.checksum) {
          return {
            tenantSlug,
            action: "conflict",
            reason: "already applied with a different checksum — the migration has been edited",
          };
        }
        return { tenantSlug, action: "skip", reason: "already applied" };

      case "Failed":
        return {
          tenantSlug,
          action: "retry",
          reason: `previous attempt failed: ${record.failureReason ?? "unknown"}`,
        };

      case "Running":
        // Either a run is in flight or a previous one died mid-flight. Both are
        // resolved by retrying, because the migrations themselves are written to
        // be idempotent — but it is surfaced distinctly so an operator can check
        // for a concurrent run before proceeding.
        return {
          tenantSlug,
          action: "retry",
          reason: "left in Running — a previous run died mid-flight, or one is in progress now",
        };

      case "Pending":
      case "Skipped":
        return { tenantSlug, action: "apply", reason: `previously ${record.status.toLowerCase()}` };
    }
  });
}

/**
 * Whether every active tenant sits at the same migration.
 *
 * This is the predicate that gates a deploy. One image serves every tenant, so
 * deploying code that expects a column which exists for only some of them is
 * how RISK-014 becomes a citizen-visible outage for one government entity.
 */
export function findSchemaDivergence(
  tenantSlugs: readonly string[],
  migration: MigrationDefinition,
  records: readonly TenantMigrationRecord[],
): readonly string[] {
  const applied = new Set(
    records
      .filter(
        (r) =>
          r.migrationName === migration.name &&
          r.status === "Applied" &&
          (!r.checksum || r.checksum === migration.checksum),
      )
      .map((r) => r.tenantSlug),
  );
  return tenantSlugs.filter((slug) => !applied.has(slug));
}

export interface MigrationRunSummary {
  readonly migrationName: string;
  readonly applied: readonly string[];
  readonly skipped: readonly string[];
  readonly failed: readonly { tenantSlug: string; reason: string }[];
  readonly notAttempted: readonly string[];
  readonly stoppedEarly: boolean;
}

/**
 * A run succeeded only if every tenant is now at this migration.
 *
 * "No failures" is not sufficient: a run stopped early leaves tenants
 * `notAttempted`, and those tenants are exactly the divergence this module
 * exists to prevent. Treating a fail-fast stop as success is the mistake that
 * would make the safety mechanism harmful.
 */
export function isRunComplete(summary: MigrationRunSummary): boolean {
  return summary.failed.length === 0 && summary.notAttempted.length === 0;
}
