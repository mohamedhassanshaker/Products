import { NextResponse, type NextRequest } from 'next/server';
import { requireTenantId, withTenantContext } from '@/server/context';
import { requireTenantUser } from '@/server/auth';
import { requirePermission } from '@/server/rbac';
import { getTenantBillingService } from '@/server/platform/billing';

/**
 * `GET /api/tenant/billing/plans` (migration plan Phase 9 sub-slice "9b", FR-PKG-6's self-serve half)
 * — ported behavior from `legacy/api/src/platform/billing/api/tenant-billing.controller.ts`'s
 * `getPlans`. The plan-upgrade screen's (`/settings/billing`) source data: every active catalog
 * package plus the tenant's current plan/subscription status. Guarded by `billing.read` only (a
 * future read-only role could see the catalog without being able to spend money — see
 * `docs/design/UX_GUIDELINES.md` §17.0) — deliberately *not* `billing.manage`.
 *
 * **Structural tenant-tampering prevention** (same rule `PATCH /api/tenant/branding` documents): the
 * acting tenant is resolved exclusively from `requireTenantId()` (the ALS-resolved id `withTenantContext`
 * establishes from the trusted `x-tenant-id` header) — no route parameter or body field ever carries a
 * tenant id, so a cross-tenant read is structurally inexpressible through this route's own signature.
 *
 * Read-only, no audit write (mirrors `GET /api/tenant/branding`'s own identical pattern).
 */
export async function GET(request: NextRequest): Promise<Response> {
  return withTenantContext(request, async () => {
    const principal = await requireTenantUser(request);
    await requirePermission(principal.userId, 'billing.read');
    const plans = await getTenantBillingService().then((service) => service.getPlans(requireTenantId()));
    return NextResponse.json(plans);
  });
}
