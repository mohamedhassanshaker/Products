"use client";

import * as React from "react";
import { ReactFlowProvider, Panel } from "@xyflow/react";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/ui/empty-state";
import { useResolvedDir } from "@/components/ui/use-resolved-dir";
import type { PipelineCanvasModel } from "./pipeline-canvas-types";
import { PipelineCanvasSurface, fallbackPosition } from "./pipeline-canvas-surface";
import { PipelineAgentPalette, type PipelineAgentOption } from "./pipeline-agent-palette";
import { useIsBelowBreakpoint } from "../flow-canvas/use-is-below-breakpoint";

const MOBILE_BREAKPOINT_PX = 820;

export type PipelineCanvasVariant = "edit" | "readonly";
export type PipelineCanvasState = "default" | "loading" | "error";

export interface PipelineCanvasGraphProps {
  model: PipelineCanvasModel;
  variant?: PipelineCanvasVariant | undefined;
  state?: PipelineCanvasState | undefined;
  errorMessage?: string | undefined;
  selectedNodeId?: string | undefined;
  onSelectedNodeChange?: ((nodeId: string | undefined) => void) | undefined;
  onActivateNode?: ((nodeId: string) => void) | undefined;
  /** A blocking-or-advisory finding names this node — the message becomes the node's own
   *  `aria-label` suffix and its destructive border (`analyzePipelineGraph`'s own findings,
   *  mapped in by the route). */
  invalidNodeReasons?: ReadonlyMap<string, string> | undefined;
  invalidEdgeIds?: ReadonlySet<string> | undefined;
  onNodeMove?: ((nodeId: string, x: number, y: number) => Promise<boolean>) | undefined;
  onConnectNodes?: ((fromNodeId: string, toNodeId: string) => void) | undefined;
  onEdgeClick?: ((edgeId: string) => void) | undefined;
  agents?: readonly PipelineAgentOption[] | undefined;
  onAddAgent?: ((agentId: string, x: number, y: number) => void) | undefined;
  onAddTurnBoundAgent?: ((x: number, y: number) => void) | undefined;
  onAddResponse?: ((x: number, y: number) => void) | undefined;
  emptyHeadline?: string | undefined;
  emptyCause?: string | undefined;
  loadingMessage?: string | undefined;
  paletteHeading?: string | undefined;
  className?: string | undefined;
}

/**
 * The Pipeline Designer's real, interactive drag-and-drop canvas — `@xyflow/react`, forked
 * from (not extending) `FlowCanvasGraph`: that component's own topology helpers are DAG-only
 * (a looped pipeline's entry is, by definition, the target of a loop-back edge — the exact
 * shape that breaks them) and its node-type union is closed to five unrelated flow-node
 * kinds, both real blockers, not styling differences (see this feature's own design notes).
 *
 * Two-component split (this wrapper + `PipelineCanvasSurface`), required because
 * `useReactFlow().screenToFlowPosition` — what a real drag-from-palette drop needs to place
 * a node at the exact cursor position, accounting for pane bounds/pan/zoom in one call — is
 * only reachable INSIDE `<ReactFlowProvider>`, which this component itself renders.
 */
export function PipelineCanvasGraph({
  model,
  variant = "edit",
  state = "default",
  errorMessage,
  selectedNodeId,
  onSelectedNodeChange,
  onActivateNode,
  invalidNodeReasons,
  invalidEdgeIds,
  onNodeMove,
  onConnectNodes,
  onEdgeClick,
  agents = [],
  onAddAgent,
  onAddTurnBoundAgent,
  onAddResponse,
  emptyHeadline = "This pipeline is empty",
  emptyCause = "Add a node from the palette to start wiring the graph.",
  loadingMessage = "Loading pipeline…",
  paletteHeading = "Add node",
  className,
}: PipelineCanvasGraphProps): React.ReactElement {
  const dir = useResolvedDir();
  const isMobile = useIsBelowBreakpoint(MOBILE_BREAKPOINT_PX);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const readonly = variant === "readonly";
  const canAddNodes = Boolean(onAddAgent && onAddTurnBoundAgent && onAddResponse) && !readonly;

  const handleSelect = React.useCallback(
    (id: string) => onSelectedNodeChange?.(id),
    [onSelectedNodeChange],
  );
  const handleActivate = React.useCallback(
    (id: string) => onActivateNode?.(id),
    [onActivateNode],
  );

  const handleDropPayload = React.useCallback(
    (payload: string, x: number, y: number) => {
      if (payload === "__turn_bound__") onAddTurnBoundAgent?.(x, y);
      else if (payload === "__response__") onAddResponse?.(x, y);
      else onAddAgent?.(payload, x, y);
    },
    [onAddAgent, onAddTurnBoundAgent, onAddResponse],
  );

  if (state === "loading") {
    return (
      <div
        data-slot="pipeline-canvas"
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
        data-slot="pipeline-canvas"
        data-state="error"
        role="alert"
        className={cn(
          "border border-destructive bg-card p-8 text-center text-sm text-destructive-strong",
          className,
        )}
        style={{ borderRadius: "var(--radius-lg)" }}
      >
        {errorMessage ?? "The pipeline could not be loaded."}
      </div>
    );
  }

  if (model.nodes.length === 0) {
    return (
      <div
        data-slot="pipeline-canvas"
        data-state="empty"
        className={cn("flex flex-col items-center", className)}
        style={{ gap: "var(--space-3)" }}
      >
        <EmptyState variant="first-run" headline={emptyHeadline} cause={emptyCause} />
        {canAddNodes ? (
          <PipelineAgentPalette
            agents={agents}
            onAddAgent={(agentId) => {
              const { x, y } = fallbackPosition(model.nodes.length);
              onAddAgent?.(agentId, x, y);
            }}
            onAddTurnBoundAgent={() => {
              const { x, y } = fallbackPosition(model.nodes.length);
              onAddTurnBoundAgent?.(x, y);
            }}
            onAddResponse={() => {
              const { x, y } = fallbackPosition(model.nodes.length);
              onAddResponse?.(x, y);
            }}
            isBelowBreakpoint={isMobile}
            heading={paletteHeading}
          />
        ) : null}
      </div>
    );
  }

  const invalidNodeIds = invalidNodeReasons ?? new Map<string, string>();

  return (
    <div
      data-slot="pipeline-canvas"
      data-variant={variant}
      className={cn("flex flex-col", className)}
      style={{ gap: "var(--space-3)" }}
    >
      <ReactFlowProvider>
        <PipelineCanvasSurface
          model={model}
          dir={dir}
          selectedNodeId={selectedNodeId}
          invalidNodeIds={invalidNodeIds}
          invalidEdgeIds={invalidEdgeIds ?? new Set()}
          readonly={readonly}
          onSelectNode={handleSelect}
          onActivateNode={handleActivate}
          onNodeMove={onNodeMove}
          onConnectNodes={onConnectNodes}
          onEdgeClick={onEdgeClick}
          onDropPayload={canAddNodes ? handleDropPayload : undefined}
          containerRef={containerRef}
          paletteSlot={
            canAddNodes ? (
              <Panel position={dir === "rtl" ? "top-right" : "top-left"}>
                <PipelineAgentPalette
                  agents={agents}
                  onAddAgent={(agentId) => {
                    const { x, y } = fallbackPosition(model.nodes.length);
                    onAddAgent?.(agentId, x, y);
                  }}
                  onAddTurnBoundAgent={() => {
                    const { x, y } = fallbackPosition(model.nodes.length);
                    onAddTurnBoundAgent?.(x, y);
                  }}
                  onAddResponse={() => {
                    const { x, y } = fallbackPosition(model.nodes.length);
                    onAddResponse?.(x, y);
                  }}
                  isBelowBreakpoint={isMobile}
                  heading={paletteHeading}
                />
              </Panel>
            ) : undefined
          }
        />
      </ReactFlowProvider>
    </div>
  );
}
