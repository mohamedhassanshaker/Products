import { NextResponse, type NextRequest } from 'next/server';
import { withPlatformAuth } from '@/server/context';
import { getAiModelsService } from '@/server/platform/ai-models';
import { parseJsonBody, requireString } from '@/server/common/http/validate';
import { getAuditLogService } from '@/server/platform/audit';
import { getRequestIp } from '@/server/common/http/request-ip.util';

/**
 * `GET /api/platform/ai-models` — platform-realm, authenticated (`withPlatformAuth`). Ported behavior
 * from `legacy/api/src/platform/ai-models/api/ai-models.controller.ts`'s `list` (FR-AI-2):
 * `?includeDisabled=true` returns the full allowlist including disabled rows (the Platform Admin
 * catalog screen's own toggle); omitted returns only enabled rows (the per-tenant assignment
 * dropdown's source list).
 *
 * The actual OpenRouter/LLM call path that *consumes* `AiModelResolver.resolve()` is still Phase 5's
 * job per the migration plan's own phase sequence — this module remains data-model/admin-CRUD only.
 */
export async function GET(request: NextRequest): Promise<Response> {
  return withPlatformAuth(request, async () => {
    const includeDisabled = request.nextUrl.searchParams.get('includeDisabled') === 'true';
    const service = await getAiModelsService();
    return NextResponse.json({ items: await service.list(includeDisabled) });
  });
}

/**
 * `POST /api/platform/ai-models` — platform-realm, authenticated. Ported behavior from
 * `legacy/api/src/platform/ai-models/api/ai-models.controller.ts`'s `approve`
 * (`ApproveAiModelDto`/FR-AI-2): `openRouterModelId`, `displayName`. Format validation (`provider/
 * model` shape) happens in `AiModelsService.approve` (`400 INVALID_MODEL_ID`), never only here — this
 * route only guards against a non-string/oversized/empty payload, matching legacy's identical
 * DTO-vs-service split.
 *
 * **Phase 2 sub-slice "2d" retrofit**: writes a `platform.audit_log` row (`aiModel.approved`) after
 * the approval has already committed — a failure to record it never fails this request.
 */
export async function POST(request: NextRequest): Promise<Response> {
  return withPlatformAuth(request, async (principal) => {
    const body = await parseJsonBody(request);
    const openRouterModelId = requireString(body.openRouterModelId, 'openRouterModelId', { min: 1, max: 200 });
    const displayName = requireString(body.displayName, 'displayName', { min: 1, max: 200 });

    const service = await getAiModelsService();
    const model = await service.approve({ openRouterModelId, displayName });

    const audit = await getAuditLogService();
    await audit.record({
      actorType: 'PlatformAdmin',
      actorId: principal.adminId,
      tenantId: null,
      action: 'aiModel.approved',
      targetType: 'ApprovedAiModel',
      targetId: model.id,
      summary: { openRouterModelId: model.openRouterModelId, isPlatformDefault: model.isPlatformDefault },
      ip: getRequestIp(request),
    });

    return NextResponse.json(model, { status: 201 });
  });
}
