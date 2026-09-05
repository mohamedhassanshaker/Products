import { and, eq, lt, sql } from "drizzle-orm";
import { schema, withTenant, type TenantContext, type TenantScopedClient } from "@nextbot/db";
import { listActiveTenantContexts } from "@nextbot/tenancy";
import { decideIdleResolution } from "../domain/idle-sweep-decision.js";

/**
 * LLD §3.7 (BL-06): "conversations with `status = Active` and `last_activity_at <
 * now() - idle_timeout` (tenant setting, default 30 min) -> if
 * `message_count(sender = Customer) = 0` set `Abandoned` + `resolution_type =
 * Abandoned`; else set `Resolved` + `resolution_type = AI`." Intended to run every
 * 60s (LLD §11's named job list includes `conversation.idle-sweep`); this phase wires
 * the real, tested, callable unit — actually *scheduling* it on a 60s interval is
 * Phase 18's job-scheduling infrastructure (same "callable but not yet
 * cron-registered" convention `apps/worker/src/agent-platform-git-sweep.ts`
 * established in Phase 10 for its own 15-minute polling reconciliation).
 *
 * **Local/reversible decision, flagged**: LLD calls the idle timeout "a tenant
 * setting" but no such column exists anywhere in the schema (`tenant`,
 * `tenant_runtime_quota`, etc.) — nothing in Phases 1-12 introduced one. Rather than
 * add an unscoped new tenant-settings column/table as a side effect of this phase
 * (a structural change outside BL-06's stated scope), this function takes the timeout
 * as a parameter defaulting to the LLD's literal "default 30 min", so wiring a real
 * per-tenant override later is a one-line change at the call site, not a new seam.
 */
const DEFAULT_IDLE_TIMEOUT_MINUTES = 30;

export interface IdleSweepResult {
  abandoned: number;
  resolved: number;
}

/** Sweeps one tenant's idle `Active` conversations. Each candidate conversation is
 * evaluated and closed inside its own `withTenant` transaction (one per row) rather
 * than one giant transaction for every candidate — a single conversation with an
 * unexpected error (e.g. a concurrent status change) must not roll back every other
 * conversation this sweep would otherwise have correctly closed. */
export async function sweepIdleConversationsForTenant(
  ctx: TenantContext,
  idleTimeoutMinutes: number = DEFAULT_IDLE_TIMEOUT_MINUTES,
): Promise<IdleSweepResult> {
  const cutoff = new Date(Date.now() - idleTimeoutMinutes * 60_000);

  const candidateIds = await withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db
      .select({ id: schema.conversation.id })
      .from(schema.conversation)
      .where(
        and(
          eq(schema.conversation.tenantId, ctx.tenantId),
          eq(schema.conversation.status, "Active"),
          lt(schema.conversation.lastActivityAt, cutoff),
        ),
      );
    return rows.map((r) => r.id);
  });

  let abandoned = 0;
  let resolved = 0;

  for (const conversationId of candidateIds) {
    const closed = await withTenant(ctx, async (db: TenantScopedClient) => {
      // Re-check status inside this row's own transaction — a candidate collected
      // above may have already been closed (e.g. the customer sent a fresh message,
      // or a concurrent sweep run) by the time this iteration runs.
      const rows = await db
        .select({ id: schema.conversation.id })
        .from(schema.conversation)
        .where(and(eq(schema.conversation.tenantId, ctx.tenantId), eq(schema.conversation.id, conversationId), eq(schema.conversation.status, "Active")));
      if (rows.length === 0) return null;

      const countResult = await db.execute<{ customer_message_count: number }>(sql`
        SELECT count(*)::int AS customer_message_count
        FROM message
        WHERE tenant_id = ${ctx.tenantId} AND conversation_id = ${conversationId} AND sender = 'Customer'
      `);
      const customerMessageCount = countResult.rows[0]?.customer_message_count ?? 0;
      const decision = decideIdleResolution(customerMessageCount);

      await db
        .update(schema.conversation)
        .set({ status: decision.status, resolutionType: decision.resolutionType, endedAt: new Date() })
        .where(and(eq(schema.conversation.tenantId, ctx.tenantId), eq(schema.conversation.id, conversationId)));

      return decision.status;
    });

    if (closed === "Abandoned") abandoned++;
    else if (closed === "Resolved") resolved++;
  }

  return { abandoned, resolved };
}

/** Sweeps every active tenant (the same `listActiveTenantContexts` cross-tenant seam
 * `@nextbot/agent-platform`'s Git-PR reconciliation sweep already uses). */
export async function sweepIdleConversationsAcrossAllTenants(
  idleTimeoutMinutes: number = DEFAULT_IDLE_TIMEOUT_MINUTES,
): Promise<{ tenantsChecked: number } & IdleSweepResult> {
  const tenants = await listActiveTenantContexts();
  let abandoned = 0;
  let resolved = 0;
  for (const tenantCtx of tenants) {
    const result = await sweepIdleConversationsForTenant(tenantCtx, idleTimeoutMinutes);
    abandoned += result.abandoned;
    resolved += result.resolved;
  }
  return { tenantsChecked: tenants.length, abandoned, resolved };
}
