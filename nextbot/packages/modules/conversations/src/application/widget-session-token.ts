import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import { WidgetSessionInvalidError } from "@nextbot/contracts";
import type { Environment, Region } from "@nextbot/db";

/**
 * The anonymous, tenant+channel-scoped widget session token (LLD §5.3
 * `CreateWidgetSessionResponse.sessionToken`). Entirely distinct from the Admin
 * Console's `SessionClaims` (`packages/modules/iam/src/application/session-token.ts`)
 * — different signing secret (`NEXTBOT_WIDGET_SESSION_SECRET`, never
 * `NEXTBOT_SESSION_SECRET`), different claim shape, never interchangeable, and never
 * issued via Better Auth or any admin-identity mechanism: this identifies an
 * end-customer's anonymous chat session, not a logged-in platform user.
 *
 * `region`/`environment` are embedded so every subsequent widget request can build a
 * `TenantContext` from the token alone, without an extra tenant lookup per request.
 */
export interface WidgetSessionClaims extends JWTPayload {
  tenantId: string;
  region: Region;
  environment: Environment;
  channelId: string;
  conversationId: string;
  /** Phase 6 (client-feedback-batch item 9) — set only when this session was created
   * via a server-verified sandbox-preview override (`create-widget-session.ts`'s
   * `verifiedPreview` param). Threaded through so the message-send path
   * (`apps/gateway`'s `turn-pipeline-adapter.ts`) can trace this conversation's turns
   * against the exact version under test rather than the tenant's live Production
   * version. Absent (`undefined`) for every ordinary customer session. */
  previewVersionId?: string;
}

/**
 * Plain (non-`JWTPayload`-extending) shape for `issueWidgetSessionToken`'s input.
 * **Deliberately not `Omit<WidgetSessionClaims, "iat" | "exp">`**: `JWTPayload`
 * carries a string index signature, and TypeScript's `Omit` (built on
 * `Pick<T, Exclude<keyof T, K>>`) collapses every named property's specific type
 * down to the index signature's type once one is present — every field would
 * type-check as `unknown` at every call site, caught here by `.setAudience()`
 * rejecting an `unknown` argument where it requires `string`.
 */
export type WidgetSessionClaimsInput = Pick<
  WidgetSessionClaims,
  "tenantId" | "region" | "environment" | "channelId" | "conversationId" | "previewVersionId"
>;

const ALG = "HS256";
/** LLD §5.3: "30 min sliding". Each new SSE connection / message re-issue extends
 * this by re-signing (`refreshWidgetSessionToken`), which is what "sliding" means in
 * practice for a stateless JWT (no server-side session store to touch). */
const WIDGET_SESSION_TTL_SECONDS = 30 * 60;

function getSigningKey(): Uint8Array {
  const secret = process.env.NEXTBOT_WIDGET_SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "NEXTBOT_WIDGET_SESSION_SECRET must be set to a string of at least 32 characters (startup config failure, per LLD §11.10).",
    );
  }
  return new TextEncoder().encode(secret);
}

/** Issues a signed widget session token for a newly-created (or resumed) conversation. */
export async function issueWidgetSessionToken(claims: WidgetSessionClaimsInput): Promise<string> {
  return new SignJWT({ ...claims })
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setExpirationTime(`${WIDGET_SESSION_TTL_SECONDS}s`)
    .setAudience(claims.channelId)
    .sign(getSigningKey());
}

/**
 * Verifies and decodes a widget session token.
 * @throws {WidgetSessionInvalidError} on any verification failure (expired, tampered, malformed).
 */
export async function verifyWidgetSessionToken(token: string): Promise<WidgetSessionClaims> {
  try {
    const { payload } = await jwtVerify(token, getSigningKey(), { algorithms: [ALG] });
    return payload as WidgetSessionClaims;
  } catch {
    throw new WidgetSessionInvalidError();
  }
}
