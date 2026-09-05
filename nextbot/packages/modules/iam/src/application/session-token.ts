import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import { SessionInvalidError } from "@nextbot/contracts";
import type { PermissionMatrix } from "@nextbot/contracts";
import { SESSION_TTL_SECONDS } from "../domain/session-policy.js";

/**
 * Admin Console session token (LLD §5.2 `AuthContext`: `{ type: 'user', userId,
 * roleIds, permissions }`). Signed HS256 rather than a bare opaque token so the
 * Gateway/Control Plane's route handlers can verify a session without a DB round
 * trip on every request; the permission matrix is baked in at issuance time and
 * re-derived (not trusted from an old token) on privilege-affecting actions like role
 * changes — see `authenticate-user.ts`'s re-issuance on `assignRole`.
 *
 * This is entirely distinct from the Gateway Plane's anonymous widget session JWT
 * (Phase 7) — different signing secret, different claim shape, never interchangeable.
 */
export interface SessionClaims extends JWTPayload {
  tenantId: string;
  userId: string;
  roleIds: string[];
  permissions: PermissionMatrix;
  /**
   * Phase 4 (BL-36, FR-SEC-10): the `auth_session.id` this token was issued
   * against. Optional at the type level only because the malformed-token test
   * fixture in `session-token.test.ts` predates this field — every real login
   * path (`authenticate-user.ts`) always sets it, and `apps/web/src/lib/
   * session.ts` treats a missing `sid` as an invalid/unrevocable-by-design
   * session (rejected), never as "skip the revocation check."
   */
  sid?: string;
}

const ALG = "HS256";

function getSigningKey(): Uint8Array {
  const secret = process.env.NEXTBOT_SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "NEXTBOT_SESSION_SECRET must be set to a string of at least 32 characters (startup config failure, per LLD §11.10).",
    );
  }
  return new TextEncoder().encode(secret);
}

/** Issues a signed session token for a user who has just authenticated successfully. */
export async function issueSessionToken(claims: Omit<SessionClaims, "iat" | "exp">): Promise<string> {
  return new SignJWT({ ...claims })
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(getSigningKey());
}

/**
 * Verifies and decodes a session token.
 * @throws {SessionInvalidError} on any verification failure (expired, tampered, malformed).
 */
export async function verifySessionToken(token: string): Promise<SessionClaims> {
  try {
    const { payload } = await jwtVerify(token, getSigningKey(), { algorithms: [ALG] });
    return payload as SessionClaims;
  } catch {
    throw new SessionInvalidError();
  }
}
