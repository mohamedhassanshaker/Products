// `FlowCanvas` is re-exported from the sibling `flow-canvas-graph/` directory (the real
// `@xyflow/react`-based interactive canvas that replaced the original static CSS-Grid + plain-
// SVG-line renderer this directory used to define directly) so its real consumer
// (`flows-step.tsx`) keeps importing from this exact barrel path with no import-path churn —
// only `flow-canvas-graph.tsx`'s own module doc comment carries the "why xyflow" history now.
export {
  FlowCanvasGraph as FlowCanvas,
  type FlowCanvasProps,
  type FlowCanvasVariant,
  type FlowCanvasState,
  type FlowCanvasView,
} from "../flow-canvas-graph/flow-canvas-graph";
export { FlowCanvasOutlineView, type FlowCanvasOutlineViewProps } from "./flow-canvas-outline-view";
export { FlowCanvasMobileSheet, type FlowCanvasMobileSheetProps } from "./flow-canvas-mobile-sheet";
export {
  NodeInspector,
  emptyNodeInspectorValue,
  validateNodeInspectorValue,
  type NodeInspectorProps,
  type NodeInspectorFormValue,
  type MessageFormValue,
  type QuestionFormValue,
  type ToolCallFormValue,
  type HandoverFormValue,
  type ConditionFormValue,
} from "./node-inspector";
export {
  FLOW_NODE_TYPE_META,
  computeTopologicalOrder,
  countReachableConditionNodes,
  describeFlowNode,
  findRootNodeIds,
  hasFreeTextEscapePath,
  incomingConnections,
  indexFlowNodesById,
  outgoingConnections,
  siblingIdsOf,
  type FlowConnection,
  type FlowModel,
  type FlowNode,
  type FlowNodeType,
  type FlowNodeTypeMeta,
} from "./flow-canvas-types";
export { useIsBelowBreakpoint } from "./use-is-below-breakpoint";
