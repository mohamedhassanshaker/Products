import { describe, expect, it } from "vitest";
import { decideIdleResolution } from "./idle-sweep-decision.js";

describe("decideIdleResolution (LLD §3.7 idle-sweep rule)", () => {
  it("marks Abandoned + resolutionType Abandoned when the customer never sent a message", () => {
    expect(decideIdleResolution(0)).toEqual({ status: "Abandoned", resolutionType: "Abandoned" });
  });

  it("marks Resolved + resolutionType AI when the customer sent at least one message", () => {
    expect(decideIdleResolution(1)).toEqual({ status: "Resolved", resolutionType: "AI" });
    expect(decideIdleResolution(42)).toEqual({ status: "Resolved", resolutionType: "AI" });
  });
});
