import { describe, expect, it } from "vitest";
import { DeleteGraphNode } from "./delete-graph-node.js";
import {
  FakeGraphRepository,
  FakeKnowledgeAiClient,
  graphNodeRecordRowFixture,
} from "../testing/fakes.js";

const NOW = new Date("2026-09-09T09:00:00.000Z");

describe("deleting a graph node", () => {
  it("soft-deletes the SQL record and calls the AI service to delete it from Neo4j", async () => {
    const graph = new FakeGraphRepository();
    const node = graphNodeRecordRowFixture();
    graph.seedNode(node);
    const ai = new FakeKnowledgeAiClient();

    const result = await new DeleteGraphNode({ graph, ai }).execute({ nodeId: node.id, now: NOW });
    expect(result).toEqual({ ok: true });
    expect(await graph.getNode(node.id)).toBeNull();
  });

  it("refuses for an unknown node", async () => {
    const graph = new FakeGraphRepository();
    const ai = new FakeKnowledgeAiClient();
    const result = await new DeleteGraphNode({ graph, ai }).execute({
      nodeId: "missing",
      now: NOW,
    });
    expect(result).toEqual({ ok: false, reason: "knowledge.node_not_found" });
  });
});
