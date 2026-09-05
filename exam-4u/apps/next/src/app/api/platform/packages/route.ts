import { NextResponse, type NextRequest } from 'next/server';
import { withPlatformAuth } from '@/server/context';
import { getPackagesService } from '@/server/platform/billing';
import { optionalBoolean, optionalInt, optionalString, parseJsonBody, requireInt, requireString } from '@/server/common/http/validate';
import { getAuditLogService } from '@/server/platform/audit';
import { getRequestIp } from '@/server/common/http/request-ip.util';

/**
 * `GET /api/platform/packages` — platform-realm, authenticated. Ported behavior from
 * `legacy/api/src/platform/packages/api/packages.controller.ts`'s `list`: `?activeOnly=true` narrows
 * to `isActive: true` packages (a future tenant-subscription reassignment dropdown's source data, not
 * consumed by any UI this dispatch); omitted/anything else returns the full catalog (this dispatch's
 * own Packages list screen's default).
 */
export async function GET(request: NextRequest): Promise<Response> {
  return withPlatformAuth(request, async () => {
    const activeOnly = request.nextUrl.searchParams.get('activeOnly') === 'true';
    const service = await getPackagesService();
    const items = activeOnly ? await service.listActive() : await service.list();
    return NextResponse.json({ items });
  });
}

/**
 * `POST /api/platform/packages` — platform-realm, authenticated. Ported behavior from
 * `legacy/api/src/platform/packages/api/packages.controller.ts`'s `create` (`CreatePackageDto`,
 * FR-PKG-7): `key` (catalog key shape, validated by `PackagesService` itself), `name`, optional
 * `description`, `priceCents` (whole-cent integer — the client converts a decimal display amount to
 * cents before submitting), optional `isActive` (defaults `true`), optional `sortOrder` (defaults `0`).
 * `currency` is deliberately not client-supplied — platform-fixed `'usd'`, set server-side.
 *
 * **Phase 2 sub-slice "2d" retrofit**: writes a `platform.audit_log` row (`package.create`) after the
 * create has already committed — a failure to record it never fails this request.
 */
export async function POST(request: NextRequest): Promise<Response> {
  return withPlatformAuth(request, async (principal) => {
    const body = await parseJsonBody(request);
    const key = requireString(body.key, 'key', { min: 1, max: 100 });
    const name = requireString(body.name, 'name', { min: 1, max: 200 });
    const description = optionalString(body.description, 'description', { min: 0, max: 500 });
    const priceCents = requireInt(body.priceCents, 'priceCents', { min: 0 });
    const isActive = optionalBoolean(body.isActive, 'isActive');
    const sortOrder = optionalInt(body.sortOrder, 'sortOrder', { min: 0 });

    const service = await getPackagesService();
    const pkg = await service.create({ key, name, description, priceCents, isActive, sortOrder });

    const audit = await getAuditLogService();
    await audit.record({
      actorType: 'PlatformAdmin',
      actorId: principal.adminId,
      tenantId: null,
      action: 'package.create',
      targetType: 'Package',
      targetId: pkg.id,
      summary: { key: pkg.key, name: pkg.name, priceCents: pkg.priceCents },
      ip: getRequestIp(request),
    });

    return NextResponse.json(pkg, { status: 201 });
  });
}
