import { describe, expect, it } from "vitest";
import { validateFlowEdgeFields } from "./flow-edge.js";

describe("validateFlowEdgeFields — CK_FlowEdges_noSelfLoop", () => {
  it("rejects an edge whose fromNodeId equals its toNodeId", () => {
    const errors = validateFlowEdgeFields({
      fromNodeId: "flownode_1",
      toNodeId: "flownode_1",
      label: null,
      ordinal: 0,
      conditionExpression: null,
      isDefaultBranch: true,
    });
    expect(errors).toEqual(["A connection cannot point a node back at itself."]);
  });

  it("accepts an edge between two different nodes", () => {
    const errors = validateFlowEdgeFields({
      fromNodeId: "flownode_1",
      toNodeId: "flownode_2",
      label: "Yes",
      ordinal: 0,
      conditionExpression: null,
      isDefaultBranch: false,
    });
    expect(errors).toHaveLength(0);
  });
});
