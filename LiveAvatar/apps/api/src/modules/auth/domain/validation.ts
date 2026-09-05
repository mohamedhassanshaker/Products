import type { AppErrorCode } from '@liveavatar/contracts';
import { AppError } from '../../../common/errors/app-error';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_RE = /^(?=.*[A-Za-z])(?=.*\d).{8,128}$/;

/**
 * Trims and validates an email (FR-AUTH-1).
 * @param email - Raw input
 * @returns Trimmed lowercase email
 * @throws AppError AUTH_EMAIL_INVALID
 */
export function normalizeEmail(email: string): string {
  const trimmed = email.trim();
  if (!trimmed || trimmed.length > 254 || !EMAIL_RE.test(trimmed)) {
    throw AppError.badRequest('AUTH_EMAIL_INVALID');
  }
  return trimmed.toLowerCase();
}

/**
 * Enforces ≥8 chars with a letter and a digit (FR-AUTH-3).
 * @param password - Plain password (not trimmed)
 * @param errorCode - Top-level error code to surface on failure. Defaults to
 *   `AUTH_INVITE_INVALID` for the invite-accept flow; callers outside that
 *   flow (e.g. bootstrap/seed) should pass a code appropriate to their own
 *   endpoint so the client doesn't see an invite-specific code from a
 *   non-invite request (see D-3, seed-operator.use-case.ts).
 * @throws AppError with the given code (400) when the policy fails
 */
export function assertPasswordPolicy(password: string, errorCode: AppErrorCode = 'AUTH_INVITE_INVALID'): void {
  if (!PASSWORD_RE.test(password)) {
    throw AppError.badRequest(errorCode, {
      fields: { password: 'Password must be at least 8 characters and include a letter and a digit.' },
    });
  }
}
