import { NextResponse, type NextRequest } from 'next/server';
import { withPlatformAuth } from '@/server/context';
import { getTenantsService } from '@/server/platform/tenants';
import { getAiModelsService } from '@/server/platform/ai-models';
import { parseJsonBody, requireString } from '@/server/common/http/validate';
import { getAuditLogService } from '@/server/platform/audit';
import { getRequestIp } from '@/server/common/http/request-ip.util';

/**
 * `PUT /api/platform/tenants/:id/ai-model` — platform-realm, authenticated. Ported behavior from
 * `legacy/api/src/platform/tenants/api/tenants.controller.ts`'s `assignAiModel`
 * (`AssignAiModelDto`/FR-AI-3). Resolves `id` first via `TenantsService.get` (`404 TENANT_NOT_FOUND`
 * owned by `platform/tenants`, not `platform/ai-models` — a module doesn't throw another bounded
 * context's not-found code, matching `AiModelsService.assignToTenant`'s own documented caller
 * contract) before delegating the actual assignment to `AiModelsService`.
 *
 * Echoes back the tenant's newly-effective model (`{source, openRouterModelId, displayName}`) so the
 * admin console's tenant-detail "AI model" panel reflects the result immediately, without a second
 * round-trip.
 *
 * No tenant-realm read endpoint (`GET /api/tenant/ai-model`) — reading the resolver from the tenant's
 * own side is still not part of this dispatch's admin-facing-CRUD scope.
 *
 * **Phase 2 sub-slice "2d" retrofit**: writes a `platform.audit_log` row (`aiModel.assigned`) after
 * the assignment has already committed — a failure to record it never fails this request.
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  return withPlatformAuth(request, async (principal) => {
    const { id } = await params;
    const body = await parseJsonBody(request);
    const approvedAiModelId = requireString(body.approvedAiModelId, 'approvedAiModelId', { min: 1, max: 200 });

    const tenants = await getTenantsService();
    await tenants.get(id); // TENANT_NOT_FOUND check, owned by platform/tenants.

    const aiModels = await getAiModelsService();
    await aiModels.assignToTenant(id, approvedAiModelId);
    const effectiveModel = await aiModels.resolveEffectiveModel(id);

    const audit = await getAuditLogService();
    await audit.record({
      actorType: 'PlatformAdmin',
      actorId: principal.adminId,
      tenantId: id,
      action: 'aiModel.assigned',
      targetType: 'Tenant',
      targetId: id,
      summary: { approvedAiModelId },
      ip: getRequestIp(request),
    });

    return NextResponse.json(effectiveModel);
  });
}

/**
 * `DELETE /api/platform/tenants/:id/ai-model` — platform-realm, authenticated. Ported behavior from
 * `legacy/api/src/platform/tenants/api/tenants.controller.ts`'s `unassignAiModel` (FR-AI-3) — reverts
 * to resolving via the platform default. Idempotent (always succeeds, even if the tenant already had
 * no explicit assignment) — same `TENANT_NOT_FOUND`-ownership contract as `PUT` above.
 *
 * **Phase 2 sub-slice "2d" retrofit**: writes a `platform.audit_log` row (`aiModel.unassigned`) after
 * the unassignment has already committed — a failure to record it never fails this request.
 */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  return withPlatformAuth(request, async (principal) => {
    const { id } = await params;

    const tenants = await getTenantsService();
    await tenants.get(id); // TENANT_NOT_FOUND check, owned by platform/tenants.

    const aiModels = await getAiModelsService();
    await aiModels.unassignFromTenant(id);
    const effectiveModel = await aiModels.resolveEffectiveModel(id);

    const audit = await getAuditLogService();
    await audit.record({
      actorType: 'PlatformAdmin',
      actorId: principal.adminId,
      tenantId: id,
      action: 'aiModel.unassigned',
      targetType: 'Tenant',
      targetId: id,
      summary: {},
      ip: getRequestIp(request),
    });

    return NextResponse.json(effectiveModel);
  });
}
