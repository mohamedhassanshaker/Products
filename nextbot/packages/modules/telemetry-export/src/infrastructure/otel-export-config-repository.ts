import { and, eq } from "drizzle-orm";
import { generateId, schema, withTenant, type TenantContext, type TenantScopedClient } from "@nextbot/db";

export interface OtelExportConfigRow {
  id: string;
  tenantId: string;
  otlpEndpointUrl: string;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export async function getOtelExportConfig(ctx: TenantContext): Promise<OtelExportConfigRow | null> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db.select().from(schema.otelExportConfig).where(eq(schema.otelExportConfig.tenantId, ctx.tenantId));
    return (rows[0] as OtelExportConfigRow | undefined) ?? null;
  });
}

/** Upserts the tenant's single config row (one per tenant, created lazily on first
 * configuration — see this table's own schema-file doc comment). */
export async function upsertOtelExportConfig(ctx: TenantContext, input: { otlpEndpointUrl: string; enabled: boolean }): Promise<OtelExportConfigRow> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const existing = await db.select({ id: schema.otelExportConfig.id }).from(schema.otelExportConfig).where(eq(schema.otelExportConfig.tenantId, ctx.tenantId));
    if (existing[0]) {
      await db
        .update(schema.otelExportConfig)
        .set({ otlpEndpointUrl: input.otlpEndpointUrl, enabled: input.enabled, updatedAt: new Date() })
        .where(and(eq(schema.otelExportConfig.tenantId, ctx.tenantId), eq(schema.otelExportConfig.id, existing[0].id)));
    } else {
      await db.insert(schema.otelExportConfig).values({ id: generateId(), tenantId: ctx.tenantId, otlpEndpointUrl: input.otlpEndpointUrl, enabled: input.enabled });
    }
    const rows = await db.select().from(schema.otelExportConfig).where(eq(schema.otelExportConfig.tenantId, ctx.tenantId));
    return rows[0] as OtelExportConfigRow;
  });
}
