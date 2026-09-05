import { OAuth2Client } from 'google-auth-library';
import { logger } from '@/server/logging';

/** Structurally matches `server/auth`'s `GoogleTokenVerifierPort` return shape (no formal
 * `implements` clause — same DIP judgment call as the JWT adapters in this module). */
export interface VerifiedGoogleIdentity {
  email: string;
  emailVerified: boolean;
}

/**
 * Real Google ID-token verification via `google-auth-library`'s `OAuth2Client` — ported logic from
 * `legacy/api/src/infrastructure/security/google-id-token-verifier.adapter.ts`. The only file in this
 * app allowed to import `google-auth-library` directly (module-boundary rule).
 *
 * **Environment note (docs/plans/nextjs-rewrite-phase1-plan.md "Decisions made")**: this repo's own
 * running `.env` has `GOOGLE_CLIENT_ID=` (blank) — no real Google Cloud OAuth client is provisioned in
 * this environment, matching legacy's own identical gap. This adapter is a faithful, complete port of
 * the real verification logic (nothing stubbed), but it cannot be exercised end-to-end against
 * Google's live JWKS/token-issuance in this dispatch's own tests; `auth.service.test.ts` instead
 * injects a fake `GoogleTokenVerifierPort`-shaped object (matching legacy's own `.spec.ts` precedent)
 * to exercise `AuthService.signInWithGoogle`'s branching logic. Real end-to-end Google sign-in
 * requires an operator to set `GOOGLE_CLIENT_ID` to a real OAuth 2.0 client id — no client secret is
 * needed server-side (ID-token verification only, not an authorization-code exchange).
 */
export class GoogleIdTokenVerifierAdapter {
  /** One shared client, constructed with no fixed audience — `audience` is passed per-call to
   * `verifyIdToken` instead, matching legacy's identical reuse pattern. */
  private readonly client = new OAuth2Client();

  /**
   * Verifies `idToken`'s signature (against Google's published JWKS, internally cached/refreshed by
   * the library), issuer, expiry, and `audience` match. Never throws — any failure (bad signature,
   * expired, wrong audience/issuer, malformed) is caught, logged at `debug` (message only, never the
   * raw token), and collapsed to `null`.
   */
  async verify(idToken: string, audience: string): Promise<VerifiedGoogleIdentity | null> {
    try {
      const ticket = await this.client.verifyIdToken({ idToken, audience });
      const payload = ticket.getPayload();
      if (!payload?.email) return null;
      return { email: payload.email, emailVerified: payload.email_verified === true };
    } catch (err) {
      logger.debug({ err: err instanceof Error ? err.message : String(err) }, 'google_id_token_verification_failed');
      return null;
    }
  }
}
