/**
 * Tenant-realm auth domain types — ported verbatim (shape unchanged) from
 * `legacy/api/src/modules/auth/domain/auth.types.ts`.
 */

/** Never includes `passwordHash` or any other sensitive column — the only shape `AuthService` ever
 * hands back to a caller. */
export interface UserSummary {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
}

export interface RegisterInput {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
}

export interface RegisterResult {
  user: UserSummary;
}

export interface LoginInput {
  email: string;
  password: string;
}

/** Also the return shape of `signInWithGoogle` — identical fields, different issuance path. */
export interface LoginResult {
  accessToken: string;
  expiresInSeconds: number;
  user: UserSummary;
}

export interface ForgotPasswordInput {
  email: string;
}

export interface ResetPasswordInput {
  token: string;
  newPassword: string;
}

export interface ChangePasswordInput {
  currentPassword: string;
  newPassword: string;
}

/** The tenant-realm authenticated principal `requireTenantUser` returns — mirrors legacy's
 * `AuthenticatedPrincipal` (`{ userId, tenantId }`, attached to `Request.user`). */
export interface AuthenticatedTenantUser {
  userId: string;
  tenantId: string;
}

/** Password policy knobs (`PASSWORD_MIN_LENGTH`/`PASSWORD_REQUIRE_*` env vars) — passed explicitly to
 * {@link import('./password-policy').evaluatePasswordPolicy} rather than read from `getEnv()` inside
 * it, so the pure policy function stays trivially unit-testable with no env dependency. */
export interface PasswordPolicy {
  minLength: number;
  requireUpper: boolean;
  requireLower: boolean;
  requireDigit: boolean;
  requireSymbol: boolean;
}
