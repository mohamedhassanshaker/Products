import { NextResponse, type NextRequest } from 'next/server';
import { requireTenantId, withTenantContext } from '@/server/context';
import { requireTenantUser } from '@/server/auth';
import { requirePermission } from '@/server/rbac';
import { getTenantBillingService } from '@/server/platform/billing';
import { getTenantsService } from '@/server/platform/tenants';
import { getAuditLogService } from '@/server/platform/audit';
import { getRequestIp } from '@/server/common/http/request-ip.util';
import { getEnv } from '@/server/config';
import { parseJsonBody, requireString } from '@/server/common/http/validate';

/**
 * `POST /api/tenant/billing/checkout-session` (migration plan Phase 9 sub-slice "9b", FR-PKG-6's
 * self-serve half) — ported behavior from
 * `legacy/api/src/platform/billing/api/tenant-billing.controller.ts`'s `createCheckoutSession`.
 * Tenant-realm counterpart to `POST /api/platform/tenants/:id/billing/checkout-session` — same
 * underlying `BillingCheckoutService`, reached via `requireTenantUser`+`requirePermission` instead of
 * `withPlatformAuth`.
 *
 * **Structural tenant-tampering prevention** (same rule `PATCH /api/tenant/branding` documents): the
 * acting tenant is resolved exclusively from `requireTenantId()` — no route parameter or body field
 * ever carries a tenant id, so a cross-tenant checkout-session creation is not merely rejected, it is
 * inexpressible through this route's own signature.
 *
 * **Read/write permission split**: guarded by the new `billing.manage` (not `billing.read`) —
 * `billing.read` is documented as view-only and this is a Stripe-checkout-initiating mutation (§17.0).
 *
 * Returns `{url}` — the real Stripe-hosted Checkout URL the browser redirects to
 * (`window.location.href = url`, no confirm dialog — §17.3). Creating a session never itself grants
 * access; the tenant's subscription only moves to `ACTIVE` once `POST /api/platform/billing/webhook`
 * processes a verified `checkout.session.completed` event for it.
 *
 * `503 BILLING_NOT_CONFIGURED` if `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` are empty for this
 * deployment; `404 PACKAGE_NOT_FOUND` / `409 PACKAGE_INACTIVE` for an invalid/inactive target package.
 *
 * Audit-logged as a `TenantUser`-attributed action, reusing the exact same `billing.checkout_session_created`
 * action name the Platform-Admin-initiated path uses, so a future audit viewer can correlate both
 * initiation paths for the same underlying event type (matching legacy's own documented rationale).
 */
export async function POST(request: NextRequest): Promise<Response> {
  return withTenantContext(request, async () => {
    const principal = await requireTenantUser(request);
    await requirePermission(principal.userId, 'billing.manage');

    const body = await parseJsonBody(request);
    const packageId = requireString(body.packageId, 'packageId', { min: 1, max: 200 });

    const tenantId = requireTenantId();
    const tenants = await getTenantsService();
    const tenant = await tenants.get(tenantId);

    const env = getEnv();
    const tenantOrigin = `https://${tenant.subdomainSlug}.${env.PUBLIC_APEX_DOMAIN}`;

    const billing = await getTenantBillingService();
    const result = await billing.initiateCheckout(tenantId, tenant.name, tenantOrigin, packageId);

    const audit = await getAuditLogService();
    await audit.record({
      actorType: 'TenantUser',
      actorId: principal.userId,
      tenantId,
      action: 'billing.checkout_session_created',
      targetType: 'Tenant',
      targetId: tenantId,
      summary: { packageId, initiatedBy: 'TenantAdmin' },
      ip: getRequestIp(request),
    });

    return NextResponse.json(result, { status: 201 });
  });
}
