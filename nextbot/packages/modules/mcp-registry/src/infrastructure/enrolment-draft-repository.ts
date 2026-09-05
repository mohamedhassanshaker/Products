import { and, eq } from "drizzle-orm";
import { generateId, schema, withTenant, type TenantContext, type TenantScopedClient } from "@nextbot/db";

/**
 * Server-side state for the 9-step enrolment wizard (LLD §14.3.2's
 * `mcp_enrolment_draft`, `McpEnrolmentDraftSchema`). `payload` is a partial of every
 * step's input, keyed by step name — never holds a secret, only `credentialId`
 * pointers already written to the vault at step 3 (FR-MCP-16's "sandbox/production
 * captured separately" — each environment gets its own `credentialId`).
 */
export interface DraftPayload {
  identify?: { name: string; description: string | null; backendType: string; ownerUserId: string; criticality: string };
  transport?: {
    bindings: Array<{ environment: string; transport: string; endpointUrl: string | null; stdioCommand: unknown | null }>;
  };
  auth?: {
    bindings: Array<{ environment: string; authMethod: string; credentialId: string | null }>;
  };
  discover?: { manifestHash: string; itemCount: number; probedEnvironment: string };
  classify?: Record<string, { ioClass?: string; approvalTier?: string; enabled?: boolean; descriptionOverride?: string; knowledgeIngestionCandidate?: boolean }>;
  grouping?: Record<string, { capabilityGroupId: string | null }>;
  policy?: unknown;
}

export interface DiscoveredItemSnapshot {
  kind: "Tool" | "Resource" | "Prompt";
  name: string;
  descriptionSource: string;
  schemaJson: unknown;
  schemaHash: string;
}

export interface DraftRow {
  id: string;
  tenantId: string;
  serverId: string | null;
  step: number;
  payload: DraftPayload;
  discoverySnapshot: DiscoveredItemSnapshot[] | null;
  dryRunResult: unknown;
  createdByUserId: string;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

function toDraftRow(row: typeof schema.mcpEnrolmentDraft.$inferSelect): DraftRow {
  return {
    id: row.id,
    tenantId: row.tenantId,
    serverId: row.serverId,
    step: row.step,
    payload: (row.payload ?? {}) as DraftPayload,
    discoverySnapshot: (row.discoverySnapshot as DiscoveredItemSnapshot[] | null) ?? null,
    dryRunResult: row.dryRunResult,
    createdByUserId: row.createdByUserId,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function createDraft(ctx: TenantContext, createdByUserId: string): Promise<DraftRow> {
  const id = generateId();
  return withTenant(ctx, async (db: TenantScopedClient) => {
    await db.insert(schema.mcpEnrolmentDraft).values({ id, tenantId: ctx.tenantId, step: 1, payload: {}, createdByUserId });
    const [row] = await db.select().from(schema.mcpEnrolmentDraft).where(and(eq(schema.mcpEnrolmentDraft.tenantId, ctx.tenantId), eq(schema.mcpEnrolmentDraft.id, id)));
    if (!row) throw new Error(`mcp_enrolment_draft '${id}' was not found immediately after insert`);
    return toDraftRow(row);
  });
}

export async function getDraft(ctx: TenantContext, id: string): Promise<DraftRow | null> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const [row] = await db.select().from(schema.mcpEnrolmentDraft).where(and(eq(schema.mcpEnrolmentDraft.tenantId, ctx.tenantId), eq(schema.mcpEnrolmentDraft.id, id)));
    return row ? toDraftRow(row) : null;
  });
}

/** Merges `patch` into the draft's `payload` (shallow, top-level step keys only — each
 * step owns its whole slice) and bumps `step` to `Math.max(current, atLeastStep)` so
 * the wizard UI always knows the furthest-completed step, without ever letting a
 * later re-edit of an earlier step (e.g. going back to "identify") regress it. */
export async function patchDraft(
  ctx: TenantContext,
  id: string,
  patch: Partial<DraftPayload>,
  atLeastStep: number,
  extra?: { discoverySnapshot?: DiscoveredItemSnapshot[]; dryRunResult?: unknown; serverId?: string },
): Promise<DraftRow> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const [existing] = await db.select().from(schema.mcpEnrolmentDraft).where(and(eq(schema.mcpEnrolmentDraft.tenantId, ctx.tenantId), eq(schema.mcpEnrolmentDraft.id, id)));
    if (!existing) throw new Error(`mcp_enrolment_draft '${id}' not found`);
    const mergedPayload = { ...(existing.payload as DraftPayload), ...patch };
    const nextStep = Math.max(existing.step, atLeastStep);
    await db
      .update(schema.mcpEnrolmentDraft)
      .set({
        payload: mergedPayload as object,
        step: nextStep,
        ...(extra?.discoverySnapshot !== undefined ? { discoverySnapshot: extra.discoverySnapshot as object } : {}),
        ...(extra?.dryRunResult !== undefined ? { dryRunResult: extra.dryRunResult as object } : {}),
        ...(extra?.serverId !== undefined ? { serverId: extra.serverId } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(schema.mcpEnrolmentDraft.tenantId, ctx.tenantId), eq(schema.mcpEnrolmentDraft.id, id)));
    const [row] = await db.select().from(schema.mcpEnrolmentDraft).where(and(eq(schema.mcpEnrolmentDraft.tenantId, ctx.tenantId), eq(schema.mcpEnrolmentDraft.id, id)));
    if (!row) throw new Error(`mcp_enrolment_draft '${id}' not found after update`);
    return toDraftRow(row);
  });
}

export async function deleteDraft(ctx: TenantContext, id: string): Promise<void> {
  await withTenant(ctx, async (db: TenantScopedClient) => {
    await db.delete(schema.mcpEnrolmentDraft).where(and(eq(schema.mcpEnrolmentDraft.tenantId, ctx.tenantId), eq(schema.mcpEnrolmentDraft.id, id)));
  });
}
