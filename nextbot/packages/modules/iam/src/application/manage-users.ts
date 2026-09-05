import { InvalidRoleAssignmentError, UserNotFoundInTenantError } from "@nextbot/contracts";
import type { TenantContext } from "@nextbot/db";
import { hashPassword } from "../domain/password.js";
import { EmailAlreadyRegisteredError } from "./register-user.js";
import { findUserByEmail, findUserById, insertUser, listUsersWithRoles, type UserWithRoles } from "../infrastructure/user-repository.js";
import { assignRolesToUser, findRolesByIds, replaceUserRoles } from "../infrastructure/role-repository.js";

/**
 * Lists every Admin Console user for the tenant with their role(s), last login, and
 * MFA status attached — the "Users & Roles" screen's user table (FR-ADM-02 / screen
 * inventory B.8.1). `users_roles` module, Read (enforced by the http layer).
 */
export async function listUsers(ctx: TenantContext): Promise<UserWithRoles[]> {
  return listUsersWithRoles(ctx);
}

export interface CreateUserInput {
  email: string;
  password: string;
  displayName: string;
  /** At least one role id (validated non-empty by the contract schema); each id must
   * resolve to a real role in this tenant — a caller-supplied id is never trusted
   * without a server-side existence check (never just "assume it's valid"). */
  roleIds: string[];
}

/**
 * Creates a new Admin Console user with one or more role assignments at creation
 * time — the "invite user" flow this screen was missing entirely. Shares
 * `register-user.ts`'s single-role core for password hashing / duplicate-email
 * checking conventions, but resolves roles by id (the UI presents a role picker
 * backed by `listRoles()`, not free-typed names) and supports multiple roles.
 *
 * @throws {EmailAlreadyRegisteredError} on a duplicate `(tenant, email)`.
 * @throws {InvalidRoleAssignmentError} if any `roleIds` entry doesn't resolve to a
 *   role that exists in this tenant.
 */
export async function createUser(ctx: TenantContext, input: CreateUserInput): Promise<string> {
  const existing = await findUserByEmail(ctx, input.email);
  if (existing) throw new EmailAlreadyRegisteredError(input.email);

  // De-dupe requested ids before resolving — a client sending the same role id twice
  // must not silently look like "fewer roles resolved than requested".
  const requestedIds = Array.from(new Set(input.roleIds));
  const resolvedRoles = await findRolesByIds(ctx, requestedIds);
  if (resolvedRoles.length !== requestedIds.length) {
    throw new InvalidRoleAssignmentError();
  }

  const passwordHash = await hashPassword(input.password);
  const userId = await insertUser(ctx, { email: input.email, passwordHash, displayName: input.displayName });
  await assignRolesToUser(ctx, userId, requestedIds);
  return userId;
}

/**
 * Replaces a user's entire role assignment set (the "change this user's role(s)"
 * action) — not incremental add/remove. FR-ADM-02's fail-closed rule (a user with no
 * role assigned cannot log in) is enforced at the contract-schema layer (`roleIds`
 * requires `minItems: 1`), so this never needs to special-case an empty array itself.
 *
 * @throws {UserNotFoundInTenantError} when `userId` doesn't resolve in this tenant.
 * @throws {InvalidRoleAssignmentError} if any `roleIds` entry doesn't resolve to a
 *   role that exists in this tenant.
 */
export async function updateUserRoles(ctx: TenantContext, userId: string, roleIds: string[]): Promise<void> {
  const user = await findUserById(ctx, userId);
  if (!user) throw new UserNotFoundInTenantError();

  const requestedIds = Array.from(new Set(roleIds));
  const resolvedRoles = await findRolesByIds(ctx, requestedIds);
  if (resolvedRoles.length !== requestedIds.length) {
    throw new InvalidRoleAssignmentError();
  }

  await replaceUserRoles(ctx, userId, requestedIds);
}
