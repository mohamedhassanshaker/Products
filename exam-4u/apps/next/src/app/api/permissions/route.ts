import { NextResponse, type NextRequest } from 'next/server';
import { withTenantContext } from '@/server/context';
import { requireTenantUser } from '@/server/auth';
import { getPermissionsCrudService, requirePermission } from '@/server/rbac';

/** `GET /api/permissions` — tenant-realm, requires `permissions.read` — ported from
 * `legacy/api/src/modules/rbac/api/permissions.controller.ts`'s `list`. */
export async function GET(request: NextRequest): Promise<Response> {
  return withTenantContext(request, async () => {
    const principal = await requireTenantUser(request);
    await requirePermission(principal.userId, 'permissions.read');

    const service = getPermissionsCrudService();
    return NextResponse.json(await service.list());
  });
}
