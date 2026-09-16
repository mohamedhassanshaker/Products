import { describe, expect, it } from "vitest";
import { BrowseGraph } from "./browse-graph.js";
import { FakeKnowledgeAiClient } from "../testing/fakes.js";

describe("browsing the entity graph", () => {
  it("passes the request through to the AI service and returns its result verbatim", async () => {
    const ai = new FakeKnowledgeAiClient();
    ai.setGraphBrowseResult({
      nodes: [{ key: "sewa", label: "Provider", name: "SEWA", properties: {} }],
      edges: [],
      truncated: false,
    });

    const result = await new BrowseGraph({ ai }).execute({
      rootKey: null,
      depth: 2,
      types: null,
      limit: 50,
    });
    expect(result.nodes).toHaveLength(1);
    expect(result.truncated).toBe(false);
  });
});
