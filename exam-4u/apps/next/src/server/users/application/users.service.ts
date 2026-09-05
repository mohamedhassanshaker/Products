import { randomBytes, randomUUID } from 'node:crypto';
import { evaluatePasswordPolicy, type PasswordPolicy } from '@/server/auth';
import type { PasswordHasherPort } from '@/server/common/ports/password-hasher.port';
import type { RoleRepository, UserRoleRepository, UserRoleAssignmentService } from '@/server/rbac';
import { UserAdminRepository } from '../infrastructure/user-admin.repository';
import { AdminEmailAlreadyRegisteredError, AdminWeakPasswordError, UserNotFoundError } from '../domain/errors';
import type { CreateUserResult, ListUsersOptions, ListUsersResult, UserRoleRef, UserSummary } from '../domain/user.types';
import type { UserEntity } from '@/server/infrastructure/database';

/** Length of the randomly-generated temporary password when an admin omits one (32 hex chars = 128
 * bits of entropy from `randomBytes(16)`, comfortably satisfying any configured strength policy). */
const TEMP_PASSWORD_RANDOM_BYTES = 16;

/**
 * FR-IAM-7's administrative user-management business logic — ported logic (not code) from
 * `legacy/api/src/modules/users/application/users.service.ts`'s `UsersService`, adapted to this
 * app's plain-class composition convention (no NestJS DI). Operates on the same tenant-scoped `user`
 * table `auth`'s `AuthService` does, via a dedicated repository (`UserAdminRepository`) rather than
 * reusing `auth`'s own `UserRepository`.
 */
export class UsersService {
  constructor(
    private readonly passwordPolicy: PasswordPolicy,
    private readonly users: UserAdminRepository,
    private readonly roles: RoleRepository,
    private readonly userRoles: UserRoleRepository,
    private readonly userRoleAssignment: UserRoleAssignmentService,
    private readonly hasher: PasswordHasherPort,
  ) {}

  async list(options: ListUsersOptions): Promise<ListUsersResult> {
    const { items, total } = await this.users.findMany(options);
    return { items: await this.hydrateMany(items), total };
  }

  /** @throws {UserNotFoundError} */
  async get(id: string): Promise<UserSummary> {
    const row = await this.requireUser(id);
    return this.hydrateOne(row);
  }

  /**
   * FR-IAM-7: "Creating a user administratively allows an optional temporary password (defaulting
   * to a known placeholder value if omitted...) and an optional initial role assignment."
   *
   * **Judgment call ported verbatim from legacy (security)**: rather than one fixed literal shared
   * by every admin-created account, this method generates a fresh, high-entropy random password
   * **per user** and returns it once in {@link CreateUserResult}, for the admin to relay to the new
   * user out of band — closes an avoidable credential-stuffing surface a single guessable literal
   * would leave open.
   *
   * @throws {AdminEmailAlreadyRegisteredError} if `input.email` is already registered in this tenant.
   * @throws {AdminWeakPasswordError} if an admin-supplied `input.password` fails the tenant's
   *   configured strength policy (a server-generated password never fails this check by construction).
   * @throws {RoleNotFoundError} if any id in `input.roleIds` does not exist.
   */
  async create(input: {
    email: string;
    firstName: string;
    lastName: string;
    password?: string;
    phone?: string | null;
    occupation?: string | null;
    companyName?: string | null;
    country?: string | null;
    roleIds?: number[];
  }): Promise<CreateUserResult> {
    const email = normalizeEmail(input.email);
    if (await this.users.findByEmail(email)) {
      throw new AdminEmailAlreadyRegisteredError();
    }

    let temporaryPassword: string | undefined;
    let passwordToHash: string;
    if (input.password) {
      const violations = evaluatePasswordPolicy(input.password, this.passwordPolicy);
      if (violations.length > 0) {
        throw new AdminWeakPasswordError(violations);
      }
      passwordToHash = input.password;
    } else {
      passwordToHash = generateTemporaryPassword();
      temporaryPassword = passwordToHash;
    }

    const passwordHash = await this.hasher.hash(passwordToHash);
    const created = await this.users.insert({
      id: randomUUID(),
      email,
      firstName: input.firstName.trim(),
      lastName: input.lastName.trim(),
      passwordHash,
      phone: input.phone?.trim() || null,
      occupation: input.occupation?.trim() || null,
      companyName: input.companyName?.trim() || null,
      country: input.country?.trim() || null,
      isActive: true,
    });

    if (input.roleIds && input.roleIds.length > 0) {
      // A brand-new user can never be "the tenant's last Tenant Admin" (they hold no roles yet), so
      // replaceRolesForUser's LAST_ADMIN_PROTECTED branch can never fire here.
      await this.userRoleAssignment.replaceRolesForUser(created.id, input.roleIds);
    }

    const user = await this.hydrateOne(created);
    return temporaryPassword ? { user, temporaryPassword } : { user };
  }

  /**
   * Identity/profile field update. Never touches password, email, or role grants — email is
   * immutable via this surface and roles are changed only via {@link replaceRoles}'s dedicated,
   * separately-permissioned route.
   *
   * @throws {UserNotFoundError}
   */
  async update(
    id: string,
    input: {
      firstName?: string;
      lastName?: string;
      phone?: string | null;
      occupation?: string | null;
      companyName?: string | null;
      country?: string | null;
      isActive?: boolean;
    },
  ): Promise<UserSummary> {
    await this.requireUser(id);

    const patch: Partial<UserEntity> = {};
    if (input.firstName !== undefined) patch.firstName = input.firstName.trim();
    if (input.lastName !== undefined) patch.lastName = input.lastName.trim();
    if (input.phone !== undefined) patch.phone = input.phone?.trim() || null;
    if (input.occupation !== undefined) patch.occupation = input.occupation?.trim() || null;
    if (input.companyName !== undefined) patch.companyName = input.companyName?.trim() || null;
    if (input.country !== undefined) patch.country = input.country?.trim() || null;
    if (input.isActive !== undefined) patch.isActive = input.isActive;

    if (Object.keys(patch).length > 0) {
      await this.users.update(id, patch);
    }

    const refreshed = await this.requireUser(id);
    return this.hydrateOne(refreshed);
  }

  /**
   * Hard-deletes a user (FR-IAM-7). `user_role` rows cascade-delete automatically.
   *
   * @throws {UserNotFoundError}
   * @throws {LastAdminProtectedError} if `id` is the tenant's only remaining Tenant Admin.
   */
  async delete(id: string): Promise<void> {
    await this.requireUser(id);
    await this.userRoleAssignment.assertUserDeletable(id);
    await this.users.delete(id);
  }

  /**
   * Full replace of `id`'s role grants. Thin delegation to
   * {@link UserRoleAssignmentService.replaceRolesForUser}, the single implementation `server/rbac`
   * already owns.
   *
   * @throws {UserNotFoundError}
   * @throws {RoleNotFoundError} if any id in `roleIds` does not exist.
   * @throws {LastAdminProtectedError} if the replace would strip the tenant's last Tenant Admin.
   */
  async replaceRoles(id: string, roleIds: number[]): Promise<UserSummary> {
    await this.requireUser(id);
    await this.userRoleAssignment.replaceRolesForUser(id, roleIds);
    const refreshed = await this.requireUser(id);
    return this.hydrateOne(refreshed);
  }

  private async requireUser(id: string): Promise<UserEntity> {
    const row = await this.users.findById(id);
    if (!row) throw new UserNotFoundError();
    return row;
  }

  private async hydrateOne(row: UserEntity): Promise<UserSummary> {
    const roles = await this.rolesFor(row.id);
    return toSummary(row, roles);
  }

  private async hydrateMany(rows: UserEntity[]): Promise<UserSummary[]> {
    return Promise.all(rows.map((row) => this.hydrateOne(row)));
  }

  /** Resolves `userId`'s currently-granted role ids, then hydrates each into `{id, name, isSystem}`
   * for the response shape. */
  private async rolesFor(userId: string): Promise<UserRoleRef[]> {
    const roleIds = await this.userRoles.findRoleIdsForUser(userId);
    if (roleIds.length === 0) return [];
    const roles = await Promise.all(roleIds.map((id) => this.roles.findById(id)));
    return roles
      .filter((role): role is NonNullable<typeof role> => role !== null)
      .map((role) => ({ id: role.id, name: role.name, isSystem: role.isSystem }));
  }
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** High-entropy random temporary password (hex-encoded, so it's guaranteed to satisfy any
 * configured upper/lower/digit policy check trivially). */
function generateTemporaryPassword(): string {
  const raw = randomBytes(TEMP_PASSWORD_RANDOM_BYTES).toString('hex');
  return `${raw.slice(0, 16)}${raw.slice(16).toUpperCase()}!`;
}

function toSummary(row: UserEntity, roles: UserRoleRef[]): UserSummary {
  return {
    id: row.id,
    email: row.email,
    firstName: row.firstName,
    lastName: row.lastName,
    phone: row.phone,
    occupation: row.occupation,
    companyName: row.companyName,
    country: row.country,
    isActive: Boolean(row.isActive),
    roles,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastLoginAt: row.lastLoginAt,
  };
}
