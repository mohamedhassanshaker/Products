import { NextResponse, type NextRequest } from 'next/server';
import { withTenantContext } from '@/server/context';
import { requireTenantUser } from '@/server/auth';
import { getRolesService, requirePermission } from '@/server/rbac';
import { parseJsonBody, requireString } from '@/server/common/http/validate';

/** `GET /api/roles` — tenant-realm, requires `roles.read` — ported from
 * `legacy/api/src/modules/rbac/api/roles.controller.ts`'s `list`. */
export async function GET(request: NextRequest): Promise<Response> {
  return withTenantContext(request, async () => {
    const principal = await requireTenantUser(request);
    await requirePermission(principal.userId, 'roles.read');

    const roles = getRolesService();
    return NextResponse.json(await roles.list());
  });
}

/** `POST /api/roles` — tenant-realm, requires `roles.create` — ported from
 * `legacy/api/src/modules/rbac/api/roles.controller.ts`'s `create`. Success is `201`. */
export async function POST(request: NextRequest): Promise<Response> {
  return withTenantContext(request, async () => {
    const principal = await requireTenantUser(request);
    await requirePermission(principal.userId, 'roles.create');

    const body = await parseJsonBody(request);
    const name = requireString(body.name, 'name', { min: 1, max: 100 });
    const description =
      body.description === undefined || body.description === null
        ? null
        : requireString(body.description, 'description', { min: 0, max: 300 });
    const permissionIds = Array.isArray(body.permissionIds)
      ? body.permissionIds.filter((v): v is number => typeof v === 'number')
      : [];

    const roles = getRolesService();
    const created = await roles.create({ name, description, permissionIds });
    return NextResponse.json(created, { status: 201 });
  });
}
