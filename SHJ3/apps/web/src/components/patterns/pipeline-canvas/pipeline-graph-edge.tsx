"use client";

import * as React from "react";
import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from "@xyflow/react";
import { cn } from "@/lib/utils";
import type { PipelineEdgeKind } from "./pipeline-canvas-types";

/** The data every real xyflow edge of this custom type carries. */
export interface PipelineGraphEdgeData extends Record<string, unknown> {
  kind: PipelineEdgeKind;
  maxIterations: number | undefined;
  conditionSummary: string | undefined;
  isInvalid: boolean;
}

/**
 * The one custom edge type this canvas needs that `flow-canvas-graph.tsx` never did — a
 * `loop-back` edge gets real, distinct visual treatment (dashed, warning-colored, extra
 * curvature) PLUS an `EdgeLabelRenderer` badge (`↺ ×N` and, when set, a tooltipped condition
 * summary) — never rendered as a plain forward line, since a citizen-facing pipeline's loop
 * is a materially different execution behaviour than a sequential handoff and must look
 * different at a glance, not just on hover.
 */
export function PipelineGraphEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  markerEnd,
}: EdgeProps & { data?: PipelineGraphEdgeData }) {
  const isLoopBack = data?.kind === "loop-back";
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    // A loop-back edge usually runs "backwards" (target precedes source in reading order)
    // — a higher curvature keeps it visually legible rather than overlapping the forward
    // edges it crosses.
    curvature: isLoopBack ? 0.6 : 0.25,
  });

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        {...(markerEnd !== undefined ? { markerEnd } : {})}
        style={{
          stroke: data?.isInvalid
            ? "var(--destructive-strong)"
            : isLoopBack
              ? "var(--warning-strong)"
              : "var(--border-strong)",
          strokeWidth: isLoopBack ? 2 : 1.5,
          ...(isLoopBack ? { strokeDasharray: "6 4" } : {}),
        }}
      />
      {isLoopBack ? (
        <EdgeLabelRenderer>
          <div
            data-slot="pipeline-loop-back-badge"
            title={data?.conditionSummary ? `While ${data.conditionSummary}` : "Unconditional"}
            className={cn(
              "absolute text-2xs font-medium",
              "border border-warning-strong bg-warning-subtle text-warning-strong",
            )}
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              borderRadius: "var(--radius-sm)",
              padding: "1px var(--space-1)",
              pointerEvents: "all",
            }}
          >
            ↺ ×{data?.maxIterations ?? "?"}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}

export const PIPELINE_GRAPH_EDGE_TYPES = {
  pipeline: PipelineGraphEdge,
} as const;
