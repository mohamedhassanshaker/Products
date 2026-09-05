import { eq } from "drizzle-orm";
import { schema, withTenant, type TenantContext, type TenantScopedClient } from "@nextbot/db";

/**
 * Target Architecture Blueprint Phase 19 (BL-50, FR-OC-08) — the tenant-opt-in
 * toggle for cross-channel customer identity resolution. Reads
 * `tenant_identity_resolution_policy.enabled`, defaulting to `false` (the safe,
 * fail-closed default FR-OC-08's hard requirement calls for) both when no row exists
 * yet (a tenant provisioned before this phase shipped) and when the row exists but
 * was never explicitly enabled.
 */
export async function getIdentityResolutionPolicy(ctx: TenantContext): Promise<{ enabled: boolean }> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db
      .select({ enabled: schema.tenantIdentityResolutionPolicy.enabled })
      .from(schema.tenantIdentityResolutionPolicy)
      .where(eq(schema.tenantIdentityResolutionPolicy.tenantId, ctx.tenantId));
    return { enabled: rows[0]?.enabled ?? false };
  });
}

/**
 * Sets the tenant's cross-channel identity-linking opt-in. Upserts rather than
 * assuming a row already exists (`provisionTenant()` inserts one going forward, but a
 * pre-Phase-19 tenant has none yet) — an explicit admin action is the ONLY way this
 * value ever changes, matching FR-OC-08's "never an automatic/inferred merge" rule at
 * the configuration layer too.
 */
export async function setIdentityResolutionPolicyEnabled(ctx: TenantContext, enabled: boolean): Promise<void> {
  await withTenant(ctx, async (db: TenantScopedClient) => {
    await db
      .insert(schema.tenantIdentityResolutionPolicy)
      .values({ tenantId: ctx.tenantId, enabled, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: schema.tenantIdentityResolutionPolicy.tenantId,
        set: { enabled, updatedAt: new Date() },
      });
  });
}
