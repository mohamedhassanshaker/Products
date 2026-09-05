import { describe, expect, it } from "vitest";
import { BreakglassGrantExpiryTooLongError } from "@nextbot/contracts";
import { classifyInactiveBreakglassGrant, computeBreakglassGrantExpiry, isBreakglassGrantActive } from "./breakglass-grant-policy.js";

const NOW = new Date("2026-06-15T12:00:00.000Z");

describe("computeBreakglassGrantExpiry (Phase 20, FR-ADM-09)", () => {
  it("computes expiresAt as now + N hours for a valid window", () => {
    const expiresAt = computeBreakglassGrantExpiry(2, NOW);
    expect(expiresAt.toISOString()).toBe("2026-06-15T14:00:00.000Z");
  });

  it("accepts exactly the platform maximum (24h)", () => {
    const expiresAt = computeBreakglassGrantExpiry(24, NOW);
    expect(expiresAt.toISOString()).toBe("2026-06-16T12:00:00.000Z");
  });

  it("rejects a window longer than the platform maximum rather than clamping it", () => {
    expect(() => computeBreakglassGrantExpiry(25, NOW)).toThrow(BreakglassGrantExpiryTooLongError);
  });

  it("rejects zero/negative/non-integer windows", () => {
    expect(() => computeBreakglassGrantExpiry(0, NOW)).toThrow(BreakglassGrantExpiryTooLongError);
    expect(() => computeBreakglassGrantExpiry(-1, NOW)).toThrow(BreakglassGrantExpiryTooLongError);
    expect(() => computeBreakglassGrantExpiry(1.5, NOW)).toThrow(BreakglassGrantExpiryTooLongError);
  });
});

describe("isBreakglassGrantActive (Phase 20, FR-ADM-09)", () => {
  it("is active when unrevoked and not yet expired", () => {
    expect(isBreakglassGrantActive({ expiresAt: new Date(NOW.getTime() + 1000), revokedAt: null }, NOW)).toBe(true);
  });

  it("is not active once revoked, even if the time-box hasn't elapsed", () => {
    expect(isBreakglassGrantActive({ expiresAt: new Date(NOW.getTime() + 1000), revokedAt: NOW }, NOW)).toBe(false);
  });

  it("is not active once expired, even if never revoked", () => {
    expect(isBreakglassGrantActive({ expiresAt: new Date(NOW.getTime() - 1), revokedAt: null }, NOW)).toBe(false);
  });

  it("treats exact-boundary expiry (expiresAt === now) as no longer active", () => {
    expect(isBreakglassGrantActive({ expiresAt: NOW, revokedAt: null }, NOW)).toBe(false);
  });
});

describe("classifyInactiveBreakglassGrant (Phase 20, FR-ADM-09 — platform audit denial detail)", () => {
  it("classifies a missing grant as no_grant", () => {
    expect(classifyInactiveBreakglassGrant(null, NOW)).toBe("no_grant");
  });

  it("classifies a revoked grant as revoked, even if also past its expiry", () => {
    expect(classifyInactiveBreakglassGrant({ expiresAt: new Date(NOW.getTime() - 1), revokedAt: NOW }, NOW)).toBe("revoked");
  });

  it("classifies a past-expiry, never-revoked grant as expired", () => {
    expect(classifyInactiveBreakglassGrant({ expiresAt: new Date(NOW.getTime() - 1), revokedAt: null }, NOW)).toBe("expired");
  });
});
