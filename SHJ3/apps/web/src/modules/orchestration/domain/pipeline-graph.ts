/**
 * The pipeline graph analyzer — ONE pure function, shared by the live canvas (real-time,
 * pre-save feedback while a Draft is being edited) and the server publish gate
 * (`PublishPipelineVersion`, which calls the identical rule set via
 * `POST /v1/orchestration/pipelines/validate`), so "the canvas says this is fine" and
 * "the server accepted it" can never quietly disagree — the same reason `apps/ai`'s
 * `domain/pipeline.py`'s `validate_definition` exists as the runtime twin of the SQL
 * publish trigger `TR_PipelineVersions_publishGraphValid`. This file's structural rules
 * (entry/terminal/orphan/cycle/loop-ancestor) are a deliberate parallel of that Python
 * module's own — not imported (there is no shared runtime to import through), and not
 * byte-identical either, since this operates on a mutable, pre-save draft graph (no
 * `PipelineDefinition.entryNodeKey` has been chosen yet — the entry node here is simply
 * "the node with kind `Start`"), while the Python side operates on an already-fully-formed
 * definition about to execute.
 */

import type {
  PipelineEdgeKind,
  PipelineNodeKind,
} from "./pipeline-vocabulary.js";

export type PipelineFindingSeverity = "blocking" | "advisory";

export type PipelineFindingReason =
  // structural — blocking
  | "orchestration.pipeline.entry_node_required"
  | "orchestration.pipeline.multiple_entry_nodes"
  | "orchestration.pipeline.terminal_node_required"
  | "orchestration.pipeline.orphan_node"
  | "orchestration.pipeline.cycle_outside_loop_edge"
  // loop semantics — blocking
  | "orchestration.pipeline.loop_edge_requires_max_iterations"
  | "orchestration.pipeline.max_iterations_out_of_range"
  | "orchestration.pipeline.loop_edge_does_not_close_a_loop"
  | "orchestration.pipeline.condition_on_non_loop_edge"
  | "orchestration.pipeline.condition_invalid"
  // references — blocking
  | "orchestration.pipeline.agent_not_published"
  | "orchestration.pipeline.self_loop_requires_loop_back_kind"
  // advisory
  | "orchestration.pipeline.parallel_branches_do_not_converge"
  | "orchestration.pipeline.parallel_fan_out_of_one"
  | "orchestration.pipeline.unconditional_loop"
  | "orchestration.pipeline.duplicate_agent_in_pipeline";

export interface PipelineGraphFinding {
  readonly reason: PipelineFindingReason;
  readonly severity: PipelineFindingSeverity;
  readonly nodeIds: readonly string[];
  readonly edgeIds: readonly string[];
  readonly values?: Readonly<Record<string, string | number>>;
}

export interface PipelineGraphNode {
  readonly id: string;
  readonly kind: PipelineNodeKind;
  readonly agentId: string | null;
}

export interface PipelineGraphEdge {
  readonly id: string;
  readonly fromNodeId: string;
  readonly toNodeId: string;
  readonly kind: PipelineEdgeKind;
  readonly maxIterations: number | null;
  readonly conditionExpression: string | null;
}

export interface PipelineGraphAnalysis {
  readonly findings: readonly PipelineGraphFinding[];
  readonly entryNodeIds: readonly string[];
  readonly terminalNodeIds: readonly string[];
  readonly orphanNodeIds: readonly string[];
  readonly loopEdgeIds: readonly string[];
  readonly cycleEdgeIds: readonly string[];
  readonly topologicalOrder: readonly string[];
}

const MAX_ITERATIONS_RANGE = { min: 1, max: 20 } as const;

function forwardEdges(edges: readonly PipelineGraphEdge[]): readonly PipelineGraphEdge[] {
  return edges.filter((e) => e.kind !== "LoopBack");
}

function loopEdges(edges: readonly PipelineGraphEdge[]): readonly PipelineGraphEdge[] {
  return edges.filter((e) => e.kind === "LoopBack");
}

function buildAdjacency(
  edges: readonly PipelineGraphEdge[],
): { readonly outgoing: ReadonlyMap<string, readonly PipelineGraphEdge[]>; readonly incoming: ReadonlyMap<string, readonly PipelineGraphEdge[]> } {
  const outgoing = new Map<string, PipelineGraphEdge[]>();
  const incoming = new Map<string, PipelineGraphEdge[]>();
  for (const edge of edges) {
    (outgoing.get(edge.fromNodeId) ?? outgoing.set(edge.fromNodeId, []).get(edge.fromNodeId)!).push(edge);
    (incoming.get(edge.toNodeId) ?? incoming.set(edge.toNodeId, []).get(edge.toNodeId)!).push(edge);
  }
  return { outgoing, incoming };
}

function forwardReachable(
  outgoing: ReadonlyMap<string, readonly PipelineGraphEdge[]>,
  start: string,
): ReadonlySet<string> {
  const seen = new Set<string>([start]);
  const queue: string[] = [start];
  while (queue.length > 0) {
    const key = queue.shift()!;
    for (const edge of outgoing.get(key) ?? []) {
      if (!seen.has(edge.toNodeId)) {
        seen.add(edge.toNodeId);
        queue.push(edge.toNodeId);
      }
    }
  }
  return seen;
}

/** DFS over the forward subgraph, white/grey/black colouring — the standard shape for
 *  detecting a cycle AND recovering every edge that participates in one, not merely
 *  reporting that "a cycle exists" with no actionable location. */
function detectForwardCycleEdgeIds(
  nodeIds: readonly string[],
  outgoing: ReadonlyMap<string, readonly PipelineGraphEdge[]>,
): readonly string[] {
  const color = new Map<string, "white" | "grey" | "black">(nodeIds.map((id) => [id, "white"]));
  const cycleEdgeIds = new Set<string>();

  function visit(nodeId: string, path: readonly string[]): void {
    color.set(nodeId, "grey");
    for (const edge of outgoing.get(nodeId) ?? []) {
      const targetColor = color.get(edge.toNodeId);
      if (targetColor === "grey") {
        // Back-edge to an ancestor on the current DFS path -- every edge from that
        // ancestor forward to here, plus this closing edge, is part of the cycle.
        const cycleStart = path.indexOf(edge.toNodeId);
        const cycleNodes = cycleStart >= 0 ? path.slice(cycleStart) : [edge.toNodeId];
        cycleEdgeIds.add(edge.id);
        for (let i = 0; i < cycleNodes.length; i += 1) {
          const from = cycleNodes[i];
          const to = cycleNodes[i + 1] ?? edge.toNodeId;
          for (const candidate of outgoing.get(from as string) ?? []) {
            if (candidate.toNodeId === to) cycleEdgeIds.add(candidate.id);
          }
        }
        continue;
      }
      if (targetColor === "white") {
        visit(edge.toNodeId, [...path, edge.toNodeId]);
      }
    }
    color.set(nodeId, "black");
  }

  for (const nodeId of nodeIds) {
    if (color.get(nodeId) === "white") visit(nodeId, [nodeId]);
  }
  return [...cycleEdgeIds];
}

function topologicalOrderOf(
  nodeIds: readonly string[],
  outgoing: ReadonlyMap<string, readonly PipelineGraphEdge[]>,
  incoming: ReadonlyMap<string, readonly PipelineGraphEdge[]>,
): readonly string[] {
  const remaining = new Map<string, number>(nodeIds.map((id) => [id, (incoming.get(id) ?? []).length]));
  const ready = [...nodeIds].filter((id) => remaining.get(id) === 0).sort();
  const order: string[] = [];
  while (ready.length > 0) {
    const key = ready.shift()!;
    order.push(key);
    for (const edge of outgoing.get(key) ?? []) {
      const next = (remaining.get(edge.toNodeId) ?? 0) - 1;
      remaining.set(edge.toNodeId, next);
      if (next === 0) {
        ready.push(edge.toNodeId);
        ready.sort();
      }
    }
  }
  // Nodes left out of `order` sit on a cycle -- appended in stable input order so every
  // node still appears exactly once (the cycle finding itself is what flags the real
  // problem; this function never throws).
  const remainder = nodeIds.filter((id) => !order.includes(id));
  return [...order, ...remainder];
}

export function analyzePipelineGraph(
  nodes: readonly PipelineGraphNode[],
  edges: readonly PipelineGraphEdge[],
  publishedAgentIds?: ReadonlySet<string>,
): PipelineGraphAnalysis {
  const findings: PipelineGraphFinding[] = [];
  const nodeIds = nodes.map((n) => n.id);
  const { outgoing, incoming } = buildAdjacency(forwardEdges(edges));

  const entryNodeIds = nodes.filter((n) => n.kind === "Start").map((n) => n.id);
  if (entryNodeIds.length === 0) {
    findings.push({
      reason: "orchestration.pipeline.entry_node_required",
      severity: "blocking",
      nodeIds: [],
      edgeIds: [],
    });
  } else if (entryNodeIds.length > 1) {
    findings.push({
      reason: "orchestration.pipeline.multiple_entry_nodes",
      severity: "blocking",
      nodeIds: entryNodeIds,
      edgeIds: [],
    });
  }

  const terminalNodeIds = nodes.filter((n) => n.kind === "Response").map((n) => n.id);
  if (terminalNodeIds.length === 0) {
    findings.push({
      reason: "orchestration.pipeline.terminal_node_required",
      severity: "blocking",
      nodeIds: [],
      edgeIds: [],
    });
  }

  const orphanNodeIds: string[] = [];
  for (const node of nodes) {
    const hasInbound = (incoming.get(node.id) ?? []).length > 0;
    const hasOutbound = (outgoing.get(node.id) ?? []).length > 0;
    if (node.kind !== "Start" && !hasInbound) {
      orphanNodeIds.push(node.id);
      findings.push({
        reason: "orchestration.pipeline.orphan_node",
        severity: "blocking",
        nodeIds: [node.id],
        edgeIds: [],
      });
    }
    if (node.kind !== "Response" && !hasOutbound) {
      if (!orphanNodeIds.includes(node.id)) orphanNodeIds.push(node.id);
      findings.push({
        reason: "orchestration.pipeline.orphan_node",
        severity: "blocking",
        nodeIds: [node.id],
        edgeIds: [],
      });
    }
  }

  const cycleEdgeIds = detectForwardCycleEdgeIds(nodeIds, outgoing);
  if (cycleEdgeIds.length > 0) {
    findings.push({
      reason: "orchestration.pipeline.cycle_outside_loop_edge",
      severity: "blocking",
      nodeIds: [],
      edgeIds: cycleEdgeIds,
    });
  }

  const topologicalOrder = topologicalOrderOf(nodeIds, outgoing, incoming);

  if (cycleEdgeIds.length === 0 && entryNodeIds.length === 1) {
    const reachable = forwardReachable(outgoing, entryNodeIds[0] as string);
    const unreachable = nodeIds.filter((id) => !reachable.has(id));
    for (const id of unreachable) {
      findings.push({
        reason: "orchestration.pipeline.orphan_node",
        severity: "blocking",
        nodeIds: [id],
        edgeIds: [],
      });
    }
  }

  const loopEdgeIds: string[] = [];
  for (const edge of loopEdges(edges)) {
    loopEdgeIds.push(edge.id);
    if (edge.maxIterations === null) {
      findings.push({
        reason: "orchestration.pipeline.loop_edge_requires_max_iterations",
        severity: "blocking",
        nodeIds: [],
        edgeIds: [edge.id],
      });
    } else if (edge.maxIterations < MAX_ITERATIONS_RANGE.min || edge.maxIterations > MAX_ITERATIONS_RANGE.max) {
      findings.push({
        reason: "orchestration.pipeline.max_iterations_out_of_range",
        severity: "blocking",
        nodeIds: [],
        edgeIds: [edge.id],
        values: { min: MAX_ITERATIONS_RANGE.min, max: MAX_ITERATIONS_RANGE.max },
      });
    }
    if (edge.fromNodeId !== edge.toNodeId) {
      const targetReaches = forwardReachable(outgoing, edge.toNodeId);
      if (!targetReaches.has(edge.fromNodeId)) {
        findings.push({
          reason: "orchestration.pipeline.loop_edge_does_not_close_a_loop",
          severity: "blocking",
          nodeIds: [],
          edgeIds: [edge.id],
        });
      }
    }
    if (edge.conditionExpression === null) {
      findings.push({
        reason: "orchestration.pipeline.unconditional_loop",
        severity: "advisory",
        nodeIds: [],
        edgeIds: [edge.id],
      });
    }
  }

  for (const edge of edges) {
    if (edge.kind !== "LoopBack" && edge.conditionExpression !== null) {
      findings.push({
        reason: "orchestration.pipeline.condition_on_non_loop_edge",
        severity: "blocking",
        nodeIds: [],
        edgeIds: [edge.id],
      });
    }
    if (edge.kind !== "LoopBack" && edge.fromNodeId === edge.toNodeId) {
      findings.push({
        reason: "orchestration.pipeline.self_loop_requires_loop_back_kind",
        severity: "blocking",
        nodeIds: [],
        edgeIds: [edge.id],
      });
    }
  }

  if (publishedAgentIds !== undefined) {
    for (const node of nodes) {
      if (node.agentId !== null && !publishedAgentIds.has(node.agentId)) {
        findings.push({
          reason: "orchestration.pipeline.agent_not_published",
          severity: "blocking",
          nodeIds: [node.id],
          edgeIds: [],
        });
      }
    }
  }

  // Advisory: a lone "Parallel" edge out of a node is really just Sequential.
  const byFromNode = new Map<string, PipelineGraphEdge[]>();
  for (const edge of forwardEdges(edges)) {
    (byFromNode.get(edge.fromNodeId) ?? byFromNode.set(edge.fromNodeId, []).get(edge.fromNodeId)!).push(edge);
  }
  for (const [fromNodeId, outEdges] of byFromNode) {
    const parallel = outEdges.filter((e) => e.kind === "Parallel");
    if (parallel.length === 1) {
      findings.push({
        reason: "orchestration.pipeline.parallel_fan_out_of_one",
        severity: "advisory",
        nodeIds: [fromNodeId],
        edgeIds: [parallel[0]!.id],
      });
    } else if (parallel.length >= 2) {
      const branchReachables = parallel.map((e) => forwardReachable(outgoing, e.toNodeId));
      const converges = branchReachables.reduce<Set<string> | null>((acc, set) => {
        if (acc === null) return new Set(set);
        return new Set([...acc].filter((id) => set.has(id)));
      }, null);
      if (converges === null || converges.size === 0) {
        findings.push({
          reason: "orchestration.pipeline.parallel_branches_do_not_converge",
          severity: "advisory",
          nodeIds: [fromNodeId],
          edgeIds: parallel.map((e) => e.id),
        });
      }
    }
  }

  // Advisory: the same agent appearing on more than one node -- legal, but usually a
  // mistake worth surfacing rather than silently allowing.
  const nodeIdsByAgent = new Map<string, string[]>();
  for (const node of nodes) {
    if (node.agentId === null) continue;
    (nodeIdsByAgent.get(node.agentId) ?? nodeIdsByAgent.set(node.agentId, []).get(node.agentId)!).push(node.id);
  }
  for (const [, ids] of nodeIdsByAgent) {
    if (ids.length > 1) {
      findings.push({
        reason: "orchestration.pipeline.duplicate_agent_in_pipeline",
        severity: "advisory",
        nodeIds: ids,
        edgeIds: [],
      });
    }
  }

  return {
    findings,
    entryNodeIds,
    terminalNodeIds,
    orphanNodeIds,
    loopEdgeIds,
    cycleEdgeIds,
    topologicalOrder,
  };
}

export function hasBlockingFindings(analysis: PipelineGraphAnalysis): boolean {
  return analysis.findings.some((f) => f.severity === "blocking");
}
