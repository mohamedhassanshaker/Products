import { NextResponse, type NextRequest } from 'next/server';
import { withPlatformAuth } from '@/server/context';
import { getTenantsService } from '@/server/platform/tenants';
import { getAuditLogService } from '@/server/platform/audit';
import { getRequestIp } from '@/server/common/http/request-ip.util';

/**
 * `POST /api/platform/tenants/:id/soft-delete` — platform-realm, authenticated.
 *
 * **No legacy HTTP surface to port from** — `legacy/api/src/platform/tenants/api/tenants.controller.ts`
 * never wired a route to `TenantsService.softDelete` (only `create`/`suspend`/`reactivate`/
 * `provisioning/retry`/branding/registration-settings/usage/subscription/ai-model exist there); this is
 * a genuinely new HTTP surface for an already-real, already-tested service method
 * (`docs/plans/nextjs-rewrite-phase2-plan.md`'s "Decisions made" explains why a dedicated `POST
 * .../soft-delete` route was chosen over an HTTP `DELETE` — a soft-delete is a state transition with a
 * response body, not a resource removal with an empty `204`, so it follows this controller's own
 * `suspend`/`activate` action-route convention rather than REST's literal `DELETE` verb).
 *
 * `200` with the updated `TenantSummary` (now carrying `deletedAt`/`purgeAfterAt`) on success;
 * `404 TENANT_NOT_FOUND` if `id` doesn't resolve to any tenant, or the tenant is already soft-deleted
 * (idempotency safety — see `TenantsService.softDelete`'s own doc comment).
 *
 * **Phase 2 sub-slice "2d" retrofit**: writes a `platform.audit_log` row (`tenant.soft_delete`) after
 * the soft-delete has already committed — a failure to record it never fails this request. No legacy
 * action-name precedent to port from (this route has none — see this file's own header comment); named
 * `tenant.soft_delete` to match this app's own `snake_case`-suffix convention for its other
 * legacy-precedent-free action (`aiModel.default_changed` uses camelCase for its noun half but
 * snake_case for the verb-phrase half — this name follows that same shape).
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  return withPlatformAuth(request, async (principal) => {
    const { id } = await params;
    const service = await getTenantsService();
    const tenant = await service.softDelete(id);

    const audit = await getAuditLogService();
    await audit.record({
      actorType: 'PlatformAdmin',
      actorId: principal.adminId,
      tenantId: tenant.id,
      action: 'tenant.soft_delete',
      targetType: 'Tenant',
      targetId: tenant.id,
      summary: { deletedAt: tenant.deletedAt, purgeAfterAt: tenant.purgeAfterAt },
      ip: getRequestIp(request),
    });

    return NextResponse.json(tenant);
  });
}
