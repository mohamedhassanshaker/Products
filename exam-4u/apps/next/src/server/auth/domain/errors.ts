import { DomainError } from '@/server/common/errors/domain-error';

/**
 * Tenant-realm auth `DomainError` subclasses — ported verbatim (code/message) from
 * `legacy/api/src/modules/auth/domain/errors.ts`.
 */

/** Enumeration-safe: thrown identically for an unknown email, a wrong password on a real account, and
 * an invited-but-password-less account (`password_hash IS NULL`) — never distinguishable by the
 * caller. */
export class InvalidCredentialsError extends DomainError {
  constructor() {
    super('INVALID_CREDENTIALS', 'The email or password you entered is incorrect.');
  }
}

/** Thrown only *after* credentials are already proven correct — deliberately distinguishable from
 * {@link InvalidCredentialsError} (no enumeration-safety concern once the password already matched). */
export class UserInactiveError extends DomainError {
  constructor() {
    super('USER_INACTIVE', 'This account has been deactivated. Contact your tenant administrator.');
  }
}

export class EmailAlreadyRegisteredError extends DomainError {
  constructor() {
    super('EMAIL_ALREADY_REGISTERED', 'An account with this email already exists.');
  }
}

/** Every unmet password-policy rule (not just the first) is included in `details.violations`; the
 * top-level `message` is the first violation for a single human-readable headline. */
export class WeakPasswordError extends DomainError {
  constructor(violations: string[]) {
    super('WEAK_PASSWORD', violations[0] ?? 'Password does not meet the minimum strength policy.', { violations });
  }
}

export class ResetTokenExpiredError extends DomainError {
  constructor() {
    super('RESET_TOKEN_EXPIRED', 'This password reset link has expired. Please request a new one.');
  }
}

/** Covers: never issued, already consumed (single-use), or belongs to a different tenant's schema
 * (the lookup is structurally tenant-scoped) — all indistinguishable to the caller. */
export class ResetTokenInvalidError extends DomainError {
  constructor() {
    super('RESET_TOKEN_INVALID', 'This password reset link is invalid. Please request a new one.');
  }
}

export class CurrentPasswordIncorrectError extends DomainError {
  constructor() {
    super('CURRENT_PASSWORD_INCORRECT', 'Your current password is incorrect.');
  }
}

export class RegistrationDisabledError extends DomainError {
  constructor() {
    super('REGISTRATION_DISABLED', 'Self-registration is disabled for this organization.');
  }
}

export class GoogleSignInDisabledError extends DomainError {
  constructor() {
    super('GOOGLE_SIGNIN_DISABLED', 'Google sign-in is disabled for this organization.');
  }
}

export class GoogleNotConfiguredError extends DomainError {
  constructor() {
    super('GOOGLE_NOT_CONFIGURED', 'Google sign-in is enabled for this organization but is not yet configured on the server.');
  }
}

/** Covers bad signature, expired, wrong audience, and unverified email — all collapsed to one code,
 * matching legacy's identical "the ID token itself is untrustworthy" framing. */
export class GoogleTokenInvalidError extends DomainError {
  constructor() {
    super('GOOGLE_TOKEN_INVALID', 'This Google sign-in could not be verified. Please try again.');
  }
}
