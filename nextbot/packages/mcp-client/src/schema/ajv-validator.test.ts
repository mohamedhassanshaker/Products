import { describe, expect, it } from "vitest";
import { validateAgainstJsonSchema } from "./ajv-validator.js";

describe("validateAgainstJsonSchema (Ajv — scoped exclusively to packages/mcp-client, LLD §1.1)", () => {
  const schema = {
    type: "object",
    properties: { amount: { type: "number" }, currency: { type: "string" } },
    required: ["amount"],
  };

  it("passes valid data", () => {
    const result = validateAgainstJsonSchema(schema, { amount: 10, currency: "USD" });
    expect(result).toEqual({ valid: true, errors: [] });
  });

  it("fails and reports errors for missing required property", () => {
    const result = validateAgainstJsonSchema(schema, { currency: "USD" });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("fails and reports errors for a wrong-typed property", () => {
    const result = validateAgainstJsonSchema(schema, { amount: "not-a-number" });
    expect(result.valid).toBe(false);
  });

  it("does not throw on an uncompilable schema — returns a validation failure instead", () => {
    const result = validateAgainstJsonSchema({ type: "totally-not-a-type" } as unknown as object, {});
    expect(result.valid).toBe(false);
  });
});
