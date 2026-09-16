import { describe, expect, it } from "vitest";
import { AddGraphNode } from "./add-graph-node.js";
import {
  FakeGraphRepository,
  FakeKnowledgeAiClient,
  graphNodeRecordRowFixture,
} from "../testing/fakes.js";

const NOW = new Date("2026-09-09T09:00:00.000Z");

describe("adding a graph node manually (FR-KNOW-10)", () => {
  it("writes the authoritative SQL record as Authored before applying it to the graph", async () => {
    const graph = new FakeGraphRepository();
    const parent = graphNodeRecordRowFixture({
      id: "parent_1",
      label: "Provider",
      canonicalKey: "sewa",
    });
    graph.seedNode(parent);
    const ai = new FakeKnowledgeAiClient();

    const result = await new AddGraphNode({ graph, ai }).execute({
      label: "Fee",
      canonicalKey: "sewa-connection-fee",
      canonicalName: "SEWA connection fee",
      parent: { label: "Provider", canonicalKey: "sewa" },
      relationshipType: "HAS_FEE",
      actorStaffUserId: "usr_admin",
      now: NOW,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const node = await graph.getNode(result.nodeId);
    expect(node?.origin).toBe("Authored");
  });

  it("refuses when the named parent does not exist", async () => {
    const graph = new FakeGraphRepository();
    const ai = new FakeKnowledgeAiClient();
    const result = await new AddGraphNode({ graph, ai }).execute({
      label: "Fee",
      canonicalKey: "x",
      canonicalName: "X",
      parent: { label: "Provider", canonicalKey: "does-not-exist" },
      relationshipType: "HAS_FEE",
      actorStaffUserId: "usr_admin",
      now: NOW,
    });
    expect(result).toEqual({ ok: false, reason: "knowledge.parent_node_not_found" });
  });
});
