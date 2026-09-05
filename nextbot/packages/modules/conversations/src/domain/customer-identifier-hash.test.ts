import { describe, expect, it } from "vitest";
import { computeCustomerIdentifierHash } from "./customer-identifier-hash.js";

describe("computeCustomerIdentifierHash (Phase 19, BL-50, FR-OC-08)", () => {
  it("is deterministic for the exact same identifier", () => {
    expect(computeCustomerIdentifierHash("+971501234567")).toBe(computeCustomerIdentifierHash("+971501234567"));
  });

  it("normalizes incidental formatting (case/whitespace) to the SAME hash", () => {
    expect(computeCustomerIdentifierHash("  Customer@Example.com ")).toBe(computeCustomerIdentifierHash("customer@example.com"));
  });

  it("NEVER produces the same hash for two genuinely different identifiers — no fuzzy matching", () => {
    // A single differing digit — the kind of "close" mismatch a fuzzy/similarity
    // matcher might conflate. FR-OC-08's hard requirement is that this codebase has
    // no such matcher anywhere: this must hash completely differently.
    expect(computeCustomerIdentifierHash("+971501234567")).not.toBe(computeCustomerIdentifierHash("+971501234568"));
    expect(computeCustomerIdentifierHash("alice@example.com")).not.toBe(computeCustomerIdentifierHash("alicee@example.com"));
    expect(computeCustomerIdentifierHash("+971501234567")).not.toBe(computeCustomerIdentifierHash("971501234567"));
  });

  it("never returns the raw identifier itself (always a hex digest)", () => {
    const hash = computeCustomerIdentifierHash("+971501234567");
    expect(hash).not.toContain("971501234567");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
