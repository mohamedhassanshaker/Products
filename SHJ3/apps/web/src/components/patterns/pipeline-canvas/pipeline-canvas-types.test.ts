import { describe, expect, it } from "vitest";
import {
  computePipelineOrder,
  describePipelineNode,
  findPipelineEntryIds,
  loopBackEdgesFrom,
  pipelineSiblingIdsOf,
  structuralConnections,
  type PipelineCanvasModel,
} from "./pipeline-canvas-types";

function model(overrides: Partial<PipelineCanvasModel> = {}): PipelineCanvasModel {
  return {
    nodes: [
      { id: "start", kind: "start", title: "Start", agentName: null },
      { id: "agent", kind: "agent", title: "Triage", agentName: "Billing agent" },
      { id: "response", kind: "response", title: "Response", agentName: null },
    ],
    edges: [
      { id: "e1", sourceId: "start", targetId: "agent", kind: "sequential" },
      { id: "e2", sourceId: "agent", targetId: "response", kind: "sequential" },
    ],
    ...overrides,
  };
}

describe("structuralConnections", () => {
  it("excludes loop-back edges from the forward subgraph", () => {
    const m = model({
      edges: [
        { id: "e1", sourceId: "start", targetId: "agent", kind: "sequential" },
        { id: "e2", sourceId: "agent", targetId: "start", kind: "loop-back", maxIterations: 3 },
      ],
    });
    expect(structuralConnections(m.edges).map((e) => e.id)).toEqual(["e1"]);
  });
});

describe("computePipelineOrder", () => {
  it("orders a linear pipeline breadth-first from its entry", () => {
    expect(computePipelineOrder(model())).toEqual(["start", "agent", "response"]);
  });

  it("does not get stuck on a real loop-back edge (the DAG-only algorithm's own failure case)", () => {
    const m = model({
      edges: [
        { id: "e1", sourceId: "start", targetId: "agent", kind: "sequential" },
        { id: "e2", sourceId: "agent", targetId: "response", kind: "sequential" },
        { id: "e3", sourceId: "response", targetId: "agent", kind: "loop-back", maxIterations: 3 },
      ],
    });
    expect(computePipelineOrder(m)).toEqual(["start", "agent", "response"]);
  });

  it("appends a node unreachable from any entry rather than dropping it", () => {
    const m = model({
      nodes: [...model().nodes, { id: "orphan", kind: "agent", title: "Orphan", agentName: null }],
    });
    expect(computePipelineOrder(m)).toEqual(["start", "agent", "response", "orphan"]);
  });
});

describe("findPipelineEntryIds", () => {
  it("returns every Start-kind node", () => {
    expect(findPipelineEntryIds(model())).toEqual(["start"]);
  });
});

describe("pipelineSiblingIdsOf", () => {
  it("returns every child of the same parent, over forward edges only", () => {
    const m = model({
      nodes: [...model().nodes, { id: "second", kind: "agent", title: "Second", agentName: null }],
      edges: [
        { id: "e1", sourceId: "start", targetId: "agent", kind: "parallel" },
        { id: "e2", sourceId: "start", targetId: "second", kind: "parallel" },
      ],
    });
    expect(pipelineSiblingIdsOf("agent", m)).toEqual(["agent", "second"]);
  });
});

describe("loopBackEdgesFrom", () => {
  it("finds a node's own outgoing loop-back edges", () => {
    const m = model({
      edges: [
        { id: "e1", sourceId: "start", targetId: "agent", kind: "sequential" },
        { id: "e2", sourceId: "agent", targetId: "start", kind: "loop-back", maxIterations: 3 },
      ],
    });
    expect(loopBackEdgesFrom("agent", m.edges).map((e) => e.id)).toEqual(["e2"]);
  });
});

describe("describePipelineNode", () => {
  it("names the loop-back target, bound, and condition in one line", () => {
    const m = model({
      edges: [
        { id: "e1", sourceId: "start", targetId: "agent", kind: "sequential" },
        {
          id: "e2",
          sourceId: "agent",
          targetId: "start",
          kind: "loop-back",
          maxIterations: 3,
          conditionSummary: "confidence < 0.6",
        },
      ],
    });
    const agentNode = m.nodes.find((n) => n.id === "agent")!;
    // `agent`'s only outgoing edge here IS the loop-back one, excluded from the forward
    // connection count — so no ", N connections" suffix, only the loop-back sentence.
    expect(describePipelineNode(agentNode, m)).toBe(
      "Agent: Triage. Loops back to Start (max 3, while confidence < 0.6)",
    );
  });
});
