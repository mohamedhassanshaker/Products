import { describe, expect, it } from "vitest";
import { detectAndMask, detectPii, maskJsonValue, type PiiMaskAction, type PolicyLookup } from "./masker.js";

/** A policy table exercising every FR-SEC-04 mask action across contexts and
 * connector trust levels, keyed loosely enough to drive the full matrix in tests
 * without hand-authoring one table per test. */
function makePolicy(table: Record<string, PiiMaskAction>): PolicyLookup {
  return (entityType, context, trustLevel) => table[`${entityType}:${context}:${trustLevel}`];
}

describe("detectPii", () => {
  it("detects an email address", () => {
    const found = detectPii("contact me at jane.doe@example.com please");
    expect(found.some((e) => e.entityType === "Email" && e.value === "jane.doe@example.com")).toBe(true);
  });

  it("detects a phone number", () => {
    const found = detectPii("call +971 50 123 4567 now");
    expect(found.some((e) => e.entityType === "Phone")).toBe(true);
  });

  it("detects an IBAN", () => {
    const found = detectPii("transfer to AE070331234567890123456");
    expect(found.some((e) => e.entityType === "IBAN")).toBe(true);
  });

  it("detects a date of birth", () => {
    const found = detectPii("DOB: 1990-05-14");
    expect(found.some((e) => e.entityType === "DateOfBirth" && e.value === "1990-05-14")).toBe(true);
  });

  it("detects a national id", () => {
    const found = detectPii("Emirates ID 784-1990-1234567-1");
    expect(found.some((e) => e.entityType === "NationalId")).toBe(true);
  });

  it("detects a passport number", () => {
    const found = detectPii("passport A12345678");
    expect(found.some((e) => e.entityType === "Passport")).toBe(true);
  });

  it("applies an enabled tenant-authored custom regex rule", () => {
    const found = detectPii("employee ref EMP-00042", [{ entityType: "Custom", label: "EmployeeRef", pattern: "EMP-\\d{5}" }]);
    expect(found.some((e) => e.entityType === "Custom" && e.value === "EMP-00042")).toBe(true);
  });

  it("never throws on an invalid custom regex — skips it instead", () => {
    expect(() => detectPii("text", [{ entityType: "Custom", label: "Bad", pattern: "(unclosed" }])).not.toThrow();
  });

  it("finds nothing in PII-free text", () => {
    expect(detectPii("just a normal customer message about shipping")).toHaveLength(0);
  });
});

describe("mask action matrix (FR-SEC-04's four intensities)", () => {
  const policy = makePolicy({
    "Email:Transcript:Trusted": "Show",
    "Email:Transcript:SemiTrusted": "PartialMask",
    "Email:Transcript:Untrusted": "FullMask",
    "Email:Export:Untrusted": "Redact",
  });

  it("Show leaves the value untouched", () => {
    expect(detectAndMask("jane@example.com", "Transcript", "Trusted", policy)).toBe("jane@example.com");
  });

  it("PartialMask keeps only the last 4 characters", () => {
    const masked = detectAndMask("jane@example.com", "Transcript", "SemiTrusted", policy);
    expect(masked.endsWith(".com")).toBe(true);
    expect(masked).not.toContain("jane@example");
  });

  it("FullMask replaces every character", () => {
    const masked = detectAndMask("jane@example.com", "Transcript", "Untrusted", policy);
    expect(masked).toBe("*".repeat("jane@example.com".length));
  });

  it("Redact replaces the value with a fixed token", () => {
    const masked = detectAndMask("jane@example.com", "Export", "Untrusted", policy);
    expect(masked).toBe("[REDACTED]");
  });

  it("fails closed to FullMask for an unconfigured (entityType, context, trustLevel) combination", () => {
    const masked = detectAndMask("jane@example.com", "A2APayload", "Untrusted", policy);
    expect(masked).toBe("*".repeat("jane@example.com".length));
  });

  it("resolves overlapping/adjacent matches without index corruption (right-to-left application)", () => {
    const policyAll = makePolicy({ "Email:Transcript:Untrusted": "Redact", "Phone:Transcript:Untrusted": "Redact" });
    const masked = detectAndMask("email a@b.com or call +971501234567", "Transcript", "Untrusted", policyAll);
    expect(masked).toContain("[REDACTED]");
    expect(masked).not.toContain("a@b.com");
  });
});

describe("maskJsonValue", () => {
  it("recursively masks strings nested in objects and arrays", () => {
    const policy = makePolicy({ "Email:ToolCallPayload:Untrusted": "Redact" });
    const input = { customer: { email: "a@b.com" }, notes: ["contact a@b.com again"] };
    const masked = maskJsonValue(input, "ToolCallPayload", "Untrusted", policy) as typeof input;
    expect(masked.customer.email).toBe("[REDACTED]");
    expect(masked.notes[0]).not.toContain("a@b.com");
  });

  it("leaves non-string values untouched", () => {
    const policy = makePolicy({});
    const input = { count: 5, active: true, nothing: null };
    expect(maskJsonValue(input, "Export", "Trusted", policy)).toEqual(input);
  });
});
