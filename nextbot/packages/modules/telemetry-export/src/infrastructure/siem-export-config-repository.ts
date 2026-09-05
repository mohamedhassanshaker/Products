import { and, eq } from "drizzle-orm";
import { generateId, schema, withTenant, type TenantContext, type TenantScopedClient } from "@nextbot/db";

export interface SiemExportConfigRow {
  id: string;
  tenantId: string;
  endpointUrl: string;
  enabled: boolean;
  lastExportedAuditLogId: string | null;
  lastExportedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export async function getSiemExportConfig(ctx: TenantContext): Promise<SiemExportConfigRow | null> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db.select().from(schema.siemExportConfig).where(eq(schema.siemExportConfig.tenantId, ctx.tenantId));
    return (rows[0] as SiemExportConfigRow | undefined) ?? null;
  });
}

/** Upserts the tenant's single config row. Deliberately does NOT reset the cursor
 * (`lastExportedAuditLogId`/`lastExportedAt`) when a tenant edits/re-enables their
 * endpoint — resuming from where the stream left off (rather than replaying the
 * entire audit history on every settings edit) is the correct default for a SIEM
 * pipeline's own de-duplication expectations. */
export async function upsertSiemExportConfig(ctx: TenantContext, input: { endpointUrl: string; enabled: boolean }): Promise<SiemExportConfigRow> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const existing = await db.select({ id: schema.siemExportConfig.id }).from(schema.siemExportConfig).where(eq(schema.siemExportConfig.tenantId, ctx.tenantId));
    if (existing[0]) {
      await db
        .update(schema.siemExportConfig)
        .set({ endpointUrl: input.endpointUrl, enabled: input.enabled, updatedAt: new Date() })
        .where(and(eq(schema.siemExportConfig.tenantId, ctx.tenantId), eq(schema.siemExportConfig.id, existing[0].id)));
    } else {
      await db.insert(schema.siemExportConfig).values({ id: generateId(), tenantId: ctx.tenantId, endpointUrl: input.endpointUrl, enabled: input.enabled });
    }
    const rows = await db.select().from(schema.siemExportConfig).where(eq(schema.siemExportConfig.tenantId, ctx.tenantId));
    return rows[0] as SiemExportConfigRow;
  });
}

/** Advances this tenant's OWN cursor — never `domain_event.processed`/`processed_at`
 * (see this table's schema-file doc comment). Called only after a batch's HTTP POST
 * genuinely succeeded. */
export async function advanceSiemExportCursor(ctx: TenantContext, configId: string, lastExportedAuditLogId: string): Promise<void> {
  await withTenant(ctx, async (db: TenantScopedClient) => {
    await db
      .update(schema.siemExportConfig)
      .set({ lastExportedAuditLogId, lastExportedAt: new Date() })
      .where(and(eq(schema.siemExportConfig.tenantId, ctx.tenantId), eq(schema.siemExportConfig.id, configId)));
  });
}
