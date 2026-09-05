import { eq } from "drizzle-orm";
import { schema, withTenant, type TenantContext, type TenantScopedClient } from "@nextbot/db";
import { validateRetentionDays } from "../domain/retention-policy.js";

/** The full retention/residency settings shape (B.8.4's Retention & Residency
 * settings screen) — one row per tenant, 1:1 with `tenant_data_policy`. */
export interface TenantDataPolicyState {
  retentionTranscriptsDays: number;
  retentionToolPayloadsDays: number;
  retentionToolMetadataDays: number;
  retentionPiiDays: number;
  residencyRegion: "UAE" | "EU" | "US";
  allowOutOfRegionInference: boolean;
  purgeLastRunAt: Date | null;
}

/** Reads the tenant's current retention/residency settings (Phase 17, BL-10,
 * extends the Phase 1 `tenant_data_policy` row rather than duplicating it). */
export async function getTenantDataPolicy(ctx: TenantContext): Promise<TenantDataPolicyState | null> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db
      .select()
      .from(schema.tenantDataPolicy)
      .where(eq(schema.tenantDataPolicy.tenantId, ctx.tenantId));
    return rows[0] ?? null;
  });
}

export interface UpdateTenantDataPolicyInput {
  retentionTranscriptsDays?: number;
  retentionTranscriptsIndefinite?: boolean;
  retentionToolPayloadsDays?: number;
  retentionToolPayloadsIndefinite?: boolean;
  retentionToolMetadataDays?: number;
  retentionToolMetadataIndefinite?: boolean;
  retentionPiiDays?: number;
  retentionPiiIndefinite?: boolean;
  residencyRegion?: "UAE" | "EU" | "US";
  allowOutOfRegionInference?: boolean;
}

/**
 * Updates the tenant's retention/residency settings (B.8.4). Every retention field
 * re-runs the same `validateRetentionDays` gate provisioning uses (FR-ADM-06:
 * 0/blank invalid, `-1` only via the explicit `*Indefinite` opt-in) — this admin
 * surface is not allowed to bypass that rule just because the row already exists.
 * Only fields present in `patch` are changed; omitted fields keep their current
 * value.
 */
export async function updateTenantDataPolicy(
  ctx: TenantContext,
  patch: UpdateTenantDataPolicyInput,
): Promise<TenantDataPolicyState> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const existingRows = await db
      .select()
      .from(schema.tenantDataPolicy)
      .where(eq(schema.tenantDataPolicy.tenantId, ctx.tenantId));
    const existing = existingRows[0];
    if (!existing) {
      throw new Error("tenant_data_policy row missing — tenant was not provisioned correctly");
    }

    const next = {
      retentionTranscriptsDays:
        patch.retentionTranscriptsDays !== undefined || patch.retentionTranscriptsIndefinite !== undefined
          ? validateRetentionDays("retentionTranscriptsDays", patch.retentionTranscriptsDays, !!patch.retentionTranscriptsIndefinite)
          : existing.retentionTranscriptsDays,
      retentionToolPayloadsDays:
        patch.retentionToolPayloadsDays !== undefined || patch.retentionToolPayloadsIndefinite !== undefined
          ? validateRetentionDays("retentionToolPayloadsDays", patch.retentionToolPayloadsDays, !!patch.retentionToolPayloadsIndefinite)
          : existing.retentionToolPayloadsDays,
      retentionToolMetadataDays:
        patch.retentionToolMetadataDays !== undefined || patch.retentionToolMetadataIndefinite !== undefined
          ? validateRetentionDays("retentionToolMetadataDays", patch.retentionToolMetadataDays, !!patch.retentionToolMetadataIndefinite)
          : existing.retentionToolMetadataDays,
      retentionPiiDays:
        patch.retentionPiiDays !== undefined || patch.retentionPiiIndefinite !== undefined
          ? validateRetentionDays("retentionPiiDays", patch.retentionPiiDays, !!patch.retentionPiiIndefinite)
          : existing.retentionPiiDays,
      residencyRegion: patch.residencyRegion ?? existing.residencyRegion,
      allowOutOfRegionInference: patch.allowOutOfRegionInference ?? existing.allowOutOfRegionInference,
    };

    await db.update(schema.tenantDataPolicy).set(next).where(eq(schema.tenantDataPolicy.tenantId, ctx.tenantId));
    return { ...next, purgeLastRunAt: existing.purgeLastRunAt };
  });
}

/** Stamps `purge_last_run_at` — called by the retention-purge sweeper
 * (`apps/worker`) after it finishes processing a tenant, regardless of whether any
 * rows were actually deleted (a clean "nothing to purge" run is still a real run). */
export async function markPurgeRun(ctx: TenantContext): Promise<void> {
  await withTenant(ctx, async (db: TenantScopedClient) => {
    await db.update(schema.tenantDataPolicy).set({ purgeLastRunAt: new Date() }).where(eq(schema.tenantDataPolicy.tenantId, ctx.tenantId));
  });
}

/**
 * Phase 10 (BL-07, ADR-0006 §3 / FR-SEC-05): reads whether this tenant has opted into
 * out-of-region model inference — the Model Gateway's region-allowlist filter
 * (`packages/modules/agent-platform`) consults this before routing a call to a
 * provider outside the tenant's own residency region.
 */
export async function getAllowOutOfRegionInference(ctx: TenantContext): Promise<boolean> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db
      .select({ allowOutOfRegionInference: schema.tenantDataPolicy.allowOutOfRegionInference })
      .from(schema.tenantDataPolicy)
      .where(eq(schema.tenantDataPolicy.tenantId, ctx.tenantId));
    return rows[0]?.allowOutOfRegionInference ?? false;
  });
}
