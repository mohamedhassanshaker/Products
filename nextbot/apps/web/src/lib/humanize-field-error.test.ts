import { describe, expect, it } from "vitest";
import { humanizeFieldError } from "./humanize-field-error.js";

describe("humanizeFieldError (QA Defect U10)", () => {
  it("passes through undefined unchanged (no error)", () => {
    expect(humanizeFieldError("name", undefined)).toBeUndefined();
  });

  it("maps a known raw TypeBox message to human copy", () => {
    expect(humanizeFieldError("name", "Expected string length greater or equal to 1")).toBe("Name is required.");
    expect(humanizeFieldError("backendType", "Expected union value")).toBe("Choose a backend type.");
    expect(humanizeFieldError("endpointUrl", "Expected string to match '^https://'")).toBe("Enter a valid https:// URL.");
    expect(humanizeFieldError("authMethod", "Expected union value")).toBe("Choose an authentication method.");
    expect(humanizeFieldError("credentialPlaintext", "Expected string length greater or equal to 1")).toBe(
      "Enter the credential value.",
    );
  });

  it("falls back to the raw message for an unmapped field", () => {
    expect(humanizeFieldError("someUnmappedField", "Expected something weird")).toBe("Expected something weird");
  });

  it("falls back to the raw message for a mapped field with an unmatched pattern", () => {
    expect(humanizeFieldError("name", "Some other validator failure")).toBe("Some other validator failure");
  });

  it("maps Phase 9 DesignModeForm field messages to human copy", () => {
    expect(humanizeFieldError("graphType", "Expected union value")).toBe("Choose a graph type.");
    expect(humanizeFieldError("modelRoute", "Expected string length greater or equal to 1")).toBe("Model route is required.");
    expect(humanizeFieldError("instructions", "Expected string length greater or equal to 1")).toBe("System instructions are required.");
    expect(humanizeFieldError("toolPolicyMaxToolCallsPerTurn", "Expected integer to be greater or equal to 1")).toBe(
      "Enter a whole number of at least 1.",
    );
    expect(humanizeFieldError("guardrailsMinConfidenceForAutonomy", "Expected number to be greater or equal to 0")).toBe(
      "Enter a value between 0 and 1.",
    );
    expect(humanizeFieldError("memoryStrategy", "Expected union value")).toBe("Choose a memory strategy.");
    expect(humanizeFieldError("memoryMaxTurns", "Expected integer to be greater or equal to 1")).toBe("Enter a whole number of at least 1.");
    expect(humanizeFieldError("budgetsMaxCostUsdPerConversation", "Expected string length greater or equal to 1")).toBe(
      "Enter a maximum cost.",
    );
    expect(humanizeFieldError("budgetsMaxLatencyMsP95", "Expected integer to be greater or equal to 0")).toBe("Enter a latency of 0 or more.");
  });
});
