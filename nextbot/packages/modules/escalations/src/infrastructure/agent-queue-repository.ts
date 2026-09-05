import { and, eq, isNull } from "drizzle-orm";
import { generateId, schema, withTenant, type TenantContext, type TenantScopedClient } from "@nextbot/db";

export interface AgentQueueRow {
  id: string;
  tenantId: string;
  name: string;
  isDefault: boolean;
  queueExternalRef: string | null;
  businessHours: Record<string, unknown> | null;
  /** Target Architecture Blueprint Phase 13 (BL-45, FR-ESC-05) — an optional SLA
   * target in seconds for escalations routed to this queue; `null` means no SLA is
   * configured (see `escalations.ts` schema's own doc on this column). */
  slaSeconds: number | null;
  deletedAt: Date | null;
  createdAt: Date;
}

/** Lists every non-deleted queue for the tenant (B.5.3's queue picker / mapping table). */
export async function listAgentQueues(ctx: TenantContext): Promise<AgentQueueRow[]> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db
      .select()
      .from(schema.agentQueue)
      .where(and(eq(schema.agentQueue.tenantId, ctx.tenantId), isNull(schema.agentQueue.deletedAt)));
    return rows as AgentQueueRow[];
  });
}

export async function findAgentQueueById(ctx: TenantContext, id: string): Promise<AgentQueueRow | null> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db.select().from(schema.agentQueue).where(and(eq(schema.agentQueue.tenantId, ctx.tenantId), eq(schema.agentQueue.id, id)));
    return (rows[0] as AgentQueueRow | undefined) ?? null;
  });
}

/** The tenant's required fallback/default queue (FR-ESC-03) — `null` only for a
 * tenant that has never had one provisioned yet (see `ensureDefaultQueue`). */
export async function findDefaultAgentQueue(ctx: TenantContext): Promise<AgentQueueRow | null> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db
      .select()
      .from(schema.agentQueue)
      .where(and(eq(schema.agentQueue.tenantId, ctx.tenantId), eq(schema.agentQueue.isDefault, true), isNull(schema.agentQueue.deletedAt)));
    return (rows[0] as AgentQueueRow | undefined) ?? null;
  });
}

/**
 * Idempotently ensures a tenant has a default queue (auto-provisions "General
 * Support" the first time an escalation would otherwise have nowhere to land). A
 * genuinely new tenant that has never opened the Escalation Routing Config screen
 * must still never leave an escalation unassigned (FR-ESC-03) — this is the
 * concrete mechanism for that guarantee. Concurrency-safe: relies on the partial
 * unique index (`tenant_id) WHERE is_default`, catching (not check-then-acting on)
 * a unique-violation from a genuinely concurrent double-provision.
 */
export async function ensureDefaultQueue(ctx: TenantContext): Promise<AgentQueueRow> {
  const existing = await findDefaultAgentQueue(ctx);
  if (existing) return existing;
  const id = generateId();
  try {
    await withTenant(ctx, async (db: TenantScopedClient) => {
      await db.insert(schema.agentQueue).values({ id, tenantId: ctx.tenantId, name: "General Support", isDefault: true });
    });
  } catch {
    // Lost the race to a concurrent caller — fall through to re-read below.
  }
  const row = await findDefaultAgentQueue(ctx);
  if (!row) throw new Error("ensureDefaultQueue: failed to provision or find a default queue");
  return row;
}

export async function createAgentQueue(
  ctx: TenantContext,
  input: {
    name: string;
    isDefault?: boolean;
    queueExternalRef?: string | null;
    businessHours?: Record<string, unknown> | null;
    slaSeconds?: number | null;
  },
): Promise<AgentQueueRow> {
  const id = generateId();
  return withTenant(ctx, async (db: TenantScopedClient) => {
    await db.insert(schema.agentQueue).values({
      id,
      tenantId: ctx.tenantId,
      name: input.name,
      isDefault: input.isDefault ?? false,
      queueExternalRef: input.queueExternalRef ?? null,
      businessHours: input.businessHours ?? null,
      slaSeconds: input.slaSeconds ?? null,
    });
    const rows = await db.select().from(schema.agentQueue).where(and(eq(schema.agentQueue.tenantId, ctx.tenantId), eq(schema.agentQueue.id, id)));
    return rows[0] as AgentQueueRow;
  });
}

export async function updateAgentQueue(
  ctx: TenantContext,
  id: string,
  patch: Partial<{
    name: string;
    isDefault: boolean;
    queueExternalRef: string | null;
    businessHours: Record<string, unknown> | null;
    slaSeconds: number | null;
  }>,
): Promise<void> {
  await withTenant(ctx, async (db: TenantScopedClient) => {
    await db
      .update(schema.agentQueue)
      .set(patch)
      .where(and(eq(schema.agentQueue.tenantId, ctx.tenantId), eq(schema.agentQueue.id, id)));
  });
}
