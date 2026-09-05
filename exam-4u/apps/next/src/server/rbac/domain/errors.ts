import { DomainError } from '@/server/common/errors/domain-error';

/** RBAC `DomainError` subclasses — ported verbatim (code/message) from
 * `legacy/api/src/modules/rbac/domain/errors.ts`. */

export class RoleNotFoundError extends DomainError {
  constructor() {
    super('ROLE_NOT_FOUND', 'Role not found.');
  }
}

export class PermissionNotFoundError extends DomainError {
  constructor() {
    super('PERMISSION_NOT_FOUND', 'One or more permissions were not found.');
  }
}

export class RoleNameExistsError extends DomainError {
  constructor() {
    super('ROLE_NAME_EXISTS', 'A role with this name already exists.');
  }
}

/** Thrown deleting a role still referenced by at least one `user_role` row. */
export class RoleInUseError extends DomainError {
  constructor() {
    super('ROLE_IN_USE', 'This role is still assigned to one or more users and cannot be deleted.');
  }
}

/** Thrown deleting a permission still referenced by at least one `role_permission` row — defense in
 * depth on top of the DB's own `ON DELETE RESTRICT` FK, giving a clean `DomainError`/409 instead of a
 * raw driver constraint-violation error. */
export class PermissionInUseError extends DomainError {
  constructor() {
    super('PERMISSION_IN_USE', 'This permission is still granted to one or more roles and cannot be deleted.');
  }
}

/** Thrown renaming or deleting one of the two provisioning-seeded system roles (`Tenant Admin`,
 * `Member`) — checked *before* any in-use check (a system role can't be deleted even if currently
 * unreferenced by any user). Permission-grant changes (`replacePermissions`) and description edits
 * are always allowed regardless of `isSystem`. */
export class SystemRoleProtectedError extends DomainError {
  constructor() {
    super('SYSTEM_ROLE_PROTECTED', 'This is a system-seeded role and cannot be renamed or deleted.');
  }
}

/** Thrown when a role-assignment change (or a hard-delete pre-check) would leave the tenant with zero
 * users holding the `Tenant Admin` role. */
export class LastAdminProtectedError extends DomainError {
  constructor() {
    super('LAST_ADMIN_PROTECTED', 'This user is the only remaining Tenant Admin and cannot be removed from that role.');
  }
}
