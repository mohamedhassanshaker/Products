import { ForbiddenDomainError } from '@/server/common/errors/domain-error';
import { requireTenantDataSource } from '@/server/context';
import { PermissionResolutionService } from '../application/permission-resolution.service';
import { UserRoleRepository } from '../infrastructure/user-role.repository';

/**
 * The Route-Handler-callable equivalent of legacy's `PermissionsGuard`/`@RequiresPermission`
 * decorator pair — this app has no NestJS guard/decorator mechanism, so every permission-gated Route
 * Handler calls this helper explicitly (after `requireTenantUser`, mirroring legacy's own
 * `@UseGuards(JwtAuthGuard, PermissionsGuard)` **ordering**: authentication must already be proven
 * before this runs — the caller is responsible for calling `requireTenantUser` first).
 *
 * A Route Handler with **no** permission requirement simply never calls this function at all — the
 * exact equivalent of legacy's "no `@RequiresPermission` metadata → authentication-only route, allowed
 * without ever calling `getEffectivePermissions`" branch. Passing zero `permissions` here is the same
 * allow-without-checking outcome, explicit rather than implicit.
 *
 * Multiple permission names are AND-ed (the caller must hold every one) — matching every real route
 * in this codebase's own usage; there is no OR variant.
 *
 * @throws {ForbiddenDomainError} listing exactly the missing permission name(s), joined with `, ` —
 *   matches legacy's exact message format.
 */
export async function requirePermission(userId: string, ...permissions: string[]): Promise<void> {
  if (permissions.length === 0) return;

  const service = new PermissionResolutionService(new UserRoleRepository(requireTenantDataSource()));
  const effective = await service.getEffectivePermissions(userId);
  const missing = permissions.filter((p) => !effective.has(p));

  if (missing.length > 0) {
    throw new ForbiddenDomainError(`Missing required permission(s): ${missing.join(', ')}.`);
  }
}
