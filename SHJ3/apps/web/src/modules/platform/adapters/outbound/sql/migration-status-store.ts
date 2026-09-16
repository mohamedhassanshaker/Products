/**
 * The real `MigrationStatusStore` (`application/run-tenant-migrations.ts`) —
 * `platform.TenantMigrations` (`TenantMigration` in `prisma/platform/schema.prisma`).
 *
 * Before this wave, `RunTenantMigrations` had no production implementation of this
 * port anywhere in the codebase — only `run-tenant-migrations.test.ts`'s `FakeStatusStore`
 * existed. This is that missing wiring, reached exclusively through `getPlatformDb()`
 * inside a `platformScope: "migration"` context (tenant-context.ts).
 */

import { getPlatformDb } from "./tenant-db.js";
import { newUlid } from "./ulid.js";
import type { MigrationStatusStore } from "../../../application/run-tenant-migrations.js";
import type { TenantMigrationRecord } from "../../../domain/migration.js";

const OPERATION = "migration status";

export class PrismaMigrationStatusStore implements MigrationStatusStore {
  async listRecords(migrationName: string): Promise<readonly TenantMigrationRecord[]> {
    const db = getPlatformDb(OPERATION);
    const rows = await db.tenantMigration.findMany({
      where: { migrationName },
      include: { tenant: { select: { slug: true } } },
    });

    return rows.map((row) => ({
      tenantSlug: row.tenant.slug,
      migrationName: row.migrationName,
      // TenantMigrations.state's CHECK constraint is the same closed set as
      // TenantMigrationStatus (Pending|Applied|Failed|Skipped) plus "Running", which
      // this cast documents rather than re-enforces.
      status: row.state as TenantMigrationRecord["status"],
      checksum: row.checksum,
      ...(row.appliedAt ? { appliedAt: row.appliedAt } : {}),
      ...(row.error ? { failureReason: row.error } : {}),
    }));
  }

  async record(entry: TenantMigrationRecord): Promise<void> {
    const db = getPlatformDb(OPERATION);
    const tenant = await db.tenant.findUnique({
      where: { slug: entry.tenantSlug },
      select: { id: true },
    });
    if (!tenant) {
      throw new Error(
        `Cannot record a migration status for unknown tenant "${entry.tenantSlug}". ` +
          "The tenant registry (platform.Tenants) has no row for this slug.",
      );
    }
    if (!entry.checksum) {
      // Every real call site in RunTenantMigrations always supplies a checksum
      // (it comes from MigrationDefinition, never omitted) — a missing one here
      // means a caller bypassed that contract, and writing an empty placeholder
      // would silently defeat MigrationChecksumConflictError's whole purpose.
      throw new Error(
        `Cannot record migration "${entry.migrationName}" for tenant "${entry.tenantSlug}" ` +
          "without a checksum — recording one without it would silently defeat edited-migration detection.",
      );
    }

    const now = new Date();
    await db.tenantMigration.upsert({
      where: {
        tenantId_migrationName: { tenantId: tenant.id, migrationName: entry.migrationName },
      },
      create: {
        id: newUlid(now),
        tenantId: tenant.id,
        migrationName: entry.migrationName,
        checksum: entry.checksum,
        state: entry.status,
        appliedAt: entry.appliedAt ?? null,
        error: entry.failureReason ?? null,
        createdAt: now,
        updatedAt: now,
      },
      update: {
        checksum: entry.checksum,
        state: entry.status,
        appliedAt: entry.appliedAt ?? null,
        error: entry.failureReason ?? null,
        updatedAt: now,
      },
    });
  }
}
