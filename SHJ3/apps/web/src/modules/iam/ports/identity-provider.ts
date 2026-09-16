/**
 * `IdentityProvider` — the staff sign-in port.
 *
 * ADR-0006's central claim is that "local auth now, SSO later" usually becomes a
 * rewrite, and that a port prevents it. This file is where that claim is either
 * true or aspirational, so it is worth being explicit about what makes it true.
 *
 * ## What this port does and does not return
 *
 * `authenticate` returns a `Principal` — id, tenant, roles, permissions,
 * assurance — and **never** a token, hash, cookie or claim (ADR-0006 rule 1).
 * Sessions are not this port's business either: the session module mints an
 * opaque Redis record *from* the principal (rule 2). That separation is precisely
 * what makes OIDC arrival a change to session creation and nothing else.
 *
 * ## The vocabulary is mechanism-neutral
 *
 * `AuthenticationAttempt.secret` is not called `password`. Today the local
 * adapter reads a password out of it; `OidcProvider` will read an authorization
 * code. Naming the field after today's mechanism would put "password" into the
 * one interface that exists so nothing has to know about passwords.
 *
 * ## One rejection reason for three situations
 *
 * `rejected: 'invalid_credentials'` covers an unknown email, a wrong password and
 * a non-active account. That is a deliberate narrowing of what the port is *able*
 * to express, not a discipline applied at the HTTP layer: a port that could
 * distinguish them would eventually have a caller that did, and account
 * enumeration on a government backoffice is a real finding (api.md §2.2).
 *
 * ## Swapping this port must not touch authorization
 *
 * ADR-0006 rule 7. Roles and permissions are resolved from `UserRepository` and
 * evaluated by `domain/permissions.ts`; the only thing an OIDC adapter adds is a
 * group-claim → role-name mapping *before* that resolution. Nothing downstream
 * of `Principal.permissions` changes.
 */

import type { Principal } from "../../platform/tenancy/tenant-context.js";
import type { TenantSlug } from "../../platform/tenancy/tenant-slug.js";
import type { ClientBinding } from "../domain/session.js";

/**
 * Who a session belongs to, provider-independently.
 *
 * For the local adapter the subject id is `StaffUsers.id`. For OIDC it will still
 * be `StaffUsers.id` — the `sub` claim maps to it — because the application's own
 * identifier must not change when the identity source does, or every audit entry
 * ever written would point at nothing.
 */
export interface SubjectRef {
  readonly subjectId: string;
  readonly tenant: TenantSlug;
}

export interface AuthenticationAttempt {
  /** Email today. A `sub` claim, a certificate SAN or a national id later. */
  readonly identifier: string;
  /**
   * The provider's private business. A password today, an OIDC authorization code
   * tomorrow. Never logged, never persisted, never returned in any shape.
   */
  readonly secret: string;
  /**
   * Which tenant to bind the session to, when the user is a member of several.
   * Null means "the home tenant".
   *
   * This is *not* a caller naming their own tenant (ADR-0002 rule 1): the adapter
   * accepts it only if `TenantMemberships` already grants it, so the request can
   * choose among tenants the server has already authorised and no others.
   */
  readonly tenant: TenantSlug | null;
  readonly client: ClientBinding;
}

export type ChallengeMethod = "totp";

/**
 * The outcome union.
 *
 * `challenge_required` carries `subject` as well as the challenge id, which
 * api.md §9.8's sketch leaves implicit. The session module has to mint a partial
 * session scoped to *someone*, and the alternative — reaching into the adapter's
 * own challenge storage to find out who — would put the session layer back inside
 * the adapter it is meant to be independent of.
 */
export type AuthenticationOutcome =
  | { readonly kind: "authenticated"; readonly principal: Principal }
  | {
      readonly kind: "challenge_required";
      readonly challengeId: string;
      readonly method: ChallengeMethod;
      readonly subject: SubjectRef;
      readonly expiresAt: Date;
    }
  | {
      /**
       * A privileged role with no authenticator enrolled. Forced enrolment on
       * invite acceptance (ADR-0006 rule 4): the token authorises enrolment and
       * nothing else, and it is not a session.
       */
      readonly kind: "enrolment_required";
      readonly enrolmentToken: string;
    }
  | {
      readonly kind: "rejected";
      /**
       * `challenge_invalid` covers a wrong code, a replayed code, an expired
       * challenge and a burned one — same reason for all four, same non-oracle
       * rationale as `invalid_credentials`.
       */
      readonly reason: "invalid_credentials" | "locked" | "challenge_invalid";
    };

export interface ChallengeResponse {
  readonly code: string;
}

/**
 * What the provider can do, so the UI can hide what it cannot.
 *
 * This is what lets B9 drop the change-password screen under SSO without any
 * feature module asking "are we on SSO?" — which would be a feature module
 * knowing about authentication mechanism, the one thing rule 1 forbids.
 */
export interface IdentityCapabilities {
  readonly supportsSelfServicePasswordChange: boolean;
  readonly supportsEnrolment: boolean;
  /** True under an IdP that performed MFA itself, which makes `completeChallenge` a no-op. */
  readonly mfaOwnedByProvider: boolean;
}

export interface IdentityProvider {
  authenticate(attempt: AuthenticationAttempt): Promise<AuthenticationOutcome>;

  /**
   * The second factor, as a separate operation rather than a second argument to
   * `authenticate`. An OIDC adapter whose IdP already did MFA answers
   * `rejected: 'challenge_invalid'` here because it never issues a challenge —
   * and its `capabilities().mfaOwnedByProvider` tells the caller not to ask.
   */
  completeChallenge(
    challengeId: string,
    response: ChallengeResponse,
  ): Promise<AuthenticationOutcome>;

  /**
   * Map an established subject to a `Principal`, on **every** request.
   *
   * Not a cache lookup: this is where roles and the live permission matrix are
   * read, which is what makes a B9 tab 3 edit effective on the next request
   * (api.md §3.1). For OIDC this will additionally map group claims to role
   * names; feature code sees only the result.
   *
   * Null means the subject is no longer a valid principal — deleted, or no longer
   * a member of that tenant.
   */
  resolvePrincipal(subject: SubjectRef): Promise<Principal | null>;

  capabilities(): IdentityCapabilities;

  /**
   * Which of these staff users currently have a second factor enrolled — the
   * Security tab's TOTP administration list (B9). Mechanism-neutral by the same
   * rule as everything else here: an OIDC adapter whose IdP owns MFA
   * (`capabilities().mfaOwnedByProvider`) may answer every id `true` (or read its
   * own IdP's enrolment state) without this port's caller knowing the difference.
   */
  listTotpEnrolmentStatus(staffUserIds: readonly string[]): Promise<ReadonlyMap<string, boolean>>;

  /**
   * Force re-enrolment for one user — e.g. after a lost device. Does **not**
   * disable the second-factor requirement itself (ADR-0006 rule 4: TOTP stays
   * mandatory for a privileged role); the next sign-in that reaches the challenge
   * step finds no secret and is routed to `enrolment_required` again, exactly the
   * same path a brand-new privileged user takes today.
   */
  resetTotpEnrolment(staffUserId: string, at: Date): Promise<void>;
}
