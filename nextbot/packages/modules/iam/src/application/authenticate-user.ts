import {
  AccountLockedError,
  AuthNoRoleAssignedError,
  InvalidCredentialsError,
  MfaChallengeInvalidError,
  type PermissionMatrix,
} from "@nextbot/contracts";
import { resolveTenantBySlug, resolveTenantById, type ResolvedTenant } from "@nextbot/tenancy";
import { DEFAULT_LOCKOUT_POLICY, isLocked, lockoutRetryAfterSeconds, recordFailedAttempt, recordSuccessfulAttempt } from "../domain/lockout-policy.js";
import { mergePermissionMatrices } from "../domain/permission-matrix.js";
import { verifyPassword } from "../domain/password.js";
import { verifyTotpCode } from "../domain/totp.js";
import {
  findUserByEmail,
  findUserById,
  getLockoutPolicy,
  getUserRolesAndMatrix,
  iamTenantContext,
  insertLoginAttempt,
  recordSuccessfulLogin,
  updateLockoutState,
  type UserRow,
} from "../infrastructure/user-repository.js";
import { issueSessionToken } from "./session-token.js";
import { insertAuthSession } from "../infrastructure/session-repository.js";
import { issueMfaChallengeToken, issueMfaEnrollmentToken, verifyMfaChallengeToken, verifyMfaEnrollmentToken } from "./mfa-challenge-token.js";
import { decryptMfaSecret, enrollTotpMfa } from "./mfa-secret-vault.js";
import { consumeBackupCode } from "./mfa-backup-codes.js";

export interface LoginInput {
  tenantSlug: string;
  email: string;
  password: string;
  ip?: string;
  userAgent?: string;
}

export type LoginResult =
  | { outcome: "mfa_required"; challengeToken: string }
  // QA Defect B3 (FR-SEC-03/ADR-0002 §4.2): a role flagged mfa_required forces
  // enrollment before login can complete, rather than allowing indefinite
  // unenrolled access. `otpauthUri`/`backupCodes` are shown to the user exactly
  // once, at this step, alongside the confirmation code entry.
  | { outcome: "mfa_enrollment_required"; enrollmentToken: string; otpauthUri: string; backupCodes: string[] }
  | { outcome: "authenticated"; sessionToken: string; userId: string; roleIds: string[]; permissions: PermissionMatrix };

/** Shared tail of every successful-login path: clears lockout state, stamps
 * `last_login_at`, records the audit row, and issues the real session token. */
async function finalizeSuccessfulLogin(
  ctx: ReturnType<typeof iamTenantContext>,
  tenant: ResolvedTenant,
  user: Pick<UserRow, "id" | "email">,
  meta?: { ip?: string; userAgent?: string },
): Promise<LoginResult & { outcome: "authenticated" }> {
  const { roleIds, matrices } = await getUserRolesAndMatrix(ctx, user.id);
  if (roleIds.length === 0) {
    await insertLoginAttempt(ctx, { email: user.email, outcome: "NoRole", ip: meta?.ip, userAgent: meta?.userAgent });
    throw new AuthNoRoleAssignedError();
  }

  await updateLockoutState(ctx, user.id, recordSuccessfulAttempt());
  await recordSuccessfulLogin(ctx, user.id);
  await insertLoginAttempt(ctx, { email: user.email, outcome: "Success", ip: meta?.ip, userAgent: meta?.userAgent });

  const permissions = mergePermissionMatrices(matrices);
  // Phase 4 (BL-36): every real login also creates a persisted `auth_session` row
  // so the session can be revoked in real time later (see session-repository.ts) —
  // its id is embedded in the JWT as `sid`.
  const sid = await insertAuthSession(ctx, { userId: user.id, ip: meta?.ip, userAgent: meta?.userAgent });
  const sessionToken = await issueSessionToken({ tenantId: tenant.id, userId: user.id, roleIds, permissions, sid });
  return { outcome: "authenticated", sessionToken, userId: user.id, roleIds, permissions };
}

/**
 * Step 1 of login (BL-01 slice B): resolves the tenant, verifies the password, checks
 * lockout, and either issues a full session (no MFA enrolled/required), an MFA
 * challenge token (already enrolled), or a forced-enrollment token (QA Defect B3 —
 * the user's role requires MFA but they aren't enrolled yet). Every branch appends a
 * `login_attempt` row (FR-SEC-03 / audit).
 *
 * Deliberately returns the *identical* `InvalidCredentialsError` for "no such tenant",
 * "no such user", and "wrong password" so the endpoint cannot be used to enumerate
 * tenants/accounts — only the *locked* and *no-role* cases get a distinct message,
 * per FR-SEC-03's explicit requirement that lockout be distinguishable from a wrong
 * password (the two are different failure classes for a legitimate user, not an
 * enumeration risk).
 *
 * @throws {InvalidCredentialsError} unknown tenant/user or wrong password.
 * @throws {AccountLockedError} the account is within its lockout cooldown.
 * @throws {AuthNoRoleAssignedError} correct credentials but zero assigned roles (FR-ADM-02).
 */
export async function login(input: LoginInput): Promise<LoginResult> {
  const tenant = await resolveTenantBySlug(input.tenantSlug);
  if (!tenant) throw new InvalidCredentialsError();

  const ctx = iamTenantContext(tenant.id, tenant.region);
  const user = await findUserByEmail(ctx, input.email);
  // Phase 4 (BL-36): a ServiceAccount-kind user has no password by construction
  // (defense in depth — belt-and-suspenders alongside `passwordHash` always being
  // null for one) and must never be reachable through the human login flow; it
  // authenticates exclusively via a scoped API key (`verifyApiKey`).
  if (!user || !user.passwordHash || user.kind === "ServiceAccount") {
    // Still worth an attempt row when we *can* attribute it to a tenant, for
    // brute-force visibility, even though the outcome to the caller is generic.
    await insertLoginAttempt(ctx, { email: input.email, outcome: "BadCredentials", ip: input.ip, userAgent: input.userAgent });
    throw new InvalidCredentialsError();
  }

  const policy = (await getLockoutPolicy(ctx)) ?? DEFAULT_LOCKOUT_POLICY;
  const lockoutState = { failedLoginCount: user.failedLoginCount, lockedUntil: user.lockedUntil };
  if (isLocked(lockoutState)) {
    await insertLoginAttempt(ctx, { email: input.email, outcome: "Locked", ip: input.ip, userAgent: input.userAgent });
    throw new AccountLockedError(lockoutRetryAfterSeconds(lockoutState));
  }

  const passwordOk = await verifyPassword(user.passwordHash, input.password);
  if (!passwordOk) {
    const next = recordFailedAttempt(lockoutState, policy);
    await updateLockoutState(ctx, user.id, next);
    await insertLoginAttempt(ctx, { email: input.email, outcome: "BadCredentials", ip: input.ip, userAgent: input.userAgent });
    throw new InvalidCredentialsError();
  }

  const { roleIds, mfaRequired: roleRequiresMfa } = await getUserRolesAndMatrix(ctx, user.id);
  if (roleIds.length === 0) {
    await insertLoginAttempt(ctx, { email: input.email, outcome: "NoRole", ip: input.ip, userAgent: input.userAgent });
    throw new AuthNoRoleAssignedError();
  }

  if (user.mfaEnrolled) {
    const challengeToken = await issueMfaChallengeToken(tenant.id, user.id);
    return { outcome: "mfa_required", challengeToken };
  }

  if (roleRequiresMfa) {
    // QA Defect B3: at least one assigned role mandates MFA and this user has never
    // enrolled — force enrollment now rather than completing an unenrolled session.
    // Enrollment (and backup-code generation) is persisted immediately here, the
    // same as the self-service `enrollTotpMfa()` path — if the user abandons this
    // flow before confirming the code, the admin MFA-reset action
    // (`resetMfaEnrollment`) recovers them rather than a permanent lockout.
    const enrollment = await enrollTotpMfa(ctx, user.id, user.email);
    const enrollmentToken = await issueMfaEnrollmentToken(tenant.id, user.id);
    return {
      outcome: "mfa_enrollment_required",
      enrollmentToken,
      otpauthUri: enrollment.otpauthUri,
      backupCodes: enrollment.backupCodes,
    };
  }

  return finalizeSuccessfulLogin(ctx, tenant, user, { ip: input.ip, userAgent: input.userAgent });
}

/**
 * Step 2 of login: verifies a TOTP (or, failing that, an unused backup — QA Defect
 * B2) code against the MFA challenge issued in step 1.
 * @throws {MfaChallengeInvalidError} bad/expired challenge token.
 * @throws {InvalidCredentialsError} bad TOTP/backup code (mapped from `MfaFailed`
 *   outcome — kept generic to avoid confirming account existence at this later step
 *   too).
 */
export async function verifyMfaAndCompleteLogin(
  challengeToken: string,
  code: string,
  meta?: { ip?: string; userAgent?: string },
): Promise<LoginResult & { outcome: "authenticated" }> {
  const claims = await verifyMfaChallengeToken(challengeToken);
  const tenant = await resolveTenantById(claims.tenantId);
  if (!tenant) throw new MfaChallengeInvalidError();

  const ctx = iamTenantContext(tenant.id, tenant.region);
  const user = await findUserById(ctx, claims.userId);
  if (!user || !user.mfaEnrolled || !user.mfaSecretRef) throw new MfaChallengeInvalidError();

  const secret = await decryptMfaSecret(ctx, user.mfaSecretRef);
  const totpOk = verifyTotpCode(secret, code);
  // QA Defect B2: a backup code is an equally valid alternative to a TOTP code at
  // this same challenge step — checked only when the TOTP code itself didn't
  // verify, since TOTP is the common case and backup-code lookup does an extra
  // hash comparison per stored code.
  const codeOk = totpOk || (await consumeBackupCode(ctx, user.id, code));
  if (!codeOk) {
    await insertLoginAttempt(ctx, { email: user.email, outcome: "MfaFailed", ip: meta?.ip, userAgent: meta?.userAgent });
    throw new InvalidCredentialsError();
  }

  return finalizeSuccessfulLogin(ctx, tenant, user, meta);
}

/**
 * QA Defect B3: completes the forced-enrollment flow begun by `login()`'s
 * `mfa_enrollment_required` outcome — verifies the confirmation code against the
 * secret generated in that step (already persisted, see `enrollTotpMfa()`) and, on
 * success, finishes login exactly like `verifyMfaAndCompleteLogin()` does.
 * @throws {MfaChallengeInvalidError} bad/expired enrollment token.
 * @throws {InvalidCredentialsError} bad confirmation code.
 */
export async function completeMfaEnrollmentAndLogin(
  enrollmentToken: string,
  code: string,
  meta?: { ip?: string; userAgent?: string },
): Promise<LoginResult & { outcome: "authenticated" }> {
  const claims = await verifyMfaEnrollmentToken(enrollmentToken);
  const tenant = await resolveTenantById(claims.tenantId);
  if (!tenant) throw new MfaChallengeInvalidError();

  const ctx = iamTenantContext(tenant.id, tenant.region);
  const user = await findUserById(ctx, claims.userId);
  if (!user || !user.mfaEnrolled || !user.mfaSecretRef) throw new MfaChallengeInvalidError();

  const secret = await decryptMfaSecret(ctx, user.mfaSecretRef);
  const codeOk = verifyTotpCode(secret, code);
  if (!codeOk) {
    await insertLoginAttempt(ctx, { email: user.email, outcome: "MfaFailed", ip: meta?.ip, userAgent: meta?.userAgent });
    throw new InvalidCredentialsError();
  }

  return finalizeSuccessfulLogin(ctx, tenant, user, meta);
}
