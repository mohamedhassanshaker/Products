/**
 * Establish a staff session.
 *
 * This is the *only* module in the application layer that ever holds a
 * credential, and it holds it for exactly one statement: the value goes straight
 * into `IdentityProvider.authenticate` and is never inspected, logged, persisted
 * or returned. Everything downstream of here sees a `Principal` (ADR-0006
 * rule 1).
 *
 * ## What this use case is actually for
 *
 * Not verifying a password — the adapter does that. This orchestrates the part
 * that must stay identical when OIDC arrives:
 *
 *   authenticate → mint an opaque session → record the login
 *
 * `LocalPasswordProvider` → `OidcProvider` changes the first step's internals and
 * nothing else in this file, which is the concrete form of ADR-0006's claim that
 * SSO changes only how a session is *created* (rule 2).
 *
 * ## Why a partial session exists at all
 *
 * A user who passes the password step but not TOTP has proven something, and that
 * something has to be remembered across two HTTP requests. It is remembered as a
 * session with `stage: "partial"` rather than as a signed token, for the same
 * reason every other session is a server-side record: it can be destroyed the
 * instant it is used, and it cannot be replayed after the challenge is burned. It
 * grants no permissions — `ResolveSession` refuses it outright.
 *
 * No vendor imports (architecture.md §4): every dependency is a port.
 */

import type { Clock } from "../../platform/ports/provisioning.js";
import type { Principal } from "../../platform/tenancy/tenant-context.js";
import type { TenantSlug } from "../../platform/tenancy/tenant-slug.js";
import { ANONYMOUS_ASSURANCE } from "../domain/assurance.js";
import { ttlPolicyFor, type ClientBinding } from "../domain/session.js";
import type { IdentityProvider } from "../ports/identity-provider.js";
import type { SessionStore } from "../ports/session-store.js";
import type { UserRepository } from "../ports/user-repository.js";
import type { SecurityPolicyRepository } from "../ports/security-policy-repository.js";

export interface SignInInput {
  readonly identifier: string;
  /** Passed through to the provider untouched. See the module note above. */
  readonly secret: string;
  readonly tenant: TenantSlug | null;
  readonly client: ClientBinding;
}

export type SignInResult =
  | {
      readonly kind: "signed_in";
      readonly sessionId: string;
      readonly principal: Principal;
      readonly expiresAt: Date;
    }
  | {
      readonly kind: "totp_required";
      readonly challengeId: string;
      /** Scoped to the TOTP route only; grants no permissions (api.md §3.2). */
      readonly partialSessionId: string;
      readonly expiresAt: Date;
    }
  | { readonly kind: "enrolment_required"; readonly enrolmentToken: string }
  | { readonly kind: "rejected"; readonly reason: "invalid_credentials" | "locked" }
  /**
   * The provider authenticated someone the application no longer recognises —
   * a user deleted between the credential read and the session mint. Distinct
   * from `rejected` because it is a consistency problem, not a bad password, and
   * it should be visible in logs as such.
   */
  | { readonly kind: "unknown_subject" };

export interface SignInDeps {
  readonly identity: IdentityProvider;
  readonly sessions: SessionStore;
  readonly users: UserRepository;
  readonly clock: Clock;
  /** The signing-in user's own tenant's Security-tab session policy (`domain/session.ts`'s hardcoded default otherwise). */
  readonly securityPolicy: SecurityPolicyRepository;
}

export class SignIn {
  constructor(private readonly deps: SignInDeps) {}

  async execute(input: SignInInput): Promise<SignInResult> {
    const { identity, sessions, users, clock } = this.deps;

    const outcome = await identity.authenticate({
      identifier: input.identifier,
      secret: input.secret,
      tenant: input.tenant,
      client: input.client,
    });

    switch (outcome.kind) {
      case "rejected":
        // `challenge_invalid` cannot reach here — it is only produced by
        // `completeChallenge` — but the union covers it, so it is folded into
        // `invalid_credentials` rather than widening this result type with a
        // reason no password response can carry.
        return {
          kind: "rejected",
          reason: outcome.reason === "locked" ? "locked" : "invalid_credentials",
        };

      case "enrolment_required":
        return { kind: "enrolment_required", enrolmentToken: outcome.enrolmentToken };

      case "challenge_required": {
        const epoch = await this.epochFor(outcome.subject.subjectId);
        if (epoch === null) return { kind: "unknown_subject" };

        const now = clock.now();
        const partial = await sessions.create(
          {
            kind: "staff",
            stage: "partial",
            subjectId: outcome.subject.subjectId,
            tenant: outcome.subject.tenant,
            // The display name is deliberately empty on a partial session: it is
            // one more fact about a half-authenticated identity, and nothing
            // renders from a partial session.
            displayName: "",
            assurance: ANONYMOUS_ASSURANCE,
            epoch,
            binding: input.client,
            ttl: ttlPolicyFor("staff", "partial"),
          },
          now,
        );

        return {
          kind: "totp_required",
          challengeId: outcome.challengeId,
          partialSessionId: partial.id,
          expiresAt: outcome.expiresAt,
        };
      }

      case "authenticated": {
        const { principal } = outcome;
        const epoch = await this.epochFor(principal.id);
        if (epoch === null) return { kind: "unknown_subject" };

        const now = clock.now();
        // Ambient tenant is already `principal.tenant` here — `signInWithPassword`
        // rebinds `runWithTenant` to the resolved home tenant before this use case
        // ever runs (see that function's own doc comment) — so this always resolves
        // the SIGNING-IN user's own tenant's policy.
        const policy = await this.deps.securityPolicy.ensureTenantConfig(now);
        const session = await sessions.create(
          {
            kind: "staff",
            stage: "full",
            subjectId: principal.id,
            tenant: principal.tenant,
            displayName: principal.displayName,
            // Staff hold no citizen assurance, and saying so explicitly is more
            // honest than leaving the field to a default.
            assurance: ANONYMOUS_ASSURANCE,
            epoch,
            binding: input.client,
            ttl: ttlPolicyFor("staff", "full", {
              idleSeconds: policy.staffSessionIdleMinutes * 60,
              absoluteSeconds: policy.staffSessionAbsoluteHours * 60 * 60,
            }),
          },
          now,
        );

        // After the session exists, so a write failure here costs a `lastLoginAt`
        // rather than a sign-in the user has to repeat.
        await users.recordSuccessfulLogin(principal.id, now);

        return {
          kind: "signed_in",
          sessionId: session.id,
          principal,
          expiresAt: session.absoluteExpiresAt,
        };
      }
    }
  }

  /**
   * The subject's current session epoch, or null if the subject is gone.
   *
   * Stamped onto the session at creation so a later bump invalidates it. Read
   * here rather than returned by the identity port, because revocation is the
   * application's rule — not the identity provider's — and it must keep working
   * identically under an IdP that has never heard of it.
   */
  private async epochFor(staffUserId: string): Promise<number | null> {
    const user = await this.deps.users.findById(staffUserId);
    return user ? user.sessionEpoch : null;
  }
}
