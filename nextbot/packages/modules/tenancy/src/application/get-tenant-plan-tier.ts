import { eq } from "drizzle-orm";
import { schema, withTenant, type TenantContext, type TenantScopedClient } from "@nextbot/db";
import type { PlanTierValue } from "@nextbot/contracts";

/**
 * Target Architecture Blueprint Phase 2 (BL-33, FR-AGT-26) — a tenant-scoped read of
 * ITS OWN plan tier, for callers (e.g. `@nextbot/model-gateway`'s route-service) that
 * need to check the tenant's plan tier against `platform_provider_type_policy` without
 * themselves being an allowed `withPlatform()` caller (LLD §3.2 rule 4 restricts that
 * to tenancy provisioning / `/api/internal/ops/**`).
 *
 * `tenant` carries no RLS policy of its own (it IS the tenant identity table — see
 * that table's own doc comment), so this filters explicitly by `ctx.tenantId` as
 * defense in depth (LLD §3.2 rule 4) rather than relying on RLS to narrow the result
 * the way every tenant-scoped table's read path does.
 */
export async function getTenantPlanTier(ctx: TenantContext): Promise<PlanTierValue> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db.select({ planTier: schema.tenant.planTier }).from(schema.tenant).where(eq(schema.tenant.id, ctx.tenantId));
    // Defaults to 'Starter' only in the defensive case of a missing row (should not
    // happen in practice — every tenant has exactly one `tenant` row) — never throws,
    // since a plan-tier lookup failure must not be the reason a route save 500s.
    return rows[0]?.planTier ?? "Starter";
  });
}
