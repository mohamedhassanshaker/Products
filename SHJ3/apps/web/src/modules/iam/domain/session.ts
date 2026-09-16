/**
 * The session record, and the expiry rules that govern it.
 *
 * ADR-0006 rule 2: a session is an **opaque server-side record**, never a JWT
 * carrying claims the application interprets. That choice is load-bearing twice
 * over:
 *
 *  1. **Revocation is immediate.** B9's `Suspended` state has to end a session
 *     *now*, not at token expiry (api.md §3.6). A stateless token cannot do that
 *     without a revocation list, at which point it is a server-side session with
 *     extra cryptography.
 *  2. **OIDC arrival changes only session creation.** Everything that *reads* a
 *     session — this module included — is unchanged when `LocalPasswordProvider`
 *     becomes `OidcProvider`, because nothing here knows how the principal was
 *     established.
 *
 * ## What the record deliberately does not hold
 *
 * No roles, no permissions, no display name for a staff principal. api.md §3.1:
 * permissions are read fresh per request from the live matrix, so a permission
 * edit in B9 tab 3 takes effect on the next request rather than the next login.
 * Caching them on the record would make the matrix screen quietly advisory — an
 * editable matrix that is not the whole truth is worse than no matrix.
 *
 * It also holds no credential material of any kind: no hash, no TOTP secret, no
 * cookie value, no token (ADR-0006 rule 1).
 *
 * ## Two expiries, doing two different jobs
 *
 * **Idle** expiry (sliding) ends a session someone walked away from. **Absolute**
 * expiry ends a session no matter how actively it is used, which is the one that
 * bounds the damage from a stolen cookie. A single TTL cannot do both: a sliding
 * TTL alone renews a stolen session forever, and a fixed TTL alone logs an active
 * operator out mid-task.
 *
 * The store implements the pair as one Redis TTL — `remainingTtlSeconds` returns
 * the *lesser* of the two remaining windows — so the physical key can never
 * outlive the absolute deadline even if a `touch` races with it.
 *
 * No vendor imports, no I/O, `now` always a parameter (architecture.md §4).
 */

import type { TenantSlug } from "../../platform/tenancy/tenant-slug.js";
import type { AssuranceLevel } from "./assurance.js";

/**
 * Which surface the session belongs to. The two have materially different TTLs
 * and cookie attributes (api.md §3.1), and conflating them is how a 30-day
 * citizen window would end up in front of the backoffice.
 */
export type SessionKind = "staff" | "citizen";

/**
 * `partial` is a session that has passed the password step and is waiting on
 * TOTP. It **grants no permissions** and is accepted only by the TOTP route
 * (api.md §3.2) — which is why the stage is on the record rather than implied by
 * the absence of something.
 */
export type SessionStage = "partial" | "full";

/**
 * A coarse client fingerprint. api.md §3.1: a mismatch forces re-authentication
 * rather than silently continuing.
 *
 * Coarse on purpose. UA *family* rather than the full string, and an IP /24
 * rather than an address: a government user on mobile data changes address
 * mid-session and a browser auto-updates its minor version, and a binding that
 * signs people out for either is a binding that gets switched off. This catches a
 * cookie replayed from a different network and browser, which is the case worth
 * catching.
 */
export interface ClientBinding {
  readonly userAgentFamily: string;
  /** The first three octets of an IPv4 address, or the /48 of an IPv6 one. */
  readonly ipBlock: string;
}

export interface SessionRecord {
  /** 256 bits of `crypto.randomBytes`, minted by the store. Opaque: it decodes to nothing. */
  readonly id: string;
  readonly kind: SessionKind;
  readonly stage: SessionStage;
  /** `StaffUsers.id` for staff, `CitizenIdentities.id` (or a per-session id) for citizens. */
  readonly subjectId: string;
  /**
   * The tenant this session is bound to, fixed at creation from the principal's
   * membership. This is the value that becomes `TenantContext.tenant`, and it is
   * the reason a caller cannot name their own tenant (ADR-0002 rule 1).
   */
  readonly tenant: TenantSlug;
  /** Carried for citizens, whose name comes from the verified identity. Staff names are read live. */
  readonly displayName: string;
  /** Citizen assurance. `L0` for staff: no citizen verification has occurred, which is the truth. */
  readonly assurance: AssuranceLevel;
  /**
   * `StaffUsers.sessionEpoch` as it stood when this session was minted.
   *
   * Belt and braces alongside deleting the records: suspension deletes sessions,
   * but a request already in flight against another pod has already read its
   * record, and the epoch is what makes that request fail too.
   */
  readonly epoch: number;
  readonly binding: ClientBinding;
  readonly issuedAt: Date;
  readonly lastSeenAt: Date;
  readonly absoluteExpiresAt: Date;
}

/** Idle and absolute windows for one session kind. */
export interface SessionTtlPolicy {
  readonly idleSeconds: number;
  readonly absoluteSeconds: number;
}

/** api.md §3.1: 30-minute sliding idle, 12-hour absolute. */
export const STAFF_SESSION_TTL: SessionTtlPolicy = {
  idleSeconds: 30 * 60,
  absoluteSeconds: 12 * 60 * 60,
};

/**
 * api.md §3.1: 24-hour sliding idle, 30-day absolute. Long, because a citizen
 * returning to a bill enquiry a week later should not have to re-establish an
 * anonymous conversation — and long is affordable precisely because the session
 * carries no permissions and its assurance decays independently.
 */
export const CITIZEN_SESSION_TTL: SessionTtlPolicy = {
  idleSeconds: 24 * 60 * 60,
  absoluteSeconds: 30 * 24 * 60 * 60,
};

/**
 * A partial session lives only long enough to type a six-digit code. Idle and
 * absolute are equal: there is nothing to slide, because the TOTP step is one
 * request.
 */
export const PARTIAL_SESSION_TTL: SessionTtlPolicy = {
  idleSeconds: 5 * 60,
  absoluteSeconds: 5 * 60,
};

/**
 * `staffFullOverride` defaults to `undefined` (falling back to `STAFF_SESSION_TTL`) —
 * optional so every existing caller (and every test) is unaffected. Applied only for
 * `("staff", "full")`: a partial (TOTP-pending) session's short fixed window and a
 * citizen session's own TTL are not tenant-configurable by this feature. The one real
 * caller that resolves a tenant's `SecurityPolicy` (`sign-in.ts`) passes it in for the
 * full staff session only.
 */
export function ttlPolicyFor(
  kind: SessionKind,
  stage: SessionStage,
  staffFullOverride?: SessionTtlPolicy,
): SessionTtlPolicy {
  if (stage === "partial") return PARTIAL_SESSION_TTL;
  if (kind === "staff" && stage === "full" && staffFullOverride) return staffFullOverride;
  return kind === "staff" ? STAFF_SESSION_TTL : CITIZEN_SESSION_TTL;
}

/**
 * Why a session is no longer usable.
 *
 * `idle` and `absolute` are separated because they mean different things to an
 * operator reading a log: the first is someone who walked away, the second is a
 * session that hit its ceiling mid-use and may be worth noticing.
 */
export type SessionExpiry = "active" | "idle" | "absolute";

/** The moment the idle window closes, given the last request. */
export function idleDeadline(session: SessionRecord, policy: SessionTtlPolicy): Date {
  return new Date(session.lastSeenAt.getTime() + policy.idleSeconds * 1_000);
}

/**
 * Classify a session against both windows.
 *
 * Absolute is checked first: a session past its ceiling is past it regardless of
 * how recently it was used, and reporting `idle` for it would be misleading.
 */
export function sessionExpiry(
  session: SessionRecord,
  policy: SessionTtlPolicy,
  now: Date,
): SessionExpiry {
  if (now.getTime() >= session.absoluteExpiresAt.getTime()) return "absolute";
  if (now.getTime() >= idleDeadline(session, policy).getTime()) return "idle";
  return "active";
}

export function isSessionExpired(
  session: SessionRecord,
  policy: SessionTtlPolicy,
  now: Date,
): boolean {
  return sessionExpiry(session, policy, now) !== "active";
}

/**
 * The TTL the physical key should carry: the lesser of the two remaining
 * windows, floored at zero.
 *
 * This is the mechanism that makes the pair safe. Because the key's own
 * expiry can never exceed the absolute deadline, a `touch` that slides the idle
 * window cannot extend the session past its ceiling — not even if the sliding
 * logic is wrong. The store's correctness does not depend on the caller's.
 */
export function remainingTtlSeconds(
  session: SessionRecord,
  policy: SessionTtlPolicy,
  now: Date,
): number {
  const untilIdle = idleDeadline(session, policy).getTime() - now.getTime();
  const untilAbsolute = session.absoluteExpiresAt.getTime() - now.getTime();
  const remaining = Math.min(untilIdle, untilAbsolute);
  return remaining <= 0 ? 0 : Math.ceil(remaining / 1_000);
}

/** Slide the idle window. Returns a new record; `SessionRecord` is immutable. */
export function slideSession(session: SessionRecord, now: Date): SessionRecord {
  return { ...session, lastSeenAt: now };
}

/**
 * True when the principal's session epoch has moved on since this session was
 * minted — i.e. someone suspended the user or rotated their password.
 */
export function isEpochStale(session: SessionRecord, currentEpoch: number): boolean {
  return session.epoch !== currentEpoch;
}

/**
 * Compare two fingerprints. Both fields must match; a partial match is a
 * mismatch, because "same browser, different network" and "same network,
 * different browser" are each more likely to be a replayed cookie than a
 * legitimate change of both.
 */
export function bindingMatches(a: ClientBinding, b: ClientBinding): boolean {
  return a.userAgentFamily === b.userAgentFamily && a.ipBlock === b.ipBlock;
}

/**
 * Derive the coarse fingerprint from what a request offers.
 *
 * Both inputs are attacker-controlled, which is fine: the binding is not an
 * authorization input. It only has to be *stable* for a legitimate client and
 * *different* for a cookie replayed from elsewhere. An attacker who can forge
 * both fields already holds the cookie, and this control was never aimed at them.
 */
export function clientBindingOf(userAgent: string | null, ipAddress: string | null): ClientBinding {
  return {
    userAgentFamily: userAgentFamilyOf(userAgent),
    ipBlock: ipBlockOf(ipAddress),
  };
}

/**
 * The product token before the first slash — `Mozilla`, `curl`, `okhttp`.
 *
 * Crude by design: anything finer tracks browser minor versions and signs users
 * out on auto-update.
 */
function userAgentFamilyOf(userAgent: string | null): string {
  if (!userAgent) return "unknown";
  const token = userAgent.trim().split(/[/\s]/, 1)[0];
  return token && token.length > 0 ? token.slice(0, 32) : "unknown";
}

/**
 * IPv4 → first three octets. IPv6 → first three hextets, which is the /48 that
 * a provider typically assigns as one site.
 */
function ipBlockOf(ipAddress: string | null): string {
  if (!ipAddress) return "unknown";
  const address = ipAddress.trim();
  if (address.length === 0) return "unknown";

  if (address.includes(":")) return address.split(":").slice(0, 3).join(":");

  const octets = address.split(".");
  return octets.length === 4 ? octets.slice(0, 3).join(".") : "unknown";
}
