import { describe, expect, it } from "vitest";
import { detectCommunitiesLabelPropagation } from "./community-detect.js";

describe("detectCommunitiesLabelPropagation (ADR-0018 §2.5 — in-worker, deterministic)", () => {
  it("groups two densely-connected clusters into two separate communities", () => {
    // Cluster 1: a-b-c fully connected. Cluster 2: x-y-z fully connected. No edges
    // between the two clusters.
    const edges = [
      { srcId: "a", dstId: "b", weight: 1 },
      { srcId: "b", dstId: "c", weight: 1 },
      { srcId: "a", dstId: "c", weight: 1 },
      { srcId: "x", dstId: "y", weight: 1 },
      { srcId: "y", dstId: "z", weight: 1 },
      { srcId: "x", dstId: "z", weight: 1 },
    ];
    const communities = detectCommunitiesLabelPropagation(edges, ["a", "b", "c", "x", "y", "z"]);
    expect(communities).toHaveLength(2);
    const memberSets = communities.map((c) => new Set(c.nodeIds));
    const clusterOne = memberSets.find((s) => s.has("a"));
    const clusterTwo = memberSets.find((s) => s.has("x"));
    expect(clusterOne).toEqual(new Set(["a", "b", "c"]));
    expect(clusterTwo).toEqual(new Set(["x", "y", "z"]));
  });

  it("an isolated node with no edges ends up in its own singleton community", () => {
    const communities = detectCommunitiesLabelPropagation([], ["solo"]);
    expect(communities).toHaveLength(1);
    expect(communities[0]?.nodeIds).toEqual(["solo"]);
  });

  it("is deterministic — running twice on the same input produces the same externalKey per community", () => {
    const edges = [
      { srcId: "a", dstId: "b", weight: 2 },
      { srcId: "b", dstId: "c", weight: 1 },
    ];
    const first = detectCommunitiesLabelPropagation(edges, ["a", "b", "c"]);
    const second = detectCommunitiesLabelPropagation(edges, ["a", "b", "c"]);
    expect(first.map((c) => c.externalKey).sort()).toEqual(second.map((c) => c.externalKey).sort());
  });

  it("terminates within maxIterations for a larger connected graph (bounded, not an infinite loop)", () => {
    const nodeIds = Array.from({ length: 30 }, (_, i) => `n${i}`);
    const edges = nodeIds.slice(1).map((id, i) => ({ srcId: nodeIds[i]!, dstId: id, weight: 1 }));
    const communities = detectCommunitiesLabelPropagation(edges, nodeIds, 20);
    const totalMembers = communities.reduce((sum, c) => sum + c.nodeIds.length, 0);
    expect(totalMembers).toBe(30);
  });

  it("ignores an edge referencing an unknown node rather than crashing", () => {
    expect(() => detectCommunitiesLabelPropagation([{ srcId: "a", dstId: "ghost", weight: 1 }], ["a"])).not.toThrow();
  });
});
