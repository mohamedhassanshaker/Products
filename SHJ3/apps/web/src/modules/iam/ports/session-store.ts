/**
 * Session, challenge and replay storage.
 *
 * ADR-0006 rule 2 in port form. Three interfaces, all backed by Redis today, all
 * describing *ephemeral* state whose loss signs people out and causes nothing
 * worse — which is exactly ADR-0003's test for what may live in Redis.
 *
 * ## Why the store mints the id rather than accepting one
 *
 * `create` returns the record it wrote, including an id it generated itself.
 * There is no `create(id, …)`. A caller that could choose a session id could
 * choose a *predictable* one, and session fixation is the whole class of bug that
 * closes off. The randomness therefore lives in the adapter next to
 * `crypto.randomBytes`, and a fake can be deterministic without the production
 * path ever accepting an id from outside.
 *
 * ## Why replay protection is a store concern
 *
 * A TOTP code is valid for a 90-second window, so "single use" cannot be decided
 * from the code and the secret alone — it needs memory shared across every pod
 * that might receive the second request. `ReplayGuard` is that memory, expressed
 * narrowly enough that a fake is three lines.
 */

import type { AssuranceLevel } from "../domain/assurance.js";
import type {
  ClientBinding,
  SessionKind,
  SessionRecord,
  SessionStage,
  SessionTtlPolicy,
} from "../domain/session.js";
import type { TenantSlug } from "../../platform/tenancy/tenant-slug.js";

/**
 * Everything needed to mint a session except the id and the timestamps, which
 * the store derives.
 */
export interface NewSession {
  readonly kind: SessionKind;
  readonly stage: SessionStage;
  readonly subjectId: string;
  readonly tenant: TenantSlug;
  readonly displayName: string;
  readonly assurance: AssuranceLevel;
  readonly epoch: number;
  readonly binding: ClientBinding;
  readonly ttl: SessionTtlPolicy;
}

export interface SessionStore {
  create(session: NewSession, now: Date): Promise<SessionRecord>;

  /**
   * Null for an id that never existed **and** for one whose key has expired. The
   * two are indistinguishable to a caller on purpose: a store that could tell
   * them apart would let an attacker confirm that a guessed id was once real.
   */
  read(sessionId: string): Promise<SessionRecord | null>;

  /**
   * Slide the idle window and re-set the physical TTL.
   *
   * The implementation must clamp the new TTL to `remainingTtlSeconds`, so a
   * touch can never carry a session past its absolute deadline.
   *
   * `ttlOverride` defaults to `ttlPolicyFor(session.kind, session.stage)` when omitted —
   * optional so every existing caller is unaffected. `ResolveSession` passes the
   * signed-in user's own tenant's real `SecurityPolicy`-derived policy for a full staff
   * session, so a tenant's configured window is honoured on every request, not only at
   * sign-in.
   */
  touch(session: SessionRecord, now: Date, ttlOverride?: SessionTtlPolicy): Promise<void>;

  destroy(sessionId: string): Promise<void>;

  /**
   * Delete every session belonging to one subject, and return how many went.
   *
   * This is the operation B9's `Suspend` depends on (api.md §3.6): suspension
   * must end a session *now*, and a stateless token could not offer this method
   * at all. The count is returned so the audit entry can record what was actually
   * revoked rather than what was intended.
   */
  destroyAllForSubject(subjectId: string): Promise<number>;

  /**
   * Delete every session in the **ambient** tenant, and return how many went.
   *
   * No `tenant` parameter, matching every other method on this interface — the
   * scope is whichever tenant is currently bound via `runWithTenant()`
   * (ADR-0002 rule 2), same as `getTenantCache()` itself. `SuspendTenant` (Part
   * C of the platform-admin wave) calls this after rebinding to the *target*
   * tenant for the duration of the call — the operator's own session stays
   * bound to the Platform tenant throughout, only the destroy call's ambient
   * context is momentarily the tenant being suspended. This is what makes
   * "Suspended" end every live session immediately (api.md §3.6's same
   * guarantee `destroyAllForSubject` gives per-user, extended to "every user of
   * this tenant").
   */
  destroyAllForTenant(): Promise<number>;
}

/**
 * The pending second factor.
 *
 * Stored rather than derived so that the five-failure burn (api.md §3.2) has
 * somewhere to count. A challenge id is opaque and single-purpose: it authorises
 * one TOTP submission and grants nothing on its own.
 */
export interface TotpChallenge {
  readonly id: string;
  /**
   * Who the password step authenticated. This is the binding that matters: a
   * challenge cannot be completed into anyone else's session, because the
   * resulting principal is compared against the partial session's subject. There
   * is deliberately no separate "which partial session" field — it would be a
   * second copy of the same fact, written after the challenge already exists, and
   * a placeholder waiting to be filled in is how a binding silently becomes
   * optional.
   */
  readonly staffUserId: string;
  readonly tenant: TenantSlug;
  readonly failureCount: number;
  readonly expiresAt: Date;
}

/** How many wrong codes burn the challenge and send the user back to the password step. */
export const CHALLENGE_FAILURES_BEFORE_BURN = 5;

export interface ChallengeStore {
  issue(challenge: Omit<TotpChallenge, "id" | "failureCount">, now: Date): Promise<TotpChallenge>;

  read(challengeId: string): Promise<TotpChallenge | null>;

  /**
   * Count one wrong code and return the updated challenge, or null once it is
   * burned. Returning null on burn rather than a flag means a burned challenge
   * behaves identically to an expired or invented one.
   */
  recordFailure(challengeId: string): Promise<TotpChallenge | null>;

  burn(challengeId: string): Promise<void>;
}

/**
 * Single-use enforcement for time-based codes.
 *
 * `remember` is a test-and-set: `true` means this subject had not presented this
 * code before and it is now recorded, `false` means it had. The atomicity is the
 * entire point, so an implementation built from a read followed by a write is
 * wrong — two requests one millisecond apart would both see "unused".
 */
export interface ReplayGuard {
  remember(subject: string, code: string, ttlSeconds: number): Promise<boolean>;
}
