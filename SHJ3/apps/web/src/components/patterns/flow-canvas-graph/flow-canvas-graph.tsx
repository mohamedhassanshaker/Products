"use client";

import * as React from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  Panel,
  MarkerType,
  applyNodeChanges,
  type Node,
  type Edge,
  type NodeChange,
  type OnConnect,
  type OnNodeDrag,
} from "@xyflow/react";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icon";
import { ToggleRow } from "@/components/ui/toggle-row";
import { EmptyState } from "@/components/ui/empty-state";
import { useResolvedDir } from "@/components/ui/use-resolved-dir";
import {
  FLOW_NODE_TYPE_META,
  indexFlowNodesById,
  type FlowConnection,
  type FlowModel,
  type FlowNodeType,
} from "../flow-canvas/flow-canvas-types";
import { FlowCanvasOutlineView } from "../flow-canvas/flow-canvas-outline-view";
import {
  NodeInspector,
  emptyNodeInspectorValue,
  type NodeInspectorFormValue,
} from "../flow-canvas/node-inspector";
import {
  FlowCanvasMobileSheet,
  type FlowCanvasMobileSheetProps,
} from "../flow-canvas/flow-canvas-mobile-sheet";
import { useIsBelowBreakpoint } from "../flow-canvas/use-is-below-breakpoint";
import { FLOW_GRAPH_NODE_TYPES, type FlowGraphNodeData } from "./flow-graph-node";
import { useTopologicalKeyboardNav } from "./use-topological-keyboard-nav";

const MOBILE_BREAKPOINT_PX = 820;
const PALETTE_COLUMNS = 4;

/**
 * The five node-type buttons, shared between the palette `<Panel>` (rendered once
 * `@xyflow/react` has real nodes to draw) and the zero-node empty state below — a flow with
 * no nodes yet must still be able to create its first one. Extracted rather than duplicated
 * so the two can never silently drift on which types are offered.
 */
function FlowCanvasPaletteButtons({
  onRequestCreateNode,
}: {
  onRequestCreateNode: (type: FlowNodeType) => void;
}): React.ReactElement {
  return (
    <>
      {Object.entries(FLOW_NODE_TYPE_META).map(([type, meta]) => (
        <button
          key={type}
          type="button"
          onClick={() => onRequestCreateNode(type as FlowNodeType)}
          className={cn(
            "flex items-center rounded text-xs font-medium hover:bg-muted",
            "outline-none focus-visible:[outline:var(--focus-ring-width)_solid_var(--ring)] focus-visible:[outline-offset:var(--focus-ring-offset)]",
          )}
          style={{ color: meta.colorToken, gap: "var(--space-1)", padding: "var(--space-1)" }}
        >
          <Icon icon={meta.glyph} size={14} />
          <span>{meta.badgeLabel}</span>
        </button>
      ))}
    </>
  );
}

/** A deterministic fallback position for a node with no real persisted `x`/`y` (a fixture never wired to real `canvasX`/`canvasY`) — the same 4-column, 240×160 spacing `flows-step.tsx`'s own `nextGridPosition` uses for a freshly created node, so a node this canvas has never positioned lands exactly where the old grid canvas would have placed it. */
function fallbackPosition(index: number): { x: number; y: number } {
  return { x: (index % PALETTE_COLUMNS) * 240, y: Math.floor(index / PALETTE_COLUMNS) * 160 };
}

function positionOf(model: FlowModel, nodeId: string): { x: number; y: number } {
  const index = model.nodes.findIndex((n) => n.id === nodeId);
  const node = model.nodes[index];
  if (!node) return { x: 0, y: 0 };
  return node.x !== undefined && node.y !== undefined ? { x: node.x, y: node.y } : fallbackPosition(index);
}

function buildRfNodes(
  model: FlowModel,
  dir: "ltr" | "rtl",
  selectedNodeId: string | undefined,
  highlighted: ReadonlySet<string>,
  onSelect: (id: string) => void,
  onActivate: ((id: string) => void) | undefined,
): Node<FlowGraphNodeData>[] {
  const focusFallback = model.nodes[0]?.id;
  return model.nodes.map((node, index) => ({
    id: node.id,
    type: node.type,
    position: positionOf(model, node.id) ?? fallbackPosition(index),
    data: {
      node,
      model,
      dir,
      tabIndex: node.id === (selectedNodeId ?? focusFallback) ? 0 : -1,
      isSelected: node.id === selectedNodeId,
      isHighlighted: highlighted.has(node.id),
      onActivate,
      onSelect,
    },
    draggable: true,
  }));
}

function buildRfEdges(connections: readonly FlowConnection[], interactive: boolean): Edge[] {
  return connections.map((connection) => ({
    id: connection.id,
    source: connection.sourceId,
    target: connection.targetId,
    ...(connection.branchLabel !== undefined ? { label: connection.branchLabel } : {}),
    // Conditional spread, not `style: … ? {…} : undefined` — `exactOptionalPropertyTypes`
    // rejects an explicit `undefined` against `style?: CSSProperties`.
    ...(connection.isDefaultBranch ? { style: { strokeDasharray: "4 3" } } : {}),
    ...(interactive ? { className: "cursor-pointer" } : {}),
    markerEnd: { type: MarkerType.ArrowClosed },
  }));
}

export type FlowCanvasVariant = "edit" | "readonly" | "trace-overlay";
export type FlowCanvasState = "default" | "loading" | "error";
export type FlowCanvasView = "canvas" | "outline";

export interface FlowCanvasProps {
  model: FlowModel;
  variant?: FlowCanvasVariant;
  state?: FlowCanvasState;
  errorMessage?: string;
  selectedNodeId?: string;
  onSelectedNodeChange?: (nodeId: string | undefined) => void;
  initialValueByNodeId?: Partial<Record<string, NodeInspectorFormValue>>;
  onSaveNode?: (nodeId: string, value: NodeInspectorFormValue) => void;
  savingNodeId?: string;
  /** See `flow-canvas/flow-canvas.tsx`'s identical prop for the full reasoning — omitted, this canvas falls back to its own built-in `NodeInspector`. First real consumer: `flows-step.tsx`, which always supplies this. */
  onActivateNode?: (nodeId: string) => void;
  /**
   * A real drag finished on node `nodeId` at persisted-space coordinates
   * `x`/`y` — the caller commits it (`updateFlowNodeAction`'s existing
   * partial `{id, flowVersionId, canvasX, canvasY}` update) and resolves
   * `true` on success. Resolving `false` (or the promise rejecting) reverts
   * the node's visual position back to `model`'s own value, since nothing was
   * actually persisted. Omitted (e.g. `readonly`) disables drag entirely.
   */
  onNodeMove?: (nodeId: string, x: number, y: number) => Promise<boolean>;
  /** A drag-to-connect completed between two real nodes — the caller opens its own real `EdgeFormDialog` pre-filled with these ids. Omitted disables the connect interaction. */
  onConnectNodes?: (fromNodeId: string, toNodeId: string) => void;
  /** A real edge on the canvas was clicked — the caller opens its own real `EdgeFormDialog` pre-filled with this edge's id for edit/delete. Omitted disables the interaction (edges render as plain, non-interactive lines, e.g. `readonly`/`trace-overlay`). */
  onEdgeClick?: (edgeId: string) => void;
  /** The node-creation palette (`<Panel>`) — a caller supplies this to open its own real `NodeFormDialog` pre-selecting `type`. Omitted hides the palette (e.g. `readonly`/`trace-overlay`, where creating a node makes no sense). */
  onRequestCreateNode?: (type: FlowNodeType) => void;
  /**
   * Lifts this canvas's Canvas/Outline toggle to the caller — omitted, the toggle stays
   * fully internal (every existing consumer's original behavior, unchanged). Supplied
   * together, the caller drives which view is active and can react to it (`flows-step.tsx`
   * uses this to know when to show its own Outline-only Connections table/selected-node
   * bar) — the same controlled/uncontrolled dual pattern `Checkbox`'s own doc comment
   * already establishes for "mirror into local state, prefer the controlled value when
   * supplied."
   */
  view?: FlowCanvasView;
  onViewChange?: (view: FlowCanvasView) => void;
  emptyHeadline?: string;
  emptyCause?: string;
  highlightedNodeIds?: readonly string[];
  renderMobileSheet?: (props: FlowCanvasMobileSheetProps) => React.ReactNode;
  loadingMessage?: string;
  viewToggleLabel?: string;
  canvasViewLabel?: string;
  outlineViewLabel?: string;
  paletteHeading?: string;
  "aria-label"?: string;
  className?: string;
}

/**
 * B7's flow designer canvas (design-system.md §5.5 #45), now a real
 * interactive graphical canvas on `@xyflow/react` — drag-to-reposition,
 * drag-to-connect, pan and zoom — replacing the original static CSS-Grid +
 * plain-SVG-line renderer (`flow-canvas/flow-canvas.tsx`, retired once both
 * real entry points moved to this component; see that file's own git
 * history). The product owner's own request, verbatim: an interactive draw
 * canvas "like reactflow" for authoring an agent's conversation flow.
 *
 * Still ships the two mandatory synchronized representations (§10.4): this
 * canvas and `FlowCanvasOutlineView` render from the same `model` prop. R3's
 * free-text escape path (`hasFreeTextEscapePath`) is no longer enforced as an
 * always-visible banner here — the product owner asked for the canvas
 * decluttered, so that check moved to publish time instead
 * (`checkFlowReadiness`, checked for every bound flow before
 * `publishAgentVersionAction` publishes the agent version itself —
 * `agents/actions.ts`), surfaced only when it actually blocks a publish attempt.
 */
export function FlowCanvasGraph({
  model,
  variant = "edit",
  state = "default",
  errorMessage,
  selectedNodeId,
  onSelectedNodeChange,
  initialValueByNodeId,
  onSaveNode,
  savingNodeId,
  onActivateNode,
  onNodeMove,
  onConnectNodes,
  onEdgeClick,
  onRequestCreateNode,
  view: controlledView,
  onViewChange,
  emptyHeadline = "This flow is empty",
  emptyCause = "Add a node from the palette to start building the conversation flow.",
  highlightedNodeIds,
  renderMobileSheet,
  loadingMessage = "Loading flow…",
  viewToggleLabel = "Flow display mode",
  canvasViewLabel = "Canvas view",
  outlineViewLabel = "Outline view",
  paletteHeading = "Add node",
  "aria-label": ariaLabel = "Conversation flow",
  className,
}: FlowCanvasProps): React.ReactElement {
  const dir = useResolvedDir();
  const isMobile = useIsBelowBreakpoint(MOBILE_BREAKPOINT_PX);
  const [internalView, setInternalView] = React.useState<FlowCanvasView>("canvas");
  const view = controlledView ?? internalView;
  const setView = React.useCallback(
    (next: FlowCanvasView) => {
      setInternalView(next);
      onViewChange?.(next);
    },
    [onViewChange],
  );
  const [inspectorNodeId, setInspectorNodeId] = React.useState<string | undefined>(undefined);
  const [draftByNodeId, setDraftByNodeId] = React.useState<Record<string, NodeInspectorFormValue>>(
    {},
  );
  const [dirtyNodeIds, setDirtyNodeIds] = React.useState<ReadonlySet<string>>(new Set());
  const lastFocusedNodeRef = React.useRef<string | undefined>(undefined);
  const inspectorHeadingRef = React.useRef<HTMLHeadingElement>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);

  const nodesById = React.useMemo(() => indexFlowNodesById(model.nodes), [model.nodes]);
  const highlighted = React.useMemo(() => new Set(highlightedNodeIds ?? []), [highlightedNodeIds]);
  const readonly = variant === "readonly";

  const handleFocusNode = React.useCallback(
    (id: string) => {
      lastFocusedNodeRef.current = id;
      onSelectedNodeChange?.(id);
    },
    [onSelectedNodeChange],
  );

  const openInspector = React.useCallback((id: string) => {
    setInspectorNodeId(id);
  }, []);

  // See `onActivateNode`'s own doc comment above — falls back to this canvas's own built-in
  // inspector when no override is supplied, exactly preserving the retired canvas's behaviour.
  const activateNode = readonly ? undefined : (onActivateNode ?? openInspector);

  const closeInspector = React.useCallback(() => {
    setInspectorNodeId(undefined);
    const returnTo = lastFocusedNodeRef.current;
    if (returnTo) {
      const el = containerRef.current?.querySelector<HTMLElement>(
        `[data-node-id="${CSS.escape(returnTo)}"]`,
      );
      el?.focus();
    }
  }, []);

  React.useEffect(() => {
    if (inspectorNodeId !== undefined && !isMobile) {
      inspectorHeadingRef.current?.focus();
    }
  }, [inspectorNodeId, isMobile]);

  const [rfNodes, setRfNodes] = React.useState<Node<FlowGraphNodeData>[]>(() =>
    buildRfNodes(model, dir, selectedNodeId, highlighted, handleFocusNode, activateNode),
  );

  // Rebuilds every real node's position/data from `model` whenever the model itself, the
  // resolved direction, selection or highlight set changes. A real, accepted trade-off: an
  // in-progress drag (mouse still held) that happens to overlap one of these updates gets
  // visually reset to the last-committed position rather than preserved — nothing is lost
  // since nothing was persisted yet, and the user simply repeats the drag gesture.
  React.useEffect(() => {
    setRfNodes(buildRfNodes(model, dir, selectedNodeId, highlighted, handleFocusNode, activateNode));
  }, [model, dir, selectedNodeId, highlighted, handleFocusNode, activateNode]);

  const rfEdges = React.useMemo(
    () => buildRfEdges(model.connections, Boolean(onEdgeClick) && !readonly),
    [model.connections, onEdgeClick, readonly],
  );

  const handleNodesChange = React.useCallback((changes: NodeChange<Node<FlowGraphNodeData>>[]) => {
    setRfNodes((nds) => applyNodeChanges(changes, nds));
  }, []);

  const handleNodeDragStop = React.useCallback(
    // Rest-collected, not `(event, node) =>` — the drag-stop event itself is never used, and
    // this project's lint config has no underscore-prefix escape for an unused parameter
    // (eslint.config.mjs: "delete dead code rather than rename it out of the way"), so a
    // positional `node` (the second, `OnNodeDrag` callback argument) is reached via `args[1]`
    // instead of a named-but-unused first parameter.
    (...args: Parameters<OnNodeDrag<Node<FlowGraphNodeData>>>) => {
      const node = args[1];
      if (!onNodeMove) return;
      const x = Math.round(node.position.x);
      const y = Math.round(node.position.y);
      void onNodeMove(node.id, x, y).then((ok) => {
        if (ok) return;
        const fallback = positionOf(model, node.id);
        setRfNodes((nds) =>
          nds.map((n) => (n.id === node.id ? { ...n, position: fallback } : n)),
        );
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
    // Rest-collected — the click event itself is never used, matching
    // `handleNodeDragStop`'s own established reasoning for this exact shape.
    (...args: Parameters<NonNullable<React.ComponentProps<typeof ReactFlow>["onEdgeClick"]>>) => {
      const edge = args[1];
      onEdgeClick?.(edge.id);
    },
    [onEdgeClick],
  );

  const { handleKeyDown: handleTopologicalKeyDown } = useTopologicalKeyboardNav(
    containerRef,
    model,
    dir,
  );

  const inspectorNode = inspectorNodeId ? nodesById.get(inspectorNodeId) : undefined;
  const inspectorValue: NodeInspectorFormValue | undefined = inspectorNode
    ? (draftByNodeId[inspectorNode.id] ??
      initialValueByNodeId?.[inspectorNode.id] ??
      emptyNodeInspectorValue(inspectorNode.type))
    : undefined;

  const handleInspectorChange = React.useCallback((id: string, value: NodeInspectorFormValue) => {
    setDraftByNodeId((prev) => ({ ...prev, [id]: value }));
    setDirtyNodeIds((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
  }, []);

  const handleInspectorSave = React.useCallback(() => {
    if (!inspectorNode || !inspectorValue) return;
    onSaveNode?.(inspectorNode.id, inspectorValue);
  }, [inspectorNode, inspectorValue, onSaveNode]);

  const inspectorPanel =
    inspectorNode && inspectorValue ? (
      <NodeInspector
        node={inspectorNode}
        value={inspectorValue}
        onChange={(value) => handleInspectorChange(inspectorNode.id, value)}
        onSave={handleInspectorSave}
        onClose={closeInspector}
        dirty={dirtyNodeIds.has(inspectorNode.id)}
        saving={savingNodeId === inspectorNode.id}
        headingRef={inspectorHeadingRef}
      />
    ) : null;

  if (state === "loading") {
    return (
      <div
        data-slot="flow-canvas"
        data-state="loading"
        aria-busy="true"
        className={cn(
          "border border-border bg-card p-8 text-center text-sm text-muted-foreground",
          className,
        )}
        style={{ borderRadius: "var(--radius-lg)" }}
      >
        {loadingMessage}
      </div>
    );
  }

  if (state === "error") {
    return (
      <div
        data-slot="flow-canvas"
        data-state="error"
        role="alert"
        className={cn(
          "border border-destructive bg-card p-8 text-center text-sm text-destructive-strong",
          className,
        )}
        style={{ borderRadius: "var(--radius-lg)" }}
      >
        {errorMessage ?? "The flow could not be loaded."}
      </div>
    );
  }

  if (model.nodes.length === 0) {
    return (
      <div
        data-slot="flow-canvas"
        data-state="empty"
        className={cn("flex flex-col items-center", className)}
        style={{ gap: "var(--space-3)" }}
      >
        <EmptyState variant="first-run" headline={emptyHeadline} cause={emptyCause} />
        {onRequestCreateNode && !readonly ? (
          <div
            data-slot="flow-canvas-palette"
            className="flex flex-wrap items-center justify-center border border-border bg-card"
            style={{ borderRadius: "var(--radius-md)", padding: "var(--space-2)", gap: "var(--space-2)" }}
          >
            <FlowCanvasPaletteButtons onRequestCreateNode={onRequestCreateNode} />
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div
      data-slot="flow-canvas"
      data-variant={variant}
      className={cn("flex flex-col", className)}
      style={{ gap: "var(--space-3)" }}
    >
      <ToggleRow
        aria-label={viewToggleLabel}
        value={view}
        onValueChange={(next) => setView(next as FlowCanvasView)}
        options={[
          { value: "canvas", label: canvasViewLabel },
          { value: "outline", label: outlineViewLabel },
        ]}
      />

      {view === "outline" ? (
        <FlowCanvasOutlineView
          model={model}
          onSelectNode={(id) => {
            handleFocusNode(id);
            setView("canvas");
          }}
        />
      ) : (
        <div className="flex flex-col gap-3 md:flex-row">
          {/* `role="application"` per design-system.md §5.5 #45. */}
          <div
            ref={containerRef}
            role="application"
            aria-label={ariaLabel}
            onKeyDownCapture={handleTopologicalKeyDown}
            className="flex-1 overflow-hidden border border-border"
            style={{
              blockSize: "var(--flow-canvas-graph-block-size)",
              borderRadius: "var(--radius-lg)",
              backgroundColor: "var(--muted)",
            }}
          >
            <ReactFlowProvider>
              <ReactFlow
                nodes={rfNodes}
                edges={rfEdges}
                nodeTypes={FLOW_GRAPH_NODE_TYPES}
                // Conditional spread, not `onNodesChange={readonly ? undefined : …}` —
                // `exactOptionalPropertyTypes` rejects an explicit `undefined` against an
                // optional prop typed without `| undefined` (the retired canvas's own
                // `flow-canvas.tsx` established this exact pattern for the same reason).
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
                {onRequestCreateNode && !readonly ? (
                  <Panel position={dir === "rtl" ? "top-right" : "top-left"}>
                    <div
                      data-slot="flow-canvas-palette"
                      className="flex flex-col border border-border bg-card"
                      style={{ borderRadius: "var(--radius-md)", padding: "var(--space-2)", gap: "var(--space-1)" }}
                    >
                      <span className="text-2xs font-medium tracking-wide text-muted-foreground uppercase">
                        {paletteHeading}
                      </span>
                      <FlowCanvasPaletteButtons onRequestCreateNode={onRequestCreateNode} />
                    </div>
                  </Panel>
                ) : null}
              </ReactFlow>
            </ReactFlowProvider>
          </div>
          {!isMobile && inspectorPanel ? (
            <div className="w-full" style={{ maxWidth: "24rem" }}>
              {inspectorPanel}
            </div>
          ) : null}
        </div>
      )}

      {isMobile
        ? (
            renderMobileSheet ??
            ((props: FlowCanvasMobileSheetProps) => <FlowCanvasMobileSheet {...props} />)
          )({
            open: inspectorNode !== undefined,
            onOpenChange: (open) => {
              if (!open) closeInspector();
            },
            titleText: inspectorNode ? inspectorNode.title : "",
            children: inspectorPanel,
          })
        : null}
    </div>
  );
}

export { FlowCanvasGraph as FlowCanvas };
