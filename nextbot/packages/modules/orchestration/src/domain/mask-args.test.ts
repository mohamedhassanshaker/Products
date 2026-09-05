import { describe, expect, it } from "vitest";
import { maskArgsForLogging } from "./mask-args.js";

describe("maskArgsForLogging (security review stub — no unmasked PII in failure logs)", () => {
  it("masks keys that look like credentials/secrets/PII identifiers", () => {
    const masked = maskArgsForLogging({ password: "hunter2", apiToken: "abc123", cardNumber: "4111111111111111", orderId: "123" });
    expect(masked.password).toBe("***MASKED***");
    expect(masked.apiToken).toBe("***MASKED***");
    expect(masked.cardNumber).toBe("***MASKED***");
    expect(masked.orderId).toBe("123");
  });

  it("truncates long string values rather than logging them verbatim", () => {
    const long = "x".repeat(500);
    const masked = maskArgsForLogging({ notes: long });
    expect((masked.notes as string).length).toBeLessThan(long.length);
    expect(masked.notes).toContain("truncated");
  });

  it("passes through short, non-sensitive values unchanged", () => {
    expect(maskArgsForLogging({ status: "open", count: 3 })).toEqual({ status: "open", count: 3 });
  });
});
