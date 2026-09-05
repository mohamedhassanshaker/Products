import { NextResponse, type NextRequest } from 'next/server';
import { withPlatformAuth } from '@/server/context';
import { getTenantsService } from '@/server/platform/tenants';
import { getSubscriptionAdminService } from '@/server/platform/billing';
import { parseJsonBody, requireString } from '@/server/common/http/validate';
import { getAuditLogService } from '@/server/platform/audit';
import { getRequestIp } from '@/server/common/http/request-ip.util';

/**
 * `GET /api/platform/tenants/:id/billing` — platform-realm, authenticated (migration plan Phase 2
 * sub-slice "2c", FR-PKG-4/FR-PKG-7). The tenant-detail screen's billing panel's read path. Resolves
 * `id` first via `TenantsService.get` (`404 TENANT_NOT_FOUND` owned by `platform/tenants`, not
 * `platform/billing` — a module doesn't throw another bounded context's not-found code, matching this
 * app's established `AiModelsService.assignToTenant` caller contract) before delegating the actual
 * subscription read to `SubscriptionAdminService`.
 *
 * `subscription: null` means the tenant has no subscription row yet (should not normally happen post-
 * provisioning, but defensively handled the same way `SubscriptionAdminService.getSummary` itself is).
 *
 * **Deliberately out of scope this dispatch**: no `platform.audit_log` write (`platform/audit` doesn't
 * exist yet — a read never needs one anyway); no feature-usage snapshot (`platform/usage` doesn't exist
 * yet — see `SubscriptionAdminService`'s own doc comment for the full reasoning).
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  return withPlatformAuth(request, async () => {
    const { id } = await params;

    const tenants = await getTenantsService();
    await tenants.get(id); // TENANT_NOT_FOUND check, owned by platform/tenants.

    const subscriptions = await getSubscriptionAdminService();
    const subscription = await subscriptions.getSummary(id);
    return NextResponse.json({ subscription });
  });
}

/**
 * `PUT /api/platform/tenants/:id/billing` — platform-realm, authenticated. Direct (non-Stripe)
 * subscription reassignment (`SubscriptionAdminService.reassign`) — the "comp a tenant, or correct a
 * mistake" path named explicitly in this dispatch's scope, distinct from the Stripe-checkout path under
 * `.../billing/checkout-session`. Same `TENANT_NOT_FOUND`-ownership contract as `GET` above.
 *
 * `409 PACKAGE_INACTIVE` if the target package is `isActive: false`; `404 PACKAGE_NOT_FOUND` if
 * `packageId` doesn't resolve to any catalog package.
 *
 * **Phase 2 sub-slice "2d" retrofit**: writes a `platform.audit_log` row
 * (`tenant.subscription_reassigned`) after the reassignment has already committed — a failure to
 * record it never fails this request.
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  return withPlatformAuth(request, async (principal) => {
    const { id } = await params;
    const body = await parseJsonBody(request);
    const packageId = requireString(body.packageId, 'packageId', { min: 1, max: 200 });

    const tenants = await getTenantsService();
    await tenants.get(id); // TENANT_NOT_FOUND check, owned by platform/tenants.

    const subscriptions = await getSubscriptionAdminService();
    const subscription = await subscriptions.reassign(id, packageId);

    const audit = await getAuditLogService();
    await audit.record({
      actorType: 'PlatformAdmin',
      actorId: principal.adminId,
      tenantId: id,
      action: 'tenant.subscription_reassigned',
      targetType: 'Tenant',
      targetId: id,
      summary: { packageId: subscription.packageId, packageKey: subscription.packageKey },
      ip: getRequestIp(request),
    });

    return NextResponse.json({ subscription });
  });
}
