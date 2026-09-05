import { NextResponse, type NextRequest } from 'next/server';
import { withTenantContext } from '@/server/context';
import { requireTenantUser } from '@/server/auth';
import { getRolesService, requirePermission, RoleNotFoundError } from '@/server/rbac';
import { parseJsonBody } from '@/server/common/http/validate';
import { ValidationFailedError } from '@/server/common/errors/domain-error';

function parseRoleId(raw: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id)) throw new RoleNotFoundError();
  return id;
}

/** `PUT /api/roles/:id/permissions` — requires `roles.update` — full, atomic replace of a role's
 * permission grants. Allowed on system roles too (only identity — rename/delete — is protected). */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  return withTenantContext(request, async () => {
    const principal = await requireTenantUser(request);
    await requirePermission(principal.userId, 'roles.update');
    const { id } = await params;

    const body = await parseJsonBody(request);
    if (!Array.isArray(body.permissionIds) || !body.permissionIds.every((v) => typeof v === 'number')) {
      throw new ValidationFailedError([{ field: 'permissionIds', constraint: 'permissionIds must be an array of numbers.' }]);
    }

    const updated = await getRolesService().replacePermissions(parseRoleId(id), body.permissionIds as number[]);
    return NextResponse.json(updated);
  });
}
