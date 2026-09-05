import { requireTenantDataSource } from '@/server/context';
import { PermissionRepository } from './infrastructure/permission.repository';
import { RoleRepository } from './infrastructure/role.repository';
import { UserRoleRepository } from './infrastructure/user-role.repository';
import { PermissionResolutionService } from './application/permission-resolution.service';
import { PermissionsCrudService } from './application/permissions-crud.service';
import { RolesService } from './application/roles.service';
import { UserRoleAssignmentService } from './application/user-role-assignment.service';
import { requirePermission } from './api/require-permission';

export { PermissionRepository, RoleRepository, UserRoleRepository };
export { PermissionResolutionService, PermissionsCrudService, RolesService, UserRoleAssignmentService };
export { requirePermission };
export type { CreateRoleInput, PermissionSummary, RoleSummary, UpdateRoleInput } from './domain/rbac.types';
export {
  LastAdminProtectedError,
  PermissionInUseError,
  PermissionNotFoundError,
  RoleInUseError,
  RoleNameExistsError,
  RoleNotFoundError,
  SystemRoleProtectedError,
} from './domain/errors';

/**
 * `server/rbac`'s public barrel (Phase 1 sub-slice 1b) — role/permission CRUD, per-request
 * permission resolution (default-deny), and the Route-Handler-callable `requirePermission` guard
 * equivalent. Nothing outside this module may import `./domain/**`/`./infrastructure/**`/
 * `./application/**`/`./api/**` directly (enforced by `apps/next/.eslintrc.cjs`'s `rbac`
 * module-boundary rule).
 *
 * Every composition function below builds a **fresh** instance per call (no `globalThis` caching) —
 * every repository here needs the *current request's* tenant-scoped `DataSource`
 * (`requireTenantDataSource()`), so, like `server/auth`'s `getAuthService()`, these must only ever be
 * called from inside a `withTenantContext`-wrapped Route Handler.
 */
export function getRolesService(): RolesService {
  const dataSource = requireTenantDataSource();
  return new RolesService(new RoleRepository(dataSource), new PermissionRepository(dataSource), new UserRoleRepository(dataSource));
}

export function getPermissionsCrudService(): PermissionsCrudService {
  return new PermissionsCrudService(new PermissionRepository(requireTenantDataSource()));
}

export function getUserRoleAssignmentService(): UserRoleAssignmentService {
  const dataSource = requireTenantDataSource();
  return new UserRoleAssignmentService(new RoleRepository(dataSource), new UserRoleRepository(dataSource));
}

export function getPermissionResolutionService(): PermissionResolutionService {
  return new PermissionResolutionService(new UserRoleRepository(requireTenantDataSource()));
}
