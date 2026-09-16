import { describe, expect, it } from "vitest";
import { analyzePipelineGraph, hasBlockingFindings, type PipelineGraphEdge, type PipelineGraphNode } from "./pipeline-graph.js";

let nextEdgeId = 0;
function node(id: string, kind: PipelineGraphNode["kind"] = "Agent", agentId: string | null = null): PipelineGraphNode {
  return { id, kind, agentId: agentId ?? (kind === "Agent" || kind === "Supervisor" ? `agt_${id}` : null) };
}
function edge(
  fromNodeId: string,
  toNodeId: string,
  kind: PipelineGraphEdge["kind"] = "Sequential",
  overrides: Partial<PipelineGraphEdge> = {},
): PipelineGraphEdge {
  nextEdgeId += 1;
  return {
    id: `e${nextEdgeId}`,
    fromNodeId,
    toNodeId,
    kind,
    maxIterations: null,
    conditionExpression: null,
    ...overrides,
  };
}

function linearChain(): { nodes: PipelineGraphNode[]; edges: PipelineGraphEdge[] } {
  return {
    nodes: [node("start", "Start"), node("a"), node("respond", "Response")],
    edges: [edge("start", "a"), edge("a", "respond")],
  };
}

function parallelFanOut(): { nodes: PipelineGraphNode[]; edges: PipelineGraphEdge[] } {
  return {
    nodes: [node("start", "Start"), node("a1"), node("a2"), node("respond", "Response")],
    edges: [
      edge("start", "a1", "Parallel"),
      edge("start", "a2", "Parallel"),
      edge("a1", "respond"),
      edge("a2", "respond"),
    ],
  };
}

function loopedChain(maxIterations: number | null = 3, conditionExpression: string | null = null) {
  return {
    nodes: [node("start", "Start"), node("a"), node("b"), node("respond", "Response")],
    edges: [
      edge("start", "a"),
      edge("a", "b"),
      edge("b", "a", "LoopBack", { maxIterations, conditionExpression }),
      edge("b", "respond"),
    ],
  };
}

describe("analyzePipelineGraph — structural rules", () => {
  it("a valid linear chain has no blocking findings", () => {
    const { nodes, edges } = linearChain();
    const analysis = analyzePipelineGraph(nodes, edges);
    expect(hasBlockingFindings(analysis)).toBe(false);
    expect(analysis.entryNodeIds).toEqual(["start"]);
    expect(analysis.terminalNodeIds).toEqual(["respond"]);
  });

  it("a valid looped chain has no blocking findings", () => {
    const { nodes, edges } = loopedChain();
    expect(hasBlockingFindings(analyzePipelineGraph(nodes, edges))).toBe(false);
  });

  it("flags a missing entry node", () => {
    const nodes = [node("a"), node("respond", "Response")];
    const edges = [edge("a", "respond")];
    const codes = analyzePipelineGraph(nodes, edges).findings.map((f) => f.reason);
    expect(codes).toContain("orchestration.pipeline.entry_node_required");
  });

  it("flags multiple entry nodes", () => {
    const nodes = [node("start1", "Start"), node("start2", "Start"), node("a"), node("respond", "Response")];
    const edges = [edge("start1", "a"), edge("start2", "a"), edge("a", "respond")];
    const codes = analyzePipelineGraph(nodes, edges).findings.map((f) => f.reason);
    expect(codes).toContain("orchestration.pipeline.multiple_entry_nodes");
  });

  it("flags a missing response node", () => {
    const nodes = [node("start", "Start"), node("a")];
    const edges = [edge("start", "a")];
    const codes = analyzePipelineGraph(nodes, edges).findings.map((f) => f.reason);
    expect(codes).toContain("orchestration.pipeline.terminal_node_required");
  });

  it("flags an orphan node with no inbound edge", () => {
    const nodes = [node("start", "Start"), node("a"), node("orphan"), node("respond", "Response")];
    const edges = [edge("start", "a"), edge("a", "respond"), edge("orphan", "respond")];
    const findings = analyzePipelineGraph(nodes, edges).findings.filter(
      (f) => f.reason === "orchestration.pipeline.orphan_node",
    );
    expect(findings.some((f) => f.nodeIds.includes("orphan"))).toBe(true);
  });

  it("flags a dead-end node with no outbound edge", () => {
    const nodes = [node("start", "Start"), node("a"), node("deadend"), node("respond", "Response")];
    const edges = [edge("start", "a"), edge("a", "respond"), edge("start", "deadend")];
    const findings = analyzePipelineGraph(nodes, edges).findings.filter(
      (f) => f.reason === "orchestration.pipeline.orphan_node",
    );
    expect(findings.some((f) => f.nodeIds.includes("deadend"))).toBe(true);
  });

  it("flags a forward cycle", () => {
    const nodes = [node("start", "Start"), node("a"), node("b")];
    const edges = [edge("start", "a"), edge("a", "b"), edge("b", "a")];
    const codes = analyzePipelineGraph(nodes, edges).findings.map((f) => f.reason);
    expect(codes).toContain("orchestration.pipeline.cycle_outside_loop_edge");
  });

  it("tolerates a real LoopBack cycle", () => {
    const { nodes, edges } = loopedChain();
    const codes = analyzePipelineGraph(nodes, edges).findings.map((f) => f.reason);
    expect(codes).not.toContain("orchestration.pipeline.cycle_outside_loop_edge");
  });
});

describe("analyzePipelineGraph — loop rules", () => {
  it("requires maxIterations on a LoopBack edge", () => {
    const { nodes, edges } = loopedChain(null);
    const codes = analyzePipelineGraph(nodes, edges).findings.map((f) => f.reason);
    expect(codes).toContain("orchestration.pipeline.loop_edge_requires_max_iterations");
  });

  it("rejects maxIterations outside 1..20", () => {
    const { nodes, edges } = loopedChain(21);
    const codes = analyzePipelineGraph(nodes, edges).findings.map((f) => f.reason);
    expect(codes).toContain("orchestration.pipeline.max_iterations_out_of_range");
  });

  it("flags a LoopBack edge that doesn't close a loop", () => {
    const nodes = [node("start", "Start"), node("a"), node("b"), node("respond", "Response")];
    const edges = [edge("start", "a"), edge("a", "b"), edge("b", "respond", "LoopBack", { maxIterations: 2 })];
    const codes = analyzePipelineGraph(nodes, edges).findings.map((f) => f.reason);
    expect(codes).toContain("orchestration.pipeline.loop_edge_does_not_close_a_loop");
  });

  it("flags a condition on a non-loop edge", () => {
    const { nodes, edges } = linearChain();
    edges[0] = { ...edges[0]!, conditionExpression: "iteration < 3" };
    const codes = analyzePipelineGraph(nodes, edges).findings.map((f) => f.reason);
    expect(codes).toContain("orchestration.pipeline.condition_on_non_loop_edge");
  });

  it("flags a non-loop self edge", () => {
    const nodes = [node("start", "Start"), node("a"), node("respond", "Response")];
    const edges = [edge("start", "a"), edge("a", "a"), edge("a", "respond")];
    const codes = analyzePipelineGraph(nodes, edges).findings.map((f) => f.reason);
    expect(codes).toContain("orchestration.pipeline.self_loop_requires_loop_back_kind");
  });

  it("marks an unconditional loop as advisory, not blocking", () => {
    const { nodes, edges } = loopedChain(3, null);
    const analysis = analyzePipelineGraph(nodes, edges);
    const finding = analysis.findings.find((f) => f.reason === "orchestration.pipeline.unconditional_loop");
    expect(finding?.severity).toBe("advisory");
    expect(hasBlockingFindings(analysis)).toBe(false);
  });

  it("does not flag unconditional_loop when a condition is present", () => {
    const { nodes, edges } = loopedChain(3, "iteration < 3");
    const codes = analyzePipelineGraph(nodes, edges).findings.map((f) => f.reason);
    expect(codes).not.toContain("orchestration.pipeline.unconditional_loop");
  });
});

describe("analyzePipelineGraph — reference and advisory rules", () => {
  it("flags an unpublished agent reference when a set is supplied", () => {
    const { nodes, edges } = linearChain();
    const codes = analyzePipelineGraph(nodes, edges, new Set(["agt_other"])).findings.map((f) => f.reason);
    expect(codes).toContain("orchestration.pipeline.agent_not_published");
  });

  it("does not flag a published agent reference", () => {
    const { nodes, edges } = linearChain();
    const codes = analyzePipelineGraph(nodes, edges, new Set(["agt_a"])).findings.map((f) => f.reason);
    expect(codes).not.toContain("orchestration.pipeline.agent_not_published");
  });

  it("does not check agent references when no set is supplied", () => {
    const { nodes, edges } = linearChain();
    const codes = analyzePipelineGraph(nodes, edges).findings.map((f) => f.reason);
    expect(codes).not.toContain("orchestration.pipeline.agent_not_published");
  });

  it("flags a lone parallel edge as advisory", () => {
    const nodes = [node("start", "Start"), node("a"), node("respond", "Response")];
    const edges = [edge("start", "a", "Parallel"), edge("a", "respond")];
    const finding = analyzePipelineGraph(nodes, edges).findings.find(
      (f) => f.reason === "orchestration.pipeline.parallel_fan_out_of_one",
    );
    expect(finding?.severity).toBe("advisory");
  });

  it("does not flag a real parallel fan-out with two branches", () => {
    const { nodes, edges } = parallelFanOut();
    const codes = analyzePipelineGraph(nodes, edges).findings.map((f) => f.reason);
    expect(codes).not.toContain("orchestration.pipeline.parallel_fan_out_of_one");
  });

  it("flags parallel branches that never converge as advisory", () => {
    const nodes = [
      node("start", "Start"),
      node("a1"),
      node("a2"),
      node("respond1", "Response"),
      node("respond2", "Response"),
    ];
    const edges = [
      edge("start", "a1", "Parallel"),
      edge("start", "a2", "Parallel"),
      edge("a1", "respond1"),
      edge("a2", "respond2"),
    ];
    const finding = analyzePipelineGraph(nodes, edges).findings.find(
      (f) => f.reason === "orchestration.pipeline.parallel_branches_do_not_converge",
    );
    expect(finding?.severity).toBe("advisory");
  });

  it("flags the same agent used on more than one node as advisory", () => {
    const nodes = [node("start", "Start"), node("a1", "Agent", "agt_shared"), node("a2", "Agent", "agt_shared"), node("respond", "Response")];
    const edges = [edge("start", "a1", "Parallel"), edge("start", "a2", "Parallel"), edge("a1", "respond"), edge("a2", "respond")];
    const finding = analyzePipelineGraph(nodes, edges).findings.find(
      (f) => f.reason === "orchestration.pipeline.duplicate_agent_in_pipeline",
    );
    expect(finding?.severity).toBe("advisory");
    expect([...(finding?.nodeIds ?? [])].sort()).toEqual(["a1", "a2"]);
  });
});
