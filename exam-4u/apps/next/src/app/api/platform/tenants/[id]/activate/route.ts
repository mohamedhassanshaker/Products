import { NextResponse, type NextRequest } from 'next/server';
import { withPlatformAuth } from '@/server/context';
import { getTenantsService } from '@/server/platform/tenants';
import { getAuditLogService } from '@/server/platform/audit';
import { getRequestIp } from '@/server/common/http/request-ip.util';

/**
 * `POST /api/platform/tenants/:id/activate` — platform-realm, authenticated. Ported behavior from
 * `legacy/api/src/platform/tenants/api/tenants.controller.ts`'s `reactivate` (route segment name
 * `activate` kept identical to legacy's own URL even though the underlying service method is named
 * `reactivate` — this is the wire contract, not an internal naming choice). `200` with the updated
 * `TenantSummary`; `409 INVALID_TENANT_STATE` if the tenant isn't currently `Suspended`.
 *
 * **Phase 2 sub-slice "2d" retrofit**: writes a `platform.audit_log` row (`tenant.activate`) after the
 * status change has already committed — a failure to record it never fails this request.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  return withPlatformAuth(request, async (principal) => {
    const { id } = await params;
    const service = await getTenantsService();
    const tenant = await service.reactivate(id);

    const audit = await getAuditLogService();
    await audit.record({
      actorType: 'PlatformAdmin',
      actorId: principal.adminId,
      tenantId: tenant.id,
      action: 'tenant.activate',
      targetType: 'Tenant',
      targetId: tenant.id,
      summary: { statusAfter: tenant.status },
      ip: getRequestIp(request),
    });

    return NextResponse.json(tenant);
  });
}
