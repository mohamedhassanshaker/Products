import { generateId, schema, withTenant, type TenantContext, type TenantScopedClient } from "@nextbot/db";

/** One audited action (B.8.2's Audit Log Viewer row shape). */
export interface RecordAuditInput {
  actorId?: string | null;
  actorLabel: string;
  actionType: string;
  targetType?: string | null;
  targetId?: string | null;
  outcome: "Success" | "Failure" | "Denied";
  details: Record<string, unknown>;
  sourceDomainEventId?: string | null;
}

/**
 * Appends one row directly to `audit_log_entry` (used by the DSR tool and any
 * other call site that has an immediate, synchronous audit obligation rather than
 * going through the outbox-consumer path). `INSERT` is the only write privilege
 * the app/platform roles retain on this table (`ensure-roles.ts`) — this function
 * never issues an `UPDATE`/`DELETE`.
 */
export async function recordAuditEntry(ctx: TenantContext, input: RecordAuditInput): Promise<string> {
  const id = generateId();
  await withTenant(ctx, async (db: TenantScopedClient) => {
    await db.insert(schema.auditLogEntry).values({ id, tenantId: ctx.tenantId, ...input });
  });
  return id;
}
