/**
 * Real-domain (`modules/flows`) ↔ presentational (`components/patterns/flow-canvas`) mapping
 * layer for `flows-step.tsx`'s graphical rendering.
 *
 * `components/patterns/flow-canvas` was built as a generic, presentational design-system
 * organism ahead of `modules/flows`' real backend — its own `FlowNodeType` union is a
 * lowercase, five-value UI vocabulary (`"message"|"question"|...`) with no concept of the
 * real `FlowNodes` columns (`slotName`, `toolBindingId`, `handoverReason`, …), and its
 * `NodeInspectorFormValue` shapes (`node-inspector.tsx`) are UI-only forms that do not map
 * onto those real columns at all — confirmed by reading that file in full: a Handover form
 * field ("queue") and a Condition form's branch labels have no matching `FlowNodes` column
 * anywhere, and a ToolCall form's free-text `toolName`/`argumentsJson` cannot express the real
 * `toolBindingId`/`retryCount`/`onFailureNodeId` triad `CK_FlowNodes_toolCallFields` requires.
 * Extending `NodeInspectorFormValue` field-by-field to match the real domain would mean either
 * re-deriving `NodeFormDialog`'s (`flows-step.tsx`) already-tested ~700 lines of schema-accurate
 * form logic a second time, or shipping a "full edit" surface that silently cannot collect the
 * fields the real `CK_FlowNodes_*` constraints require — this module instead maps ONLY the
 * fields the canvas needs to render nodes/connections as a real graphical layout
 * (`FlowNode.title`, `FlowNode.summary`, `FlowConnection.branchLabel`), and `flows-step.tsx`
 * wires the canvas's `onActivateNode` extension point (`flow-canvas.tsx`) to open the real,
 * already-built, field-complete `NodeFormDialog`/`EdgeFormDialog` instead of the canvas's own
 * generic inspector — see that file's own module doc comment for the full reasoning.
 */

import { summarizeFlowNode } from "../../../../../../../modules/flows/domain/flow-node.js";
import type { FlowNodeType } from "../../../../../../../modules/flows/domain/flow-node.js";
import type {
  FlowEdgeRow,
  FlowNodeRow,
} from "../../../../../../../modules/flows/ports/flow-repository.js";
// Imports the pure types module directly, not the package's `index.ts` barrel: the barrel
// also re-exports the real `FlowCanvas` component, which transitively pulls in
// component-only path aliases (`@/lib/utils`, `@/components/ui/*`) that this file's own
// `vitest` "unit" project (pure domain/application logic, no UI alias resolution configured —
// deliberately, matching `vitest.config.ts`'s own project split) cannot resolve — confirmed
// live: importing the barrel here failed the unit test run with "Cannot find package
// '@/lib/utils'" the first time this was tried.
import {
  type FlowConnection,
  type FlowModel,
  type FlowNode as CanvasNode,
  type FlowNodeType as CanvasNodeType,
} from "../../../../../../../components/patterns/flow-canvas/flow-canvas-types.js";

/** The real, closed `FlowNodeType` set (`modules/flows/domain/flow-node.ts`) mapped onto the canvas's own lowercase, presentational vocabulary (`flow-canvas-types.ts`) — a `Record`, not a function, so a sixth real node type fails to compile here rather than silently rendering uncoloured. */
export const NODE_TYPE_CANVAS_KEY: Readonly<Record<FlowNodeType, CanvasNodeType>> = {
  Message: "message",
  Question: "question",
  ToolCall: "tool-call",
  Handover: "handover",
  Condition: "condition",
};

/**
 * The inverse of `NODE_TYPE_CANVAS_KEY` — the canvas's own graphical node-creation palette
 * (`FlowCanvasGraph`'s `onRequestCreateNode`) only knows the presentational vocabulary, but
 * `NodeFormDialog` (`flows-step.tsx`) needs the real `FlowNodeType` casing to pre-select its
 * type `Select`. Derived from `NODE_TYPE_CANVAS_KEY` rather than hand-duplicated, so the two
 * can never silently disagree.
 */
export const CANVAS_KEY_NODE_TYPE: Readonly<Record<CanvasNodeType, FlowNodeType>> = Object.fromEntries(
  Object.entries(NODE_TYPE_CANVAS_KEY).map(([real, canvas]) => [canvas, real]),
) as Record<CanvasNodeType, FlowNodeType>;

/** One real `FlowNodeRow` → the canvas's presentational `FlowNode` — `summary` reuses the real, already-tested `summarizeFlowNode` (the exact same per-type summary the old node table showed), not a re-derived one. */
export function mapFlowNodeRowToCanvasNode(row: FlowNodeRow): CanvasNode {
  return {
    id: row.id,
    type: NODE_TYPE_CANVAS_KEY[row.type],
    title: row.title,
    summary: summarizeFlowNode(row),
    x: row.canvasX,
    y: row.canvasY,
  };
}

/**
 * One real `FlowEdgeRow` → the canvas's presentational `FlowConnection` —
 * `label` (nullable, real column) becomes `branchLabel` (`undefined`, never
 * `null`, matching `FlowConnection`'s own optional-field shape). `isDefaultBranch`
 * (real, required `boolean` column, `FlowEdgeFields`) is passed through
 * verbatim so the canvas can render a condition node's fallback branch with a
 * visually distinct (dashed) connector line, per design-system.md §5.5 #45's
 * "connectors with arrowheads and branch labels."
 */
export function mapFlowEdgeRowToCanvasConnection(row: FlowEdgeRow): FlowConnection {
  return {
    id: row.id,
    sourceId: row.fromNodeId,
    targetId: row.toNodeId,
    ...(row.label !== null ? { branchLabel: row.label } : {}),
    isDefaultBranch: row.isDefaultBranch,
  };
}

/** The one function `FlowsStep` calls to build the canvas's `model` prop from real, live `FlowNodeRow`/`FlowEdgeRow` state — the whole real ↔ presentational bridge in one place. */
export function buildFlowCanvasModel(
  nodes: readonly FlowNodeRow[],
  edges: readonly FlowEdgeRow[],
): FlowModel {
  return {
    nodes: nodes.map(mapFlowNodeRowToCanvasNode),
    connections: edges.map(mapFlowEdgeRowToCanvasConnection),
  };
}
