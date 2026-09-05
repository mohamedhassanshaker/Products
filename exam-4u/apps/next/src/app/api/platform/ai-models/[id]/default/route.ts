import { NextResponse, type NextRequest } from 'next/server';
import { withPlatformAuth } from '@/server/context';
import { getAiModelsService } from '@/server/platform/ai-models';
import { getAuditLogService } from '@/server/platform/audit';
import { getRequestIp } from '@/server/common/http/request-ip.util';

/**
 * `PUT /api/platform/ai-models/:id/default` — platform-realm, authenticated. Ported behavior from
 * `legacy/api/src/platform/ai-models/api/ai-models.controller.ts`'s `setDefault` (FR-AI-2): atomically
 * designates `id` the new platform default. `404 MODEL_NOT_FOUND`; `409 MODEL_DISABLED` if the target
 * model is currently disabled (the platform default is always enabled).
 *
 * **Phase 2 sub-slice "2d" retrofit**: writes a `platform.audit_log` row (`aiModel.default_changed`)
 * after the change has already committed — a failure to record it never fails this request.
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  return withPlatformAuth(request, async (principal) => {
    const { id } = await params;
    const service = await getAiModelsService();
    const model = await service.setDefault(id);

    const audit = await getAuditLogService();
    await audit.record({
      actorType: 'PlatformAdmin',
      actorId: principal.adminId,
      tenantId: null,
      action: 'aiModel.default_changed',
      targetType: 'ApprovedAiModel',
      targetId: model.id,
      summary: { openRouterModelId: model.openRouterModelId },
      ip: getRequestIp(request),
    });

    return NextResponse.json(model);
  });
}
