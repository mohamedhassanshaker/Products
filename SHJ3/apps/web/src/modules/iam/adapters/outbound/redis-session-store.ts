/**
 * Opaque server-side sessions in Redis.
 *
 * ADR-0006 rule 2. The three things this file exists to guarantee:
 *
 *  1. **The id is opaque.** 256 bits from `crypto.randomBytes`, base64url. It
 *     decodes to nothing, carries no claims, and cannot be forged offline — which
 *     is the property a JWT trades away in exchange for statelessness.
 *  2. **Revocation is immediate.** `destroyAllForSubject` is a real operation
 *     against real keys, which is what makes B9's `Suspended` state end a session
 *     *now* (api.md §3.6) rather than at token expiry.
 *  3. **No Redis client is constructed here.** Everything goes through
 *     `getTenantCache()`, which is the only handle that exists (ADR-0002 rule 3);
 *     the `no-unscoped-store-clients` gate fails the build otherwise. Every key
 *     written from this file is therefore inside the calling tenant's prefix, and
 *     one government entity's sessions are unreachable from another's request.
 *
 * ## The per-subject index, and why it is keys rather than a set
 *
 * api.md §3.6 describes revocation as one `UNLINK` over a maintained
 * `user-sessions:{userId}` set. `TenantCache` deliberately exposes no set
 * commands — its surface is narrow so that every command taking a key pattern is
 * either absent or prefix-bounded — so the index is built from keys instead: each
 * session writes a marker at `user-session:{subjectId}:{sessionId}` with the same
 * TTL as the record. Revocation scans that one prefix, which is bounded by *that
 * user's own* session count and cannot escape the tenant, then deletes records and
 * markers in a single call.
 *
 * That is the same guarantee by a different primitive, and it is preferable to
 * widening the cache surface: an `sMembers` on `TenantCache` would then be
 * available to every future caller, and the value of that surface being narrow is
 * that it stays auditable.
 *
 * ## Serialisation
 *
 * JSON with ISO-8601 dates, revived explicitly. `JSON.parse` cannot restore a
 * `Date`, and a session whose `absoluteExpiresAt` silently became a string would
 * compare as never expired — a session outliving its ceiling is the one failure
 * this module cannot have. So the revival is exhaustive, and a record that does
 * not revive is treated as absent.
 */

import { randomBytes } from "node:crypto";
import { getTenantCache } from "../../../platform/adapters/outbound/cache/tenant-cache.js";
import { assertValidSlugShape } from "../../../platform/tenancy/tenant-slug.js";
import { isAssuranceLevel, type AssuranceLevel } from "../../domain/assurance.js";
import {
  remainingTtlSeconds,
  ttlPolicyFor,
  type ClientBinding,
  type SessionKind,
  type SessionRecord,
  type SessionStage,
  type SessionTtlPolicy,
} from "../../domain/session.js";
import {
  CHALLENGE_FAILURES_BEFORE_BURN,
  type ChallengeStore,
  type NewSession,
  type ReplayGuard,
  type SessionStore,
  type TotpChallenge,
} from "../../ports/session-store.js";
import type { EnrolmentTokenIssuer } from "./local-password-provider.js";

/**
 * 32 bytes = 256 bits, per api.md §3.1. Enough that guessing is not a strategy
 * even against every session in every tenant simultaneously.
 */
const OPAQUE_ID_BYTES = 32;

const SESSION_PREFIX = "session:";
const SUBJECT_INDEX_PREFIX = "user-session:";
const CHALLENGE_PREFIX = "totp-challenge:";
const REPLAY_PREFIX = "totp-used:";
const ENROLMENT_PREFIX = "totp-enrolment:";

/** Enrolment must be completed in one sitting; a token left lying around is a bypass. */
const ENROLMENT_TTL_SECONDS = 15 * 60;

/**
 * base64url, so the value is cookie- and URL-safe without escaping. Never a
 * counter, a hash of anything, or a value derived from the subject: an id that
 * encodes something is an id an attacker can reason about.
 */
function opaqueId(): string {
  return randomBytes(OPAQUE_ID_BYTES).toString("base64url");
}

/** The marker key that puts a session in its subject's index. */
function subjectIndexKey(subjectId: string, sessionId: string): string {
  return `${SUBJECT_INDEX_PREFIX}${subjectId}:${sessionId}`;
}

interface StoredSession {
  readonly id: string;
  readonly kind: string;
  readonly stage: string;
  readonly subjectId: string;
  readonly tenant: string;
  readonly displayName: string;
  readonly assurance: string;
  readonly epoch: number;
  readonly binding: ClientBinding;
  readonly issuedAt: string;
  readonly lastSeenAt: string;
  readonly absoluteExpiresAt: string;
}

const SESSION_KINDS: readonly string[] = ["staff", "citizen"];
const SESSION_STAGES: readonly string[] = ["partial", "full"];

/**
 * Revive a record, or return null.
 *
 * Every field is checked. A record written under an older shape is treated as
 * absent rather than partially trusted, which turns a deploy that changes this
 * interface into "everyone signs in again" instead of "some sessions behave
 * oddly".
 */
function reviveSession(raw: string): SessionRecord | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;

  const stored = parsed as Partial<StoredSession>;
  const { kind, stage, assurance, binding } = stored;

  if (
    typeof stored.id !== "string" ||
    typeof kind !== "string" ||
    !SESSION_KINDS.includes(kind) ||
    typeof stage !== "string" ||
    !SESSION_STAGES.includes(stage) ||
    typeof stored.subjectId !== "string" ||
    typeof stored.tenant !== "string" ||
    typeof stored.displayName !== "string" ||
    typeof assurance !== "string" ||
    !isAssuranceLevel(assurance) ||
    typeof stored.epoch !== "number" ||
    typeof binding !== "object" ||
    binding === null ||
    typeof binding.userAgentFamily !== "string" ||
    typeof binding.ipBlock !== "string" ||
    typeof stored.issuedAt !== "string" ||
    typeof stored.lastSeenAt !== "string" ||
    typeof stored.absoluteExpiresAt !== "string"
  ) {
    return null;
  }

  const issuedAt = new Date(stored.issuedAt);
  const lastSeenAt = new Date(stored.lastSeenAt);
  const absoluteExpiresAt = new Date(stored.absoluteExpiresAt);
  if (
    Number.isNaN(issuedAt.getTime()) ||
    Number.isNaN(lastSeenAt.getTime()) ||
    Number.isNaN(absoluteExpiresAt.getTime())
  ) {
    return null;
  }

  return {
    id: stored.id,
    kind: kind as SessionKind,
    stage: stage as SessionStage,
    subjectId: stored.subjectId,
    // Re-validated on the way out. The check is cheap and this value goes on to
    // become a store identifier, which is never interpolated unvalidated
    // (ADR-0002 rule 4).
    tenant: assertValidSlugShape(stored.tenant),
    displayName: stored.displayName,
    assurance: assurance as AssuranceLevel,
    epoch: stored.epoch,
    binding: { userAgentFamily: binding.userAgentFamily, ipBlock: binding.ipBlock },
    issuedAt,
    lastSeenAt,
    absoluteExpiresAt,
  };
}

function serialiseSession(session: SessionRecord): string {
  const stored: StoredSession = {
    id: session.id,
    kind: session.kind,
    stage: session.stage,
    subjectId: session.subjectId,
    tenant: session.tenant,
    displayName: session.displayName,
    assurance: session.assurance,
    epoch: session.epoch,
    binding: session.binding,
    issuedAt: session.issuedAt.toISOString(),
    lastSeenAt: session.lastSeenAt.toISOString(),
    absoluteExpiresAt: session.absoluteExpiresAt.toISOString(),
  };
  return JSON.stringify(stored);
}

export class RedisSessionStore implements SessionStore {
  async create(input: NewSession, now: Date): Promise<SessionRecord> {
    const session: SessionRecord = {
      id: opaqueId(),
      kind: input.kind,
      stage: input.stage,
      subjectId: input.subjectId,
      tenant: input.tenant,
      displayName: input.displayName,
      assurance: input.assurance,
      epoch: input.epoch,
      binding: input.binding,
      issuedAt: now,
      lastSeenAt: now,
      absoluteExpiresAt: new Date(now.getTime() + input.ttl.absoluteSeconds * 1_000),
    };

    const ttl = remainingTtlSeconds(session, input.ttl, now);
    const cache = getTenantCache("session create");

    await cache.set(`${SESSION_PREFIX}${session.id}`, serialiseSession(session), ttl);
    // The marker carries no data: the record is the truth, and duplicating any of
    // it here would create a second copy to keep in step.
    await cache.set(subjectIndexKey(session.subjectId, session.id), "1", ttl);

    return session;
  }

  async read(sessionId: string): Promise<SessionRecord | null> {
    const raw = await getTenantCache("session read").get(`${SESSION_PREFIX}${sessionId}`);
    return raw === null ? null : reviveSession(raw);
  }

  async touch(session: SessionRecord, now: Date, ttlOverride?: SessionTtlPolicy): Promise<void> {
    const ttl = remainingTtlSeconds(
      session,
      ttlOverride ?? ttlPolicyFor(session.kind, session.stage),
      now,
    );
    // Zero means the session is already past one of its deadlines. Writing it
    // with no TTL would make it immortal — the exact failure the clamp inside
    // `remainingTtlSeconds` exists to prevent — so drop it instead.
    if (ttl <= 0) {
      await this.destroy(session.id);
      return;
    }

    const cache = getTenantCache("session touch");
    await cache.set(`${SESSION_PREFIX}${session.id}`, serialiseSession(session), ttl);
    await cache.expire(subjectIndexKey(session.subjectId, session.id), ttl);
  }

  async destroy(sessionId: string): Promise<void> {
    const existing = await this.read(sessionId);
    const keys = [`${SESSION_PREFIX}${sessionId}`];
    if (existing) keys.push(subjectIndexKey(existing.subjectId, sessionId));
    await getTenantCache("session destroy").del(...keys);
  }

  async destroyAllForSubject(subjectId: string): Promise<number> {
    const cache = getTenantCache("session revoke");
    const indexPrefix = `${SUBJECT_INDEX_PREFIX}${subjectId}:`;
    const markers = await cache.scanKeys(`${indexPrefix}*`);
    if (markers.length === 0) return 0;

    const sessionKeys = markers.map(
      (marker) => `${SESSION_PREFIX}${marker.slice(indexPrefix.length)}`,
    );

    // One call for records and markers together: a partial revocation would leave
    // a suspended user holding a live session, which is the failure api.md §3.6
    // exists to rule out.
    await cache.del(...sessionKeys, ...markers);
    return sessionKeys.length;
  }

  async destroyAllForTenant(): Promise<number> {
    const cache = getTenantCache("tenant session revoke");
    // Every session key AND every subject-index marker in the ambient tenant's cache
    // namespace — unlike `destroyAllForSubject`, this does not need to correlate a
    // marker back to its record first, because it is deleting all of both rather
    // than one subject's slice of them.
    const [sessionKeys, markers] = await Promise.all([
      cache.scanKeys(`${SESSION_PREFIX}*`),
      cache.scanKeys(`${SUBJECT_INDEX_PREFIX}*`),
    ]);
    if (sessionKeys.length === 0 && markers.length === 0) return 0;
    await cache.del(...sessionKeys, ...markers);
    return sessionKeys.length;
  }
}

interface StoredChallenge {
  readonly id: string;
  readonly staffUserId: string;
  readonly tenant: string;
  readonly failureCount: number;
  readonly expiresAt: string;
}

export class RedisChallengeStore implements ChallengeStore {
  async issue(
    challenge: Omit<TotpChallenge, "id" | "failureCount">,
    now: Date,
  ): Promise<TotpChallenge> {
    const issued: TotpChallenge = { ...challenge, id: opaqueId(), failureCount: 0 };
    await this.write(issued, now);
    return issued;
  }

  async read(challengeId: string): Promise<TotpChallenge | null> {
    const raw = await getTenantCache("challenge read").get(`${CHALLENGE_PREFIX}${challengeId}`);
    if (raw === null) return null;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
    if (typeof parsed !== "object" || parsed === null) return null;

    const stored = parsed as Partial<StoredChallenge>;
    if (
      typeof stored.id !== "string" ||
      typeof stored.staffUserId !== "string" ||
      typeof stored.tenant !== "string" ||
      typeof stored.failureCount !== "number" ||
      typeof stored.expiresAt !== "string"
    ) {
      return null;
    }

    const expiresAt = new Date(stored.expiresAt);
    if (Number.isNaN(expiresAt.getTime())) return null;

    return {
      id: stored.id,
      staffUserId: stored.staffUserId,
      tenant: assertValidSlugShape(stored.tenant),
      failureCount: stored.failureCount,
      expiresAt,
    };
  }

  async recordFailure(challengeId: string): Promise<TotpChallenge | null> {
    const existing = await this.read(challengeId);
    if (!existing) return null;

    const updated: TotpChallenge = { ...existing, failureCount: existing.failureCount + 1 };
    if (updated.failureCount >= CHALLENGE_FAILURES_BEFORE_BURN) {
      await this.burn(challengeId);
      return null;
    }

    await this.write(updated, new Date());
    return updated;
  }

  async burn(challengeId: string): Promise<void> {
    await getTenantCache("challenge burn").del(`${CHALLENGE_PREFIX}${challengeId}`);
  }

  /**
   * The TTL is always derived from the challenge's own `expiresAt`, never from a
   * fresh window. Five wrong guesses must not be able to extend the challenge.
   */
  private async write(challenge: TotpChallenge, now: Date): Promise<void> {
    const ttl = Math.ceil((challenge.expiresAt.getTime() - now.getTime()) / 1_000);
    if (ttl <= 0) return;

    const stored: StoredChallenge = {
      id: challenge.id,
      staffUserId: challenge.staffUserId,
      tenant: challenge.tenant,
      failureCount: challenge.failureCount,
      expiresAt: challenge.expiresAt.toISOString(),
    };
    await getTenantCache("challenge write").set(
      `${CHALLENGE_PREFIX}${challenge.id}`,
      JSON.stringify(stored),
      ttl,
    );
  }
}

/**
 * Single-use enforcement for TOTP codes, as an atomic test-and-set.
 *
 * `setIfAbsent` is `SET NX EX` — one round trip, no read-then-write window. Two
 * requests carrying the same code a millisecond apart therefore cannot both see
 * "unused", which is the whole reason this is not a `get` followed by a `set`.
 */
export class RedisReplayGuard implements ReplayGuard {
  async remember(subject: string, code: string, ttlSeconds: number): Promise<boolean> {
    return getTenantCache("totp replay guard").setIfAbsent(
      `${REPLAY_PREFIX}${subject}:${code}`,
      "1",
      ttlSeconds,
    );
  }
}

/**
 * One-shot enrolment tokens.
 *
 * Consumed by deleting: `del` returning 1 proves this call is the one that spent
 * the token, so two concurrent enrolment attempts cannot both succeed.
 */
export class RedisEnrolmentTokenIssuer implements EnrolmentTokenIssuer {
  async issue(staffUserId: string): Promise<string> {
    const token = opaqueId();
    await getTenantCache("enrolment token issue").set(
      `${ENROLMENT_PREFIX}${token}`,
      staffUserId,
      ENROLMENT_TTL_SECONDS,
    );
    return token;
  }

  async consume(token: string): Promise<string | null> {
    const cache = getTenantCache("enrolment token consume");
    const key = `${ENROLMENT_PREFIX}${token}`;
    const staffUserId = await cache.get(key);
    if (staffUserId === null) return null;

    const deleted = await cache.del(key);
    return deleted === 1 ? staffUserId : null;
  }
}
