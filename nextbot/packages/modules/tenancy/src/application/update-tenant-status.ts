import { eq } from "drizzle-orm";
import { generateId, schema } from "@nextbot/db";
import { withPlatform, type PlatformClient } from "@nextbot/db/platform-only";
import type { TenantStatusValue } from "./list-all-tenants.js";

/** Result of a successful status change (Tenant Detail screen, NFR-11). */
export interface TenantStatusUpdateResult {
  id: string;
  status: TenantStatusValue;
}

/**
 * Changes a tenant's lifecycle `status` (Active/Suspended/Trial — the existing
 * `tenant_status` Postgres enum, LLD §3.3; not a new vocabulary). Platform Manager
 * console Phase 2 (NFR-11) Tenant Detail screen action, gated behind a confirm
 * dialog client-side since a status change is consequential (e.g. suspending a
 * tenant stops it being picked up by `listActiveTenantContexts()`'s scheduled jobs).
 *
 * Writes exactly one `platform_audit_log_entry` row in the same `withPlatform`
 * transaction as the status update, recording the previous and new status — mirrors
 * `provisionTenant()`'s established audit pattern.
 *
 * @returns `null` if no tenant exists with `tenantId` (caller renders a 404), else
 *   the tenant's id and new status.
 */
export async function updateTenantStatus(
  tenantId: string,
  status: TenantStatusValue,
  actorLabel = "system",
): Promise<TenantStatusUpdateResult | null> {
  return withPlatform(async (db: PlatformClient) => {
    const [existing] = await db
      .select({ id: schema.tenant.id, status: schema.tenant.status })
      .from(schema.tenant)
      .where(eq(schema.tenant.id, tenantId));
    if (!existing) return null;

    const [updated] = await db
      .update(schema.tenant)
      .set({ status, updatedAt: new Date() })
      .where(eq(schema.tenant.id, tenantId))
      .returning({ id: schema.tenant.id, status: schema.tenant.status });

    await db.insert(schema.platformAuditLogEntry).values({
      id: generateId(),
      actorLabel,
      actionType: "tenant.update-status",
      targetTenantId: tenantId,
      details: { previousStatus: existing.status, newStatus: status },
    });

    // `existing` was just confirmed present above (same transaction), so this UPDATE
    // ... WHERE tenant.id = tenantId cannot fail to return a row.
    return updated!;
  });
}
