/**
 * The second factor.
 *
 * ADR-0006 rule 4: TOTP is mandatory for every role that can publish or manage
 * users, because those two permissions are the ones whose misuse is not
 * recoverable — a published agent has spoken to citizens, and a granted role has
 * already been used.
 *
 * ## Two bindings, and why the second is not optional
 *
 * A code alone is not enough to promote a session. This use case requires both a
 * challenge id and a partial session id, and requires them to agree about *who*
 * is signing in:
 *
 *  1. **Challenge → subject.** The challenge records who the password step
 *     authenticated, so a code intercepted from one user cannot complete another
 *     user's challenge.
 *  2. **Resulting principal → partial session subject.** The provider is trusted
 *     to verify a code, not to decide whose session this was. This is also what
 *     closes the pairing attack: an attacker who presents a victim's challenge id
 *     alongside their own partial cookie gets a principal for the victim and a
 *     partial session for themselves, and the mismatch rejects it.
 *
 * ## The session id changes
 *
 * The partial session is destroyed and a **new** id is minted rather than the
 * partial being upgraded in place. api.md §3.1: sessions rotate on privilege
 * change, and going from "no permissions" to "every permission a Super Admin
 * holds" is the largest privilege change in the system. Rotating means a partial
 * cookie captured before the TOTP step is worthless afterwards.
 */

import type { Clock } from "../../platform/ports/provisioning.js";
import type { Principal } from "../../platform/tenancy/tenant-context.js";
import { ANONYMOUS_ASSURANCE } from "../domain/assurance.js";
import { isSessionExpired, ttlPolicyFor } from "../domain/session.js";
import type { IdentityProvider } from "../ports/identity-provider.js";
import type { SessionStore } from "../ports/session-store.js";
import type { UserRepository } from "../ports/user-repository.js";
import type { SecurityPolicyRepository } from "../ports/security-policy-repository.js";

export interface CompleteTotpChallengeInput {
  readonly challengeId: string;
  readonly partialSessionId: string;
  readonly code: string;
}

export type CompleteTotpChallengeResult =
  | {
      readonly kind: "signed_in";
      readonly sessionId: string;
      readonly principal: Principal;
      readonly expiresAt: Date;
    }
  /**
   * One reason for every failure: a wrong code, a replayed code, an expired or
   * burned challenge, a missing partial session, a mismatched pairing. api.md
   * §3.2 answers all of them with `401 auth.totp_invalid`, and a result type that
   * could distinguish them would eventually have a caller that did.
   */
  | { readonly kind: "rejected"; readonly reason: "totp_invalid" };

export interface CompleteTotpChallengeDeps {
  readonly identity: IdentityProvider;
  readonly sessions: SessionStore;
  readonly users: UserRepository;
  readonly clock: Clock;
  /** The signing-in user's own tenant's Security-tab session policy — same override `sign-in.ts` resolves for the password-only path. */
  readonly securityPolicy: SecurityPolicyRepository;
}

const REJECTED: CompleteTotpChallengeResult = { kind: "rejected", reason: "totp_invalid" };

export class CompleteTotpChallenge {
  constructor(private readonly deps: CompleteTotpChallengeDeps) {}

  async execute(input: CompleteTotpChallengeInput): Promise<CompleteTotpChallengeResult> {
    const { identity, sessions, users, clock } = this.deps;
    const now = clock.now();

    const partial = await sessions.read(input.partialSessionId);
    if (!partial || partial.stage !== "partial") return REJECTED;

    // A partial session past its five minutes is gone, and so is the attempt.
    if (isSessionExpired(partial, ttlPolicyFor(partial.kind, partial.stage), now)) {
      await sessions.destroy(partial.id);
      return REJECTED;
    }

    const outcome = await identity.completeChallenge(input.challengeId, { code: input.code });
    if (outcome.kind !== "authenticated") return REJECTED;

    const { principal } = outcome;

    // Binding 3: the provider verified a code; it does not get to choose whose
    // session is promoted.
    if (principal.id !== partial.subjectId || principal.tenant !== partial.tenant) {
      await sessions.destroy(partial.id);
      return REJECTED;
    }

    const user = await users.findById(principal.id);
    if (!user) return REJECTED;

    const policy = await this.deps.securityPolicy.ensureTenantConfig(now);
    const session = await sessions.create(
      {
        kind: "staff",
        stage: "full",
        subjectId: principal.id,
        tenant: principal.tenant,
        displayName: principal.displayName,
        assurance: ANONYMOUS_ASSURANCE,
        epoch: user.sessionEpoch,
        // The full session inherits the partial session's fingerprint, not the
        // current request's. The two requests come from one client; taking the
        // second request's would let an attacker who stole the partial cookie
        // rebind the session to their own network.
        binding: partial.binding,
        ttl: ttlPolicyFor("staff", "full", {
          idleSeconds: policy.staffSessionIdleMinutes * 60,
          absoluteSeconds: policy.staffSessionAbsoluteHours * 60 * 60,
        }),
      },
      now,
    );

    // Destroy after the full session exists. The other order would leave a user
    // whose store write failed with neither session and a burned challenge.
    await sessions.destroy(partial.id);
    await users.recordSuccessfulLogin(principal.id, now);

    return {
      kind: "signed_in",
      sessionId: session.id,
      principal,
      expiresAt: session.absoluteExpiresAt,
    };
  }
}
