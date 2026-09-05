import { NextResponse, type NextRequest } from 'next/server';
import { requireTenantDataSource, withTenantContext } from '@/server/context';
import { requireTenantUser, UserRepository } from '@/server/auth';
import { getPermissionResolutionService } from '@/server/rbac';
import { NotFoundDomainError } from '@/server/common/errors/domain-error';

/**
 * `GET /api/auth/me` — tenant-realm, authenticated (`requireTenantUser`) — ported behavior from
 * `legacy/api/src/modules/auth/api/auth.controller.ts`'s `me`. Kept as a one-off inline read (not
 * delegated to `AuthService`) matching legacy's own judgment call: a one-line read doesn't need a
 * dedicated service method wrapper.
 *
 * Response: `{ id, email, firstName, lastName, permissions: string[] (sorted) }` — the real resolved
 * union of the user's role grants (`PermissionResolutionService`), not a placeholder, which is exactly
 * why this route is the highest-value smoke check for the whole RBAC pipeline being wired correctly
 * end to end.
 */
export async function GET(request: NextRequest): Promise<Response> {
  return withTenantContext(request, async () => {
    const principal = await requireTenantUser(request);

    const users = new UserRepository(requireTenantDataSource());
    const user = await users.findById(principal.userId);
    if (!user) {
      throw new NotFoundDomainError('User not found.');
    }

    const permissionResolution = getPermissionResolutionService();
    const permissions = await permissionResolution.getEffectivePermissions(principal.userId);

    return NextResponse.json({
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      permissions: Array.from(permissions).sort(),
    });
  });
}
