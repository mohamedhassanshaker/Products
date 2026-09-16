import { describe, expect, it } from "vitest";
import {
  breakerRef,
  isBreakerEventReason,
  isBreakerTransition,
  isCircuitBreakerTargetKind,
  isFallbackStrategy,
  manualResetTransition,
  manualTripTransition,
  requiresActor,
} from "./circuit-breaker.js";

describe("enums", () => {
  it("target kind", () => {
    expect(isCircuitBreakerTargetKind("McpServer")).toBe(true);
    expect(isCircuitBreakerTargetKind("Database")).toBe(false);
  });

  it("fallback strategy", () => {
    expect(isFallbackStrategy("ServeCachedAnswer")).toBe(true);
    expect(isFallbackStrategy("Retry")).toBe(false);
  });

  it("transition", () => {
    expect(isBreakerTransition("HalfOpen")).toBe(true);
    expect(isBreakerTransition("Tripped")).toBe(false);
  });

  it("event reason", () => {
    expect(isBreakerEventReason("CooldownElapsed")).toBe(true);
    expect(isBreakerEventReason("Timeout")).toBe(false);
  });
});

describe("requiresActor", () => {
  it("requires an actor for manual reasons only", () => {
    expect(requiresActor("ManualTrip")).toBe(true);
    expect(requiresActor("ManualReset")).toBe(true);
  });

  it("does not require an actor for automatic reasons", () => {
    expect(requiresActor("ThresholdBreached")).toBe(false);
    expect(requiresActor("CooldownElapsed")).toBe(false);
    expect(requiresActor("ProbeSucceeded")).toBe(false);
    expect(requiresActor("ProbeFailed")).toBe(false);
  });
});

describe("manual transitions", () => {
  it("reset always closes with reason ManualReset", () => {
    expect(manualResetTransition()).toEqual({ transition: "Closed", reason: "ManualReset" });
  });

  it("trip always opens with reason ManualTrip", () => {
    expect(manualTripTransition()).toEqual({ transition: "Open", reason: "ManualTrip" });
  });
});

describe("breakerRef", () => {
  it("prefers targetId when both are somehow present", () => {
    expect(breakerRef({ targetId: "AGENT01", targetKey: "ignored" })).toBe("AGENT01");
  });

  it("falls back to targetKey when targetId is null", () => {
    expect(breakerRef({ targetId: null, targetKey: "whatsapp_bsp" })).toBe("whatsapp_bsp");
  });

  it("throws when neither is set — CK_CircuitBreakerConfigs_targetPaired violated", () => {
    expect(() => breakerRef({ targetId: null, targetKey: null })).toThrow(/targetPaired/);
  });
});
