import { Secret, TOTP } from "otpauth";
import { randomBytes, randomInt } from "node:crypto";

/**
 * TOTP MFA (FR-SEC-03) — the fully-implemented MFA method this phase. SMS/Email are
 * stubbed behind `MfaChallenger` (see `mfa-challenger.ts`) per the plan's open item #2;
 * this file only ever handles the TOTP algorithm itself.
 */

const ISSUER = "NextBot";
const DIGITS = 6;
const PERIOD = 30;

export interface TotpEnrollment {
  /** Base32 secret — never persisted in plaintext; the application layer stores it
   * only via `SecretsProvider` and keeps a `vault_ref`-style pointer on `app_user`. */
  secretBase32: string;
  /** `otpauth://` URI for QR-code enrollment in an authenticator app. */
  otpauthUri: string;
}

/** Generates a new random TOTP secret + enrollment URI for `accountLabel` (the user's email). */
export function generateTotpEnrollment(accountLabel: string): TotpEnrollment {
  const secret = new Secret({ size: 20 });
  const totp = new TOTP({
    issuer: ISSUER,
    label: accountLabel,
    algorithm: "SHA1",
    digits: DIGITS,
    period: PERIOD,
    secret,
  });
  return { secretBase32: secret.base32, otpauthUri: totp.toString() };
}

/**
 * Verifies a user-submitted 6-digit code against the stored secret, tolerating one
 * time-step of clock drift on either side (`window: 1`) — a common, low-risk
 * usability allowance for TOTP.
 *
 * @returns true if the code is valid for the current (or adjacent) time window.
 */
export function verifyTotpCode(secretBase32: string, code: string): boolean {
  const totp = new TOTP({
    issuer: ISSUER,
    algorithm: "SHA1",
    digits: DIGITS,
    period: PERIOD,
    secret: Secret.fromBase32(secretBase32),
  });
  const delta = totp.validate({ token: code, window: 1 });
  return delta !== null;
}

/**
 * Generates `count` single-use backup codes (FR-SEC-03 "MFA with backup codes").
 * Codes are returned once to the caller (to display to the user) and the caller is
 * expected to persist only their hashes, never the plaintext codes.
 */
export function generateBackupCodes(count = 10): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    // 10-digit numeric codes, easy to type manually, still ~33 bits of entropy each.
    codes.push(String(randomInt(0, 1e10)).padStart(10, "0"));
  }
  return codes;
}

/** Opaque random token for the short-lived MFA challenge step between password
 * verification and code submission (never a JWT — it authorizes nothing on its own,
 * it just correlates the two requests). */
export function generateChallengeToken(): string {
  return randomBytes(24).toString("base64url");
}
