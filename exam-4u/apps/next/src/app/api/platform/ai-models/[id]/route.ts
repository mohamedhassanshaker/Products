import { NextResponse, type NextRequest } from 'next/server';
import { withPlatformAuth } from '@/server/context';
import { getAiModelsService } from '@/server/platform/ai-models';
import { optionalBoolean, optionalString, parseJsonBody } from '@/server/common/http/validate';
import { getAuditLogService } from '@/server/platform/audit';
import { getRequestIp } from '@/server/common/http/request-ip.util';

/** `GET /api/platform/ai-models/:id` — platform-realm, authenticated. Ported behavior from
 * `legacy/api/src/platform/ai-models/api/ai-models.controller.ts`'s `get`. `404 MODEL_NOT_FOUND` if
 * `id` doesn't resolve to any allowlist row. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  return withPlatformAuth(request, async () => {
    const { id } = await params;
    const service = await getAiModelsService();
    return NextResponse.json(await service.get(id));
  });
}

/** `PATCH /api/platform/ai-models/:id` — platform-realm, authenticated. Ported behavior from
 * `legacy/api/src/platform/ai-models/api/ai-models.controller.ts`'s `update`
 * (`UpdateAiModelDto`/FR-AI-2): `displayName` update and/or `isEnabled` toggle.
 * `openRouterModelId` is deliberately not editable here — it's the allowlist's own unique key.
 * `409 DEFAULT_MODEL_REQUIRED` if `isEnabled: false` is requested for the current platform default.
 *
 * **Phase 2 sub-slice "2d" retrofit**: writes a `platform.audit_log` row (`aiModel.updated`) after
 * the update has already committed — a failure to record it never fails this request. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  return withPlatformAuth(request, async (principal) => {
    const { id } = await params;
    const body = await parseJsonBody(request);
    const displayName = optionalString(body.displayName, 'displayName', { min: 1, max: 200 });
    const isEnabled = optionalBoolean(body.isEnabled, 'isEnabled');

    const service = await getAiModelsService();
    const model = await service.update(id, { displayName, isEnabled });

    const audit = await getAuditLogService();
    await audit.record({
      actorType: 'PlatformAdmin',
      actorId: principal.adminId,
      tenantId: null,
      action: 'aiModel.updated',
      targetType: 'ApprovedAiModel',
      targetId: model.id,
      summary: { displayName: model.displayName, isEnabled: model.isEnabled },
      ip: getRequestIp(request),
    });

    return NextResponse.json(model);
  });
}

/** `DELETE /api/platform/ai-models/:id` — platform-realm, authenticated. Ported behavior from
 * `legacy/api/src/platform/ai-models/api/ai-models.controller.ts`'s `remove` (FR-AI-2): hard-deletes an
 * allowlist entry. `404 MODEL_NOT_FOUND`; `409 DEFAULT_MODEL_REQUIRED` if `id` is the current platform
 * default; `409 MODEL_IN_USE` (`details.tenantCount`) if any tenant is still explicitly assigned to it.
 * `204` (no body) on success.
 *
 * **Phase 2 sub-slice "2d" retrofit**: writes a `platform.audit_log` row (`aiModel.removed`) after
 * the delete has already committed — a failure to record it never fails this request. */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  return withPlatformAuth(request, async (principal) => {
    const { id } = await params;
    const service = await getAiModelsService();
    await service.remove(id);

    const audit = await getAuditLogService();
    await audit.record({
      actorType: 'PlatformAdmin',
      actorId: principal.adminId,
      tenantId: null,
      action: 'aiModel.removed',
      targetType: 'ApprovedAiModel',
      targetId: id,
      summary: {},
      ip: getRequestIp(request),
    });

    return new NextResponse(null, { status: 204 });
  });
}
