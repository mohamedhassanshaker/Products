import type { TenantContext } from "@nextbot/db";
import { hashPassword } from "../domain/password.js";
import { findUserByEmail, insertUser } from "../infrastructure/user-repository.js";
import { assignRoleToUser, findRoleByName } from "../infrastructure/role-repository.js";

export class EmailAlreadyRegisteredError extends Error {
  readonly code = "EMAIL_ALREADY_REGISTERED";
  readonly httpStatus = 409;
  constructor(email: string) {
    super(`A user with email '${email}' is already registered in this tenant.`);
    this.name = "EmailAlreadyRegisteredError";
  }
}

export class RoleNotFoundError extends Error {
  readonly code = "ROLE_NOT_FOUND";
  readonly httpStatus = 404;
  constructor(roleName: string) {
    super(`Role '${roleName}' does not exist for this tenant.`);
    this.name = "RoleNotFoundError";
  }
}

export interface RegisterUserInput {
  email: string;
  password: string;
  displayName: string;
  /** FR-ADM-02 fail-closed: at least one role must be assigned at registration time
   * (an admin inviting a user always picks a role in the UI); this is enforced here
   * rather than left to a follow-up step that could be skipped. */
  roleName: string;
}

/**
 * Registers a new Admin Console user with a hashed password and an initial role
 * assignment (BL-01 slice B). Bare invite/SSO-only flows (no password) are Phase 3+
 * UI scope — this service is the shared core either path calls into.
 *
 * @throws {EmailAlreadyRegisteredError} on a duplicate `(tenant, email)`.
 * @throws {RoleNotFoundError} when `roleName` doesn't exist for this tenant.
 */
export async function registerUser(ctx: TenantContext, input: RegisterUserInput): Promise<string> {
  const existing = await findUserByEmail(ctx, input.email);
  if (existing) throw new EmailAlreadyRegisteredError(input.email);

  const role = await findRoleByName(ctx, input.roleName);
  if (!role) throw new RoleNotFoundError(input.roleName);

  const passwordHash = await hashPassword(input.password);
  const userId = await insertUser(ctx, { email: input.email, passwordHash, displayName: input.displayName });
  await assignRoleToUser(ctx, userId, role.id);
  return userId;
}
