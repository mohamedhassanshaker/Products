import { getEnv } from '@/server/config';
import { requireTenantDataSource } from '@/server/context';
import { BcryptPasswordHasherAdapter } from '@/server/infrastructure/security';
import { RoleRepository, UserRoleRepository, UserRoleAssignmentService } from '@/server/rbac';
import { UsersService } from './application/users.service';
import { UserAdminRepository } from './infrastructure/user-admin.repository';

export { UsersService, UserAdminRepository };
export type { CreateUserResult, ListUsersOptions, ListUsersResult, UserRoleRef, UserSortColumn, UserSummary } from './domain/user.types';
export { AdminEmailAlreadyRegisteredError, AdminWeakPasswordError, UserNotFoundError } from './domain/errors';

/**
 * `server/users`'s public barrel (Phase 1 sub-slice 1c, FR-IAM-7) — admin CRUD over other
 * tenant-realm users, as distinct from `server/profile`'s self-service "my profile" surface. Nothing
 * outside this module may import `./domain/**`/`./infrastructure/**`/`./application/**` directly
 * (enforced by `apps/next/.eslintrc.cjs`'s `users` module-boundary rule).
 *
 * {@link getUsersService} builds a fresh instance per call — every collaborator needs the *current
 * request's* tenant-scoped `DataSource` (must only ever be called from inside a
 * `withTenantContext`-wrapped Route Handler), matching `server/auth`/`server/rbac`'s identical
 * composition-root convention.
 */
export function getUsersService(): UsersService {
  const env = getEnv();
  const dataSource = requireTenantDataSource();
  return new UsersService(
    {
      minLength: env.PASSWORD_MIN_LENGTH,
      requireUpper: env.PASSWORD_REQUIRE_UPPER,
      requireLower: env.PASSWORD_REQUIRE_LOWER,
      requireDigit: env.PASSWORD_REQUIRE_DIGIT,
      requireSymbol: env.PASSWORD_REQUIRE_SYMBOL,
    },
    new UserAdminRepository(dataSource),
    new RoleRepository(dataSource),
    new UserRoleRepository(dataSource),
    new UserRoleAssignmentService(new RoleRepository(dataSource), new UserRoleRepository(dataSource)),
    new BcryptPasswordHasherAdapter(env.BCRYPT_COST),
  );
}
