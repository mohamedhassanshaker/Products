import { describe, expect, it } from "vitest";
import { UpdateSecurityPolicy } from "./update-security-policy.js";
import { FakeSecurityPolicyRepository } from "../testing/fakes.js";
import { SECURITY_POLICY_DEFAULTS } from "../domain/security-policy.js";

const NOW = new Date("2026-09-13T09:00:00.000Z");

function validInput(overrides: Partial<Parameters<UpdateSecurityPolicy["execute"]>[0]> = {}) {
  return {
    ...SECURITY_POLICY_DEFAULTS,
    updatedByStaffUserId: "staff_1",
    now: NOW,
    ...overrides,
  };
}

describe("updating the Security tab's session/lockout policy", () => {
  it("saves valid values and round-trips them", async () => {
    const securityPolicy = new FakeSecurityPolicyRepository();
    const result = await new UpdateSecurityPolicy({ securityPolicy }).execute(
      validInput({ lockoutFailuresBeforeLock: 3 }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.policy.lockoutFailuresBeforeLock).toBe(3);

    const reloaded = await securityPolicy.ensureTenantConfig(NOW);
    expect(reloaded.lockoutFailuresBeforeLock).toBe(3);
  });

  it("refuses a session idle window outside 1-10080 minutes", async () => {
    const securityPolicy = new FakeSecurityPolicyRepository();
    const result = await new UpdateSecurityPolicy({ securityPolicy }).execute(
      validInput({ staffSessionIdleMinutes: 0 }),
    );
    expect(result).toEqual({ ok: false, reason: "security.value_out_of_range" });
  });

  it("refuses a lockout threshold outside 1-20", async () => {
    const securityPolicy = new FakeSecurityPolicyRepository();
    const result = await new UpdateSecurityPolicy({ securityPolicy }).execute(
      validInput({ lockoutFailuresBeforeLock: 21 }),
    );
    expect(result).toEqual({ ok: false, reason: "security.value_out_of_range" });
  });

  it("ensureTenantConfig seeds the documented defaults on first use", async () => {
    const securityPolicy = new FakeSecurityPolicyRepository();
    const config = await securityPolicy.ensureTenantConfig(NOW);
    expect(config.staffSessionIdleMinutes).toBe(SECURITY_POLICY_DEFAULTS.staffSessionIdleMinutes);
    expect(config.lockoutFailuresBeforeLock).toBe(
      SECURITY_POLICY_DEFAULTS.lockoutFailuresBeforeLock,
    );
  });
});
