import { describe, expect, it } from "vitest";
import {
  gateActiveBlockedMessage,
  gateActiveNoBlockMessage,
  gateInactiveMessage,
} from "./gate-status-message.js";

describe("gate status messages", () => {
  it("FR-EVAL-10: the gate-off sentence matches the requirement's exact wording", () => {
    expect(gateInactiveMessage()).toBe("Any agent can be published regardless of test results.");
  });

  it("B13 tab 3 worked example: names the agent, version, and the missed threshold", () => {
    const text = gateActiveBlockedMessage({
      agentName: "General FAQ Agent",
      versionLabel: "v3.0",
      reasons: [
        {
          metric: "accuracy",
          goldenSetId: "gs_arabic",
          goldenSetName: "Arabic language parity",
          observed: 0.71,
          threshold: 0.85,
        },
      ],
    });
    expect(text).toBe(
      "Gate is active. General FAQ Agent v3.0 is currently blocked — Arabic language parity at 71% is below the 85% floor.",
    );
  });

  it("renders a sensible sentence with nothing currently blocked", () => {
    expect(gateActiveNoBlockMessage()).toContain("Gate is active");
  });
});
