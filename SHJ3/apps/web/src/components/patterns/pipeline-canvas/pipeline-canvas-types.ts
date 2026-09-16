import type { LucideIcon } from "lucide-react";
import { CircleDot, Sparkles, UserRound, Workflow } from "lucide-react";

/**
 * The Pipeline Designer's own presentational vocabulary — a deliberate structural
 * duplicate of `modules/orchestration/domain/pipeline-vocabulary.ts`'s real, persisted
 * kinds, lower-cased to this codebase's established "components layer keeps its own UI
 * vocabulary, never imports a feature module's domain types" convention
 * (`flow-canvas-types.ts`'s `FlowNodeType` is the identical precedent — `eslint.config.mjs`'s
 * `boundaries/element-types` forbids `components/**` importing `modules/**` at all, feature
 * or not). The mapping route code (`pipeline-canvas-mapping.ts`, `apps/web/src/app/**`)
 * translates between the two vocabularies at the one boundary allowed to see both.
 */
export type PipelineNodeKind = "start" | "agent" | "supervisor" | "response";
export type PipelineEdgeKind = "sequential" | "parallel" | "loop-back";

export interface PipelineCanvasNode {
  readonly id: string;
  readonly kind: PipelineNodeKind;
  readonly title: string;
  readonly agentName: string | null;
  readonly x?: number;
  readonly y?: number;
}

export interface PipelineCanvasEdge {
  readonly id: string;
  readonly sourceId: string;
  readonly targetId: string;
  readonly kind: PipelineEdgeKind;
  readonly label?: string;
  readonly maxIterations?: number;
  readonly conditionSummary?: string;
}

/** The one data source both the canvas and the mandatory outline view render from —
 *  mirrors `FlowModel`'s identical role. */
export interface PipelineCanvasModel {
  readonly nodes: readonly PipelineCanvasNode[];
  readonly edges: readonly PipelineCanvasEdge[];
}

export interface PipelineNodeKindMeta {
  readonly colorToken: string;
  readonly glyph: LucideIcon;
  readonly badgeLabel: string;
}

/** Four node kinds, four tokens — `Start` reuses `--muted-foreground` (a structural,
 *  non-agent node), `Agent`/`Supervisor` share the "an LLM call happens here" family
 *  (distinguished by glyph, not just color — never color alone), `Response` gets the
 *  terminal/success family. */
export const PIPELINE_NODE_KIND_META: Readonly<Record<PipelineNodeKind, PipelineNodeKindMeta>> = {
  start: { colorToken: "var(--muted-foreground)", glyph: CircleDot, badgeLabel: "Start" },
  agent: { colorToken: "var(--chart-1)", glyph: Sparkles, badgeLabel: "Agent" },
  supervisor: { colorToken: "var(--chart-2)", glyph: UserRound, badgeLabel: "Supervisor" },
  response: { colorToken: "var(--chart-5)", glyph: Workflow, badgeLabel: "Response" },
};

export function indexPipelineNodesById(
  nodes: readonly PipelineCanvasNode[],
): ReadonlyMap<string, PipelineCanvasNode> {
  return new Map(nodes.map((node) => [node.id, node]));
}

/** Forward (non-`loop-back`) edges only — the subgraph every structural helper below walks,
 *  the same "loop edges are excluded from the acyclic walk" rule
 *  `domain/pipeline-graph.ts::analyzePipelineGraph`'s own `forwardEdges` establishes. */
export function structuralConnections(
  edges: readonly PipelineCanvasEdge[],
): readonly PipelineCanvasEdge[] {
  return edges.filter((edge) => edge.kind !== "loop-back");
}

export function incomingConnections(
  nodeId: string,
  edges: readonly PipelineCanvasEdge[],
): readonly PipelineCanvasEdge[] {
  return edges.filter((edge) => edge.targetId === nodeId);
}

export function outgoingConnections(
  nodeId: string,
  edges: readonly PipelineCanvasEdge[],
): readonly PipelineCanvasEdge[] {
  return edges.filter((edge) => edge.sourceId === nodeId);
}

/** The version's own `Start` node(s) — normally exactly one; a canvas mid-edit may
 *  temporarily have zero or several, both surfaced by `analyzePipelineGraph`'s own
 *  blocking findings rather than by this function throwing. */
export function findPipelineEntryIds(model: PipelineCanvasModel): readonly string[] {
  return model.nodes.filter((node) => node.kind === "start").map((node) => node.id);
}

/**
 * A deterministic linear order over every node reachable from an entry, walking only
 * forward (non-loop-back) edges — the loop-aware replacement for
 * `flow-canvas-types.ts::computeTopologicalOrder`, which assumes a DAG and silently
 * degrades to `[]` on a real cycle (a looped pipeline's entry is, by definition, the
 * TARGET of at least one loop-back edge — the exact case that breaks the DAG-only
 * version). Breadth-first, children visited in edge order; a node unreachable from any
 * entry is appended after every reachable node, in `nodes` array order, so nothing is
 * ever silently dropped.
 */
export function computePipelineOrder(model: PipelineCanvasModel): readonly string[] {
  const forward = structuralConnections(model.edges);
  const visited = new Set<string>();
  const order: string[] = [];
  const queue: string[] = [...findPipelineEntryIds(model)];

  while (queue.length > 0) {
    const id = queue.shift();
    if (id === undefined || visited.has(id)) continue;
    visited.add(id);
    order.push(id);
    for (const edge of outgoingConnections(id, forward)) {
      if (!visited.has(edge.targetId)) queue.push(edge.targetId);
    }
  }
  for (const node of model.nodes) {
    if (!visited.has(node.id)) {
      visited.add(node.id);
      order.push(node.id);
    }
  }
  return order;
}

/** Every node sharing `nodeId`'s parent (over forward edges only), in edge order,
 *  `nodeId` included — mirrors `flow-canvas-types.ts::siblingIdsOf` exactly, loop-aware. */
export function pipelineSiblingIdsOf(nodeId: string, model: PipelineCanvasModel): readonly string[] {
  const forward = structuralConnections(model.edges);
  const parents = incomingConnections(nodeId, forward);
  if (parents.length === 0) return findPipelineEntryIds(model);
  const parentId = parents[0]?.sourceId;
  if (parentId === undefined) return [nodeId];
  return outgoingConnections(parentId, forward).map((edge) => edge.targetId);
}

/** Every loop-back edge whose SOURCE is `nodeId` — what the outline view's "Loops back
 *  to…" line is built from. */
export function loopBackEdgesFrom(
  nodeId: string,
  edges: readonly PipelineCanvasEdge[],
): readonly PipelineCanvasEdge[] {
  return edges.filter((edge) => edge.kind === "loop-back" && edge.sourceId === nodeId);
}

/** A node's full accessible name/outline-view line — one function, used by the node
 *  renderer, the outline view, and the live region announcer alike (this module's own
 *  design decision: "so they can't drift"), mirroring `flow-canvas-types.ts::
 *  describeFlowNode`'s identical role, extended with the one relationship a flat list
 *  would otherwise hide entirely: a node's own loop-back target(s). */
export function describePipelineNode(
  node: PipelineCanvasNode,
  model: PipelineCanvasModel,
): string {
  const meta = PIPELINE_NODE_KIND_META[node.kind];
  const outCount = outgoingConnections(node.id, structuralConnections(model.edges)).length;
  const suffix = outCount > 0 ? `, ${outCount} ${outCount === 1 ? "connection" : "connections"}` : "";
  const loops = loopBackEdgesFrom(node.id, model.edges);
  const loopSuffix = loops
    .map((edge) => {
      const target = model.nodes.find((n) => n.id === edge.targetId);
      const bound = edge.maxIterations !== undefined ? `max ${edge.maxIterations}` : "unbounded";
      const condition = edge.conditionSummary ? `, while ${edge.conditionSummary}` : "";
      return `. Loops back to ${target?.title ?? edge.targetId} (${bound}${condition})`;
    })
    .join("");
  return `${meta.badgeLabel}: ${node.title}${suffix}${loopSuffix}`;
}
