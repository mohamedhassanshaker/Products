import { eq } from "drizzle-orm";
import { generateId, schema } from "@nextbot/db";
import { withPlatform, type PlatformClient } from "@nextbot/db/platform-only";
import type { PlanTierValue } from "@nextbot/contracts";

/** Result of a successful plan-tier label change (Tenant Detail screen, NFR-11). */
export interface TenantPlanTierUpdateResult {
  id: string;
  planTier: PlanTierValue;
}

/**
 * Changes a tenant's `plan_tier` **label only** (Platform Manager console Phase 2,
 * NFR-11). Deliberately does NOT touch `tenant_runtime_quota` — the plan's own
 * requirement is that a tier-label change never silently rewrites a tenant's live
 * quota, so relabeling can never clobber an Enterprise tenant's hand-tuned quota.
 * An operator who actually wants to reapply the new tier's defaults must invoke the
 * separate, explicit {@link reseedTenantQuotaFromTier} action
 * (`reseed-tenant-quota.ts`) — there is no query param or body flag on this function
 * that can trigger it, by design (this is the "cannot be triggered by the plain
 * tier-label-change endpoint by accident" requirement).
 *
 * Writes exactly one `platform_audit_log_entry` row in the same transaction as the
 * update, recording the previous and new tier.
 *
 * @returns `null` if no tenant exists with `tenantId` (caller renders a 404), else
 *   the tenant's id and new plan tier.
 */
export async function updateTenantPlanTier(
  tenantId: string,
  planTier: PlanTierValue,
  actorLabel = "system",
): Promise<TenantPlanTierUpdateResult | null> {
  return withPlatform(async (db: PlatformClient) => {
    const [existing] = await db
      .select({ id: schema.tenant.id, planTier: schema.tenant.planTier })
      .from(schema.tenant)
      .where(eq(schema.tenant.id, tenantId));
    if (!existing) return null;

    const [updated] = await db
      .update(schema.tenant)
      .set({ planTier, updatedAt: new Date() })
      .where(eq(schema.tenant.id, tenantId))
      .returning({ id: schema.tenant.id, planTier: schema.tenant.planTier });

    await db.insert(schema.platformAuditLogEntry).values({
      id: generateId(),
      actorLabel,
      actionType: "tenant.update-plan-tier",
      targetTenantId: tenantId,
      details: { previousPlanTier: existing.planTier, newPlanTier: planTier },
    });

    // `existing` was just confirmed present above (same transaction), so this UPDATE
    // ... WHERE tenant.id = tenantId cannot fail to return a row.
    return updated!;
  });
}
