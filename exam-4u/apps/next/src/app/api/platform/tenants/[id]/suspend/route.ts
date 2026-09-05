import { NextResponse, type NextRequest } from 'next/server';
import { withPlatformAuth } from '@/server/context';
import { getTenantsService } from '@/server/platform/tenants';
import { getAuditLogService } from '@/server/platform/audit';
import { getRequestIp } from '@/server/common/http/request-ip.util';

/**
 * `POST /api/platform/tenants/:id/suspend` — platform-realm, authenticated. Ported behavior from
 * `legacy/api/src/platform/tenants/api/tenants.controller.ts`'s `suspend` (FR-MT-1: "a distinct,
 * explicit action from suspension"). `200` with the updated `TenantSummary` on success;
 * `409 INVALID_TENANT_STATE` if the tenant isn't currently `Active` (the client-side UI disables this
 * action outside that state as error prevention, but the server is the real gate — see
 * `docs/design/UX_GUIDELINES.md` §3.4's "benign race" handling for how the console recovers from a
 * `409` here without a blocking error dialog).
 *
 * **Phase 2 sub-slice "2d" retrofit**: writes a `platform.audit_log` row (`tenant.suspend`) after the
 * status change has already committed — a failure to record it never fails this request.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  return withPlatformAuth(request, async (principal) => {
    const { id } = await params;
    const service = await getTenantsService();
    const tenant = await service.suspend(id);

    const audit = await getAuditLogService();
    await audit.record({
      actorType: 'PlatformAdmin',
      actorId: principal.adminId,
      tenantId: tenant.id,
      action: 'tenant.suspend',
      targetType: 'Tenant',
      targetId: tenant.id,
      summary: { statusAfter: tenant.status },
      ip: getRequestIp(request),
    });

    return NextResponse.json(tenant);
  });
}
