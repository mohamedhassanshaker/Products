/**
 * Apply one Prisma migration to every real tenant schema (plus the platform schema).
 *
 *   pnpm db:migrate -- <migration-name>
 *
 * (also `pnpm exec tsx scripts/migrate-tenants.ts <migration-name>`.) `package.json`'s
 * `db:migrate` referred to this file before it existed on disk — `migration-executor.ts`'s
 * own doc comment names that gap plainly ("Building the general migration CLI... is out of
 * scope for the theming backend wave; this is the missing *executor* the CLI would need").
 * This is that CLI: real orchestration (`RunTenantMigrations`) and real adapters
 * (`PrismaMigrationExecutor`, `PrismaMigrationStatusStore`, `PlatformAuditSink`) already
 * existed and were already tested — only the composition root wiring them together for an
 * operator to actually run was missing.
 *
 * Lists tenants the same way `bootstrap-platform-schema.ts`/`seed-iam-demo-data.ts` reach
 * `getPlatformDb()` — a `runWithTenant` context with `platformScope: "migration"`, the exact
 * scope `migration-status-store.ts`'s own doc comment names as this port's real home.
 */

import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { getPlatformDb, disconnectAllTenantDbs } from "../apps/web/src/modules/platform/adapters/outbound/sql/tenant-db.js";
import { PrismaMigrationExecutor } from "../apps/web/src/modules/platform/adapters/outbound/sql/migration-executor.js";
import { PrismaMigrationStatusStore } from "../apps/web/src/modules/platform/adapters/outbound/sql/migration-status-store.js";
import { PlatformAuditSink } from "../apps/web/src/modules/platform/adapters/outbound/sql/audit-sink.js";
import { RunTenantMigrations } from "../apps/web/src/modules/platform/application/run-tenant-migrations.js";
import { isRunComplete, type MigrationDefinition } from "../apps/web/src/modules/platform/domain/migration.js";
import { runWithTenant } from "../apps/web/src/modules/platform/tenancy/tenant-context.js";
import { assertValidSlugShape } from "../apps/web/src/modules/platform/tenancy/tenant-slug.js";

const MIGRATIONS_DIR = resolve(process.cwd(), "prisma", "migrations");

/** Active AND Suspended — a suspended tenant's schema must not fall behind (`RunTenantMigrationsDeps`'s own doc comment), only a tenant never fully provisioned (or being torn down) is excluded. */
async function listRealTenantSlugs(): Promise<readonly string[]> {
  const db = getPlatformDb("migrate-tenants script");
  const rows = await db.tenant.findMany({
    where: { status: { in: ["Active", "Suspended"] } },
    select: { slug: true },
  });
  return rows.map((row) => row.slug);
}

async function loadMigration(name: string): Promise<MigrationDefinition> {
  const sql = await readFile(join(MIGRATIONS_DIR, name, "migration.sql"), "utf8");
  return {
    name,
    checksum: createHash("sha256").update(sql).digest("hex"),
    requiresMaintenanceWindow: false,
  };
}

async function main(): Promise<void> {
  const name = process.argv[2];
  if (!name) {
    console.error("Usage: pnpm db:migrate -- <migration-name>");
    process.exitCode = 1;
    return;
  }

  const migration = await loadMigration(name);
  const environment = process.env.NODE_ENV === "production" ? "production" : "development";

  await runWithTenant(
    {
      // Arbitrary and harmless — every call below is platform-scoped or iterates its own
      // real tenant slug, never reads this field. Mirrors bootstrap-platform-schema.ts's
      // identical "runAsBootstrap" reasoning.
      tenant: assertValidSlugShape("sewa"),
      principal: null,
      traceId: `migrate-tenants:${migration.name}`,
      platformScope: "migration",
    },
    async () => {
      const runner = new RunTenantMigrations({
        executor: new PrismaMigrationExecutor(),
        status: new PrismaMigrationStatusStore(),
        listTenantSlugs: listRealTenantSlugs,
        audit: new PlatformAuditSink(),
        clock: { now: () => new Date() },
      });

      console.info(`[migrate-tenants] plan for "${migration.name}":`);
      for (const entry of await runner.plan(migration)) {
        console.info(`  ${entry.tenantSlug}: ${entry.action} (${entry.reason})`);
      }

      const summary = await runner.execute({
        migration,
        actor: { kind: "System", label: "migrate-tenants script" },
        environment,
      });

      console.info(`[migrate-tenants] applied: ${summary.applied.join(", ") || "(none)"}`);
      console.info(`[migrate-tenants] skipped: ${summary.skipped.join(", ") || "(none)"}`);
      if (summary.failed.length > 0) {
        console.error(
          `[migrate-tenants] FAILED: ${summary.failed.map((f) => `${f.tenantSlug} (${f.reason})`).join(", ")}`,
        );
      }
      if (summary.notAttempted.length > 0) {
        console.error(`[migrate-tenants] not attempted: ${summary.notAttempted.join(", ")}`);
      }

      if (!isRunComplete(summary)) {
        process.exitCode = 1;
      }
    },
  );

  await disconnectAllTenantDbs();
}

main().catch((error: unknown) => {
  console.error("[migrate-tenants] failed:", error);
  process.exitCode = 1;
});
