import { NextResponse, type NextRequest } from 'next/server';
import { withPlatformAuth } from '@/server/context';
import { getPackagesService } from '@/server/platform/billing';
import { optionalBoolean, optionalInt, optionalString, parseJsonBody } from '@/server/common/http/validate';
import { getAuditLogService } from '@/server/platform/audit';
import { getRequestIp } from '@/server/common/http/request-ip.util';

/** `GET /api/platform/packages/:id` — platform-realm, authenticated. Ported behavior from
 * `legacy/api/src/platform/packages/api/packages.controller.ts`'s `get`: the full `PackageDetail`
 * (summary fields + `features[]`, the currently-configured `(featureId, limit)` pairs — a package's
 * feature-association picker's initial checked/limit state). `404 PACKAGE_NOT_FOUND` if `id` doesn't
 * resolve to any package. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  return withPlatformAuth(request, async () => {
    const { id } = await params;
    const service = await getPackagesService();
    return NextResponse.json(await service.get(id));
  });
}

/** `PATCH /api/platform/packages/:id` — platform-realm, authenticated. Ported behavior from
 * `legacy/api/src/platform/packages/api/packages.controller.ts`'s `update` (`UpdatePackageDto`): every
 * field optional, `undefined`/absent leaves it unchanged.
 *
 * **Phase 2 sub-slice "2d" retrofit**: writes a `platform.audit_log` row (`package.update`) after the
 * update has already committed — a failure to record it never fails this request. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  return withPlatformAuth(request, async (principal) => {
    const { id } = await params;
    const body = await parseJsonBody(request);
    const key = optionalString(body.key, 'key', { min: 1, max: 100 });
    const name = optionalString(body.name, 'name', { min: 1, max: 200 });
    const description = optionalString(body.description, 'description', { min: 0, max: 500 });
    const priceCents = optionalInt(body.priceCents, 'priceCents', { min: 0 });
    const isActive = optionalBoolean(body.isActive, 'isActive');
    const sortOrder = optionalInt(body.sortOrder, 'sortOrder', { min: 0 });

    const service = await getPackagesService();
    const pkg = await service.update(id, { key, name, description, priceCents, isActive, sortOrder });

    const audit = await getAuditLogService();
    await audit.record({
      actorType: 'PlatformAdmin',
      actorId: principal.adminId,
      tenantId: null,
      action: 'package.update',
      targetType: 'Package',
      targetId: pkg.id,
      summary: { key: pkg.key, isActive: pkg.isActive },
      ip: getRequestIp(request),
    });

    return NextResponse.json(pkg);
  });
}
