import { eq } from "drizzle-orm";
import { generateId, schema } from "@nextbot/db";
import { withPlatform, type PlatformClient } from "@nextbot/db/platform-only";
import { readEffectivePlanTierDefaultsWithin } from "./plan-tier-definitions.js";

/** The `tenant_runtime_quota` fields this action writes (Platform Manager console, NFR-11). */
export interface ReseedTenantQuotaResult {
  tenantId: string;
  maxToolCallsPerSecond: number | null;
  maxConcurrentConversations: number | null;
  maxMcpConnectors: number | null;
}

/**
 * Explicit, separate "Re-seed quota from tier defaults" action (Platform Manager
 * console Phase 2, NFR-11) — reads the tenant's *current* plan tier, applies that
 * tier's *current* quota defaults (via {@link readEffectivePlanTierDefaultsWithin},
 * reflecting any plan-tier-definition edits an operator has since made) to the
 * tenant's `tenant_runtime_quota` row.
 *
 * Deliberately a distinct function/endpoint from {@link updateTenantPlanTier} (see
 * that function's doc comment) — a plain tier-label change must never silently
 * clobber a tenant's hand-tuned quota, so overwriting the quota requires this
 * separate, explicitly-named call, gated in the UI behind its own confirm dialog
 * whose copy makes clear this will overwrite the tenant's current quota numbers.
 *
 * Reads the tier defaults and writes the quota + audit row inside one
 * `withPlatform` transaction, so the whole action is atomic: either the quota row
 * and its audit entry both land, or neither does.
 *
 * @returns `null` if no tenant exists with `tenantId` (caller renders a 404), else
 *   the quota fields that were written.
 */
export async function reseedTenantQuotaFromTier(
  tenantId: string,
  actorLabel = "system",
): Promise<ReseedTenantQuotaResult | null> {
  return withPlatform(async (db: PlatformClient) => {
    const [tenantRow] = await db
      .select({ id: schema.tenant.id, planTier: schema.tenant.planTier })
      .from(schema.tenant)
      .where(eq(schema.tenant.id, tenantId));
    if (!tenantRow) return null;

    const defaults = await readEffectivePlanTierDefaultsWithin(db, tenantRow.planTier);

    const [existingQuota] = await db
      .select()
      .from(schema.tenantRuntimeQuota)
      .where(eq(schema.tenantRuntimeQuota.tenantId, tenantId));

    const nextValues = {
      maxToolCallsPerSecond: defaults.maxToolCallsPerSecond,
      maxConcurrentConversations: defaults.maxConcurrentConversations,
      maxMcpConnectors: defaults.maxMcpConnectors,
      updatedAt: new Date(),
    };

    if (existingQuota) {
      await db.update(schema.tenantRuntimeQuota).set(nextValues).where(eq(schema.tenantRuntimeQuota.tenantId, tenantId));
    } else {
      // Defensive: every provisioned tenant gets a tenant_runtime_quota row at
      // creation time, but re-seeding should not fail outright if one is somehow
      // missing (e.g. a tenant provisioned before this table existed).
      await db.insert(schema.tenantRuntimeQuota).values({ tenantId, ...nextValues });
    }

    await db.insert(schema.platformAuditLogEntry).values({
      id: generateId(),
      actorLabel,
      actionType: "tenant.reseed-quota",
      targetTenantId: tenantId,
      details: { planTier: tenantRow.planTier, appliedDefaults: defaults },
    });

    return {
      tenantId,
      maxToolCallsPerSecond: nextValues.maxToolCallsPerSecond,
      maxConcurrentConversations: nextValues.maxConcurrentConversations,
      maxMcpConnectors: nextValues.maxMcpConnectors,
    };
  });
}
