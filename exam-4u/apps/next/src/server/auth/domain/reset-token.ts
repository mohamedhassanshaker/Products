import { createHash, randomBytes } from 'node:crypto';

/** A freshly generated reset token — `token` is emailed and **never persisted**; only {@link tokenHash}
 * is stored. Ported verbatim from `legacy/api/src/modules/auth/domain/reset-token.ts`. */
export interface GeneratedResetToken {
  token: string;
  tokenHash: string;
  expiresAt: Date;
}

/**
 * Generates a high-entropy, single-use password-reset token — ported verbatim (algorithm unchanged)
 * from `legacy/api/src/modules/auth/domain/reset-token.ts`.
 *
 * @param ttlMinutes Validity window in minutes (`RESET_TOKEN_TTL_MIN`, default 60).
 * @param now Injectable for deterministic testing; defaults to `new Date()`.
 */
export function generateResetToken(ttlMinutes: number, now: Date = new Date()): GeneratedResetToken {
  // 256-bit random value, 64 lowercase hex chars — high enough entropy that no rate limiting/lockout
  // is needed on the token itself (only on the emailing path, which `forgotPassword` already makes
  // silent/always-200 regardless of account existence).
  const token = randomBytes(32).toString('hex');
  return {
    token,
    tokenHash: hashResetToken(token),
    expiresAt: new Date(now.getTime() + ttlMinutes * 60_000),
  };
}

/**
 * SHA-256 hex digest (64 chars, matching the `password_reset_token_hash CHAR(64)` column) — a fast
 * hash, not bcrypt, is deliberately used: the token itself is already high-entropy random, so no slow
 * KDF is needed (contrast with password hashing, which defends against a weak human-chosen input).
 */
export function hashResetToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}
