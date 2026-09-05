import { NextResponse, type NextRequest } from 'next/server';
import { withTenantContext } from '@/server/context';
import { requireTenantUser } from '@/server/auth';
import { requirePermission } from '@/server/rbac';
import { getUsersService } from '@/server/users';
import { parseJsonBody } from '@/server/common/http/validate';
import { ValidationFailedError } from '@/server/common/errors/domain-error';

/** `PUT /api/users/:id/roles` — requires `users.assign_roles`. Atomic full replace of `id`'s role
 * grants (FR-IAM-7) — thin delegation to `UsersService.replaceRoles`, which itself delegates to
 * `rbac`'s `UserRoleAssignmentService` (the single implementation of the last-admin-protection rule). */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  return withTenantContext(request, async () => {
    const principal = await requireTenantUser(request);
    await requirePermission(principal.userId, 'users.assign_roles');
    const { id } = await params;

    const body = await parseJsonBody(request);
    if (!Array.isArray(body.roleIds) || !body.roleIds.every((v) => typeof v === 'number')) {
      throw new ValidationFailedError([{ field: 'roleIds', constraint: 'roleIds must be an array of numbers.' }]);
    }

    const updated = await getUsersService().replaceRoles(id, body.roleIds as number[]);
    return NextResponse.json(updated);
  });
}
