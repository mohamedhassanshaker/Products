import { describe, expect, it } from "vitest";
import { TenantContextRequiredError, TenantIsolationViolationError } from "./errors.js";

describe("db errors", () => {
  it("TenantContextRequiredError carries the reason in its message", () => {
    const err = new TenantContextRequiredError("no context supplied");
    expect(err.name).toBe("TenantContextRequiredError");
    expect(err.message).toContain("no context supplied");
  });

  it("TenantIsolationViolationError wraps the underlying cause", () => {
    const cause = new Error("current_setting: unrecognized configuration parameter");
    const err = new TenantIsolationViolationError(cause);
    expect(err.name).toBe("TenantIsolationViolationError");
    expect(err.cause).toBe(cause);
    expect(err.message).toContain("GUC unset or invalid");
  });
});
