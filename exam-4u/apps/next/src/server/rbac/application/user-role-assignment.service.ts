import { LastAdminProtectedError, RoleNotFoundError } from '../domain/errors';
import type { RoleRepository } from '../infrastructure/role.repository';
import type { UserRoleRepository } from '../infrastructure/user-role.repository';

/** Looked up **by name**, never a hardcoded id — ids are `AUTO_INCREMENT` and not guaranteed
 * identical across tenant schemas. */
const TENANT_ADMIN_ROLE_NAME = 'Tenant Admin';

/**
 * Role-assignment logic + the "last Tenant Admin" protection invariant — ported verbatim (logic
 * unchanged) from
 * `legacy/api/src/modules/rbac/application/user-role-assignment.service.ts`'s
 * `UserRoleAssignmentService`. No Route Handler is wired to this service this dispatch (matching
 * legacy's own identical-phase scope: both methods are proven only via direct service calls) — the
 * future landing spot is `users`' `PUT /users/:id/roles` and hard-delete paths (Phase 1 sub-slice 1c).
 */
export class UserRoleAssignmentService {
  constructor(
    private readonly roles: RoleRepository,
    private readonly userRoles: UserRoleRepository,
  ) {}

  /**
   * Full, atomic replace of `userId`'s role grants (de-duplicates `roleIds` silently).
   *
   * @throws {RoleNotFoundError} any target id doesn't exist — rejects the *whole* call, no write
   *   occurs at all.
   * @throws {LastAdminProtectedError} `userId` currently holds `Tenant Admin`, the new set no longer
   *   includes it, and no other user in the tenant holds it — checked whether the new set is empty or
   *   non-empty-but-missing-admin. If the tenant has no `Tenant Admin`-named role at all (defensive
   *   edge case), this check is skipped entirely.
   */
  async replaceRolesForUser(userId: string, roleIds: number[]): Promise<void> {
    const uniqueIds = Array.from(new Set(roleIds));
    const adminRole = await this.roles.findByName(TENANT_ADMIN_ROLE_NAME);

    if (uniqueIds.length > 0) {
      for (const id of uniqueIds) {
        const role = await this.roles.findById(id);
        if (!role) throw new RoleNotFoundError();
      }
      if (adminRole && !uniqueIds.includes(adminRole.id)) {
        await this.assertNotLastAdmin(userId, adminRole.id);
      }
    } else if (adminRole) {
      // Replacing with an EMPTY set still needs the last-admin check.
      await this.assertNotLastAdmin(userId, adminRole.id);
    }

    await this.userRoles.replaceRolesForUser(userId, uniqueIds);
  }

  /**
   * Pre-hard-delete guard — same invariant as removing the admin role via {@link replaceRolesForUser},
   * since deleting the user obviously drops every grant. Resolves with `undefined` for a non-admin
   * user or one-of-several-admins.
   *
   * @throws {LastAdminProtectedError}
   */
  async assertUserDeletable(userId: string): Promise<void> {
    const adminRole = await this.roles.findByName(TENANT_ADMIN_ROLE_NAME);
    if (!adminRole) return;
    await this.assertNotLastAdmin(userId, adminRole.id);
  }

  private async assertNotLastAdmin(userId: string, adminRoleId: number): Promise<void> {
    const currentRoleIds = await this.userRoles.findRoleIdsForUser(userId);
    if (!currentRoleIds.includes(adminRoleId)) return; // Not currently an admin — nothing to protect.

    const holders = await this.userRoles.findUserIdsForRole(adminRoleId);
    const otherHolders = holders.filter((id) => id !== userId);
    if (otherHolders.length === 0) {
      throw new LastAdminProtectedError();
    }
  }
}
