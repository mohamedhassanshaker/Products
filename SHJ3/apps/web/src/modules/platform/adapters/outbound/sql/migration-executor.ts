/**
 * The real `MigrationExecutor` (`application/run-tenant-migrations.ts`) — the piece
 * that turns a `MigrationDefinition` (a name + checksum) into actual DDL run against
 * the platform schema once, and against each tenant's own schema in turn.
 *
 * Before this wave, no production implementation of this port existed anywhere in
 * this codebase — only `run-tenant-migrations.test.ts`'s `FakeExecutor` did, and
 * `package.json`'s `db:migrate` script (`node scripts/migrate-tenants.mjs`) refers to
 * a file that does not exist on disk. Building the general migration CLI
 * (`scripts/migrate-tenants.mjs` itself — argument parsing, environment selection,
 * dry-run wiring) is out of scope for the theming backend wave; this is the missing
 * *executor* the CLI would need, built for real because proving this wave's own
 * migration through `RunTenantMigrations` (rather than only through
 * `SqlStoreProvisioner`'s brand-new-tenant path) requires one to exist.
 *
 * ## Reuses `SqlStoreProvisioner`'s own primitives, not a parallel mechanism
 *
 * `applyToTenant` uses the exact same `tenantTemplateStatements()` /
 * `substituteSchema()` / `tenantSection()` functions `sql-store-provisioner.ts`
 * already uses for a brand-new tenant's initial DDL replay — the only difference is
 * *which* migration's `migration.sql` is read (one specific file here, the whole
 * history there) and that the constraints file's tenant section is re-applied
 * unconditionally afterwards (safe because it is fully idempotent by construction —
 * RISK-025), which is what keeps an incrementally-migrated tenant and a
 * freshly-provisioned one converging on the identical end state.
 */

import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { getPlatformDb } from "./tenant-db.js";
import { PRISMA_MIGRATIONS_DIR, PRISMA_SQL_DIR } from "./prisma-root.js";
import {
  safeSchemaName,
  splitBatches,
  substituteSchema,
  tenantSection,
  tenantTemplateStatements,
} from "./sql-script.js";
import type { MigrationExecutor } from "../../../application/run-tenant-migrations.js";
import type { MigrationDefinition } from "../../../domain/migration.js";
import { assertValidSlugShape } from "../../../tenancy/tenant-slug.js";

const OPERATION = "tenant migration";
const MIGRATION_FILE = "migration.sql";
const CONSTRAINTS_SCRIPT = "001_constraints.sql";

/** A statement terminator at end of line — mirrors `sql-script.ts`'s own
 *  `STATEMENT_TERMINATOR`, which is not exported (kept private to that module). */
const STATEMENT_TERMINATOR = /;[ \t]*(?:\r?\n|$)/;

/**
 * The platform-schema subset of a migration: statements naming `[platform].` at all.
 * The complement of `tenantTemplateStatements()` in spirit, but deliberately NOT
 * "every statement that does not mention tenant_template" — a statement can
 * legitimately mention neither (rare) or both (one of the five cross-schema FKs
 * ADR-0011 describes), so this filters by presence of `[platform].` specifically,
 * leaving a statement that also touches tenant_template to run there via
 * `applyToTenant` instead. Needed because Prisma's raw DDL carries no `IF NOT EXISTS`
 * guards (`sql-store-provisioner.ts`'s own module comment): `applyToPlatform` must
 * not re-run a tenant_template-only statement, which would be both semantically
 * wrong (tenant_template is a template, not a runtime target — see `tenant-db.ts`'s
 * doc comment) and, on any second invocation, a real SQL error.
 */
export function platformStatements(migrationSql: string): readonly string[] {
  return migrationSql
    .split(STATEMENT_TERMINATOR)
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0 && /\[platform\]\./.test(statement));
}

/** Extracts `ALTER TABLE [schema].[Table] ADD [col1] ..., [col2] ...` column names,
 *  so `verifyTenantSchema` can check exactly what THIS migration claims to have added
 *  rather than only a table count (which a column-level mismatch would not catch). */
export function addedColumns(statement: string): readonly { table: string; column: string }[] {
  const alterMatch = /ALTER TABLE \[[^\]]+\]\.\[([^\]]+)\] ADD\b([\s\S]*)/i.exec(statement);
  if (!alterMatch) return [];
  const table = alterMatch[1]!;
  const rest = alterMatch[2] ?? "";
  const columns: { table: string; column: string }[] = [];
  // Each added column starts a fragment naming `[colName]` immediately after a comma
  // or the ADD keyword itself, before its type — this is a heuristic over Prisma's
  // own consistent output shape, in the same spirit sql-script.ts's own statement
  // splitting is: good enough for the shape Prisma actually emits, not a full parser.
  for (const match of rest.matchAll(/(?:^|,)\s*\[([A-Za-z0-9_]+)\]\s+[A-Z]/g)) {
    columns.push({ table, column: match[1]! });
  }
  return columns;
}

export interface PrismaMigrationExecutorOptions {
  readonly migrationsDir?: string;
  readonly scriptDir?: string;
}

export class PrismaMigrationExecutor implements MigrationExecutor {
  private readonly migrationsDir: string;
  private readonly scriptDir: string;

  constructor(options: PrismaMigrationExecutorOptions = {}) {
    this.migrationsDir = options.migrationsDir ?? PRISMA_MIGRATIONS_DIR;
    this.scriptDir = options.scriptDir ?? PRISMA_SQL_DIR;
  }

  /**
   * Runs only this migration's `[platform].`-touching statements (see
   * `platformStatements()` above for why not the whole file verbatim). For a
   * migration with none — this wave's own `TenantBrandings`/`UserThemePreferences`
   * columns are entirely tenant-side — this is a genuine, safe no-op, called every
   * time `RunTenantMigrations.execute()` runs (including a resumed run) with nothing
   * to re-apply and nothing to fail on.
   */
  async applyToPlatform(migration: MigrationDefinition): Promise<void> {
    const sql = await this.readMigrationSql(migration.name);
    const db = getPlatformDb(OPERATION);
    for (const statement of platformStatements(sql)) {
      await db.$executeRawUnsafe(statement);
    }
  }

  /**
   * Applies the migration's tenant-touching statements to one real tenant schema,
   * then re-applies `001_constraints.sql`'s whole tenant section unconditionally.
   * The second step is deliberate, not incidental: this migration's new CHECK
   * constraints and its new trigger live in that file, not in the Prisma-generated
   * `migration.sql`, and the file is fully idempotent by construction (RISK-025) — a
   * cheap, safe, complete re-apply is what keeps an incrementally-migrated tenant
   * converging on the exact same end state a freshly-provisioned one gets from
   * `SqlStoreProvisioner.create()`.
   */
  async applyToTenant(tenantSlug: string, migration: MigrationDefinition): Promise<void> {
    const slug = assertValidSlugShape(tenantSlug);
    const db = getPlatformDb(OPERATION);

    const migrationSql = await this.readMigrationSql(migration.name);
    for (const statement of tenantTemplateStatements(migrationSql, slug)) {
      await db.$executeRawUnsafe(statement);
    }

    const constraintsSql = await readFile(join(this.scriptDir, CONSTRAINTS_SCRIPT), "utf8");
    const tenantConstraints = substituteSchema(tenantSection(constraintsSql), slug);
    for (const batch of splitBatches(tenantConstraints)) {
      await db.$executeRawUnsafe(batch);
    }
  }

  /**
   * Checks that every column this migration's tenant statements claim to add is
   * genuinely present on the live tenant schema — a status row is a claim, the
   * schema is the fact (the same principle `RunTenantMigrations`'s own doc comment
   * states about itself).
   */
  async verifyTenantSchema(tenantSlug: string, migration: MigrationDefinition): Promise<boolean> {
    const slug = assertValidSlugShape(tenantSlug);
    const schema = safeSchemaName(slug);
    const db = getPlatformDb(OPERATION);

    const migrationSql = await this.readMigrationSql(migration.name);
    const expected = tenantTemplateStatements(migrationSql, slug).flatMap(addedColumns);
    if (expected.length === 0) {
      // This migration added no tenant columns (e.g. platform-only, or constraints
      // only) — nothing for this check to verify; absence of a claim is not a
      // verification failure.
      return true;
    }

    for (const { table, column } of expected) {
      const rows = (await db.$queryRawUnsafe(
        `SELECT COUNT(*) AS value FROM sys.columns c
         JOIN sys.tables t ON t.object_id = c.object_id
         JOIN sys.schemas s ON s.schema_id = t.schema_id
         WHERE s.name = @P1 AND t.name = @P2 AND c.name = @P3`,
        schema,
        table,
        column,
      )) as { value: number | bigint }[];
      const count = Number(rows[0]?.value ?? 0);
      if (count === 0) return false;
    }
    return true;
  }

  private async readMigrationSql(migrationName: string): Promise<string> {
    const path = join(this.migrationsDir, migrationName, MIGRATION_FILE);
    try {
      return await readFile(path, "utf8");
    } catch {
      throw new Error(
        `No ${MIGRATION_FILE} for migration "${migrationName}" at "${path}". ` +
          "MigrationDefinition.name must be an existing prisma/migrations/<name>/ directory.",
      );
    }
  }
}

/** Lists migration directory names in the same chronological (lexical) order
 *  `SqlStoreProvisioner.readMigrationHistory()` relies on, for callers building a
 *  `MigrationDefinition` from disk rather than hand-naming one. */
export async function listMigrationNames(migrationsDir?: string): Promise<readonly string[]> {
  const dir = migrationsDir ?? PRISMA_MIGRATIONS_DIR;
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}
