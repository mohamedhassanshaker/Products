import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { InvalidTenantSlugError, assertValidSlugShape } from "../../../tenancy/tenant-slug.js";
import type { TenantSlug } from "../../../tenancy/tenant-slug.js";
import { SqlStoreProvisioner, type RawSqlExecutor } from "./sql-store-provisioner.js";

/**
 * Tests for the SQL Server limb of provisioning.
 *
 * The decision logic is what is under test — which script runs, in which order, and which
 * schema state is refused. Statement *text* is covered in `sql-script.test.ts`, and the
 * scripts themselves are exercised against a real SQL Server by the integration suite;
 * neither belongs in a pre-commit run.
 *
 * The assertions worth reading are the two refusals. `create` refuses a schema holding
 * *some* of the expected tables, because Prisma's DDL carries no existence guards and a
 * blind replay would fail on the first table that exists while repairing nothing — that is
 * the migration orchestrator's job (RB-07). And `verify` refuses a schema that exists but
 * is empty, because a bare schema resolves a connection string and would hand out a
 * working handle onto nothing.
 *
 * Covers FR-PLAT-02 and FR-PLAT-04.
 */

const SEWA = assertValidSlugShape("sewa");
const SCRIPT_DIR = resolve(process.cwd(), "prisma", "sql");

const TEMPLATE_TABLES = 3;

const MIGRATION_SQL = [
  "CREATE TABLE [platform].[Tenants] ([slug] VARCHAR(30) NOT NULL);",
  "CREATE TABLE [tenant_template].[Agents] ([id] CHAR(26) NOT NULL);",
  "CREATE TABLE [tenant_template].[Teams] ([id] CHAR(26) NOT NULL);",
  "CREATE TABLE [tenant_template].[AuditLogEntries] ([id] CHAR(26) NOT NULL);",
].join("\n");

/** A registered `platform.Tenants` row, as `ensureTenantProfile`'s `queryRow` sees it. */
interface FakeTenantRegistration {
  readonly id: string;
  readonly displayName: string;
  readonly entityKind: string;
  readonly dataResidency: string;
}

/**
 * A fake executor that reports table counts from a mutable map, so a test can put the
 * schema in the exact state it wants to assert against.
 */
class FakeSql implements RawSqlExecutor {
  readonly executed: string[] = [];
  /** Schema name -> table count. Absent means the schema does not exist. */
  readonly schemas = new Map<string, number>([["tenant_template", TEMPLATE_TABLES]]);
  /**
   * `platform.Tenants` rows `ensureTenantProfile` can read back, keyed by slug — standing in
   * for what `TenantRegistry.register()` would already have written in production by the
   * time `SqlStoreProvisioner.create()` runs (`ProvisionTenant.execute()`'s own ordering).
   */
  readonly tenantRegistrations = new Map<string, FakeTenantRegistration>([
    [
      "sewa",
      {
        id: "01SEWAFAKEPLATFORMTENANT01",
        displayName: "Sharjah Electricity, Water & Gas Authority",
        entityKind: "GovernmentEntity",
        dataResidency: "UaeSharjahDc",
      },
    ],
  ]);
  /** Schema name -> whether its `TenantProfiles` singleton row has been written. */
  readonly tenantProfiles = new Set<string>();
  /** The parameters of the most recent `TenantProfiles` insert, for assertions. */
  lastTenantProfileInsert: readonly unknown[] | null = null;
  /** Set to make the next `execute` throw, standing in for a store failure. */
  failOn: string | null = null;

  async execute(sql: string): Promise<void> {
    if (this.failOn !== null && sql.includes(this.failOn)) {
      throw new Error("store failure");
    }
    this.executed.push(sql);

    // The real `000_tenant_schema.sql` creates the schema; the fake mirrors that so the
    // count queries that follow see a schema with no tables, as they would in reality.
    const created = /IF NOT EXISTS \(SELECT 1 FROM sys\.schemas WHERE name = N'(\w+)'\)/.exec(sql);
    if (created?.[1] !== undefined && sql.includes("CREATE SCHEMA")) {
      if (!this.schemas.has(created[1])) this.schemas.set(created[1], 0);
    }

    // Tables appear as the DDL is replayed, which is what makes the second `create` see a
    // fully built schema — the state whose handling is the idempotency contract.
    const table = /CREATE TABLE \[(\w+)\]\.\[/.exec(sql);
    if (table?.[1] !== undefined) {
      this.schemas.set(table[1], (this.schemas.get(table[1]) ?? 0) + 1);
    }
  }

  async executeParameterized(sql: string, ...params: readonly unknown[]): Promise<void> {
    this.executed.push(sql);
    const insert = /INSERT INTO \[(\w+)\]\.\[TenantProfiles\]/.exec(sql);
    if (insert?.[1] !== undefined) {
      this.tenantProfiles.add(insert[1]);
      this.lastTenantProfileInsert = params;
    }
  }

  async queryRow(
    sql: string,
    ...params: readonly string[]
  ): Promise<Record<string, unknown> | null> {
    if (sql.includes("[platform].[Tenants]")) {
      const row = this.tenantRegistrations.get(params[0] ?? "");
      return row ? { ...row } : null;
    }
    return null;
  }

  async countScalar(sql: string, ...params: readonly string[]): Promise<number> {
    if (sql.includes("TenantProfiles")) {
      // The schema name is interpolated into the query text here (identifier position,
      // same as every DDL script), not bound — extracted back out for the fake's own state.
      const schema = /\[(\w+)\]\.\[TenantProfiles\]/.exec(sql)?.[1] ?? "";
      return this.tenantProfiles.has(schema) ? 1 : 0;
    }
    const name = params[0] ?? "";
    if (sql.includes("sys.schemas WHERE name")) return this.schemas.has(name) ? 1 : 0;
    return this.schemas.get(name) ?? 0;
  }

  count(fragment: string): number {
    return this.executed.filter((sql) => sql.includes(fragment)).length;
  }
}

async function migrationsDirWith(sql: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "shj3-migrations-"));
  await mkdir(join(root, "20260101000000_init"), { recursive: true });
  await writeFile(join(root, "20260101000000_init", "migration.sql"), sql, "utf8");
  return root;
}

function forge(value: string): TenantSlug {
  return value as unknown as TenantSlug;
}

let sql: FakeSql;
let migrationsDir: string;

beforeEach(async () => {
  sql = new FakeSql();
  migrationsDir = await migrationsDirWith(MIGRATION_SQL);
});

function provisioner(): SqlStoreProvisioner {
  return new SqlStoreProvisioner({ sql, scriptDir: SCRIPT_DIR, migrationsDir });
}

describe("SqlStoreProvisioner", () => {
  it("declares the Sql store, which is what orders it first in PROVISIONING_STORES", () => {
    expect(provisioner().store).toBe("Sql");
  });

  it("refuses a slug the type system claims is validated", async () => {
    // The schema name reaches identifier position, so the re-assertion has to happen on
    // the way in rather than being trusted from the brand.
    await expect(provisioner().create(forge("sewa]; DROP SCHEMA platform --"))).rejects.toThrow(
      InvalidTenantSlugError,
    );
    expect(sql.executed).toHaveLength(0);
  });
});

describe("create", () => {
  it("creates the schema, replays the tenant DDL, then constrains and grants it", async () => {
    await provisioner().create(SEWA);

    const order = sql.executed.map((statement) => {
      if (statement.includes("CREATE SCHEMA")) return "schema";
      if (statement.includes("[sewa].[Agents]")) return "ddl";
      if (statement.includes("CK_")) return "constraints";
      if (statement.includes("GRANT") || statement.includes("DENY")) return "grants";
      return "other";
    });

    expect(order.indexOf("schema")).toBe(0);
    expect(order.indexOf("ddl")).toBeLessThan(order.indexOf("constraints"));
    expect(order.indexOf("constraints")).toBeLessThan(order.indexOf("grants"));
  });

  it("replays only the tenant half of the migration history", async () => {
    await provisioner().create(SEWA);

    expect(sql.count("CREATE TABLE [sewa].[Agents]")).toBe(1);
    // The platform half has already been applied once, against `platform`.
    expect(sql.count("CREATE TABLE [platform].[Tenants]")).toBe(0);
  });

  it("is idempotent: a second run skips the DDL and re-applies the idempotent scripts", async () => {
    await provisioner().create(SEWA);
    const firstRun = sql.executed.length;
    sql.executed.length = 0;

    await provisioner().create(SEWA);

    // Re-running is how RB-11 repairs a schema whose constraints or grants were lost, so
    // those must re-apply — but the DDL must not be replayed over existing tables.
    expect(sql.count("CREATE TABLE [sewa].[Agents]")).toBe(0);
    expect(sql.count("CK_")).toBeGreaterThan(0);
    expect(sql.executed.length).toBeLessThan(firstRun);
  });

  it("refuses a partially built schema and names the runbook that can fix it", async () => {
    sql.schemas.set("sewa", 1);

    await expect(provisioner().create(SEWA)).rejects.toThrow(/RB-07/);
    expect(sql.count("CREATE TABLE [sewa].[Agents]")).toBe(0);
  });

  it("refuses when the template schema has never been migrated", async () => {
    // Provisioning from an unmigrated template would produce an empty schema that
    // `verify` then rejects — a confusing failure two steps away from its cause.
    sql.schemas.set("tenant_template", 0);

    await expect(provisioner().create(SEWA)).rejects.toThrow(/no per-tenant DDL to replay/);
  });

  it("refuses when there is no migration history to replay", async () => {
    const empty = await mkdtemp(join(tmpdir(), "shj3-empty-"));
    const withoutHistory = new SqlStoreProvisioner({
      sql,
      scriptDir: SCRIPT_DIR,
      migrationsDir: empty,
    });

    await expect(withoutHistory.create(SEWA)).rejects.toThrow(/no migration.sql/);
  });

  it("propagates a store failure rather than continuing to the grants", async () => {
    sql.failOn = "[sewa].[Agents]";

    await expect(provisioner().create(SEWA)).rejects.toThrow("store failure");
    expect(sql.count("GRANT")).toBe(0);
  });
});

describe("create: TenantProfiles singleton (B-2 — TR_Teams_crossEntityScope's precondition)", () => {
  it("creates the singleton row, deriving isPlatformTenant from the registered entityKind", async () => {
    await provisioner().create(SEWA);

    expect(sql.tenantProfiles.has("sewa")).toBe(true);
    const params = sql.lastTenantProfileInsert;
    expect(params).not.toBeNull();
    // [ulid, tenantId, slug, displayName, isPlatformTenant, dataResidency, now] — see
    // ensureTenantProfile's own VALUES clause ordering.
    expect(params?.[2]).toBe("sewa");
    expect(params?.[3]).toBe("Sharjah Electricity, Water & Gas Authority");
    expect(params?.[4]).toBe(false); // GovernmentEntity, not PlatformOperator
  });

  it("derives isPlatformTenant: true for a PlatformOperator-kind tenant", async () => {
    sql.tenantRegistrations.set("sharjah", {
      id: "01SHARJAHFAKEPLATFORMOP01",
      displayName: "Sharjah (Platform)",
      entityKind: "PlatformOperator",
      dataResidency: "UaeSharjahDc",
    });

    await provisioner().create(forge("sharjah"));

    expect(sql.lastTenantProfileInsert?.[4]).toBe(true);
  });

  it("is idempotent: a second create() does not insert a second singleton row", async () => {
    await provisioner().create(SEWA);
    sql.lastTenantProfileInsert = null;

    await provisioner().create(SEWA);

    expect(sql.lastTenantProfileInsert).toBeNull();
    expect(sql.count("INSERT INTO [sewa].[TenantProfiles]")).toBe(1);
  });

  it("refuses when no platform.Tenants row is registered for the slug", async () => {
    // Every real call path registers via TenantRegistry.register() first
    // (ProvisionTenant.execute()'s own ordering) — an unregistered slug here means that
    // ordering was violated, and the honest failure names it rather than inserting a
    // TenantProfiles row with fabricated content.
    await expect(provisioner().create(forge("unregisteredslug"))).rejects.toThrow(
      /no registered platform\.Tenants row/,
    );
  });
});

describe("destroy", () => {
  it("runs the drop script for the tenant's schema", async () => {
    await provisioner().create(SEWA);
    sql.executed.length = 0;

    await provisioner().destroy(SEWA);

    expect(sql.count("DROP TABLE")).toBeGreaterThan(0);
    expect(sql.count("DROP SCHEMA [sewa]")).toBe(1);
  });

  it("names only the tenant's own schema, never another", async () => {
    await provisioner().destroy(SEWA);

    expect(sql.executed.some((statement) => statement.includes("N'sewa'"))).toBe(true);
    // No other schema is named anywhere in the generated drops.
    expect(sql.executed.some((statement) => statement.includes("[platform]"))).toBe(false);
    expect(sql.executed.some((statement) => statement.includes("N'platform'"))).toBe(false);
  });

  it("tolerates a schema that was never created", async () => {
    // Rollback runs after a failure and cannot assume what got created.
    await expect(provisioner().destroy(SEWA)).resolves.toBeUndefined();
  });
});

describe("verify", () => {
  it("is false when the schema does not exist", async () => {
    expect(await provisioner().verify(SEWA)).toBe(false);
  });

  it("is false when the schema exists but is empty", async () => {
    // The state this check exists for: a bare schema resolves a connection string, so
    // `getTenantDb()` would hand out a working handle onto nothing and every query for
    // that government entity would fail at the first table.
    sql.schemas.set("sewa", 0);

    expect(await provisioner().verify(SEWA)).toBe(false);
  });

  it("is false when the schema holds fewer tables than the template", async () => {
    sql.schemas.set("sewa", TEMPLATE_TABLES - 1);

    expect(await provisioner().verify(SEWA)).toBe(false);
  });

  it("is true when the schema matches the template's shape", async () => {
    await provisioner().create(SEWA);
    sql.schemas.set("sewa", TEMPLATE_TABLES);

    expect(await provisioner().verify(SEWA)).toBe(true);
  });

  it("reads the expected count from the template rather than a constant", async () => {
    // The template *is* the definition of a tenant's shape (ADR-0005). A constant here
    // would drift from it the first time a model was added.
    sql.schemas.set("sewa", 7);
    sql.schemas.set("tenant_template", 7);

    expect(await provisioner().verify(SEWA)).toBe(true);
  });

  it("is false after destroy, which is what confirms the rollback", async () => {
    sql.schemas.set("sewa", TEMPLATE_TABLES);
    expect(await provisioner().verify(SEWA)).toBe(true);

    sql.schemas.delete("sewa");
    expect(await provisioner().verify(SEWA)).toBe(false);
  });
});
