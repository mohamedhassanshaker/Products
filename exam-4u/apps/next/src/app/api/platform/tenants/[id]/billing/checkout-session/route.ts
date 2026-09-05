import { NextResponse, type NextRequest } from 'next/server';
import { withPlatformAuth } from '@/server/context';
import { getTenantsService } from '@/server/platform/tenants';
import { getBillingCheckoutService } from '@/server/platform/billing';
import { parseJsonBody, requireString } from '@/server/common/http/validate';
import { getAuditLogService } from '@/server/platform/audit';
import { getRequestIp } from '@/server/common/http/request-ip.util';

/**
 * `POST /api/platform/tenants/:id/billing/checkout-session` — platform-realm, authenticated (migration
 * plan Phase 2 sub-slice "2c", FR-PKG-6). **Platform-Admin-initiated only** — self-serve tenant-
 * initiated checkout is Phase 9 scope, matching `BillingCheckoutService`'s own doc comment. Resolves
 * `id` first via `TenantsService.get` (`404 TENANT_NOT_FOUND` owned by `platform/tenants`, the same
 * caller contract every other cross-module route in this app already follows) before delegating the
 * actual Stripe Checkout Session creation to `BillingCheckoutService`.
 *
 * Returns `{url}` — the real Stripe-hosted Checkout URL the admin console redirects the Platform
 * Admin's browser to (or opens in a new tab). Creating a session never itself grants access; the
 * tenant's subscription only moves to `ACTIVE` once `POST /api/platform/billing/webhook` processes a
 * verified `checkout.session.completed` event for it.
 *
 * `503 BILLING_NOT_CONFIGURED` if `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` are empty for this
 * deployment; `404 PACKAGE_NOT_FOUND` / `409 PACKAGE_INACTIVE` for an invalid/inactive target package.
 *
 * **Phase 2 sub-slice "2d" retrofit**: writes a `platform.audit_log` row
 * (`billing.checkout_session_created`) after the Checkout Session has already been created — a
 * failure to record it never fails this request.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  return withPlatformAuth(request, async (principal) => {
    const { id } = await params;
    const body = await parseJsonBody(request);
    const packageId = requireString(body.packageId, 'packageId', { min: 1, max: 200 });

    const tenants = await getTenantsService();
    const tenant = await tenants.get(id); // TENANT_NOT_FOUND check, owned by platform/tenants.

    const checkout = await getBillingCheckoutService();
    const result = await checkout.createCheckoutSession(tenant.id, tenant.name, packageId);

    const audit = await getAuditLogService();
    await audit.record({
      actorType: 'PlatformAdmin',
      actorId: principal.adminId,
      tenantId: id,
      action: 'billing.checkout_session_created',
      targetType: 'Tenant',
      targetId: id,
      summary: { packageId },
      ip: getRequestIp(request),
    });

    return NextResponse.json(result);
  });
}
