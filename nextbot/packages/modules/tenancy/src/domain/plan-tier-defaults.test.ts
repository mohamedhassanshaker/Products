import { describe, expect, it } from "vitest";
import { getPlanTierQuotaDefaults } from "./plan-tier-defaults.js";

describe("getPlanTierQuotaDefaults (NFR-4a seeding table)", () => {
  it("seeds Starter defaults", () => {
    const d = getPlanTierQuotaDefaults("Starter");
    expect(d).toEqual({
      maxToolCallsPerSecond: 1,
      maxConcurrentConversations: 50,
      maxMcpConnectors: 3,
      isDedicatedDatabase: false,
    });
  });

  it("seeds Growth defaults", () => {
    const d = getPlanTierQuotaDefaults("Growth");
    expect(d).toEqual({
      maxToolCallsPerSecond: 5,
      maxConcurrentConversations: 500,
      maxMcpConnectors: 15,
      isDedicatedDatabase: false,
    });
  });

  it("seeds Enterprise defaults and routes to the dedicated-database escape hatch", () => {
    const d = getPlanTierQuotaDefaults("Enterprise");
    expect(d.isDedicatedDatabase).toBe(true);
    expect(d.maxMcpConnectors).toBeNull();
    expect(d.maxToolCallsPerSecond).toBe(16);
    expect(d.maxConcurrentConversations).toBe(5000);
  });
});
