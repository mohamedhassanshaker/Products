/**
 * The one boundary allowed to see both vocabularies (`boundaries/element-types`'s "app"
 * type may import any feature module) — translates `PipelineCanvas` (the real, persisted
 * `PipelineNodeRow`/`PipelineEdgeRow` shape from `modules/orchestration/ports/
 * pipeline-repository.ts`) into `PipelineCanvasModel` (the presentational, lower-cased
 * vocabulary `components/patterns/pipeline-canvas` renders), and the graph-analysis shape
 * `domain/pipeline-graph.ts::analyzePipelineGraph` consumes.
 */
import {
  analyzePipelineGraph,
  type PipelineGraphEdge,
  type PipelineGraphFinding,
  type PipelineGraphNode,
} from "../../../../../../modules/orchestration/domain/pipeline-graph.js";
import type {
  PipelineCanvas,
  PipelineEdgeRow,
  PipelineNodeRow,
} from "../../../../../../modules/orchestration/ports/pipeline-repository.js";
import type {
  PipelineCanvasEdge,
  PipelineCanvasModel,
  PipelineCanvasNode,
  PipelineEdgeKind,
  PipelineNodeKind,
} from "../../../../../../components/patterns/pipeline-canvas/pipeline-canvas-types.js";

const NODE_KIND_TO_UI: Readonly<Record<string, PipelineNodeKind>> = {
  Start: "start",
  Agent: "agent",
  Supervisor: "supervisor",
  Response: "response",
};

const EDGE_KIND_TO_UI: Readonly<Record<string, PipelineEdgeKind>> = {
  Sequential: "sequential",
  Parallel: "parallel",
  LoopBack: "loop-back",
};

function toUiNode(
  row: PipelineNodeRow,
  agentNameById: ReadonlyMap<string, string>,
): PipelineCanvasNode {
  const kind = NODE_KIND_TO_UI[row.kind] ?? "agent";
  const agentName = row.usesTurnBoundAgent
    ? "Turn-bound agent"
    : row.agentId !== null
      ? (agentNameById.get(row.agentId) ?? row.agentId)
      : null;
  return {
    id: row.id,
    kind,
    title: row.title,
    agentName,
    x: row.canvasX,
    y: row.canvasY,
  };
}

function toUiEdge(row: PipelineEdgeRow): PipelineCanvasEdge {
  return {
    id: row.id,
    sourceId: row.fromNodeId,
    targetId: row.toNodeId,
    kind: EDGE_KIND_TO_UI[row.kind] ?? "sequential",
    ...(row.label !== null ? { label: row.label } : {}),
    ...(row.maxIterations !== null ? { maxIterations: row.maxIterations } : {}),
    ...(row.conditionExpression !== null ? { conditionSummary: row.conditionExpression } : {}),
  };
}

export function toPipelineCanvasModel(
  canvas: PipelineCanvas,
  agentNameById: ReadonlyMap<string, string>,
): PipelineCanvasModel {
  return {
    nodes: canvas.nodes.map((n) => toUiNode(n, agentNameById)),
    edges: canvas.edges.map(toUiEdge),
  };
}

/** `PipelineNodeRow`/`PipelineEdgeRow` -> `analyzePipelineGraph`'s own real (non-UI)
 *  vocabulary — kept `PascalCase`/real-id-based, since the analyzer's rule set is the
 *  deliberately-mirrored twin of `domain/pipeline.py::validate_definition` and
 *  `TR_PipelineVersions_publishGraphValid`, not the canvas's own presentational shape. */
export function toGraphNodes(nodes: readonly PipelineNodeRow[]): readonly PipelineGraphNode[] {
  return nodes.map((n) => ({ id: n.id, kind: n.kind, agentId: n.agentId }));
}

export function toGraphEdges(edges: readonly PipelineEdgeRow[]): readonly PipelineGraphEdge[] {
  return edges.map((e) => ({
    id: e.id,
    fromNodeId: e.fromNodeId,
    toNodeId: e.toNodeId,
    kind: e.kind,
    maxIterations: e.maxIterations,
    conditionExpression: e.conditionExpression,
  }));
}

export function analyzeCanvas(
  canvas: PipelineCanvas,
  publishedAgentIds: ReadonlySet<string>,
): readonly PipelineGraphFinding[] {
  return analyzePipelineGraph(
    toGraphNodes(canvas.nodes),
    toGraphEdges(canvas.edges),
    publishedAgentIds,
  ).findings;
}

/** `nodeId -> the first blocking/advisory finding's message` — what
 *  `PipelineCanvasGraph.invalidNodeReasons` needs, one reason per node (a node with several
 *  findings shows the first; the full list lives in `PipelineFindingsPanel`). */
export function invalidNodeReasonsFrom(
  findings: readonly PipelineGraphFinding[],
): ReadonlyMap<string, string> {
  const map = new Map<string, string>();
  for (const finding of findings) {
    for (const nodeId of finding.nodeIds) {
      if (!map.has(nodeId)) map.set(nodeId, finding.reason);
    }
  }
  return map;
}

export function invalidEdgeIdsFrom(findings: readonly PipelineGraphFinding[]): ReadonlySet<string> {
  const set = new Set<string>();
  for (const finding of findings) {
    for (const edgeId of finding.edgeIds) set.add(edgeId);
  }
  return set;
}
