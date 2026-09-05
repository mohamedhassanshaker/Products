import { describe, expect, it } from "vitest";
import { chooseTrafficAllocation, trafficBucketFor, TRAFFIC_BUCKET_SPACE, type TrafficAllocationCandidate } from "./traffic-bucket.js";

/**
 * Target Architecture Blueprint Phase 17 (BL-48, ADR-0019 §2.3, LLD §15.9 item 3) — the
 * weighting rule itself, proven without a database.
 *
 * ADR-0019 §6 item 3's verification ("over >=10 000 distinct conversation ids, a 90/10
 * split lands within a tight band of 90/10; the same conversation id always resolves to
 * the same version for a fixed active set") is a property of these two pure functions, so
 * it is proven here at 10 000 real ids rather than being approximated in an integration
 * test that would spend 10 000 round trips to say the same thing.
 */

const NINETY_TEN: TrafficAllocationCandidate[] = [
  { deploymentId: "aaaa", agentDefinitionVersionId: "v-stable", trafficSplitPct: 90 },
  { deploymentId: "bbbb", agentDefinitionVersionId: "v-canary", trafficSplitPct: 10 },
];

describe("trafficBucketFor (ADR-0019 §2.3 step 4)", () => {
  it("is deterministic — the same (conversation, agent definition) always yields the same bucket", () => {
    const first = trafficBucketFor("conv-1", "agent-1");
    for (let i = 0; i < 50; i += 1) {
      expect(trafficBucketFor("conv-1", "agent-1")).toBe(first);
    }
  });

  it("always lands inside [0, 10000)", () => {
    for (let i = 0; i < 2000; i += 1) {
      const bucket = trafficBucketFor(`conv-${i}`, "agent-1");
      expect(Number.isInteger(bucket)).toBe(true);
      expect(bucket).toBeGreaterThanOrEqual(0);
      expect(bucket).toBeLessThan(TRAFFIC_BUCKET_SPACE);
    }
  });

  it("mixes in the agent definition — the same conversation talking to two bots does not inherit one bot's bucket", () => {
    // Not merely "usually different": across many conversations the two id spaces must be
    // genuinely independent, otherwise a tenant running two agents would see their canary
    // populations perfectly correlated.
    let differing = 0;
    for (let i = 0; i < 500; i += 1) {
      if (trafficBucketFor(`conv-${i}`, "agent-a") !== trafficBucketFor(`conv-${i}`, "agent-b")) differing += 1;
    }
    expect(differing).toBeGreaterThan(490);
  });
});

describe("chooseTrafficAllocation (ADR-0019 §6 item 3)", () => {
  it("distributes 10 000 distinct conversation ids within a tight band of 90/10", () => {
    const counts: Record<string, number> = { "v-stable": 0, "v-canary": 0 };
    for (let i = 0; i < 10_000; i += 1) {
      const chosen = chooseTrafficAllocation(NINETY_TEN, trafficBucketFor(`conversation-${i}`, "agent-1"));
      counts[chosen!.agentDefinitionVersionId] = (counts[chosen!.agentDefinitionVersionId] ?? 0) + 1;
    }
    // A sha256-derived bucket over 10k samples of a 10% arm has a standard deviation of
    // ~30, so +/- 1.5 percentage points is roughly 5 sigma — tight enough to catch a real
    // weighting bug (an off-by-one in the cumulative walk moves it by whole percent) and
    // loose enough never to flake.
    expect(counts["v-canary"]! / 100).toBeGreaterThan(8.5);
    expect(counts["v-canary"]! / 100).toBeLessThan(11.5);
    expect(counts["v-stable"]! + counts["v-canary"]!).toBe(10_000);
  });

  it("sends bucket 0 to the first allocation and the last bucket to the last allocation (boundary walk)", () => {
    expect(chooseTrafficAllocation(NINETY_TEN, 0)!.agentDefinitionVersionId).toBe("v-stable");
    expect(chooseTrafficAllocation(NINETY_TEN, 8_999)!.agentDefinitionVersionId).toBe("v-stable");
    // 90% * 100 = 9000 basis points, so 9000 is the first bucket belonging to the canary.
    expect(chooseTrafficAllocation(NINETY_TEN, 9_000)!.agentDefinitionVersionId).toBe("v-canary");
    expect(chooseTrafficAllocation(NINETY_TEN, 9_999)!.agentDefinitionVersionId).toBe("v-canary");
  });

  it("honours the caller's ordering — the same bucket resolves differently if the rows are reordered", () => {
    // This is why LLD §15.3 mandates `ORDER BY deployment.id`: without a fixed order the
    // same conversation could resolve differently on two replicas reading the same rows.
    const reversed = [...NINETY_TEN].reverse();
    expect(chooseTrafficAllocation(NINETY_TEN, 500)!.agentDefinitionVersionId).toBe("v-stable");
    expect(chooseTrafficAllocation(reversed, 500)!.agentDefinitionVersionId).toBe("v-canary");
  });

  it("returns null for an empty active set — today's honest 'no agent run to trace yet' behavior", () => {
    expect(chooseTrafficAllocation([], 1234)).toBeNull();
  });

  it("falls back to the last row rather than dropping a turn if the active rows sum to under 100", () => {
    // Migration 0016's trigger rejects > 100 but permits < 100, and `setTrafficSplit`'s
    // domain validation rejects it — but a live turn must still be served if some other
    // path ever produced such a set.
    const under = [{ deploymentId: "a", agentDefinitionVersionId: "v1", trafficSplitPct: 50 }];
    expect(chooseTrafficAllocation(under, 9_999)!.agentDefinitionVersionId).toBe("v1");
  });

  it("is exhaustive for a 100% single allocation — every bucket resolves to it", () => {
    const single = [{ deploymentId: "a", agentDefinitionVersionId: "v1", trafficSplitPct: 100 }];
    for (const bucket of [0, 1, 4_999, 9_999]) {
      expect(chooseTrafficAllocation(single, bucket)!.agentDefinitionVersionId).toBe("v1");
    }
  });
});
