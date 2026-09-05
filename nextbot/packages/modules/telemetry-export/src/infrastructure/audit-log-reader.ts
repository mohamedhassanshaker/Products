import { and, asc, eq, gt } from "drizzle-orm";
import { schema, withTenant, type TenantContext, type TenantScopedClient } from "@nextbot/db";

export interface AuditLogBatchRow {
  id: string;
  occurredAt: Date;
  actorLabel: string;
  actionType: string;
  targetType: string | null;
  targetId: string | null;
  outcome: string;
  details: unknown;
}

/**
 * The SIEM export sweep's own read side: every `audit_log_entry` row created after
 * `afterId` (this table's ids are UUIDv7 — time-ordered — the same property
 * `createFixtureTenant`'s own doc comment already relies on elsewhere in this
 * codebase, so ordering/filtering by id alone is equivalent to ordering by
 * `created_at` without a tie-breaking second column). `afterId: null` reads from the
 * very beginning (a tenant's first-ever export, or a fresh config after re-enabling
 * with no prior cursor).
 */
export async function listAuditLogEntriesSince(ctx: TenantContext, afterId: string | null, limit: number): Promise<AuditLogBatchRow[]> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db
      .select({
        id: schema.auditLogEntry.id,
        occurredAt: schema.auditLogEntry.occurredAt,
        actorLabel: schema.auditLogEntry.actorLabel,
        actionType: schema.auditLogEntry.actionType,
        targetType: schema.auditLogEntry.targetType,
        targetId: schema.auditLogEntry.targetId,
        outcome: schema.auditLogEntry.outcome,
        details: schema.auditLogEntry.details,
      })
      .from(schema.auditLogEntry)
      .where(afterId ? and(eq(schema.auditLogEntry.tenantId, ctx.tenantId), gt(schema.auditLogEntry.id, afterId)) : eq(schema.auditLogEntry.tenantId, ctx.tenantId))
      .orderBy(asc(schema.auditLogEntry.id))
      .limit(limit);
    return rows as AuditLogBatchRow[];
  });
}
