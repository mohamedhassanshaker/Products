/**
 * Port for verifying a Google Sign-In ID token — ported verbatim from
 * `legacy/api/src/modules/auth/domain/ports/google-token-verifier.port.ts`. The real implementation
 * (`server/infrastructure/security`'s `GoogleIdTokenVerifierAdapter`) is wired in this module's
 * composition root; tests inject a fake matching this same shape (see this module's own
 * `auth.service.test.ts` — no real Google Cloud OAuth client is configured in this environment,
 * `docs/plans/nextjs-rewrite-phase1-plan.md`'s "Decisions made").
 */
export interface VerifiedGoogleIdentity {
  email: string;
  emailVerified: boolean;
}

export interface GoogleTokenVerifierPort {
  /** Never throws — returns `null` for any verification failure (bad signature, expired, wrong
   * audience, malformed). */
  verify(idToken: string, audience: string): Promise<VerifiedGoogleIdentity | null>;
}
