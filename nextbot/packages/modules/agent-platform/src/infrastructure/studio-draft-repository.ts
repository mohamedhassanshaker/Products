import { and, eq } from "drizzle-orm";
import { generateId, schema, withTenant, type TenantContext, type TenantScopedClient } from "@nextbot/db";
import { StudioDraftNotFoundError } from "@nextbot/contracts";

/**
 * Target Architecture Blueprint Phase 12 (BL-43, FR-AGT-13, LLD §14.5.5) — server-
 * side state for the Studio's nine-step wizard, mirroring `@nextbot/mcp-registry`'s
 * `mcp_enrolment_draft`/`enrolment-draft-repository.ts` shape and sweep exactly
 * ("same shape and sweep as `mcp_enrolment_draft`, §14.3.2"): `payload` is a
 * partial of every step's own staged input, keyed by step name; each step only
 * ever shallow-merges its own slice, never touching another step's already-staged
 * answers. Unlike the MCP wizard, no step here has a side effect (no secret
 * vaulted, no external call) — the ONE real write happens at Review/submit, via
 * `application/agent-definition-service.ts#createAgentDefinitionVersion` (the
 * exact same write path Text/Design mode use).
 */
export interface StudioDraftPayload {
  purpose?: { instructions: string };
  audience?: { trustLevel?: string; channelTypes?: string[] };
  skills?: { skills: string[] };
  tools?: { capabilityGroups: string[]; maxToolCallsPerTurn?: number };
  knowledge?: { knowledge?: unknown };
  guardrails?: { minConfidenceForAutonomy: number; escalateOn: string[]; trustLevel?: string; maskingFloor?: Record<string, string> };
  modelBudgets?: { modelRoute: string; maxCostUsdPerConversation: string; maxLatencyMsP95: number };
  memory?: { strategy: string; maxTurns: number };
  evals?: { includedSkillEvalCaseIds: string[] };
}

export interface StudioDraftRow {
  id: string;
  tenantId: string;
  agentDefinitionId: string;
  step: number;
  payload: StudioDraftPayload;
  createdByUserId: string;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

function toDraftRow(row: typeof schema.studioDraft.$inferSelect): StudioDraftRow {
  return {
    id: row.id,
    tenantId: row.tenantId,
    agentDefinitionId: row.agentDefinitionId,
    step: row.step,
    payload: (row.payload ?? {}) as StudioDraftPayload,
    createdByUserId: row.createdByUserId,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function createStudioDraft(ctx: TenantContext, agentDefinitionId: string, createdByUserId: string): Promise<StudioDraftRow> {
  const id = generateId();
  return withTenant(ctx, async (db: TenantScopedClient) => {
    await db.insert(schema.studioDraft).values({ id, tenantId: ctx.tenantId, agentDefinitionId, step: 1, payload: {}, createdByUserId });
    const [row] = await db.select().from(schema.studioDraft).where(and(eq(schema.studioDraft.tenantId, ctx.tenantId), eq(schema.studioDraft.id, id)));
    if (!row) throw new Error(`studio_draft '${id}' was not found immediately after insert`);
    return toDraftRow(row);
  });
}

async function requireDraftRow(ctx: TenantContext, id: string): Promise<typeof schema.studioDraft.$inferSelect> {
  const row = await withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db.select().from(schema.studioDraft).where(and(eq(schema.studioDraft.tenantId, ctx.tenantId), eq(schema.studioDraft.id, id)));
    return rows[0];
  });
  if (!row) throw new StudioDraftNotFoundError(id);
  return row;
}

export async function getStudioDraft(ctx: TenantContext, id: string): Promise<StudioDraftRow> {
  return toDraftRow(await requireDraftRow(ctx, id));
}

/** Shallow-merges `patch` into the draft's `payload` (one step's own slice) and
 * bumps `step` to `Math.max(current, atLeastStep)` — mirrors `mcp_enrolment_
 * draft`'s `patchDraft` exactly, including its "never regress the furthest-
 * completed step" guarantee. */
export async function patchStudioDraft(ctx: TenantContext, id: string, patch: Partial<StudioDraftPayload>, atLeastStep: number): Promise<StudioDraftRow> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const [existing] = await db.select().from(schema.studioDraft).where(and(eq(schema.studioDraft.tenantId, ctx.tenantId), eq(schema.studioDraft.id, id)));
    if (!existing) throw new StudioDraftNotFoundError(id);
    const mergedPayload = { ...(existing.payload as StudioDraftPayload), ...patch };
    const nextStep = Math.max(existing.step, atLeastStep);
    await db
      .update(schema.studioDraft)
      .set({ payload: mergedPayload as object, step: nextStep, updatedAt: new Date() })
      .where(and(eq(schema.studioDraft.tenantId, ctx.tenantId), eq(schema.studioDraft.id, id)));
    const [row] = await db.select().from(schema.studioDraft).where(and(eq(schema.studioDraft.tenantId, ctx.tenantId), eq(schema.studioDraft.id, id)));
    if (!row) throw new Error(`studio_draft '${id}' not found after update`);
    return toDraftRow(row);
  });
}

export async function deleteStudioDraft(ctx: TenantContext, id: string): Promise<void> {
  await requireDraftRow(ctx, id);
  await withTenant(ctx, (db: TenantScopedClient) => db.delete(schema.studioDraft).where(and(eq(schema.studioDraft.tenantId, ctx.tenantId), eq(schema.studioDraft.id, id))));
}
