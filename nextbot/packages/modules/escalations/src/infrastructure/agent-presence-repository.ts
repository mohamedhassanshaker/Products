import { and, eq, sql } from "drizzle-orm";
import { schema, withTenant, type TenantContext, type TenantScopedClient } from "@nextbot/db";

/** Target Architecture Blueprint Phase 13 (BL-45, FR-ESC-05, LLD §14.9.2) —
 * `agent_presence` row shape. `state` is informational/self-service only this phase
 * (see `application/agent-presence-service.ts`'s doc comment for why it does not gate
 * claiming); `currentLoad`/`maxConcurrent` are the real enforced concurrency ceiling. */
export type AgentPresenceStateValue = "Available" | "Busy" | "Away" | "Offline";

export interface AgentPresenceRow {
  tenantId: string;
  userId: string;
  state: AgentPresenceStateValue;
  maxConcurrent: number;
  currentLoad: number;
  updatedAt: Date;
}

/** FR-ESC-05's own stated default ceiling ("defaulting a user to Offline/3 on first
 * reference"). */
const DEFAULT_MAX_CONCURRENT = 3;

export async function findAgentPresence(ctx: TenantContext, userId: string): Promise<AgentPresenceRow | null> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db
      .select()
      .from(schema.agentPresence)
      .where(and(eq(schema.agentPresence.tenantId, ctx.tenantId), eq(schema.agentPresence.userId, userId)));
    return (rows[0] as AgentPresenceRow | undefined) ?? null;
  });
}

/** B.5.x's presence overview (also the source for a future queue-level "how many
 * agents are available" indicator) — every presence row for the tenant. */
export async function listAgentPresenceForTenant(ctx: TenantContext): Promise<AgentPresenceRow[]> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db.select().from(schema.agentPresence).where(eq(schema.agentPresence.tenantId, ctx.tenantId));
    return rows as AgentPresenceRow[];
  });
}

/**
 * Idempotently ensures a (tenant, user) presence row exists, defaulting to
 * `Offline`/3/0 on first reference — FR-ESC-05 explicitly requires no separate
 * provisioning step. Concurrency-safe: relies on the composite primary key, catching
 * (never check-then-acting on) a unique-violation from a genuinely concurrent
 * double-provision — the exact same convention `ensureDefaultQueue` already
 * established for `agent_queue`.
 */
export async function ensureAgentPresence(ctx: TenantContext, userId: string): Promise<AgentPresenceRow> {
  const existing = await findAgentPresence(ctx, userId);
  if (existing) return existing;
  try {
    await withTenant(ctx, async (db: TenantScopedClient) => {
      await db.insert(schema.agentPresence).values({
        tenantId: ctx.tenantId,
        userId,
        state: "Offline",
        maxConcurrent: DEFAULT_MAX_CONCURRENT,
        currentLoad: 0,
      });
    });
  } catch {
    // Lost the race to a concurrent caller provisioning the identical row — fall
    // through to re-read below, exactly like `ensureDefaultQueue`.
  }
  const row = await findAgentPresence(ctx, userId);
  if (!row) throw new Error(`ensureAgentPresence: failed to provision or find a presence row for user ${userId}`);
  return row;
}

/** Self-service state toggle (FR-ESC-05's "availability/presence status") — does not
 * touch `currentLoad`/`maxConcurrent`. */
export async function setAgentPresenceState(ctx: TenantContext, userId: string, state: AgentPresenceStateValue): Promise<AgentPresenceRow> {
  await ensureAgentPresence(ctx, userId);
  return withTenant(ctx, async (db: TenantScopedClient) => {
    await db
      .update(schema.agentPresence)
      .set({ state, updatedAt: new Date() })
      .where(and(eq(schema.agentPresence.tenantId, ctx.tenantId), eq(schema.agentPresence.userId, userId)));
    const rows = await db
      .select()
      .from(schema.agentPresence)
      .where(and(eq(schema.agentPresence.tenantId, ctx.tenantId), eq(schema.agentPresence.userId, userId)));
    return rows[0] as AgentPresenceRow;
  });
}

/** Admin-configured per-agent concurrency ceiling — a deliberately separate function
 * from `setAgentPresenceState` so a route can expose the state toggle to any agent
 * for themselves while keeping ceiling configuration on a distinct, more privileged
 * call site (see `apps/web`'s `agent-presence` routes for the actual RBAC split). */
export async function setAgentMaxConcurrent(ctx: TenantContext, userId: string, maxConcurrent: number): Promise<AgentPresenceRow> {
  await ensureAgentPresence(ctx, userId);
  return withTenant(ctx, async (db: TenantScopedClient) => {
    await db
      .update(schema.agentPresence)
      .set({ maxConcurrent, updatedAt: new Date() })
      .where(and(eq(schema.agentPresence.tenantId, ctx.tenantId), eq(schema.agentPresence.userId, userId)));
    const rows = await db
      .select()
      .from(schema.agentPresence)
      .where(and(eq(schema.agentPresence.tenantId, ctx.tenantId), eq(schema.agentPresence.userId, userId)));
    return rows[0] as AgentPresenceRow;
  });
}

/**
 * THE atomic concurrency-ceiling primitive (FR-ESC-05's core correctness mechanic,
 * "silent over-assignment is explicitly called out as the failure this phase exists
 * to prevent"). A single conditional `UPDATE` increments `current_load` only if the
 * row is *still* under its ceiling at the exact moment the statement runs —
 * Postgres's row-level lock inside the `UPDATE` makes this atomic under true
 * concurrency (mirrors `claimEscalationTransition`/`claimToolCallTransition`'s
 * identical CAS shape, applied to a different column/table). **Must** be called with
 * a `db` handle from a transaction that ALSO performs the paired escalation-status
 * CAS-claim (see `escalation-repository.ts#claimEscalationWithCeilingCheck`) — if that
 * later claim loses its own race, the whole transaction (including this increment)
 * rolls back together, so a lost claim never leaves a phantom incremented load. The
 * presence row must already exist (call `ensureAgentPresence` first, outside this
 * transaction — provisioning a default row is independently idempotent and does not
 * need to be atomic with the increment).
 */
export async function tryIncrementCurrentLoadInTx(db: TenantScopedClient, tenantId: string, userId: string): Promise<boolean> {
  const result = await db.execute(sql`
    UPDATE agent_presence
       SET current_load = current_load + 1, updated_at = now()
     WHERE tenant_id = ${tenantId} AND user_id = ${userId} AND current_load < max_concurrent
  `);
  return ((result as unknown as { rowCount: number | null }).rowCount ?? 0) > 0;
}

/** Releases one concurrency slot — called on a terminal escalation transition
 * (`Resolved`/`ReturnedToBot`) or when reassigning an escalation away from its
 * current agent. `GREATEST(..., 0)` is defense-in-depth against ever going negative
 * (a bug elsewhere double-releasing) — the `agent_presence_current_load_nonneg` CHECK
 * constraint would reject a raw negative value outright, but clamping here means a
 * double-release is merely a no-op rather than a hard transaction failure. */
export async function decrementCurrentLoadInTx(db: TenantScopedClient, tenantId: string, userId: string): Promise<void> {
  await db.execute(sql`
    UPDATE agent_presence
       SET current_load = GREATEST(current_load - 1, 0), updated_at = now()
     WHERE tenant_id = ${tenantId} AND user_id = ${userId}
  `);
}
