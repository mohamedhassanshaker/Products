import { requirePermission } from "../domain/permission-matrix.js";
import type { SessionClaims } from "../application/session-token.js";
import { verifySessionToken } from "../application/session-token.js";
import { login as loginService, verifyMfaAndCompleteLogin, completeMfaEnrollmentAndLogin } from "../application/authenticate-user.js";
import { listRoles, createRole, updateRole } from "../application/manage-roles.js";
import { listUsers, createUser, updateUserRoles } from "../application/manage-users.js";
import { resetUserMfa } from "../application/reset-mfa.js";
import { iamTenantContext } from "../infrastructure/user-repository.js";
import { resolveTenantById } from "@nextbot/tenancy";
import type {
  CreateRoleRequest,
  CreateUserRequest,
  LoginRequest,
  MfaChallengeRequest,
  MfaEnrollmentConfirmRequest,
  UpdateRoleRequest,
  UpdateUserRolesRequest,
} from "@nextbot/contracts";

/**
 * `http/` layer (LLD §2.2): plain `(ctx, input) => output` functions. `apps/web`'s
 * `app/api/v1/admin/**\/route.ts` files are ≤10-line adapters parsing/validating with
 * a `contracts` schema and calling straight into these.
 */

export async function handleLogin(input: LoginRequest, meta: { ip?: string; userAgent?: string }) {
  return loginService({ tenantSlug: input.tenantSlug, email: input.email, password: input.password, ...meta });
}

export async function handleMfaChallenge(input: MfaChallengeRequest, meta: { ip?: string; userAgent?: string }) {
  return verifyMfaAndCompleteLogin(input.challengeToken, input.code, meta);
}

/** QA Defect B3 — completes a forced-enrollment login (see `login()`'s
 * `mfa_enrollment_required` outcome). */
export async function handleMfaEnrollmentConfirm(input: MfaEnrollmentConfirmRequest, meta: { ip?: string; userAgent?: string }) {
  return completeMfaEnrollmentAndLogin(input.enrollmentToken, input.code, meta);
}

/** Verifies a bearer session token and returns its decoded claims — the "session
 * check" / "current-user" endpoint's shared implementation. */
export async function handleGetSession(sessionToken: string): Promise<SessionClaims> {
  return verifySessionToken(sessionToken);
}

export async function handleListRoles(session: SessionClaims) {
  requirePermission(session.permissions, "users_roles", "Read");
  const tenant = await resolveTenantById(session.tenantId);
  if (!tenant) throw new Error("tenant not found for session");
  return listRoles(iamTenantContext(session.tenantId, tenant.region));
}

export async function handleCreateRole(session: SessionClaims, input: CreateRoleRequest) {
  requirePermission(session.permissions, "users_roles", "Write");
  const tenant = await resolveTenantById(session.tenantId);
  if (!tenant) throw new Error("tenant not found for session");
  return createRole(iamTenantContext(session.tenantId, tenant.region), input);
}

/** QA Defect B2 — admin-side "reset this user's MFA" action (`users_roles` module,
 * Write — the same RBAC gate user/role administration already uses). */
export async function handleResetUserMfa(session: SessionClaims, userId: string): Promise<void> {
  requirePermission(session.permissions, "users_roles", "Write");
  const tenant = await resolveTenantById(session.tenantId);
  if (!tenant) throw new Error("tenant not found for session");
  await resetUserMfa(iamTenantContext(session.tenantId, tenant.region), userId);
}

/** Edits a custom role's name/permission matrix/MFA flag (`users_roles`, Write). */
export async function handleUpdateRole(session: SessionClaims, roleId: string, input: UpdateRoleRequest) {
  requirePermission(session.permissions, "users_roles", "Write");
  const tenant = await resolveTenantById(session.tenantId);
  if (!tenant) throw new Error("tenant not found for session");
  await updateRole(iamTenantContext(session.tenantId, tenant.region), roleId, input);
}

/** Lists every user for the tenant with role(s)/last-login/MFA status (`users_roles`, Read). */
export async function handleListUsers(session: SessionClaims) {
  requirePermission(session.permissions, "users_roles", "Read");
  const tenant = await resolveTenantById(session.tenantId);
  if (!tenant) throw new Error("tenant not found for session");
  return listUsers(iamTenantContext(session.tenantId, tenant.region));
}

/** Creates an Admin Console user with an initial role assignment (`users_roles`, Write). */
export async function handleCreateUser(session: SessionClaims, input: CreateUserRequest) {
  requirePermission(session.permissions, "users_roles", "Write");
  const tenant = await resolveTenantById(session.tenantId);
  if (!tenant) throw new Error("tenant not found for session");
  return createUser(iamTenantContext(session.tenantId, tenant.region), input);
}

/** Replaces a user's role assignment set (`users_roles`, Write). */
export async function handleUpdateUserRoles(session: SessionClaims, userId: string, input: UpdateUserRolesRequest) {
  requirePermission(session.permissions, "users_roles", "Write");
  const tenant = await resolveTenantById(session.tenantId);
  if (!tenant) throw new Error("tenant not found for session");
  await updateUserRoles(iamTenantContext(session.tenantId, tenant.region), userId, input.roleIds);
}
