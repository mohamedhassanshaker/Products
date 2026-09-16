import { describe, expect, it } from "vitest";
import {
  canTransitionTransaction,
  requiresFailureCode,
  requiresSettledAt,
} from "./transaction-status.js";

/** FR-PAY-04: "transitions restricted to a documented state machine." */
describe("canTransitionTransaction", () => {
  it("allows the real, documented hops", () => {
    expect(canTransitionTransaction("Initiated", "Settled")).toBe(true);
    expect(canTransitionTransaction("Settled", "RefundRequested")).toBe(true);
    expect(canTransitionTransaction("RefundRequested", "Refunded")).toBe(true);
    expect(canTransitionTransaction("RefundRequested", "Settled")).toBe(true); // decline
  });

  it("rejects FR-PAY-04's own worked counter-example", () => {
    expect(canTransitionTransaction("Failed", "Refunded")).toBe(false);
  });

  it("rejects a hop from a terminal state", () => {
    expect(canTransitionTransaction("Refunded", "Settled")).toBe(false);
    expect(canTransitionTransaction("Declined", "Settled")).toBe(false);
  });
});

describe("requiresSettledAt / requiresFailureCode", () => {
  it("matches CK_Transactions_settledPaired's real vocabulary", () => {
    expect(requiresSettledAt("Settled")).toBe(true);
    expect(requiresSettledAt("RefundRequested")).toBe(true);
    expect(requiresSettledAt("Refunded")).toBe(true);
    expect(requiresSettledAt("Initiated")).toBe(false);
  });

  it("matches CK_Transactions_failurePaired's real vocabulary", () => {
    expect(requiresFailureCode("Failed")).toBe(true);
    expect(requiresFailureCode("Declined")).toBe(true);
    expect(requiresFailureCode("Settled")).toBe(false);
  });
});
