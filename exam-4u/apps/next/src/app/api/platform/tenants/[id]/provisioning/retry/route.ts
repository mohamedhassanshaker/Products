import { NextResponse, type NextRequest } from 'next/server';
import { withPlatformAuth } from '@/server/context';
import { getTenantProvisioningService } from '@/server/platform/provisioning';
import { getAuditLogService } from '@/server/platform/audit';
import { getRequestIp } from '@/server/common/http/request-ip.util';

/**
 * `POST /api/platform/tenants/:id/provisioning/retry` — platform-realm, authenticated. Ported behavior
 * from `legacy/api/src/platform/tenants/api/tenants.controller.ts`'s `retryProvisioning`.
 *
 * **Not in this dispatch's originally-enumerated scope list** (which named only suspend/reactivate/
 * soft-delete/update-registration-settings), added anyway as a small, low-risk, directly-adjacent
 * addition — see `docs/plans/nextjs-rewrite-phase2-plan.md`'s "Decisions made" for the full
 * justification: without this route, a tenant whose creation lands in `Failed` status (a real,
 * expected outcome the create-tenant UI must already handle per `docs/design/UX_GUIDELINES.md` §3.3
 * step 6) has **no** recovery path from the console at all — the tenant detail screen's own
 * `provisioningError` panel (§3.2) is specifically designed around this action being available right
 * next to it. Reuses the already-built, already-tested {@link
 * import('@/server/platform/provisioning').TenantProvisioningService.retry} verbatim — no new
 * business logic, purely a new HTTP entry point onto existing, proven code.
 *
 * Legacy returns `202 Accepted` for this route (an "async-flavored" status even though the workflow
 * itself runs synchronously in this app, exactly as `provisionNewTenant` does) — kept identical here
 * for wire-contract parity; see `docs/design/UX_GUIDELINES.md` §3.4's guidance on why the client should
 * not assume the immediately-following `GET .../:id` already reflects `Active`.
 *
 * **Phase 2 sub-slice "2d" retrofit**: writes a `platform.audit_log` row
 * (`tenant.provisioning.retry`) after the retry has already run — a failure to record it never fails
 * this request.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  return withPlatformAuth(request, async (principal) => {
    const { id } = await params;
    const provisioning = await getTenantProvisioningService();
    const tenant = await provisioning.retry(id);

    const audit = await getAuditLogService();
    await audit.record({
      actorType: 'PlatformAdmin',
      actorId: principal.adminId,
      tenantId: tenant.id,
      action: 'tenant.provisioning.retry',
      targetType: 'Tenant',
      targetId: tenant.id,
      summary: { statusAfter: tenant.status },
      ip: getRequestIp(request),
    });

    return NextResponse.json(tenant, { status: 202 });
  });
}
