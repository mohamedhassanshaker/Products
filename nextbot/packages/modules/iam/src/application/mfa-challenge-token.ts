import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import { MfaChallengeInvalidError } from "@nextbot/contracts";

/**
 * Short-lived signed tokens correlating a login step across requests, without
 * needing a dedicated DB table for in-flight challenges. Distinct signing
 * purpose/claim shape from the full session token (`session-token.ts`) so neither
 * can ever be mistaken for — or escalated into — an authenticated session even if
 * replayed at the wrong endpoint. Two purposes:
 *  - `mfa_challenge`: correlates the password-verified step with the MFA-code-
 *    submission step for an *already-enrolled* user (FR-SEC-03).
 *  - `mfa_enrollment`: QA Defect B3 — correlates the password-verified step with the
 *    forced-enrollment confirmation step when a user's role requires MFA and they
 *    aren't enrolled yet (see `authenticate-user.ts`'s `mfa_enrollment_required`
 *    login outcome).
 */
export interface MfaChallengeClaims extends JWTPayload {
  purpose: "mfa_challenge" | "mfa_enrollment";
  tenantId: string;
  userId: string;
}

const ALG = "HS256";
const CHALLENGE_TTL_SECONDS = 5 * 60; // 5 minutes — long enough to fetch an authenticator code, short enough to bound replay risk.

function getSigningKey(): Uint8Array {
  const secret = process.env.NEXTBOT_SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("NEXTBOT_SESSION_SECRET must be set to a string of at least 32 characters.");
  }
  return new TextEncoder().encode(secret);
}

async function issueToken(purpose: "mfa_challenge" | "mfa_enrollment", tenantId: string, userId: string): Promise<string> {
  return new SignJWT({ purpose, tenantId, userId })
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setExpirationTime(`${CHALLENGE_TTL_SECONDS}s`)
    .sign(getSigningKey());
}

async function verifyToken(purpose: "mfa_challenge" | "mfa_enrollment", token: string): Promise<MfaChallengeClaims> {
  try {
    const { payload } = await jwtVerify(token, getSigningKey(), { algorithms: [ALG] });
    if (payload.purpose !== purpose) throw new Error("wrong purpose");
    return payload as MfaChallengeClaims;
  } catch {
    throw new MfaChallengeInvalidError();
  }
}

export async function issueMfaChallengeToken(tenantId: string, userId: string): Promise<string> {
  return issueToken("mfa_challenge", tenantId, userId);
}

/** @throws {MfaChallengeInvalidError} when the token is expired/tampered/wrong-purpose. */
export async function verifyMfaChallengeToken(token: string): Promise<MfaChallengeClaims> {
  return verifyToken("mfa_challenge", token);
}

/** QA Defect B3: issues the forced-enrollment confirmation token. */
export async function issueMfaEnrollmentToken(tenantId: string, userId: string): Promise<string> {
  return issueToken("mfa_enrollment", tenantId, userId);
}

/** @throws {MfaChallengeInvalidError} when the token is expired/tampered/wrong-purpose. */
export async function verifyMfaEnrollmentToken(token: string): Promise<MfaChallengeClaims> {
  return verifyToken("mfa_enrollment", token);
}
