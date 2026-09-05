import { and, desc, eq } from "drizzle-orm";
import { generateId, schema, withTenant, type TenantContext, type TenantScopedClient } from "@nextbot/db";

/** Target Architecture Blueprint Phase 13 (BL-45, FR-ESC-05, LLD §14.9.2) —
 * `escalation_assignment_log.action` vocabulary. `AutoAssigned` is reserved for a
 * future automatic-assignment mechanic (not built this phase — FR-ESC-05 only
 * requires explicit human claiming/reassignment; routing still only resolves a
 * *queue*, never a specific agent, per FR-ESC-03) — declared now so the enum/table
 * shape never needs a later `ALTER TYPE`. */
export type EscalationAssignmentActionValue = "Claimed" | "Released" | "Reassigned" | "AutoAssigned";

export interface EscalationAssignmentLogRow {
  id: string;
  tenantId: string;
  escalationId: string;
  userId: string;
  action: EscalationAssignmentActionValue;
  actorUserId: string | null;
  createdAt: Date;
}

/**
 * Appends one row to the append-only assignment audit trail. **Must** be called with
 * a `db` handle already inside the same transaction as the load-affecting change it
 * records (a claim/release/reassign) — never as its own standalone `withTenant` call —
 * so the log entry and the state change it describes commit or roll back together,
 * exactly like `escalation_event`'s own append-only convention elsewhere in this
 * codebase. Never updated in place; there is deliberately no `updateAssignmentLog*`
 * export.
 */
export async function appendAssignmentLogInTx(
  db: TenantScopedClient,
  tenantId: string,
  escalationId: string,
  userId: string,
  action: EscalationAssignmentActionValue,
  actorUserId: string | null,
): Promise<void> {
  await db.insert(schema.escalationAssignmentLog).values({
    id: generateId(),
    tenantId,
    escalationId,
    userId,
    action,
    actorUserId,
  });
}

/** FR-RP-01 reporting / B.5.2 context panel feed — every logged action for one
 * escalation, most recent first. */
export async function listAssignmentLogForEscalation(ctx: TenantContext, escalationId: string): Promise<EscalationAssignmentLogRow[]> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db
      .select()
      .from(schema.escalationAssignmentLog)
      .where(and(eq(schema.escalationAssignmentLog.tenantId, ctx.tenantId), eq(schema.escalationAssignmentLog.escalationId, escalationId)))
      .orderBy(desc(schema.escalationAssignmentLog.createdAt));
    return rows as EscalationAssignmentLogRow[];
  });
}
