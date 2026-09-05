import { and, eq } from "drizzle-orm";
import { generateId, schema, withTenant, type TenantContext, type TenantScopedClient } from "@nextbot/db";
import { listActiveTenantContexts } from "@nextbot/tenancy";

/**
 * The audit module's outbox consumer (LLD §2.4, FR-ADM-03/NFR-5). Reads
 * `domain_event` rows this tenant's writers have already appended (every
 * fallback/`PolicyDenied` event from `orchestration`'s Phase 12 writer today; more
 * event types accumulate here automatically as later phases add their own outbox
 * writes — no per-event-type wiring needed on this side) and mirrors each into
 * `audit_log_entry`, then marks the source row `processed = true`.
 *
 * **Known scope gap, flagged rather than silently narrowed**: `domain_event` is
 * currently written by exactly one module (`orchestration`'s fallback/PolicyDenied
 * events) — no other Phase 1-16 module's mutating endpoints append to the outbox
 * yet, even though the outbox itself was built generically in Phase 0 specifically
 * so every module *could*. This dispatch's "audit-completeness" bar is therefore
 * "every domain_event the system currently produces is faithfully mirrored into
 * the audit log," not "every mutating endpoint across Phases 1-16 emits one" — the
 * latter would mean retrofitting outbox writes onto roughly a dozen modules'
 * existing mutation paths, which is out of this dispatch's bounded scope and is
 * called out explicitly in the phase report rather than silently claimed done.
 *
 * Idempotent by construction: `audit_log_entry.source_domain_event_id` carries a
 * unique index, so re-processing the same `domain_event` row twice (e.g. a crash
 * between the audit insert and the `processed = true` update) fails the second
 * insert cleanly rather than duplicating the audit row — reconciled here by
 * catching that specific conflict and treating it as already-synced.
 */
export interface AuditSyncResult {
  synced: number;
}

/** Maps one raw `domain_event` row to the audit log's actor/target/outcome shape.
 * A conservative default mapping (event `type` becomes `actionType`, the whole
 * payload becomes `details`) — event-specific richer mapping can be added per
 * `type` without changing this function's shape. */
function toAuditEntry(event: { id: string; type: string; payload: Record<string, unknown> }) {
  const payload = event.payload;
  const outcome: "Success" | "Failure" | "Denied" =
    event.type.toLowerCase().includes("denied")
      ? "Denied"
      : event.type.toLowerCase().includes("fail") || event.type.toLowerCase().includes("timeout")
        ? "Failure"
        : "Success";
  return {
    actorId: (payload.actorId as string | undefined) ?? null,
    actorLabel: (payload.actorLabel as string | undefined) ?? "system",
    actionType: event.type,
    targetType: (payload.targetType as string | undefined) ?? null,
    targetId: (payload.targetId as string | undefined) ?? (payload.toolCallId as string | undefined) ?? null,
    outcome,
    details: payload,
    sourceDomainEventId: event.id,
  };
}

/** Syncs every unprocessed `domain_event` row for one tenant. */
export async function syncAuditFromEventsForTenant(ctx: TenantContext): Promise<AuditSyncResult> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const unprocessed = await db
      .select()
      .from(schema.domainEvent)
      .where(and(eq(schema.domainEvent.tenantId, ctx.tenantId), eq(schema.domainEvent.processed, false)));

    let synced = 0;
    for (const event of unprocessed) {
      try {
        await db.insert(schema.auditLogEntry).values({
          id: generateId(),
          tenantId: ctx.tenantId,
          ...toAuditEntry({ id: event.id, type: event.type, payload: event.payload as Record<string, unknown> }),
        });
        synced += 1;
      } catch (err) {
        // The unique `source_domain_event_id` index is the idempotency guarantee —
        // a conflict here means this event was already synced by a previous run
        // (e.g. a crash after insert but before the processed-flag update below);
        // anything else is a real failure and must not be silently swallowed.
        const message = err instanceof Error ? err.message : String(err);
        if (!message.includes("audit_log_entry_source_event_key")) throw err;
      }
      await db.update(schema.domainEvent).set({ processed: true, processedAt: new Date() }).where(eq(schema.domainEvent.id, event.id));
    }
    return { synced };
  });
}

/** Syncs every tenant's unprocessed events — what `apps/worker`'s scheduled job
 * calls, mirroring the idle-sweeper's across-all-tenants convention. */
export async function syncAuditFromEventsAcrossAllTenants(): Promise<{ tenantsChecked: number } & AuditSyncResult> {
  const tenants = await listActiveTenantContexts();
  let synced = 0;
  for (const tenantCtx of tenants) {
    const result = await syncAuditFromEventsForTenant(tenantCtx);
    synced += result.synced;
  }
  return { tenantsChecked: tenants.length, synced };
}
