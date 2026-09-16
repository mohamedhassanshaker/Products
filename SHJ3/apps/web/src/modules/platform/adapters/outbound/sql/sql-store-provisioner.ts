/**
 * SQL Server limb of tenant provisioning — RB-09 step 1, RB-10 reverse step 1, RB-11
 * checks 2 and 3.
 *
 * Implements `StoreProvisioner` for the `"Sql"` store: the tenant's schema, the
 * per-tenant DDL replayed into it, the constraints Prisma cannot declare, and the grants
 * that are the actual access control (ADR-0005 rule 5).
 *
 * ## Why this is the one adapter that does its own work
 *
 * SQL Server is written by `shj3-web` (ADR-0003's ownership table) and its schema is
 * owned by Prisma (ADR-0005), both of which live here. The Neo4j and Qdrant limbs are
 * HTTP calls into `shj3-ai` because those stores belong to it; Redis is written by both.
 * So the four provisioners are deliberately asymmetric, and this is the one that holds a
 * database handle.
 *
 * ## Idempotency, and the one state it refuses
 *
 * `create` must be re-runnable — RB-09 is resumable and an operator will re-run it. Two
 * of the three states are handled structurally: an absent schema is created and populated,
 * and a fully populated schema skips straight to the constraints and grants, both of which
 * are written to be idempotent.
 *
 * The third state — a schema holding *some* of the expected tables — is refused rather
 * than repaired. Prisma's emitted DDL carries no `IF NOT EXISTS` guards, so a blind replay
 * would fail on the first table that already exists and leave the schema exactly as
 * broken as it was. Repairing it correctly needs the per-migration status table and the
 * resumable orchestrator (`RunTenantMigrations`, RB-07), not a provisioning run. Refusing
 * with that instruction is the honest answer; guessing is how one entity ends up on a
 * different schema version from the rest (RISK-014).
 *
 * That state is only reachable if `destroy` also failed, which is RB-10 residue and
 * already demands a human.
 *
 * ## No new client
 *
 * Everything here goes through `getPlatformDb()`. Constructing a `PrismaClient` outside
 * `tenant-db.ts` is refused by the `no-unscoped-store-clients` gate (ADR-0002 rule 3),
 * and `getPlatformDb()` already carries the platform-scope check that makes this one of
 * the two audited cross-tenant paths — which is precisely what provisioning is.
 */

import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { ProvisioningStore } from "../../../domain/tenant.js";
import type { StoreProvisioner } from "../../../ports/provisioning.js";
import type { TenantSlug } from "../../../tenancy/tenant-slug.js";
import { getPlatformDb } from "./tenant-db.js";
import { PRISMA_MIGRATIONS_DIR, PRISMA_SQL_DIR } from "./prisma-root.js";
import { newUlid } from "./ulid.js";
import {
  TEMPLATE_SCHEMA,
  safeSchemaName,
  splitBatches,
  substituteSchema,
  tenantSection,
  tenantTemplateStatements,
} from "./sql-script.js";

/** Provisioning scripts, applied in this order. */
const SCHEMA_SCRIPT = "000_tenant_schema.sql";
const CONSTRAINTS_SCRIPT = "001_constraints.sql";
const GRANTS_SCRIPT = "002_tenant_grants.sql";
const DROP_SCRIPT = "003_tenant_drop.sql";

/** Prisma writes one `migration.sql` per timestamped directory. */
const MIGRATION_FILE = "migration.sql";

const OPERATION = "tenant provisioning (sql)";

/**
 * The narrow slice of raw SQL access this adapter needs.
 *
 * Extracted as an interface for one reason worth stating: it makes the decision logic
 * above — which script runs, in which order, and which schema state is refused — testable
 * without a container, while the real implementation stays the only thing that touches
 * Prisma. Statement *text* is tested separately in `sql-script.test.ts`.
 */
export interface RawSqlExecutor {
  /** Run one batch. DDL, so no result set and nothing to bind. */
  execute(sql: string): Promise<void>;
  /**
   * Run one parameterized, non-query statement (`@P1`, `@P2`, … in `sql`) with bound
   * values. Needed wherever a statement carries free-text content — a tenant's
   * `displayName`, for instance — that must never be inlined as a SQL literal the way
   * `execute()`'s pre-built DDL text is.
   */
  executeParameterized(sql: string, ...params: readonly unknown[]): Promise<void>;
  /** Run a query whose single row has a single column aliased `value`. */
  countScalar(sql: string, ...params: readonly string[]): Promise<number>;
  /**
   * Run a query returning at most one row, as a plain object keyed by column alias — null
   * when nothing matches. For a provisioning decision that needs more than one `COUNT(*)`
   * scalar, such as reading a tenant's own registered `displayName`/`entityKind`/
   * `dataResidency` to seed its `TenantProfiles` singleton.
   */
  queryRow(sql: string, ...params: readonly string[]): Promise<Record<string, unknown> | null>;
}

const prismaExecutor: RawSqlExecutor = {
  async execute(sql) {
    await getPlatformDb(OPERATION).$executeRawUnsafe(sql);
  },

  async executeParameterized(sql, ...params) {
    await getPlatformDb(OPERATION).$executeRawUnsafe(sql, ...params);
  },

  async queryRow(sql, ...params) {
    const rows = (await getPlatformDb(OPERATION).$queryRawUnsafe(sql, ...params)) as Record<
      string,
      unknown
    >[];
    return rows[0] ?? null;
  },

  async countScalar(sql, ...params) {
    // Cast rather than a type argument: the generated client types `$queryRawUnsafe`
    // loosely, and a type argument on it is rejected until `prisma generate` has run — so
    // the annotation would make this file's compilation depend on generation order.
    // `COUNT(*)` is an `int`, but the connector can surface it as a bigint, hence the union
    // and the `Number()` below.
    const rows = (await getPlatformDb(OPERATION).$queryRawUnsafe(sql, ...params)) as {
      value: number | bigint;
    }[];
    const first = rows[0];
    if (first === undefined) {
      throw new Error(
        `A COUNT query returned no rows while ${OPERATION}. The connection is not usable.`,
      );
    }
    return Number(first.value);
  },
};

/**
 * Counting queries.
 *
 * The schema name is bound as a parameter here, not interpolated — `sys.schemas.name` is
 * a value, unlike the identifier position the DDL scripts need, so the safe mechanism is
 * available and is used.
 */
const COUNT_SCHEMA = "SELECT COUNT(*) AS value FROM sys.schemas WHERE name = @P1";
const COUNT_TABLES =
  "SELECT COUNT(*) AS value FROM sys.tables t " +
  "JOIN sys.schemas s ON s.schema_id = t.schema_id WHERE s.name = @P1";

export interface SqlStoreProvisionerOptions {
  readonly sql?: RawSqlExecutor;
  /** Where the provisioning scripts live. Defaults to the repo root's `prisma/sql`
   *  (`prisma-root.ts`'s `PRISMA_SQL_DIR`), resolved independently of `process.cwd()`. */
  readonly scriptDir?: string;
  /**
   * Prisma's migration history — the source of the per-tenant DDL (ADR-0005).
   *
   * A directory rather than a file because the tenant schema is built from the *whole*
   * history, in order, exactly as RB-09's `--from-zero` run does. deployment.md §5.2
   * copies these artefacts into the image so the provisioning path and the migration Job
   * replay identical text.
   */
  readonly migrationsDir?: string;
}

export class SqlStoreProvisioner implements StoreProvisioner {
  readonly store: ProvisioningStore = "Sql";

  private readonly sql: RawSqlExecutor;
  private readonly scriptDir: string;
  private readonly migrationsDir: string;

  constructor(options: SqlStoreProvisionerOptions = {}) {
    this.sql = options.sql ?? prismaExecutor;
    this.scriptDir = options.scriptDir ?? PRISMA_SQL_DIR;
    this.migrationsDir = options.migrationsDir ?? PRISMA_MIGRATIONS_DIR;
  }

  async create(tenant: TenantSlug): Promise<void> {
    const schema = safeSchemaName(tenant);

    await this.applyScript(SCHEMA_SCRIPT, tenant);

    const [tableCount, templateCount] = await Promise.all([
      this.countTables(schema),
      this.countTables(TEMPLATE_SCHEMA),
    ]);

    if (templateCount === 0) {
      throw new Error(
        `The ${TEMPLATE_SCHEMA} schema holds no tables, so there is no per-tenant DDL to ` +
          "replay. Prisma owns the schema (ADR-0005) and emits that DDL once against the " +
          "template — run the platform migration first, then provision.",
      );
    }

    if (tableCount === 0) {
      await this.applyTemplateDdl(tenant);
    } else if (tableCount !== templateCount) {
      throw new Error(
        `Schema "${schema}" already holds ${tableCount} of the ${templateCount} expected ` +
          "tables. Provisioning will not replay DDL over a partially built schema — Prisma's " +
          "emitted statements carry no existence guards, so a replay would fail on the first " +
          "table that exists and repair nothing. Resume through the migration orchestrator " +
          "(RB-07), or remove the residue via RB-10 and provision a clean schema.",
      );
    }

    // Both are written to be idempotent, so they are re-applied unconditionally — which
    // makes a re-run repair a schema whose constraints or grants were lost, rather than
    // skipping past it.
    await this.applyTenantConstraints(tenant);
    await this.applyScript(GRANTS_SCRIPT, tenant);
    await this.ensureTenantProfile(tenant, schema);
  }

  async destroy(tenant: TenantSlug): Promise<void> {
    await this.applyScript(DROP_SCRIPT, tenant);
  }

  /**
   * Prove the schema exists **and** is correctly shaped.
   *
   * Existence alone is not provisioning: a bare schema resolves a connection string and
   * would let `getTenantDb()` hand out a working handle onto nothing, so every query for
   * that government entity would fail at the first table. The expected table count is read
   * from `tenant_template` rather than hardcoded, because the template *is* the definition
   * of a tenant's shape (ADR-0005) and a constant here would drift from it silently.
   *
   * Also the post-destroy check: after RB-10 the schema is gone, so this returns false and
   * the rollback is confirmed rather than assumed.
   */
  async verify(tenant: TenantSlug): Promise<boolean> {
    const schema = safeSchemaName(tenant);

    const schemaCount = await this.sql.countScalar(COUNT_SCHEMA, schema);
    if (schemaCount === 0) return false;

    const [tableCount, templateCount] = await Promise.all([
      this.countTables(schema),
      this.countTables(TEMPLATE_SCHEMA),
    ]);

    return tableCount > 0 && tableCount === templateCount;
  }

  private async countTables(schema: string): Promise<number> {
    return this.sql.countScalar(COUNT_TABLES, schema);
  }

  private async applyScript(fileName: string, tenant: TenantSlug): Promise<void> {
    const source = await readFile(join(this.scriptDir, fileName), "utf8");
    await this.runBatches(substituteSchema(source, tenant));
  }

  private async applyTenantConstraints(tenant: TenantSlug): Promise<void> {
    const source = await readFile(join(this.scriptDir, CONSTRAINTS_SCRIPT), "utf8");
    await this.runBatches(substituteSchema(tenantSection(source), tenant));
  }

  /**
   * Create the tenant's own `TenantProfiles` singleton row if it does not already exist.
   *
   * **A real, pre-existing gap, found and fixed here rather than merely worked around in
   * the B-2 seed script.** `TenantProfile`'s own doc comment says this row is "kept in sync
   * by the provisioning path and by `TR_Tenants_syncProfiles`" — but `TR_Tenants_syncProfiles`
   * only *updates* an existing row on a later `platform.Tenants` change (see its own comment
   * in `001_constraints.sql`); nothing created the row in the first place. Confirmed by
   * grepping every call site before this fix: no `tenantProfile.create` existed anywhere in
   * this codebase outside `tests/isolation/sql.spec.ts`'s own hand-built fixture (always
   * `isPlatformTenant: false`, since that suite never needs the AllEntities case). Without
   * this, `TR_Teams_crossEntityScope` could never legitimately admit an AllEntities-scoped
   * team for *any* tenant — including the platform operator's own — because the row its
   * `WHERE isPlatformTenant = 1` clause looks for would never exist. That is exactly B9 tab
   * 2's "Platform -> All entities" row, so this had to be fixed at the root (provisioning),
   * not patched around in the seed script alone.
   *
   * Idempotent, matching `create()`'s own re-runnable contract (constraints/grants above are
   * re-applied unconditionally on every call, including a resumed run) — checked by a
   * `COUNT` against the singleton key rather than an `IF NOT EXISTS` guard inline in the
   * `INSERT`, since `RawSqlExecutor.execute`/`executeParameterized` carry no result set to
   * branch on.
   *
   * Reads the registered `platform.Tenants` row through `this.sql.queryRow` — the same
   * `RawSqlExecutor` seam every other decision in this class goes through, deliberately not
   * `getPlatformDb()`'s typed client directly, which would reach past the interface this
   * class's own header comment names as the thing that "makes the decision logic ... testable
   * without a container" and silently require a real database in `sql-store-provisioner.test.ts`'s
   * fake-backed suite.
   */
  private async ensureTenantProfile(tenant: TenantSlug, schema: string): Promise<void> {
    const existing = await this.sql.countScalar(
      `SELECT COUNT(*) AS value FROM [${schema}].[TenantProfiles] WHERE singletonKey = 1`,
    );
    if (existing > 0) return;

    const tenantRow = await this.sql.queryRow(
      "SELECT id, displayName, entityKind, dataResidency FROM [platform].[Tenants] WHERE slug = @P1",
      tenant,
    );
    if (!tenantRow) {
      throw new Error(
        `Cannot create the TenantProfiles row for "${tenant}": no registered platform.Tenants ` +
          "row was found. TenantRegistry.register() must run before the SQL store's create() " +
          "step — which is always true through ProvisionTenant.execute()'s own ordering.",
      );
    }

    const now = new Date();
    await this.sql.executeParameterized(
      `INSERT INTO [${schema}].[TenantProfiles] ` +
        "(id, singletonKey, tenantId, slug, displayName, isPlatformTenant, dataResidency, createdAt, updatedAt) " +
        "VALUES (@P1, 1, @P2, @P3, @P4, @P5, @P6, @P7, @P7)",
      newUlid(now),
      String(tenantRow.id),
      tenant,
      String(tenantRow.displayName),
      // `entityKind` is the one source of truth for this flag (§4.1) — the platform
      // operator's own tenant is the only one `TR_Teams_crossEntityScope` may ever admit
      // an AllEntities-scoped team for.
      tenantRow.entityKind === "PlatformOperator",
      String(tenantRow.dataResidency),
      now,
    );
  }

  private async runBatches(sql: string): Promise<void> {
    // Sequential, not parallel: a later batch routinely depends on an object an earlier
    // one created, and `GO` exists precisely to mark that ordering.
    for (const batch of splitBatches(sql)) {
      await this.sql.execute(batch);
    }
  }

  /**
   * Replay the whole migration history's tenant half into this tenant's schema.
   *
   * Statement-at-a-time rather than batched: these statements come from Prisma, not from a
   * `GO`-separated script, and each is independent.
   */
  private async applyTemplateDdl(tenant: TenantSlug): Promise<void> {
    const migrations = await this.readMigrationHistory();
    for (const migration of migrations) {
      for (const statement of tenantTemplateStatements(migration, tenant)) {
        await this.sql.execute(statement);
      }
    }
  }

  private async readMigrationHistory(): Promise<readonly string[]> {
    let entries;
    try {
      entries = await readdir(this.migrationsDir, { withFileTypes: true });
    } catch {
      throw new Error(
        `No Prisma migration history at "${this.migrationsDir}". The per-tenant DDL comes from ` +
          "that history (ADR-0005) — generate it with Prisma Migrate before provisioning a tenant.",
      );
    }

    // Prisma names migration directories with a leading timestamp, so lexical order is
    // chronological order. Applying them out of order would build a schema that never
    // existed.
    const directories = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();

    const sources: string[] = [];
    for (const directory of directories) {
      try {
        sources.push(await readFile(join(this.migrationsDir, directory, MIGRATION_FILE), "utf8"));
      } catch {
        // A directory without a migration.sql is not a migration — Prisma also keeps
        // `migration_lock.toml` alongside them.
        continue;
      }
    }

    if (sources.length === 0) {
      throw new Error(
        `"${this.migrationsDir}" contains no ${MIGRATION_FILE}. There is no per-tenant DDL to ` +
          "replay, so a provisioned schema would be empty — which `verify` would then reject.",
      );
    }
    return sources;
  }
}
