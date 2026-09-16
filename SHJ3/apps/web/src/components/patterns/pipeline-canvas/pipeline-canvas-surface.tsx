"use client";

import * as React from "react";
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  applyNodeChanges,
  useReactFlow,
  type Node,
  type Edge,
  type NodeChange,
  type OnConnect,
  type OnNodeDrag,
} from "@xyflow/react";
import type { PipelineCanvasEdge, PipelineCanvasModel } from "./pipeline-canvas-types";
import { PIPELINE_GRAPH_NODE_TYPES, type PipelineGraphNodeData } from "./pipeline-graph-node";
import { PIPELINE_GRAPH_EDGE_TYPES, type PipelineGraphEdgeData } from "./pipeline-graph-edge";

/** The custom MIME type a palette button's drag payload carries (`agentId`, or the literal
 *  `"__turn_bound__"`/`"__response__"` sentinel for the two agent-less node kinds the
 *  palette also offers) — namespaced so a stray OS file/text drag onto the canvas is
 *  silently ignored rather than creating a bogus node (this feature's own drag-and-drop
 *  design decision, `pipeline-agent-palette.tsx`'s own doc comment). */
export const PIPELINE_AGENT_DRAG_MIME = "application/x-shj3-pipeline-agent";

/** A deterministic, non-overlapping grid position for the `index`-th node — used both as
 *  the render-time fallback for a node with no real persisted position (fixture/test data
 *  only; every real, DB-backed node always has a concrete, non-null `canvasX`/`canvasY`)
 *  AND, exported below, as the real position a newly click-added node is created at
 *  (`PipelineCanvasGraph`'s own palette). Every node sharing one hardcoded position (e.g.
 *  `(0, 0)`) is a real bug, not a cosmetic one: `@xyflow/react`'s `fitView` computes its
 *  zoom/pan from the nodes' bounding box, and a box with zero width/height (every node at
 *  the same point) renders the canvas as visually empty even though the data is real. */
export function fallbackPosition(index: number): { x: number; y: number } {
  return { x: (index % 4) * 240, y: Math.floor(index / 4) * 160 };
}

function positionOf(model: PipelineCanvasModel, nodeId: string): { x: number; y: number } {
  const index = model.nodes.findIndex((n) => n.id === nodeId);
  const node = model.nodes[index];
  if (!node) return { x: 0, y: 0 };
  return node.x !== undefined && node.y !== undefined ? { x: node.x, y: node.y } : fallbackPosition(index);
}

function buildRfNodes(
  model: PipelineCanvasModel,
  dir: "ltr" | "rtl",
  selectedNodeId: string | undefined,
  invalidNodeIds: ReadonlyMap<string, string>,
  onSelect: (id: string) => void,
  onActivate: (id: string) => void,
): Node<PipelineGraphNodeData>[] {
  return model.nodes.map((node, index) => ({
    id: node.id,
    type: node.kind,
    position: positionOf(model, node.id) ?? fallbackPosition(index),
    data: {
      node,
      model,
      dir,
      tabIndex: node.id === (selectedNodeId ?? model.nodes[0]?.id) ? 0 : -1,
      isSelected: node.id === selectedNodeId,
      isInvalid: invalidNodeIds.has(node.id),
      invalidReason: invalidNodeIds.get(node.id),
      onSelect,
      onActivate,
    },
    draggable: true,
  }));
}

function buildRfEdges(
  edges: readonly PipelineCanvasEdge[],
  invalidEdgeIds: ReadonlySet<string>,
  interactive: boolean,
): Edge<PipelineGraphEdgeData>[] {
  return edges.map((edge) => ({
    id: edge.id,
    source: edge.sourceId,
    target: edge.targetId,
    type: "pipeline",
    data: {
      kind: edge.kind,
      maxIterations: edge.maxIterations,
      conditionSummary: edge.conditionSummary,
      isInvalid: invalidEdgeIds.has(edge.id),
    },
    ...(edge.label !== undefined ? { label: edge.label } : {}),
    ...(interactive ? { className: "cursor-pointer" } : {}),
    markerEnd: { type: MarkerType.ArrowClosed },
  }));
}

export interface PipelineCanvasSurfaceProps {
  model: PipelineCanvasModel;
  dir: "ltr" | "rtl";
  selectedNodeId: string | undefined;
  invalidNodeIds: ReadonlyMap<string, string>;
  invalidEdgeIds: ReadonlySet<string>;
  readonly: boolean;
  onSelectNode: (id: string) => void;
  onActivateNode: (id: string) => void;
  onNodeMove?: ((nodeId: string, x: number, y: number) => Promise<boolean>) | undefined;
  onConnectNodes?: ((fromNodeId: string, toNodeId: string) => void) | undefined;
  onEdgeClick?: ((edgeId: string) => void) | undefined;
  /** A drag-from-palette drop finished at the given viewport coordinates — the caller
   *  (`PipelineCanvasGraph`) resolves the payload into a real `onAddAgent(agentId, x, y)`
   *  call. `screenToFlowPosition` (only reachable INSIDE the `<ReactFlowProvider>`, the
   *  whole reason this surface is a separate component from the public `PipelineCanvasGraph`
   *  wrapper) already accounts for pane bounds, pan and zoom in one call. */
  onDropPayload?: ((payload: string, x: number, y: number) => void) | undefined;
  containerRef: React.RefObject<HTMLDivElement | null>;
  paletteSlot?: React.ReactNode | undefined;
}

/** Inside `<ReactFlowProvider>` — owns `onDrop`/`onDragOver` and `useReactFlow().
 *  screenToFlowPosition`, neither reachable from `PipelineCanvasGraph` itself (the same
 *  provider-scoping constraint this module's own design decision already names). */
export function PipelineCanvasSurface({
  model,
  dir,
  selectedNodeId,
  invalidNodeIds,
  invalidEdgeIds,
  readonly,
  onSelectNode,
  onActivateNode,
  onNodeMove,
  onConnectNodes,
  onEdgeClick,
  onDropPayload,
  containerRef,
  paletteSlot,
}: PipelineCanvasSurfaceProps): React.ReactElement {
  const { screenToFlowPosition } = useReactFlow();
  const [rfNodes, setRfNodes] = React.useState<Node<PipelineGraphNodeData>[]>(() =>
    buildRfNodes(model, dir, selectedNodeId, invalidNodeIds, onSelectNode, onActivateNode),
  );

  React.useEffect(() => {
    setRfNodes(
      buildRfNodes(model, dir, selectedNodeId, invalidNodeIds, onSelectNode, onActivateNode),
    );
  }, [model, dir, selectedNodeId, invalidNodeIds, onSelectNode, onActivateNode]);

  const rfEdges = React.useMemo(
    () => buildRfEdges(model.edges, invalidEdgeIds, Boolean(onEdgeClick) && !readonly),
    [model.edges, invalidEdgeIds, onEdgeClick, readonly],
  );

  const handleNodesChange = React.useCallback(
    (changes: NodeChange<Node<PipelineGraphNodeData>>[]) => {
      setRfNodes((nds) => applyNodeChanges(changes, nds));
    },
    [],
  );

  const handleNodeDragStop = React.useCallback(
    (...args: Parameters<OnNodeDrag<Node<PipelineGraphNodeData>>>) => {
      const node = args[1];
      if (!onNodeMove) return;
      const x = Math.round(node.position.x);
      const y = Math.round(node.position.y);
      void onNodeMove(node.id, x, y).then((ok) => {
        if (ok) return;
        const fallback = positionOf(model, node.id);
        setRfNodes((nds) => nds.map((n) => (n.id === node.id ? { ...n, position: fallback } : n)));
      });
    },
    [model, onNodeMove],
  );

  const handleConnect: OnConnect = React.useCallback(
    (connection) => {
      if (!onConnectNodes || !connection.source || !connection.target) return;
      onConnectNodes(connection.source, connection.target);
    },
    [onConnectNodes],
  );

  const handleEdgeClick = React.useCallback(
    (...args: Parameters<NonNullable<React.ComponentProps<typeof ReactFlow>["onEdgeClick"]>>) => {
      const edge = args[1];
      onEdgeClick?.(edge.id);
    },
    [onEdgeClick],
  );

  const handleDragOver = React.useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (!onDropPayload) return;
      if (!event.dataTransfer.types.includes(PIPELINE_AGENT_DRAG_MIME)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    },
    [onDropPayload],
  );

  const handleDrop = React.useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (!onDropPayload) return;
      const payload = event.dataTransfer.getData(PIPELINE_AGENT_DRAG_MIME);
      if (!payload) return;
      event.preventDefault();
      const { x, y } = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      onDropPayload(payload, x, y);
    },
    [onDropPayload, screenToFlowPosition],
  );

  return (
    <div
      ref={containerRef}
      role="application"
      aria-label="Pipeline graph"
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      // No `flex-1` here: unlike `FlowCanvasGraph`'s equivalent container (which sits inside
      // an `md:flex-row` wrapper, so `flex-1` only governs width and `blockSize` governs the
      // cross axis), this container is the sole child of `PipelineCanvasGraph`'s `flex-col`
      // wrapper. `flex-1` there sets `flex-basis: 0%` on the main (vertical) axis, which wins
      // over the `blockSize` style below and collapses the canvas to 0px regardless of the
      // CSS variable's value — confirmed live: computed height was exactly 2px (just the
      // borders). Dropping `flex-1` lets `blockSize` resolve as the flex item's `auto` basis.
      className="overflow-hidden border border-border"
      style={{
        blockSize: "var(--flow-canvas-graph-block-size, 32rem)",
        borderRadius: "var(--radius-lg)",
        backgroundColor: "var(--muted)",
      }}
    >
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={PIPELINE_GRAPH_NODE_TYPES}
        edgeTypes={PIPELINE_GRAPH_EDGE_TYPES}
        {...(readonly
          ? {}
          : {
              onNodesChange: handleNodesChange,
              onNodeDragStop: handleNodeDragStop,
              onConnect: handleConnect,
            })}
        {...(!readonly && onEdgeClick ? { onEdgeClick: handleEdgeClick } : {})}
        edgesFocusable={!readonly && Boolean(onEdgeClick)}
        nodesDraggable={!readonly}
        nodesConnectable={!readonly}
        elementsSelectable
        proOptions={{ hideAttribution: true }}
        fitView
        minZoom={0.25}
        maxZoom={2}
      >
        <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
        <Controls position={dir === "rtl" ? "bottom-left" : "bottom-right"} showInteractive={false} />
        {paletteSlot}
      </ReactFlow>
    </div>
  );
}

