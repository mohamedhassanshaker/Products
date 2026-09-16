import { describe, expect, it } from "vitest";
import { EvaluateStepUp } from "./evaluate-step-up.js";
import { FakeStepUpRuleRepository } from "../testing/fakes.js";

/**
 * B11 tab 2's gate — the same rule `apps/ai`'s `ExecuteFlowStep`/`ProcessTurn`
 * enforce for a tool call, exercised here on the TypeScript side that gates
 * `POST .../payments/intents` (api.md §4.2: "checked before the intent is
 * created").
 */
describe("EvaluateStepUp", () => {
  it("allows an action with no configured rule — fails open on a config gap, not on every payment", async () => {
    const useCase = new EvaluateStepUp({ rules: new FakeStepUpRuleRepository() });
    const result = await useCase.execute({ action: "InitiatePayment", heldAssurance: "L0" });
    expect(result.allowed).toBe(true);
  });

  it("blocks a session below the configured level, naming the required rank", async () => {
    const rules = new FakeStepUpRuleRepository();
    rules.seed({
      id: "rule_1",
      actionKey: "InitiatePayment",
      requiredAssurance: "VerifiedPlusOtp",
      isEnabled: true,
      ordinal: 1,
    });
    const useCase = new EvaluateStepUp({ rules });

    const result = await useCase.execute({ action: "InitiatePayment", heldAssurance: "L0" });

    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.required).toBe("L2");
      expect(result.action).toBe("InitiatePayment");
    }
  });

  it("allows a session at or above the configured level", async () => {
    const rules = new FakeStepUpRuleRepository();
    rules.seed({
      id: "rule_1",
      actionKey: "InitiatePayment",
      requiredAssurance: "VerifiedPlusOtp",
      isEnabled: true,
      ordinal: 1,
    });
    const useCase = new EvaluateStepUp({ rules });

    const result = await useCase.execute({ action: "InitiatePayment", heldAssurance: "L2" });
    expect(result.allowed).toBe(true);
  });

  it("a disabled rule gates nothing, matching B11 tab 2's own toggle", async () => {
    const rules = new FakeStepUpRuleRepository();
    rules.seed({
      id: "rule_1",
      actionKey: "ViewBillBalance",
      requiredAssurance: "VerifiedPlusOtp",
      isEnabled: false,
      ordinal: 1,
    });
    const useCase = new EvaluateStepUp({ rules });

    const result = await useCase.execute({ action: "ViewBillBalance", heldAssurance: "L0" });
    expect(result.allowed).toBe(true);
  });
});
