import { describe, expect, it } from "vitest";
import { FakePolicyOverrideRepository, guardrailPolicyFixture } from "../testing/fakes.js";
import { SetGuardrailOverride } from "./set-guardrail-override.js";

const NOW = new Date("2026-09-09T09:00:00.000Z");

describe("setting a guardrail override", () => {
  it("rejects mask_pii_in_transcripts because it is locked", async () => {
    const policies = new FakePolicyOverrideRepository();
    policies.seedPolicy(
      guardrailPolicyFixture({ policyKey: "mask_pii_in_transcripts", isLocked: true }),
    );
    const setOverride = new SetGuardrailOverride({ policies });

    const result = await setOverride.execute({
      agentId: "agent-1",
      policyKey: "mask_pii_in_transcripts",
      mode: "Disabled",
      valueJson: null,
      reason: "Testing the lock.",
      actorStaffUserId: "usr_01JBADMIN",
      now: NOW,
    });

    expect(result).toEqual({ ok: false, reason: "governance.policy_locked" });
    expect(policies.setOverrideCalls).toHaveLength(0);
  });

  it("rejects a policy key with no live catalogue row at all", async () => {
    const policies = new FakePolicyOverrideRepository();
    const setOverride = new SetGuardrailOverride({ policies });

    const result = await setOverride.execute({
      agentId: "agent-1",
      policyKey: "unknown_policy",
      mode: "Value",
      valueJson: "1",
      reason: "Testing.",
      actorStaffUserId: "usr_01JBADMIN",
      now: NOW,
    });

    expect(result).toEqual({ ok: false, reason: "governance.policy_locked" });
  });

  it("sets the override when the policy is overridable", async () => {
    const policies = new FakePolicyOverrideRepository();
    policies.seedPolicy(
      guardrailPolicyFixture({ policyKey: "grounding_threshold", isLocked: false }),
    );
    const setOverride = new SetGuardrailOverride({ policies });

    const result = await setOverride.execute({
      agentId: "agent-1",
      policyKey: "grounding_threshold",
      mode: "Value",
      valueJson: "0.8",
      reason: "Higher accuracy bar for billing.",
      actorStaffUserId: "usr_01JBADMIN",
      now: NOW,
    });

    expect(result).toEqual({ ok: true });
    const overrides = await policies.listOverridesForAgent("agent-1");
    expect(overrides).toEqual([
      {
        id: "override-1",
        policyKey: "grounding_threshold",
        mode: "Value",
        valueJson: "0.8",
        reason: "Higher accuracy bar for billing.",
      },
    ]);
  });
});
