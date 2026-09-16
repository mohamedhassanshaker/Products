import { describe, expect, it } from "vitest";
import { FakePolicyOverrideRepository, guardrailPolicyFixture } from "../testing/fakes.js";
import { GetGuardrailSettings } from "./get-guardrail-settings.js";

const NOW = new Date("2026-09-09T09:00:00.000Z");

describe("reading guardrail settings for an agent", () => {
  it("reports 'Default' when no override exists", async () => {
    const policies = new FakePolicyOverrideRepository();
    policies.seedPolicy(
      guardrailPolicyFixture({
        policyKey: "mask_pii_in_transcripts",
        title: "Mask PII in transcripts",
        isLocked: true,
      }),
    );
    const getSettings = new GetGuardrailSettings({ policies });

    const { settings } = await getSettings.execute({ agentId: "agent-1" });
    expect(settings).toEqual([
      {
        policyKey: "mask_pii_in_transcripts",
        title: "Mask PII in transcripts",
        isLocked: true,
        currentMode: "Default",
        valueJson: null,
      },
    ]);
  });

  it("reports the override's mode and value when one exists", async () => {
    const policies = new FakePolicyOverrideRepository();
    policies.seedPolicy(
      guardrailPolicyFixture({
        policyKey: "grounding_threshold",
        title: "Refuse below grounding threshold",
      }),
    );
    await policies.setOverride({
      agentId: "agent-1",
      policyKey: "grounding_threshold",
      mode: "Value",
      valueJson: "0.8",
      reason: "Higher accuracy bar for billing.",
      actorStaffUserId: "usr_01JBADMIN",
      now: NOW,
    });
    const getSettings = new GetGuardrailSettings({ policies });

    const { settings } = await getSettings.execute({ agentId: "agent-1" });
    expect(settings).toEqual([
      {
        policyKey: "grounding_threshold",
        title: "Refuse below grounding threshold",
        isLocked: false,
        currentMode: "Value",
        valueJson: "0.8",
      },
    ]);
  });

  it("omits a policy key with no live catalogue row, rather than crashing", async () => {
    const policies = new FakePolicyOverrideRepository();
    // allow_competitor_discussion not seeded — the platform hasn't caught up to this wave yet.
    const getSettings = new GetGuardrailSettings({ policies });

    const { settings } = await getSettings.execute({ agentId: "agent-1" });
    expect(settings).toEqual([]);
  });
});
