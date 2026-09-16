import type { LucideIcon } from "lucide-react";
import { GitBranch, HelpCircle, MessageSquare, UserRound, Wrench } from "lucide-react";

/**
 * B7's five flow-node types (design-system.md §5.5 #45). A closed union, not
 * a free string — every consumer below is a `Record<FlowNodeType, …>`, so a
 * sixth node type introduced anywhere in real flow data without updating this
 * file fails to compile rather than silently rendering with no colour, no
 * badge and no inspector form.
 */
export type FlowNodeType = "message" | "question" | "tool-call" | "handover" | "condition";

/** One node in the flow. Topology (parent/child, sibling order) is derived entirely from `FlowConnection[]`, never stored on the node itself — one source of truth for both the canvas and the outline view. */
export interface FlowNode {
  id: string;
  type: FlowNodeType;
  title: string;
  summary: string;
  /**
   * Real, persisted freeform canvas position (`FlowNodeRow.canvasX`/`canvasY`
   * — non-null `Int` columns, `modules/flows/ports/flow-repository.ts`).
   * Optional here because this type is also used by fixtures/tests that never
   * cared about position under the old grid-laid-out canvas; a graphical
   * canvas consuming this field treats a missing value as "not yet placed"
   * and falls back to a deterministic default (`nextGridPosition`-shaped),
   * never `0,0` for every node at once.
   */
  x?: number;
  y?: number;
}

/**
 * A directed edge between two flow nodes. `branchLabel` names a condition's
 * branch (e.g. "Yes"/"No"), undefined for a plain linear connection.
 * `isDefaultBranch` mirrors the real domain's `FlowEdgeFields.isDefaultBranch`
 * (`modules/flows/domain/flow-edge.ts`) — the fallback branch a condition node
 * takes when no other branch's expression matches. Undefined for a connection
 * with no branching semantics at all (a plain linear connection out of a
 * Message/Question/ToolCall/Handover node), never `false` in that case —
 * "not a default branch" and "not a branch at all" are different facts, and
 * conflating them would make a `false` value ambiguous to a renderer deciding
 * whether to draw the "this is the fallback path" visual treatment.
 */
export interface FlowConnection {
  id: string;
  sourceId: string;
  targetId: string;
  branchLabel?: string;
  isDefaultBranch?: boolean;
}

/** The one data source both the canvas and the mandatory outline view render from (§10.4). */
export interface FlowModel {
  nodes: readonly FlowNode[];
  connections: readonly FlowConnection[];
}

export interface FlowNodeTypeMeta {
  /** `var(--chart-*)` or `var(--warning)` per design-system.md §5.5 #45's exact mapping — applied via `style`, never a literal. */
  colorToken: string;
  glyph: LucideIcon;
  /** English default badge text, overridable once wired to next-intl. */
  badgeLabel: string;
}

/**
 * The exact per-type mapping §5.5 #45 states: *"Message `--chart-5` ·
 * Question `--chart-2` · Tool call `--chart-1` · Handover `--warning` ·
 * Condition `--chart-6`."* Each type also carries a text badge (§6.4's
 * "Flow node type | node type tokens | A type badge in the node header") —
 * never colour alone.
 */
export const FLOW_NODE_TYPE_META: Readonly<Record<FlowNodeType, FlowNodeTypeMeta>> = {
  message: { colorToken: "var(--chart-5)", glyph: MessageSquare, badgeLabel: "Message" },
  question: { colorToken: "var(--chart-2)", glyph: HelpCircle, badgeLabel: "Question" },
  "tool-call": { colorToken: "var(--chart-1)", glyph: Wrench, badgeLabel: "Tool call" },
  handover: { colorToken: "var(--warning)", glyph: UserRound, badgeLabel: "Handover" },
  condition: { colorToken: "var(--chart-6)", glyph: GitBranch, badgeLabel: "Condition" },
};

/** `id -> node` index, built once per render. */
export function indexFlowNodesById(nodes: readonly FlowNode[]): ReadonlyMap<string, FlowNode> {
  return new Map(nodes.map((node) => [node.id, node]));
}

/** Every connection whose `targetId` is `nodeId` — a node's incoming edges (normally exactly one outside a merge). */
export function incomingConnections(
  nodeId: string,
  connections: readonly FlowConnection[],
): readonly FlowConnection[] {
  return connections.filter((connection) => connection.targetId === nodeId);
}

/** Every connection whose `sourceId` is `nodeId`, in array order — a node's children, in the order they branch (branch order is meaningful for `ArrowLeft`/`ArrowRight`, so this is never re-sorted). */
export function outgoingConnections(
  nodeId: string,
  connections: readonly FlowConnection[],
): readonly FlowConnection[] {
  return connections.filter((connection) => connection.sourceId === nodeId);
}

/** Nodes with no incoming connection — the flow's entry point(s). Normally exactly one; more than one is treated as parallel roots (B7's supervisor–worker/parallel modes), each still reachable from `computeTopologicalOrder`. */
export function findRootNodeIds(model: FlowModel): readonly string[] {
  const targets = new Set(model.connections.map((connection) => connection.targetId));
  return model.nodes.filter((node) => !targets.has(node.id)).map((node) => node.id);
}

/**
 * A single, deterministic linear order over every node reachable from a root
 * — breadth-first, children visited in connection order — the sequence
 * `ArrowDown`/`ArrowUp` walk (§5.5 #45: *"roving tabindex across nodes in
 * topological order"*) and the exact order the outline view lists nodes in,
 * so the two are provably the same sequence rather than independently
 * derived. A node unreachable from any root (a disconnected fragment) is
 * appended after every reachable node, in `nodes` array order, so it is never
 * silently dropped from either representation.
 */
export function computeTopologicalOrder(model: FlowModel): readonly string[] {
  const visited = new Set<string>();
  const order: string[] = [];
  const queue: string[] = [...findRootNodeIds(model)];

  while (queue.length > 0) {
    const id = queue.shift();
    if (id === undefined || visited.has(id)) continue;
    visited.add(id);
    order.push(id);
    for (const connection of outgoingConnections(id, model.connections)) {
      if (!visited.has(connection.targetId)) queue.push(connection.targetId);
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

/**
 * Every node sharing `nodeId`'s parent, in branch order, `nodeId` included —
 * what `ArrowLeft`/`ArrowRight` moves between (§5.5 #45: *"across sibling
 * branches"*). A root node's "siblings" are every other root, so
 * `ArrowLeft`/`ArrowRight` still does something sensible for a flow with
 * parallel entry points.
 */
export function siblingIdsOf(nodeId: string, model: FlowModel): readonly string[] {
  const parents = incomingConnections(nodeId, model.connections);
  if (parents.length === 0) {
    return findRootNodeIds(model);
  }
  // A merged node (more than one incoming connection) uses its first parent
  // for sibling purposes — sibling order is a branch-navigation convenience,
  // not a claim about the node's one true position in the graph.
  const parentId = parents[0]?.sourceId;
  if (parentId === undefined) return [nodeId];
  return outgoingConnections(parentId, model.connections).map((connection) => connection.targetId);
}

/**
 * R3 (B7's brief, quoted in design-system.md §5.5 #45): *"the condition node
 * exits the flow at any point and returns control to the router."* A flow
 * with no `condition` node reachable from a root has no such escape path —
 * every visitor is forced through rigid Message/Question/Tool-call/Handover
 * steps with no branch back to free text. Deliberately a real, computed,
 * testable predicate (not a static warning): `FlowCanvas` surfaces its
 * negation as a `blocking` `SummaryStrip`.
 */
export function hasFreeTextEscapePath(model: FlowModel): boolean {
  return countReachableConditionNodes(model) > 0;
}

/**
 * The real, computed count `hasFreeTextEscapePath` above reduces to a
 * boolean — surfaced as its own function so a caller reporting the R3 gate's
 * state (`FlowCanvas`'s own blocking `SummaryStrip`) can describe the
 * ACTUAL measured value ("0 condition nodes reachable from the start") for
 * the specific flow being viewed, rather than a generic, non-computed
 * placeholder string — see `flow-canvas.tsx`'s own doc comment on
 * `escapePathBlockedMeasured` for the finding this closes.
 */
export function countReachableConditionNodes(model: FlowModel): number {
  const reachable = new Set(computeTopologicalOrder(model));
  return model.nodes.filter((node) => node.type === "condition" && reachable.has(node.id)).length;
}

/**
 * A node's full accessible name, e.g. `"Tool call: Fetch bill by account #, 1
 * input from Question, 2 outputs to Handover and Condition"`-shaped per §5.5
 * #45's own example, simplified here to the type, title and outgoing
 * connection count. One function, called by both the canvas node and any
 * future surface announcing a node, rather than composed ad hoc per call
 * site.
 */
export function describeFlowNode(node: FlowNode, connections: readonly FlowConnection[]): string {
  const meta = FLOW_NODE_TYPE_META[node.type];
  const outCount = outgoingConnections(node.id, connections).length;
  const suffix =
    outCount > 0 ? `, ${outCount} ${outCount === 1 ? "connection" : "connections"}` : "";
  return `${meta.badgeLabel}: ${node.title}${suffix}`;
}
