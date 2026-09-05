import { describe, expect, it } from "vitest";
import { checkEmergencyRollbackEligibility } from "./emergency-rollback-policy.js";

describe("checkEmergencyRollbackEligibility (ADR-0017 §2.1/§6)", () => {
  it("rejects a target belonging to a different agent definition", () => {
    const result = checkEmergencyRollbackEligibility({
      sameAgentDefinition: false,
      wasEverProductionWithPassingGate: true,
      trimmedReason: "incident-123",
    });
    expect(result).toEqual({ allowed: false, code: "EMERGENCY_ROLLBACK_NOT_ELIGIBLE" });
  });

  it("rejects a version that was never previously Production (Draft/EvalGated/HumanReview/Approved-never-promoted)", () => {
    const result = checkEmergencyRollbackEligibility({
      sameAgentDefinition: true,
      wasEverProductionWithPassingGate: false,
      trimmedReason: "incident-123",
    });
    expect(result).toEqual({ allowed: false, code: "EMERGENCY_ROLLBACK_NOT_ELIGIBLE" });
  });

  it("rejects a blank (or whitespace-only, once trimmed) reason with the exact FR-AGT-30 error code", () => {
    const result = checkEmergencyRollbackEligibility({
      sameAgentDefinition: true,
      wasEverProductionWithPassingGate: true,
      trimmedReason: "",
    });
    expect(result).toEqual({ allowed: false, code: "EMERGENCY_ROLLBACK_REASON_REQUIRED" });
  });

  it("allows a previously-Production, now-superseded version of the same definition with a real reason", () => {
    const result = checkEmergencyRollbackEligibility({
      sameAgentDefinition: true,
      wasEverProductionWithPassingGate: true,
      trimmedReason: "reverting v4's checkout regression",
    });
    expect(result).toEqual({ allowed: true });
  });

  it("checks eligibility before the reason, so an ineligible + reasonless call still reports NOT_ELIGIBLE", () => {
    const result = checkEmergencyRollbackEligibility({
      sameAgentDefinition: false,
      wasEverProductionWithPassingGate: false,
      trimmedReason: "",
    });
    expect(result).toEqual({ allowed: false, code: "EMERGENCY_ROLLBACK_NOT_ELIGIBLE" });
  });
});
