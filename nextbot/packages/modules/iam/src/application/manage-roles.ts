import {
  RoleNameDuplicateError,
  RoleNotFoundInTenantError,
  SystemRoleImmutableError,
  type PermissionMatrix,
} from "@nextbot/contracts";
import type { TenantContext } from "@nextbot/db";
import {
  findRoleByName,
  findRoleById,
  insertRole,
  listRoles as listRolesRepo,
  updateRole as updateRoleRepo,
  type RoleRow,
} from "../infrastructure/role-repository.js";

/** Lists every role for the caller's tenant (`users_roles` RBAC module, Read). */
export async function listRoles(ctx: TenantContext): Promise<RoleRow[]> {
  return listRolesRepo(ctx);
}

/**
 * Creates a custom (non-system) role.
 * @throws {RoleNameDuplicateError} when `name` collides with an existing role.
 */
export async function createRole(
  ctx: TenantContext,
  input: { name: string; permissionMatrix: PermissionMatrix; mfaRequired?: boolean },
): Promise<string> {
  const existing = await findRoleByName(ctx, input.name);
  if (existing) throw new RoleNameDuplicateError(input.name);
  return insertRole(ctx, {
    name: input.name,
    permissionMatrix: input.permissionMatrix,
    isSystem: false,
    mfaRequired: input.mfaRequired ?? false,
  });
}

/**
 * Edits a *custom* (non-system) role's name/permission matrix/MFA flag — the role
 * editor's "save" action for an existing role. System roles (the six seeded per
 * tenant) are the tenant's baseline and are intentionally not editable through this
 * screen; a caller with `users_roles: Write` still cannot rewrite what "Tenant Admin"
 * grants.
 *
 * @throws {RoleNotFoundInTenantError} when `roleId` doesn't resolve in this tenant.
 * @throws {SystemRoleImmutableError} when the role is a seeded system role.
 * @throws {RoleNameDuplicateError} when renaming to a name already used by another role.
 */
export async function updateRole(
  ctx: TenantContext,
  roleId: string,
  input: { name: string; permissionMatrix: PermissionMatrix; mfaRequired?: boolean },
): Promise<void> {
  const existing = await findRoleById(ctx, roleId);
  if (!existing) throw new RoleNotFoundInTenantError();
  if (existing.isSystem) throw new SystemRoleImmutableError(existing.name);

  if (input.name !== existing.name) {
    const collision = await findRoleByName(ctx, input.name);
    if (collision && collision.id !== roleId) throw new RoleNameDuplicateError(input.name);
  }

  await updateRoleRepo(ctx, roleId, input);
}
