import { NextResponse, type NextRequest } from 'next/server';
import { requireTenantId, withTenantContext } from '@/server/context';
import { requireTenantUser } from '@/server/auth';
import { requirePermission } from '@/server/rbac';
import { getFeatureUsageService } from '@/server/platform/usage';

/**
 * `GET /api/tenant/usage` (FR-PKG-5: "current usage and remaining quota for a tenant's own features
 * are readable by that tenant's Admin") — ported behavior from
 * `legacy/api/src/platform/usage/api/usage.controller.ts`'s `getUsage`, added by the
 * post-Phase-10-e2e closure dispatch that ports `platform/usage` (see
 * `docs/plans/nextjs-rewrite-phase10-plan.md`'s "Post-e2e closure" section).
 *
 * **Guarded by `billing.read`, not legacy's `tenant.settings.manage`** — a deliberate, documented
 * deviation: this app's own `/settings/billing` screen (the natural home for this read, per this
 * dispatch's own brief) already gates its current-plan panel on `billing.read`/`billing.manage`
 * (`GET /api/tenant/billing/plans`'s own doc comment), and a per-feature usage/quota snapshot is the
 * same class of billing-adjacent information — reusing that existing permission keeps one consistent
 * gate for the whole billing screen rather than introducing a second, `tenant.settings.manage`-gated
 * concept legacy only used because `platform/usage` predated this app's `billing.read`/`billing.manage`
 * split.
 *
 * **Structural tenant-tampering prevention** (same rule `GET /api/tenant/billing/plans` documents): the
 * acting tenant is resolved exclusively from `requireTenantId()` (the ALS-resolved id `withTenantContext`
 * establishes from the trusted `x-tenant-id` header) — no route parameter or body field ever carries a
 * tenant id, so a cross-tenant read is structurally inexpressible through this route's own signature.
 *
 * Read-only — never increments any counter (only `requireFeatureLimit`, called from a gated *action*
 * route, ever increments).
 */
export async function GET(request: NextRequest): Promise<Response> {
  return withTenantContext(request, async () => {
    const principal = await requireTenantUser(request);
    await requirePermission(principal.userId, 'billing.read');
    const usage = await getFeatureUsageService();
    const features = await usage.getUsageSnapshot(requireTenantId());
    return NextResponse.json({ features });
  });
}
