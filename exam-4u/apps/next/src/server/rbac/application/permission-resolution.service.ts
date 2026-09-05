import { getRequestContext } from '@/server/context';
import type { UserRoleRepository } from '../infrastructure/user-role.repository';

/**
 * Resolves a tenant user's effective (union-of-all-roles) permission-name set — ported verbatim
 * (logic unchanged) from
 * `legacy/api/src/modules/rbac/application/permission-resolution.service.ts`'s
 * `PermissionResolutionService`. This is the RBAC module's **sole** deny/allow decision point; every
 * other RBAC surface (`requirePermission`, `GET /auth/me`'s permissions field) goes through this one
 * function.
 *
 * **Fail-closed/default-deny, exhaustively** (ported verbatim from legacy, verified by this module's
 * own unit tests):
 * - A user with **zero roles** resolves to an **empty `Set`** — never throws, never defaults to
 *   "allow everything".
 * - A role with zero permission grants contributes nothing to the union but never affects other
 *   roles' grants.
 * - A nonexistent/stale `userId` resolves to an empty `Set` identically to "zero roles" — this
 *   service never validates the user's existence (that's `GET /auth/me`'s own explicit
 *   `UserRepository.findById` check, an unrelated concern).
 * - There is **no code path anywhere in this class that returns "allow everything"** — every miss is
 *   expressed as absence from the returned `Set`.
 *
 * **Per-request memoization**: the resolved `Set` is cached on the ALS
 * {@link import('@/server/context').RequestContext.effectivePermissions} the first time it's computed
 * within a request (populated by `withTenantContext`), so a handler checking multiple permissions (or
 * also reading permissions for display) never re-runs the `user_role`/`role_permission`/`permission`
 * join more than once per request. Outside any request context (e.g. a script), memoization is
 * silently skipped — every call re-queries; a performance-only difference, never a correctness one,
 * since the query itself is always scoped by `userId`.
 */
export class PermissionResolutionService {
  constructor(private readonly userRoles: UserRoleRepository) {}

  async getEffectivePermissions(userId: string): Promise<Set<string>> {
    const ctx = getRequestContext();
    if (ctx?.effectivePermissions) {
      return ctx.effectivePermissions;
    }

    const names = await this.userRoles.findEffectivePermissionNames(userId);
    const resolved = new Set(names);

    if (ctx) {
      ctx.effectivePermissions = resolved;
    }
    return resolved;
  }

  async hasPermission(userId: string, permission: string): Promise<boolean> {
    const permissions = await this.getEffectivePermissions(userId);
    return permissions.has(permission);
  }
}
