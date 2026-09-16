import { describe, expect, it } from "vitest";
import { filterEventForCitizen } from "./citizen-event-filter.js";

describe("filterEventForCitizen", () => {
  it("strips denylisted fields at the top level", () => {
    expect(
      filterEventForCitizen({
        stage: "pre",
        decision: "pass",
        policyId: "prompt_injection_filter",
      }),
    ).toEqual({
      stage: "pre",
      decision: "pass",
    });
  });

  it("strips denylisted fields nested inside arrays and objects", () => {
    const input = {
      trace: {
        hops: [
          { hop: 1, toolBindingId: "tb_1", agentId: "agt_billing" },
          { hop: 2, agentVersionId: "av_2" },
        ],
      },
      usage: { tokensIn: 10, costAed: 0.01 },
    };
    expect(filterEventForCitizen(input)).toEqual({
      trace: { hops: [{ hop: 1, agentId: "agt_billing" }, { hop: 2 }] },
      usage: { tokensIn: 10 },
    });
  });

  it("keeps masked tool arguments untouched", () => {
    const input = { args: { account_number: "••••4821" } };
    expect(filterEventForCitizen(input)).toEqual(input);
  });

  it("passes non-object payloads through unchanged", () => {
    expect(filterEventForCitizen("text")).toBe("text");
    expect(filterEventForCitizen(null)).toBe(null);
    expect(filterEventForCitizen(42)).toBe(42);
  });
});
