import { describe, expect, it } from "vitest";
import { checkTrafficSplitAllocations } from "./traffic-split-policy.js";

/**
 * Target Architecture Blueprint Phase 17 (BL-48/BL-13, LLD §15.4 step 2, §15.9 item 1) —
 * the pure allocation-shape rules. The database-level backstop (migration `0016`'s
 * `enforce_deployment_traffic_split_invariant()`) is proven separately, against a real
 * Postgres, in `deployment-traffic-split.int.test.ts`; this suite is the friendly-error
 * half of that pair.
 */
describe("checkTrafficSplitAllocations", () => {
  it("accepts a 90/10 canary", () => {
    expect(checkTrafficSplitAllocations([{ agentDefinitionVersionId: "a", trafficSplitPct: 90 }, { agentDefinitionVersionId: "b", trafficSplitPct: 10 }])).toEqual({
      valid: true,
    });
  });

  it("accepts a single 100% allocation (the shape `promoteCanary` produces)", () => {
    expect(checkTrafficSplitAllocations([{ agentDefinitionVersionId: "a", trafficSplitPct: 100 }])).toEqual({ valid: true });
  });

  it("rejects a 90/20 split with TRAFFIC_SPLIT_MUST_SUM_TO_100 and names the actual total", () => {
    const result = checkTrafficSplitAllocations([
      { agentDefinitionVersionId: "a", trafficSplitPct: 90 },
      { agentDefinitionVersionId: "b", trafficSplitPct: 20 },
    ]);
    expect(result.valid).toBe(false);
    expect(result).toMatchObject({ code: "TRAFFIC_SPLIT_MUST_SUM_TO_100" });
    expect((result as { detail: string }).detail).toContain("110%");
  });

  it("rejects an under-100 split too — a shortfall would leave buckets with no arm to serve them", () => {
    expect(checkTrafficSplitAllocations([{ agentDefinitionVersionId: "a", trafficSplitPct: 90 }])).toMatchObject({
      valid: false,
      code: "TRAFFIC_SPLIT_MUST_SUM_TO_100",
    });
  });

  it("rejects an empty allocation set — an agent serving nothing is not a valid split", () => {
    expect(checkTrafficSplitAllocations([])).toMatchObject({ valid: false, code: "TRAFFIC_SPLIT_ALLOCATION_INVALID" });
  });

  it("rejects a 0% allocation — that is an absent row, not a canary", () => {
    expect(
      checkTrafficSplitAllocations([
        { agentDefinitionVersionId: "a", trafficSplitPct: 100 },
        { agentDefinitionVersionId: "b", trafficSplitPct: 0 },
      ]),
    ).toMatchObject({ valid: false, code: "TRAFFIC_SPLIT_ALLOCATION_INVALID" });
  });

  it("rejects a non-integer or out-of-range percentage", () => {
    expect(checkTrafficSplitAllocations([{ agentDefinitionVersionId: "a", trafficSplitPct: 33.5 }])).toMatchObject({ valid: false });
    expect(checkTrafficSplitAllocations([{ agentDefinitionVersionId: "a", trafficSplitPct: 101 }])).toMatchObject({ valid: false });
    expect(checkTrafficSplitAllocations([{ agentDefinitionVersionId: "a", trafficSplitPct: -10 }])).toMatchObject({ valid: false });
  });

  it("rejects the same version allocated twice, even when the total is exactly 100", () => {
    expect(
      checkTrafficSplitAllocations([
        { agentDefinitionVersionId: "a", trafficSplitPct: 50 },
        { agentDefinitionVersionId: "a", trafficSplitPct: 50 },
      ]),
    ).toMatchObject({ valid: false, code: "TRAFFIC_SPLIT_ALLOCATION_INVALID" });
  });
});
