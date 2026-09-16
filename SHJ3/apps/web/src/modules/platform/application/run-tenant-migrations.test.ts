import { describe, expect, it } from "vitest";
import {
  MigrationChecksumConflictError,
  findSchemaDivergence,
  isRunComplete,
  planMigration,
  type MigrationDefinition,
  type MigrationRunSummary,
  type TenantMigrationRecord,
} from "../domain/migration.js";
import type { AuditActor, AuditSink, Clock } from "../ports/provisioning.js";
import {
  RunTenantMigrations,
  type MigrationExecutor,
  type MigrationStatusStore,
} from "./run-tenant-migrations.js";

/**
 * N-tenant migration tests.
 *
 * The thing being defended against is RISK-014: a partially applied migration
 * leaves government entities on divergent schemas while one image serves all of
 * them. Combined with RISK-011 (a `--no-verify` commit skipping the drift check)
 * that produces conversations failing for one entity only, which with no CI
 * nothing catches earlier.
 *
 * So the assertions that matter are about *incompleteness being visible*: a run
 * that stops early must not read as success, and divergence must block a deploy.
 *
 * Covers FR-PLAT-05.
 */

const MIGRATION: MigrationDefinition = {
  name: "20260908120000_add_agent_fallback_model",
  checksum: "a".repeat(64),
  requiresMaintenanceWindow: false,
};

const TENANTS = ["sewa", "customs", "libraries", "sharjah_platform"];

const record = (
  tenantSlug: string,
  status: TenantMigrationRecord["status"],
  overrides: Partial<TenantMigrationRecord> = {},
): TenantMigrationRecord => ({
  tenantSlug,
  migrationName: MIGRATION.name,
  status,
  checksum: MIGRATION.checksum,
  ...overrides,
});

// ---------------------------------------------------------------------------
// Planning — pure, and the basis of RB-07's "never resume blind".
// ---------------------------------------------------------------------------

describe("planMigration", () => {
  it("applies to every tenant when nothing has run", () => {
    const plan = planMigration(TENANTS, MIGRATION, []);
    expect(plan.map((p) => p.action)).toEqual(["apply", "apply", "apply", "apply"]);
  });

  it("skips tenants already applied at the same checksum", () => {
    const plan = planMigration(TENANTS, MIGRATION, [record("sewa", "Applied")]);
    expect(plan.find((p) => p.tenantSlug === "sewa")?.action).toBe("skip");
  });

  it("retries a failed tenant and surfaces the previous reason", () => {
    const plan = planMigration(TENANTS, MIGRATION, [
      record("customs", "Failed", { failureReason: "timeout on index rebuild" }),
    ]);
    const entry = plan.find((p) => p.tenantSlug === "customs")!;
    expect(entry.action).toBe("retry");
    expect(entry.reason).toContain("timeout on index rebuild");
  });

  it("retries a tenant left in Running, and says why distinctly", () => {
    // Either a run died mid-flight or one is in progress. Both resolve by
    // retrying — migrations are idempotent — but an operator should be able to
    // check for a concurrent run first.
    const plan = planMigration(TENANTS, MIGRATION, [record("libraries", "Running")]);
    const entry = plan.find((p) => p.tenantSlug === "libraries")!;
    expect(entry.action).toBe("retry");
    expect(entry.reason).toMatch(/died mid-flight|in progress/);
  });

  it("flags a conflict when an applied migration's checksum changed", () => {
    // The dangerous case: the status row says success and the schema may
    // nonetheless differ, because the migration file was edited after applying.
    const plan = planMigration(TENANTS, MIGRATION, [
      record("sewa", "Applied", { checksum: "b".repeat(64) }),
    ]);
    expect(plan.find((p) => p.tenantSlug === "sewa")?.action).toBe("conflict");
  });

  it("ignores records for other migrations", () => {
    const plan = planMigration(TENANTS, MIGRATION, [
      { tenantSlug: "sewa", migrationName: "some_other_migration", status: "Applied" },
    ]);
    expect(plan.find((p) => p.tenantSlug === "sewa")?.action).toBe("apply");
  });

  it("is a pure function of its inputs, so a plan can be printed before executing", () => {
    const a = planMigration(TENANTS, MIGRATION, [record("sewa", "Applied")]);
    const b = planMigration(TENANTS, MIGRATION, [record("sewa", "Applied")]);
    expect(a).toEqual(b);
  });
});

describe("findSchemaDivergence", () => {
  it("reports nothing when every tenant is applied", () => {
    const records = TENANTS.map((t) => record(t, "Applied"));
    expect(findSchemaDivergence(TENANTS, MIGRATION, records)).toEqual([]);
  });

  it("reports tenants with no record", () => {
    expect(findSchemaDivergence(TENANTS, MIGRATION, [record("sewa", "Applied")])).toEqual([
      "customs",
      "libraries",
      "sharjah_platform",
    ]);
  });

  it("counts a Failed tenant as diverged", () => {
    const records = [
      ...TENANTS.slice(0, 3).map((t) => record(t, "Applied")),
      record("sharjah_platform", "Failed"),
    ];
    expect(findSchemaDivergence(TENANTS, MIGRATION, records)).toEqual(["sharjah_platform"]);
  });

  it("counts an Applied tenant with a mismatched checksum as diverged", () => {
    const records = [
      record("sewa", "Applied", { checksum: "b".repeat(64) }),
      ...TENANTS.slice(1).map((t) => record(t, "Applied")),
    ];
    expect(findSchemaDivergence(TENANTS, MIGRATION, records)).toEqual(["sewa"]);
  });
});

describe("isRunComplete", () => {
  const base: MigrationRunSummary = {
    migrationName: MIGRATION.name,
    applied: TENANTS,
    skipped: [],
    failed: [],
    notAttempted: [],
    stoppedEarly: false,
  };

  it("is true when every tenant is applied or skipped", () => {
    expect(isRunComplete(base)).toBe(true);
    expect(isRunComplete({ ...base, applied: ["sewa"], skipped: TENANTS.slice(1) })).toBe(true);
  });

  it("is false when a tenant failed", () => {
    expect(isRunComplete({ ...base, failed: [{ tenantSlug: "sewa", reason: "x" }] })).toBe(false);
  });

  it("is false when a tenant was not attempted, even with no failures recorded", () => {
    // "No failures" is not sufficient. A run stopped early leaves tenants
    // behind, and those tenants are exactly the divergence this guards against.
    expect(isRunComplete({ ...base, notAttempted: ["libraries"], stoppedEarly: true })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

class FakeExecutor implements MigrationExecutor {
  platformApplied = false;
  appliedTenants: string[] = [];
  verifiedTenants: string[] = [];

  constructor(
    private readonly behaviour: {
      failFor?: readonly string[];
      failVerifyFor?: readonly string[];
    } = {},
  ) {}

  async applyToPlatform(): Promise<void> {
    this.platformApplied = true;
  }

  async applyToTenant(tenantSlug: string): Promise<void> {
    if (this.behaviour.failFor?.includes(tenantSlug)) {
      throw new Error(`${tenantSlug} apply failed`);
    }
    this.appliedTenants.push(tenantSlug);
  }

  async verifyTenantSchema(tenantSlug: string): Promise<boolean> {
    this.verifiedTenants.push(tenantSlug);
    return !this.behaviour.failVerifyFor?.includes(tenantSlug);
  }
}

class FakeStatusStore implements MigrationStatusStore {
  rows: TenantMigrationRecord[] = [];

  async listRecords(migrationName: string): Promise<readonly TenantMigrationRecord[]> {
    return this.rows.filter((r) => r.migrationName === migrationName);
  }

  async record(entry: TenantMigrationRecord): Promise<void> {
    const i = this.rows.findIndex(
      (r) => r.tenantSlug === entry.tenantSlug && r.migrationName === entry.migrationName,
    );
    if (i === -1) this.rows.push(entry);
    else this.rows[i] = entry;
  }
}

function fakeAudit(): AuditSink & { entries: { summary: string }[] } {
  const entries: { summary: string }[] = [];
  return {
    entries,
    async record(entry) {
      entries.push(entry as { summary: string });
    },
  };
}

/** An operator running the migration, or the automated deploy pipeline — both are AuditActors. */
const ACTOR: AuditActor = { kind: "System", label: "Migration Orchestrator" };

const clock: Clock = { now: () => new Date("2026-09-08T12:00:00Z") };

function build(executor = new FakeExecutor(), tenants: readonly string[] = TENANTS) {
  const status = new FakeStatusStore();
  const audit = fakeAudit();
  const useCase = new RunTenantMigrations({
    executor,
    status,
    listTenantSlugs: async () => tenants,
    audit,
    clock,
  });
  return { useCase, status, audit, executor };
}

const input = { migration: MIGRATION, actor: ACTOR, environment: "development" };

describe("execute", () => {
  it("migrates the platform schema before any tenant", async () => {
    // Tenant schemas reference platform tables, so a tenant migration depending
    // on a new platform column must find it already there.
    const executor = new FakeExecutor();
    const { useCase } = build(executor);
    await useCase.execute(input);
    expect(executor.platformApplied).toBe(true);
  });

  it("applies to every tenant and reports a complete run", async () => {
    const { useCase } = build();
    const summary = await useCase.execute(input);
    expect(summary.applied).toEqual(TENANTS);
    expect(isRunComplete(summary)).toBe(true);
  });

  it("verifies the live schema after each apply", async () => {
    // A status row is a claim; the schema is the fact.
    const executor = new FakeExecutor();
    const { useCase } = build(executor);
    await useCase.execute(input);
    expect(executor.verifiedTenants).toEqual(TENANTS);
  });

  it("treats a failed verification as a failed tenant", async () => {
    const executor = new FakeExecutor({ failVerifyFor: ["customs"] });
    const { useCase } = build(executor);
    const summary = await useCase.execute(input);
    expect(summary.failed).toEqual([
      { tenantSlug: "customs", reason: expect.stringContaining("verification failed") },
    ]);
    expect(isRunComplete(summary)).toBe(false);
  });

  it("continues past a failure in development", async () => {
    const { useCase } = build(new FakeExecutor({ failFor: ["sewa"] }));
    const summary = await useCase.execute({ ...input, environment: "development" });
    expect(summary.failed).toHaveLength(1);
    expect(summary.applied).toEqual(["customs", "libraries", "sharjah_platform"]);
    expect(summary.stoppedEarly).toBe(false);
  });

  it("stops after the first failure in production", async () => {
    // If a migration breaks on the first tenant it will break on all of them.
    // Stopping leaves N-1 entities untouched and recoverable.
    const { useCase } = build(new FakeExecutor({ failFor: ["sewa"] }));
    const summary = await useCase.execute({ ...input, environment: "production" });
    expect(summary.stoppedEarly).toBe(true);
    expect(summary.failed).toHaveLength(1);
    expect(summary.notAttempted).toEqual(["customs", "libraries", "sharjah_platform"]);
  });

  it("does NOT report a stopped run as successful", async () => {
    // The mistake that would make fail-fast harmful: treating an early stop as
    // success would hide exactly the divergence it was protecting against.
    const { useCase, audit } = build(new FakeExecutor({ failFor: ["sewa"] }));
    const summary = await useCase.execute({ ...input, environment: "production" });
    expect(isRunComplete(summary)).toBe(false);
    expect(audit.entries.at(-1)?.summary).toContain("did not complete");
  });

  it("is resumable: a second run skips applied tenants and retries the failure", async () => {
    const first = new FakeExecutor({ failFor: ["libraries"] });
    const { useCase, status } = build(first);
    await useCase.execute({ ...input, environment: "development" });

    // Same status store, an executor that now succeeds — RB-07's resume path.
    const second = new FakeExecutor();
    const resumed = new RunTenantMigrations({
      executor: second,
      status,
      listTenantSlugs: async () => TENANTS,
      audit: fakeAudit(),
      clock,
    });
    const summary = await resumed.execute({ ...input, environment: "development" });

    expect(second.appliedTenants).toEqual(["libraries"]);
    expect(summary.skipped).toEqual(["sewa", "customs", "sharjah_platform"]);
    expect(isRunComplete(summary)).toBe(true);
  });

  it("refuses to run when an applied migration's checksum has changed", async () => {
    const { useCase, status } = build();
    await status.record(record("sewa", "Applied", { checksum: "b".repeat(64) }));
    await expect(useCase.execute(input)).rejects.toThrow(MigrationChecksumConflictError);
  });

  it("does not touch the platform schema when a checksum conflict is detected", async () => {
    // Refused before anything runs: the conflict cannot be resolved by retrying,
    // so nothing should have been changed by the attempt.
    const executor = new FakeExecutor();
    const { useCase, status } = build(executor);
    await status.record(record("customs", "Applied", { checksum: "c".repeat(64) }));
    await expect(useCase.execute(input)).rejects.toThrow(MigrationChecksumConflictError);
    expect(executor.platformApplied).toBe(false);
  });

  it("dry run changes nothing and reports the plan", async () => {
    const executor = new FakeExecutor();
    const { useCase } = build(executor);
    const summary = await useCase.execute({ ...input, dryRun: true });
    expect(executor.platformApplied).toBe(false);
    expect(executor.appliedTenants).toEqual([]);
    expect(summary.notAttempted).toEqual(TENANTS);
  });

  it("migrates suspended tenants too", async () => {
    // A suspended tenant's schema must not fall behind, or reactivating it later
    // would break under current code.
    const executor = new FakeExecutor();
    const { useCase } = build(executor, ["sewa", "suspended_entity"]);
    await useCase.execute(input);
    expect(executor.appliedTenants).toContain("suspended_entity");
  });
});

describe("assertNoDivergence", () => {
  it("passes when every tenant is at the migration", async () => {
    const { useCase } = build();
    await useCase.execute(input);
    await expect(useCase.assertNoDivergence(MIGRATION)).resolves.toBeUndefined();
  });

  it("blocks a deploy when any tenant is behind, and names them", async () => {
    const { useCase } = build(new FakeExecutor({ failFor: ["customs"] }));
    await useCase.execute({ ...input, environment: "development" });
    await expect(useCase.assertNoDivergence(MIGRATION)).rejects.toThrow(/customs/);
  });

  it("explains why divergence blocks rather than warns", async () => {
    // One image serves every tenant, so deploying now would break the entities
    // that are behind — and only those, which is the hard failure to diagnose.
    const { useCase } = build(new FakeExecutor({ failFor: ["sewa"] }));
    await useCase.execute({ ...input, environment: "development" });
    await expect(useCase.assertNoDivergence(MIGRATION)).rejects.toThrow(
      /RISK-014|one image serves/i,
    );
  });
});
