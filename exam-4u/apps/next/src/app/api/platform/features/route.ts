import { NextResponse, type NextRequest } from 'next/server';
import { withPlatformAuth } from '@/server/context';
import { getFeaturesService } from '@/server/platform/billing';
import { optionalString, parseJsonBody, requireEnum, requireString } from '@/server/common/http/validate';
import { getAuditLogService } from '@/server/platform/audit';
import { getRequestIp } from '@/server/common/http/request-ip.util';

const RESET_PERIODS = ['NONE', 'DAILY', 'MONTHLY'] as const;

/**
 * `GET /api/platform/features` — platform-realm, authenticated (`withPlatformAuth`). Ported behavior
 * from `legacy/api/src/platform/features/api/features.controller.ts`'s `list` (FR-PKG-7): every
 * catalog feature, each annotated with the `isReferenced` flag the console's Key-lock UX needs.
 */
export async function GET(request: NextRequest): Promise<Response> {
  return withPlatformAuth(request, async () => {
    const service = await getFeaturesService();
    return NextResponse.json({ items: await service.list() });
  });
}

/**
 * `POST /api/platform/features` — platform-realm, authenticated. Ported behavior from
 * `legacy/api/src/platform/features/api/features.controller.ts`'s `create`
 * (`CreateFeatureDto`/FR-PKG-7): `key` (a catalog key shape, validated by `FeaturesService` itself —
 * see that service's own doc comment for why this app validates the pattern in the service rather
 * than a separate DTO layer), `name`, optional `description`, `unit`, `resetPeriod`
 * (`'NONE'|'DAILY'|'MONTHLY'`).
 *
 * **Phase 2 sub-slice "2d" retrofit**: writes a `platform.audit_log` row (`feature.create`) after the
 * create has already committed — a failure to record it never fails this request.
 */
export async function POST(request: NextRequest): Promise<Response> {
  return withPlatformAuth(request, async (principal) => {
    const body = await parseJsonBody(request);
    const key = requireString(body.key, 'key', { min: 1, max: 100 });
    const name = requireString(body.name, 'name', { min: 1, max: 200 });
    const description = optionalString(body.description, 'description', { min: 0, max: 500 });
    const unit = requireString(body.unit, 'unit', { min: 1, max: 50 });
    const resetPeriod = requireEnum(body.resetPeriod, 'resetPeriod', RESET_PERIODS);

    const service = await getFeaturesService();
    const feature = await service.create({ key, name, description, unit, resetPeriod });

    const audit = await getAuditLogService();
    await audit.record({
      actorType: 'PlatformAdmin',
      actorId: principal.adminId,
      tenantId: null,
      action: 'feature.create',
      targetType: 'Feature',
      targetId: feature.id,
      summary: { key: feature.key, name: feature.name },
      ip: getRequestIp(request),
    });

    return NextResponse.json(feature, { status: 201 });
  });
}
