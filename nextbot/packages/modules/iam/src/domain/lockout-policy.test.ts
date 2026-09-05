import { describe, expect, it } from "vitest";
import {
  DEFAULT_LOCKOUT_POLICY,
  isLocked,
  lockoutRetryAfterSeconds,
  recordFailedAttempt,
  recordSuccessfulAttempt,
} from "./lockout-policy.js";

describe("lockout policy (FR-SEC-03, default 5 attempts / 15 min)", () => {
  it("is not locked with zero failed attempts and no lockedUntil", () => {
    expect(isLocked({ failedLoginCount: 0, lockedUntil: null })).toBe(false);
  });

  it("is locked while lockedUntil is in the future", () => {
    const future = new Date(Date.now() + 60_000);
    expect(isLocked({ failedLoginCount: 0, lockedUntil: future })).toBe(true);
  });

  it("is not locked once lockedUntil is in the past (cooldown elapsed)", () => {
    const past = new Date(Date.now() - 1000);
    expect(isLocked({ failedLoginCount: 0, lockedUntil: past })).toBe(false);
  });

  it("does not lock before reaching maxFailedAttempts", () => {
    let state = { failedLoginCount: 0, lockedUntil: null as Date | null };
    for (let i = 0; i < DEFAULT_LOCKOUT_POLICY.maxFailedAttempts - 1; i++) {
      state = recordFailedAttempt(state, DEFAULT_LOCKOUT_POLICY);
    }
    expect(state.lockedUntil).toBeNull();
    expect(state.failedLoginCount).toBe(DEFAULT_LOCKOUT_POLICY.maxFailedAttempts - 1);
  });

  it("locks for cooldownMinutes exactly at the Nth failed attempt and resets the counter", () => {
    let state = { failedLoginCount: 0, lockedUntil: null as Date | null };
    const before = Date.now();
    for (let i = 0; i < DEFAULT_LOCKOUT_POLICY.maxFailedAttempts; i++) {
      state = recordFailedAttempt(state, DEFAULT_LOCKOUT_POLICY, new Date(before));
    }
    expect(state.failedLoginCount).toBe(0);
    expect(state.lockedUntil).not.toBeNull();
    expect((state.lockedUntil as Date).getTime()).toBe(before + DEFAULT_LOCKOUT_POLICY.cooldownMinutes * 60_000);
  });

  it("lockoutRetryAfterSeconds returns 0 when not locked, and the remaining seconds when locked", () => {
    expect(lockoutRetryAfterSeconds({ failedLoginCount: 0, lockedUntil: null })).toBe(0);
    const now = new Date();
    const lockedUntil = new Date(now.getTime() + 90_000);
    expect(lockoutRetryAfterSeconds({ failedLoginCount: 0, lockedUntil }, now)).toBe(90);
  });

  it("recordSuccessfulAttempt clears both the counter and the lock", () => {
    expect(recordSuccessfulAttempt()).toEqual({ failedLoginCount: 0, lockedUntil: null });
  });

  it("honors a custom (tenant-configured) policy", () => {
    const customPolicy = { maxFailedAttempts: 2, cooldownMinutes: 1 };
    const now = new Date();
    const after1 = recordFailedAttempt({ failedLoginCount: 0, lockedUntil: null }, customPolicy, now);
    expect(after1.lockedUntil).toBeNull();
    const after2 = recordFailedAttempt(after1, customPolicy, now);
    expect(after2.lockedUntil).toEqual(new Date(now.getTime() + 60_000));
  });
});
