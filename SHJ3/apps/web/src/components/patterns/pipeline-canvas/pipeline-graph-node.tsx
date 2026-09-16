"use client";

import * as React from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icon";
import {
  PIPELINE_NODE_KIND_META,
  outgoingConnections,
  structuralConnections,
  type PipelineCanvasModel,
  type PipelineCanvasNode,
} from "./pipeline-canvas-types";

/** The data every real xyflow node carries — mirrors `FlowGraphNodeData`'s identical shape
 *  and identical reasoning (a plain data field, not context/closure, since xyflow renders
 *  every node through its own internal store subscription). */
export interface PipelineGraphNodeData extends Record<string, unknown> {
  node: PipelineCanvasNode;
  model: PipelineCanvasModel;
  dir: "ltr" | "rtl";
  tabIndex: 0 | -1;
  isSelected: boolean;
  isInvalid: boolean;
  invalidReason: string | undefined;
  onSelect: (id: string) => void;
  onActivate: (id: string) => void;
}

/**
 * One shared node renderer registered under all four real node-kind keys
 * (`pipeline-canvas-surface.tsx`'s `nodeTypes`) — differs only in `PIPELINE_NODE_KIND_META`'s
 * colour/glyph/badge, the same one-component-four-keys shape `FlowGraphNode` already
 * establishes. An invalid node (a blocking `analyzePipelineGraph` finding names it) renders
 * with a destructive border PLUS an `AlertTriangle`-shaped marker PLUS the problem stated in
 * its own `aria-label` — never colour alone (`docs/design-system.md`'s own rule, already
 * cited by this feature's design).
 */
export function PipelineGraphNode({ data }: NodeProps & { data: PipelineGraphNodeData }) {
  const { node, model, dir, tabIndex, isSelected, isInvalid, invalidReason, onSelect, onActivate } =
    data;
  const meta = PIPELINE_NODE_KIND_META[node.kind];
  const children = outgoingConnections(node.id, structuralConnections(model.edges));
  const targetSide = dir === "rtl" ? Position.Right : Position.Left;
  const sourceSide = dir === "rtl" ? Position.Left : Position.Right;
  const accessibleName = `${meta.badgeLabel}: ${node.title}${invalidReason ? `. ${invalidReason}` : ""}`;

  return (
    <div
      tabIndex={tabIndex}
      data-slot="pipeline-canvas-node"
      data-node-id={node.id}
      data-selected={isSelected ? "true" : undefined}
      data-invalid={isInvalid ? "true" : undefined}
      role="button"
      aria-label={accessibleName}
      style={{
        inlineSize: "var(--flow-node-inline-size, 220px)",
        borderColor: isInvalid ? "var(--destructive-strong)" : isSelected ? "var(--ring)" : "var(--border-strong)",
        borderWidth: isSelected || isInvalid ? 2 : 1,
        borderRadius: "var(--radius-md)",
        padding: "var(--space-3)",
        backgroundColor: "var(--card)",
      }}
      className={cn(
        "cursor-grab border",
        "outline-none focus-visible:[outline:var(--focus-ring-width)_solid_var(--ring)] focus-visible:[outline-offset:var(--focus-ring-offset)]",
      )}
      onFocus={() => onSelect(node.id)}
      onClick={() => {
        onSelect(node.id);
        onActivate(node.id);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          onActivate(node.id);
        }
      }}
    >
      {node.kind !== "start" ? <Handle type="target" position={targetSide} /> : null}
      <p
        className="flex items-center justify-between text-2xs font-medium tracking-wide uppercase"
        style={{ color: meta.colorToken, gap: "var(--space-1)" }}
      >
        <span className="flex items-center" style={{ gap: "var(--space-1)" }}>
          <Icon icon={meta.glyph} size={14} />
          <span>{meta.badgeLabel}</span>
        </span>
        {isInvalid ? <Icon icon={AlertTriangle} size={14} className="text-destructive-strong" /> : null}
      </p>
      <p dir="auto" className="mt-1 text-sm font-medium text-foreground">
        {node.title}
      </p>
      {node.agentName ? (
        <p dir="auto" className="mt-0.5 text-xs text-muted-foreground">
          {node.agentName}
        </p>
      ) : null}
      {children.length > 0 ? (
        <ul className="mt-2 list-none border-t border-border pt-1.5 text-2xs text-muted-foreground">
          {children.map((edge) => (
            <li key={edge.id}>
              → {model.nodes.find((n) => n.id === edge.targetId)?.title ?? edge.targetId}
            </li>
          ))}
        </ul>
      ) : null}
      {node.kind !== "response" ? <Handle type="source" position={sourceSide} /> : null}
    </div>
  );
}

export const PIPELINE_GRAPH_NODE_TYPES = {
  start: PipelineGraphNode,
  agent: PipelineGraphNode,
  supervisor: PipelineGraphNode,
  response: PipelineGraphNode,
} as const;
