import { describe, expect, it } from "vitest";
import {
  CHANNEL_KEYS,
  isAgentStatus,
  isAgentVersionStatus,
  isChannelKey,
  isTone,
  isWizardStepId,
  WIZARD_CHANNEL_KEYS,
  WIZARD_STEP_IDS,
  wizardStepNumber,
} from "./agent.js";

describe("isAgentStatus", () => {
  it("accepts the three real statuses and rejects anything else", () => {
    expect(isAgentStatus("Draft")).toBe(true);
    expect(isAgentStatus("Published")).toBe(true);
    expect(isAgentStatus("Archived")).toBe(true);
    expect(isAgentStatus("Suspended")).toBe(false);
  });
});

describe("isAgentVersionStatus", () => {
  it("mirrors the same three values", () => {
    expect(isAgentVersionStatus("Published")).toBe(true);
    expect(isAgentVersionStatus("Live")).toBe(false);
  });
});

describe("isTone", () => {
  it("accepts exactly the three CK_AgentVersions_tone values", () => {
    expect(isTone("Helpful")).toBe(true);
    expect(isTone("Formal")).toBe(true);
    expect(isTone("Concise")).toBe(true);
    expect(isTone("Casual")).toBe(false);
  });
});

describe("channel keys", () => {
  it("carries all four Channels.key values", () => {
    expect(CHANNEL_KEYS).toEqual(["WebWidget", "WhatsApp", "MobileApp", "KioskIvr"]);
  });

  it("isChannelKey validates against the full set", () => {
    expect(isChannelKey("MobileApp")).toBe(true);
    expect(isChannelKey("Sms")).toBe(false);
  });

  it("exposes only the three the wizard actually renders", () => {
    expect(WIZARD_CHANNEL_KEYS).toEqual(["WebWidget", "WhatsApp", "KioskIvr"]);
  });
});

describe("wizard steps", () => {
  it("has exactly 10 steps, matching AgentWizardDrafts.lastStep's CHECK range", () => {
    expect(WIZARD_STEP_IDS).toHaveLength(10);
  });

  it("wizardStepNumber is 1-based and matches declaration order", () => {
    expect(wizardStepNumber("identity")).toBe(1);
    expect(wizardStepNumber("tools")).toBe(4);
    expect(wizardStepNumber("publish")).toBe(10);
  });

  it("isWizardStepId rejects an unknown step", () => {
    expect(isWizardStepId("tools")).toBe(true);
    expect(isWizardStepId("billing")).toBe(false);
  });
});
