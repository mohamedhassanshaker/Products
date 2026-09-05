import { NextResponse, type NextRequest } from 'next/server';
import { withPlatformAuth } from '@/server/context';
import { getFeaturesService } from '@/server/platform/billing';
import { optionalString, parseJsonBody, requireEnum } from '@/server/common/http/validate';
import { getAuditLogService } from '@/server/platform/audit';
import { getRequestIp } from '@/server/common/http/request-ip.util';

const RESET_PERIODS = ['NONE', 'DAILY', 'MONTHLY'] as const;

/** `GET /api/platform/features/:id` — platform-realm, authenticated. Ported behavior from
 * `legacy/api/src/platform/features/api/features.controller.ts`'s `get`. `404 FEATURE_NOT_FOUND` if
 * `id` doesn't resolve to any catalog feature. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  return withPlatformAuth(request, async () => {
    const { id } = await params;
    const service = await getFeaturesService();
    return NextResponse.json(await service.get(id));
  });
}

/**
 * `PATCH /api/platform/features/:id` — platform-realm, authenticated. Ported behavior from
 * `legacy/api/src/platform/features/api/features.controller.ts`'s `update` (`UpdateFeatureDto`):
 * every field optional, `undefined`/absent leaves it unchanged. `key` is accepted (unlike a narrower
 * identity-fields-only DTO) because a not-yet-referenced feature's key *is* editable —
 * `409 FEATURE_KEY_IMMUTABLE` is the runtime enforcement point (`FeaturesService.update`), not a fixed
 * request shape.
 *
 * **Phase 2 sub-slice "2d" retrofit**: writes a `platform.audit_log` row (`feature.update`) after the
 * update has already committed — a failure to record it never fails this request.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  return withPlatformAuth(request, async (principal) => {
    const { id } = await params;
    const body = await parseJsonBody(request);
    const key = optionalString(body.key, 'key', { min: 1, max: 100 });
    const name = optionalString(body.name, 'name', { min: 1, max: 200 });
    const description = optionalString(body.description, 'description', { min: 0, max: 500 });
    const unit = optionalString(body.unit, 'unit', { min: 1, max: 50 });
    const resetPeriod = body.resetPeriod === undefined ? undefined : requireEnum(body.resetPeriod, 'resetPeriod', RESET_PERIODS);

    const service = await getFeaturesService();
    const feature = await service.update(id, { key, name, description, unit, resetPeriod });

    const audit = await getAuditLogService();
    await audit.record({
      actorType: 'PlatformAdmin',
      actorId: principal.adminId,
      tenantId: null,
      action: 'feature.update',
      targetType: 'Feature',
      targetId: feature.id,
      summary: { key: feature.key, name: feature.name },
      ip: getRequestIp(request),
    });

    return NextResponse.json(feature);
  });
}

/** `DELETE /api/platform/features/:id` — platform-realm, authenticated. Ported behavior from
 * `legacy/api/src/platform/features/api/features.controller.ts`'s `delete` (FR-PKG-7): hard-deletes a
 * catalog feature. `409 FEATURE_IN_USE` if any package still references it (remove it from every
 * package's feature configuration first); `404 FEATURE_NOT_FOUND` if `id` doesn't resolve to any
 * feature. `204` (no body) on success — matches legacy's own `HttpStatus.NO_CONTENT`.
 *
 * **Phase 2 sub-slice "2d" retrofit**: writes a `platform.audit_log` row (`feature.delete`) after the
 * delete has already committed — a failure to record it never fails this request. */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  return withPlatformAuth(request, async (principal) => {
    const { id } = await params;
    const service = await getFeaturesService();
    await service.delete(id);

    const audit = await getAuditLogService();
    await audit.record({
      actorType: 'PlatformAdmin',
      actorId: principal.adminId,
      tenantId: null,
      action: 'feature.delete',
      targetType: 'Feature',
      targetId: id,
      summary: {},
      ip: getRequestIp(request),
    });

    return new NextResponse(null, { status: 204 });
  });
}
