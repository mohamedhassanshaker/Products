import { describe, expect, it } from "vitest";
import * as tenancy from "./index.js";

/** Smoke test exercising the module's public barrel (LLD §2.2: the only file other packages may import from). */
describe("@nextbot/tenancy public API", () => {
  it("exports provisionTenant, plan-tier defaults, and retention validation", () => {
    expect(typeof tenancy.provisionTenant).toBe("function");
    expect(typeof tenancy.getPlanTierQuotaDefaults).toBe("function");
    expect(typeof tenancy.validateRetentionDays).toBe("function");
    expect(tenancy.INDEFINITE_RETENTION).toBe(-1);
    expect(tenancy.getPlanTierQuotaDefaults("Starter").maxMcpConnectors).toBe(3);
  });
});
