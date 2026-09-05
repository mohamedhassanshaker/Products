import { and, desc, eq, gte, inArray, lte, or, sql } from "drizzle-orm";
import { schema, withTenant, type TenantContext, type TenantScopedClient } from "@nextbot/db";

/** B.8.2's Audit Log Viewer filters. */
export interface AuditLogFilters {
  actionType?: string;
  targetType?: string;
  /** QA fix (UI-D1) — filters by `actor_id` (the acting user's id); the Audit Log
   * Viewer's missing "Actor" filter now wires through to this. */
  actorId?: string;
  outcome?: "Success" | "Failure" | "Denied";
  from?: Date;
  to?: Date;
  /** Free-text search, matched against the migration's `to_tsvector` GIN index. */
  search?: string;
  limit?: number;
  offset?: number;
}

export interface AuditLogEntryRow {
  id: string;
  occurredAt: Date;
  actorId: string | null;
  actorLabel: string;
  actionType: string;
  targetType: string | null;
  targetId: string | null;
  outcome: "Success" | "Failure" | "Denied";
  details: Record<string, unknown>;
}

/**
 * Queries `audit_log_entry` for the viewer's list. Unmasked `details` is returned
 * here — the detail-drawer/export call sites apply `pii/application`'s context
 * masker on top of this before it ever reaches a client response (module
 * boundary: `audit` cannot import `pii` directly either way, so masking is always
 * the caller's job, exactly like `conversations`/`orchestration`'s pattern of
 * returning raw rows and letting the composition root apply cross-module policy).
 */
export async function queryAuditLog(ctx: TenantContext, filters: AuditLogFilters): Promise<AuditLogEntryRow[]> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const conditions = [eq(schema.auditLogEntry.tenantId, ctx.tenantId)];
    if (filters.actionType) conditions.push(eq(schema.auditLogEntry.actionType, filters.actionType));
    if (filters.targetType) conditions.push(eq(schema.auditLogEntry.targetType, filters.targetType));
    if (filters.actorId) conditions.push(eq(schema.auditLogEntry.actorId, filters.actorId));
    if (filters.outcome) conditions.push(eq(schema.auditLogEntry.outcome, filters.outcome));
    if (filters.from) conditions.push(gte(schema.auditLogEntry.occurredAt, filters.from));
    if (filters.to) conditions.push(lte(schema.auditLogEntry.occurredAt, filters.to));
    if (filters.search) {
      conditions.push(
        sql`to_tsvector('english', ${schema.auditLogEntry.actionType} || ' ' || ${schema.auditLogEntry.actorLabel} || ' ' || coalesce(${schema.auditLogEntry.targetType}, '') || ' ' || coalesce(${schema.auditLogEntry.targetId}, '')) @@ plainto_tsquery('english', ${filters.search})`,
      );
    }
    const rows = await db
      .select()
      .from(schema.auditLogEntry)
      .where(and(...conditions))
      .orderBy(desc(schema.auditLogEntry.occurredAt))
      .limit(filters.limit ?? 50)
      .offset(filters.offset ?? 0);
    return rows.map((r) => ({
      id: r.id,
      occurredAt: r.occurredAt,
      actorId: r.actorId,
      actorLabel: r.actorLabel,
      actionType: r.actionType,
      targetType: r.targetType,
      targetId: r.targetId,
      outcome: r.outcome,
      details: r.details as Record<string, unknown>,
    }));
  });
}

/**
 * QA fix (BE-3, FR-ADM-06) — the DSR export/delete aggregation's audit-trail
 * lookup. FR-ADM-06 requires the DSR tool to search/view/export across "all of
 * a tenant's data" for a customer identifier, and B.8.4 itself expects an audit
 * trail of DSR actions — so a customer's own DSR export must include the audit
 * entries genuinely tied to them: any row whose `(target_type, target_id)`
 * matches one of the supplied pairs (e.g. `("customer", <masked identifier>)`,
 * `("tool_call", <id>)` for every tool call found in their conversations). Not a
 * generic query — this exists specifically for the composition-root DSR
 * aggregation (`apps/web`'s `dsr-service.ts`), which is the only caller allowed
 * to combine `audit` with `conversations`/`approvals`/`escalations` (LLD §2.3).
 */
export async function findAuditEntriesForTargets(
  ctx: TenantContext,
  targets: Array<{ targetType: string; targetId: string }>,
): Promise<AuditLogEntryRow[]> {
  if (targets.length === 0) return [];
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const byType = new Map<string, string[]>();
    for (const t of targets) {
      const ids = byType.get(t.targetType) ?? [];
      ids.push(t.targetId);
      byType.set(t.targetType, ids);
    }
    const orConditions = Array.from(byType.entries()).map(([targetType, targetIds]) =>
      and(eq(schema.auditLogEntry.targetType, targetType), inArray(schema.auditLogEntry.targetId, targetIds)),
    );

    const rows = await db
      .select()
      .from(schema.auditLogEntry)
      .where(and(eq(schema.auditLogEntry.tenantId, ctx.tenantId), or(...orConditions)))
      .orderBy(desc(schema.auditLogEntry.occurredAt));

    return rows.map((r) => ({
      id: r.id,
      occurredAt: r.occurredAt,
      actorId: r.actorId,
      actorLabel: r.actorLabel,
      actionType: r.actionType,
      targetType: r.targetType,
      targetId: r.targetId,
      outcome: r.outcome,
      details: r.details as Record<string, unknown>,
    }));
  });
}
