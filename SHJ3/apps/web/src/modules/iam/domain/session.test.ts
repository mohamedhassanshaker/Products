import { describe, expect, it } from "vitest";
import type { TenantSlug } from "../../platform/tenancy/tenant-slug.js";
import {
  CITIZEN_SESSION_TTL,
  PARTIAL_SESSION_TTL,
  STAFF_SESSION_TTL,
  bindingMatches,
  clientBindingOf,
  idleDeadline,
  isEpochStale,
  isSessionExpired,
  remainingTtlSeconds,
  sessionExpiry,
  slideSession,
  ttlPolicyFor,
  type SessionRecord,
} from "./session.js";

/**
 * Session expiry: idle versus absolute.
 *
 * The pair is the reason this is not a single TTL. A sliding window alone renews
 * a stolen cookie forever; a fixed window alone signs an operator out mid-task.
 * These tests assert that each does its own job and that the two interact in the
 * one direction that matters — the absolute deadline always wins.
 *
 * Covers ADR-0006 rule 2 and api.md §3.1.
 */

const ISSUED = new Date("2026-09-08T09:00:00.000Z");

function session(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: "session-1",
    kind: "staff",
    stage: "full",
    subjectId: "usr_01JBSARA",
    tenant: "sewa" as TenantSlug,
    displayName: "Sara Al Mazrouei",
    assurance: "L0",
    epoch: 3,
    binding: { userAgentFamily: "Mozilla", ipBlock: "10.20.30" },
    issuedAt: ISSUED,
    lastSeenAt: ISSUED,
    absoluteExpiresAt: new Date(ISSUED.getTime() + STAFF_SESSION_TTL.absoluteSeconds * 1_000),
    ...overrides,
  };
}

function secondsAfterIssue(seconds: number): Date {
  return new Date(ISSUED.getTime() + seconds * 1_000);
}

describe("the TTL policies match api.md §3.1", () => {
  it("gives staff 30 minutes idle and 12 hours absolute", () => {
    expect(STAFF_SESSION_TTL).toEqual({ idleSeconds: 1_800, absoluteSeconds: 43_200 });
  });

  it("gives citizens 24 hours idle and 30 days absolute", () => {
    expect(CITIZEN_SESSION_TTL).toEqual({ idleSeconds: 86_400, absoluteSeconds: 2_592_000 });
  });

  it("gives a partial session equal windows — there is nothing to slide", () => {
    expect(PARTIAL_SESSION_TTL.idleSeconds).toBe(PARTIAL_SESSION_TTL.absoluteSeconds);
  });

  it("selects the partial policy by stage, whatever the kind", () => {
    expect(ttlPolicyFor("staff", "partial")).toBe(PARTIAL_SESSION_TTL);
    expect(ttlPolicyFor("citizen", "partial")).toBe(PARTIAL_SESSION_TTL);
    expect(ttlPolicyFor("staff", "full")).toBe(STAFF_SESSION_TTL);
    expect(ttlPolicyFor("citizen", "full")).toBe(CITIZEN_SESSION_TTL);
  });
});

describe("idle expiry", () => {
  it("stays active inside the idle window", () => {
    expect(sessionExpiry(session(), STAFF_SESSION_TTL, secondsAfterIssue(1_799))).toBe("active");
  });

  it("expires exactly at the idle deadline", () => {
    expect(sessionExpiry(session(), STAFF_SESSION_TTL, secondsAfterIssue(1_800))).toBe("idle");
  });

  it("measures from the last request, not from issue", () => {
    // The whole point of a sliding window: an operator working continuously for
    // eleven hours is never idle.
    const active = session({ lastSeenAt: secondsAfterIssue(10 * 3_600) });
    expect(sessionExpiry(active, STAFF_SESSION_TTL, secondsAfterIssue(10 * 3_600 + 60))).toBe(
      "active",
    );
  });

  it("moves the deadline when slid", () => {
    const slid = slideSession(session(), secondsAfterIssue(600));
    expect(idleDeadline(slid, STAFF_SESSION_TTL)).toEqual(secondsAfterIssue(600 + 1_800));
    // Immutably: the original record is untouched.
    expect(idleDeadline(session(), STAFF_SESSION_TTL)).toEqual(secondsAfterIssue(1_800));
  });
});

describe("absolute expiry", () => {
  it("ends a continuously active session at its ceiling", () => {
    // This is the one that bounds the damage from a stolen cookie: no amount of
    // use extends it.
    const busy = session({ lastSeenAt: secondsAfterIssue(43_199) });
    expect(sessionExpiry(busy, STAFF_SESSION_TTL, secondsAfterIssue(43_200))).toBe("absolute");
  });

  it("reports absolute rather than idle when both have passed", () => {
    // Reporting "idle" for a session that hit its ceiling would mislead whoever
    // reads the log.
    expect(sessionExpiry(session(), STAFF_SESSION_TTL, secondsAfterIssue(50_000))).toBe("absolute");
  });

  it("is a stored deadline, so shortening the policy cannot resurrect a session", () => {
    const expired = session({
      absoluteExpiresAt: secondsAfterIssue(100),
      lastSeenAt: secondsAfterIssue(90),
    });
    expect(isSessionExpired(expired, STAFF_SESSION_TTL, secondsAfterIssue(101))).toBe(true);
  });
});

describe("remainingTtlSeconds is the clamp that makes the pair safe", () => {
  it("returns the idle window while it is the shorter one", () => {
    expect(remainingTtlSeconds(session(), STAFF_SESSION_TTL, ISSUED)).toBe(1_800);
  });

  it("returns the absolute remainder once that is shorter", () => {
    // Near the ceiling, the physical key must expire with the ceiling — not 30
    // minutes past it.
    const late = session({ lastSeenAt: secondsAfterIssue(43_000) });
    expect(remainingTtlSeconds(late, STAFF_SESSION_TTL, secondsAfterIssue(43_000))).toBe(200);
  });

  it("never lets a slide push a key past the absolute deadline", () => {
    // The property, stated directly: at every second of the session's life, the
    // TTL a touch would write lands at or before the ceiling.
    for (const elapsed of [0, 1_000, 20_000, 42_000, 43_100]) {
      const now = secondsAfterIssue(elapsed);
      const slid = slideSession(session(), now);
      const ttl = remainingTtlSeconds(slid, STAFF_SESSION_TTL, now);
      expect(now.getTime() + ttl * 1_000).toBeLessThanOrEqual(slid.absoluteExpiresAt.getTime());
    }
  });

  it("floors at zero rather than returning a negative TTL", () => {
    // A negative TTL handed to Redis is an immortal key.
    expect(remainingTtlSeconds(session(), STAFF_SESSION_TTL, secondsAfterIssue(99_999))).toBe(0);
  });
});

describe("epoch staleness", () => {
  it("accepts a session whose epoch still matches", () => {
    expect(isEpochStale(session({ epoch: 3 }), 3)).toBe(false);
  });

  it("rejects a session minted before a bump", () => {
    // The mechanism that catches a request already in flight on another pod when
    // B9 suspends the user (api.md §3.6).
    expect(isEpochStale(session({ epoch: 3 }), 4)).toBe(true);
  });

  it("rejects a session whose epoch is ahead, rather than trusting it", () => {
    // Should be impossible. If it happens, the record is wrong and the safe
    // reading of a wrong record is "not valid".
    expect(isEpochStale(session({ epoch: 5 }), 4)).toBe(true);
  });
});

describe("client binding", () => {
  it("matches an identical fingerprint", () => {
    const binding = clientBindingOf("Mozilla/5.0 (Windows NT 10.0)", "10.20.30.40");
    expect(
      bindingMatches(binding, clientBindingOf("Mozilla/5.0 (X11; Linux)", "10.20.30.99")),
    ).toBe(true);
  });

  it("survives a browser minor-version bump and a changed last octet", () => {
    // Deliberately coarse: a binding that signs people out on an auto-update is
    // a binding that gets switched off.
    const before = clientBindingOf("Mozilla/5.0 (rv:120.0)", "10.20.30.5");
    const after = clientBindingOf("Mozilla/5.0 (rv:121.0)", "10.20.30.200");
    expect(bindingMatches(before, after)).toBe(true);
  });

  it("rejects a cookie replayed from a different network", () => {
    const original = clientBindingOf("Mozilla/5.0", "10.20.30.40");
    const replayed = clientBindingOf("Mozilla/5.0", "203.0.113.7");
    expect(bindingMatches(original, replayed)).toBe(false);
  });

  it("rejects a cookie replayed from a different client", () => {
    const browser = clientBindingOf("Mozilla/5.0", "10.20.30.40");
    const script = clientBindingOf("curl/8.4.0", "10.20.30.40");
    expect(bindingMatches(browser, script)).toBe(false);
  });

  it("requires both halves to match", () => {
    const original = clientBindingOf("Mozilla/5.0", "10.20.30.40");
    expect(bindingMatches(original, clientBindingOf("curl/8.4.0", "203.0.113.7"))).toBe(false);
  });

  it("derives a stable placeholder from missing values instead of throwing", () => {
    const unknown = clientBindingOf(null, null);
    expect(unknown).toEqual({ userAgentFamily: "unknown", ipBlock: "unknown" });
    expect(bindingMatches(unknown, clientBindingOf(null, null))).toBe(true);
  });

  it("takes the /48 of an IPv6 address", () => {
    expect(clientBindingOf("Mozilla/5.0", "2001:db8:1234:5678::1").ipBlock).toBe("2001:db8:1234");
  });
});
