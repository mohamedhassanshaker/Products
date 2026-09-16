import * as React from "react";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icon";
import { InlineAlert } from "@/components/ui/inline-alert";
import {
  PIPELINE_NODE_KIND_META,
  computePipelineOrder,
  incomingConnections,
  indexPipelineNodesById,
  loopBackEdgesFrom,
  outgoingConnections,
  structuralConnections,
  type PipelineCanvasModel,
} from "./pipeline-canvas-types";

export interface PipelineCanvasOutlineViewProps {
  model: PipelineCanvasModel;
  onSelectNode?: (nodeId: string) => void;
  headingText?: string;
  selectRowLabel?: (title: string) => string;
  openButtonText?: string;
  orphanHeadingText?: string;
  className?: string;
}

function defaultSelectRowLabel(title: string): string {
  return `Open ${title} in the pipeline`;
}

/**
 * The mandatory second representation for `PipelineCanvasGraph` — same conformance
 * reasoning as `FlowCanvasOutlineView`, extended with the one relationship a flat list
 * would otherwise hide entirely: an explicit "Loops back to X (max N, while <condition>)"
 * line per node with an outgoing loop-back edge, and orphan nodes (unreachable from any
 * `Start`) rendered in a visually SEPARATED, `InlineAlert`-flagged trailing group rather
 * than silently interleaved — the same distinction `analyzePipelineGraph`'s own
 * `orphan_node` finding makes structurally.
 */
export function PipelineCanvasOutlineView({
  model,
  onSelectNode,
  headingText = "Pipeline nodes",
  selectRowLabel = defaultSelectRowLabel,
  openButtonText = "Open",
  orphanHeadingText = "Not connected to the pipeline",
  className,
}: PipelineCanvasOutlineViewProps) {
  const nodesById = indexPipelineNodesById(model.nodes);
  const order = computePipelineOrder(model);
  const forward = structuralConnections(model.edges);
  const headingId = React.useId();

  // A node with no forward inbound edge AND no forward outbound edge is disconnected — the
  // same shape `analyzePipelineGraph`'s own orphan check flags, computed independently here
  // (a components-layer file may not import that feature module's domain logic —
  // `boundaries/element-types`) so the outline view degrades gracefully even before a
  // findings panel has run.
  const orphanIds = model.nodes
    .filter(
      (node) =>
        node.kind !== "start" &&
        incomingConnections(node.id, forward).length === 0 &&
        node.kind !== "response" &&
        outgoingConnections(node.id, forward).length === 0,
    )
    .map((n) => n.id);
  const orphanSet = new Set(orphanIds);
  const connectedOrder = order.filter((id) => !orphanSet.has(id));

  function renderRow(id: string) {
    const node = nodesById.get(id);
    if (!node) return null;
    const meta = PIPELINE_NODE_KIND_META[node.kind];
    const children = outgoingConnections(id, forward);
    const loops = loopBackEdgesFrom(id, model.edges);

    return (
      <li
        key={id}
        className="border border-border bg-card"
        style={{ borderRadius: "var(--radius-md)", padding: "var(--space-2)" }}
      >
        <div className="flex items-start justify-between" style={{ gap: "var(--space-2)" }}>
          <div className="flex items-start" style={{ gap: "var(--space-2)" }}>
            <Icon icon={meta.glyph} size={14} style={{ color: meta.colorToken }} />
            <div>
              <p className="text-xs font-medium" style={{ color: meta.colorToken }}>
                {meta.badgeLabel}
              </p>
              <p dir="auto" className="text-sm font-medium text-foreground">
                {node.title}
              </p>
              {node.agentName ? (
                <p dir="auto" className="text-xs text-muted-foreground">
                  {node.agentName}
                </p>
              ) : null}
              {children.length > 0 ? (
                <p className="mt-1 text-2xs text-muted-foreground">
                  {children
                    .map((edge) => nodesById.get(edge.targetId)?.title ?? edge.targetId)
                    .join(", ")}
                </p>
              ) : null}
              {loops.map((edge) => {
                const target = nodesById.get(edge.targetId);
                const bound = edge.maxIterations !== undefined ? `max ${edge.maxIterations}` : "unbounded";
                return (
                  <p key={edge.id} className="mt-1 text-2xs text-warning-strong">
                    ↺ Loops back to {target?.title ?? edge.targetId} ({bound}
                    {edge.conditionSummary ? `, while ${edge.conditionSummary}` : ""})
                  </p>
                );
              })}
            </div>
          </div>
          {onSelectNode ? (
            <button
              type="button"
              onClick={() => onSelectNode(id)}
              aria-label={selectRowLabel(node.title)}
              className={cn(
                "shrink-0 text-xs text-primary underline-offset-4 hover:underline",
                "outline-none focus-visible:[outline:var(--focus-ring-width)_solid_var(--ring)] focus-visible:[outline-offset:var(--focus-ring-offset)]",
              )}
            >
              {openButtonText}
            </button>
          ) : null}
        </div>
      </li>
    );
  }

  return (
    <div
      className={cn("flex flex-col", className)}
      style={{ gap: "var(--space-3)" }}
      data-slot="pipeline-canvas-outline-view"
    >
      <div className="flex flex-col" style={{ gap: "var(--space-2)" }}>
        <h3 id={headingId} className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          {headingText}
        </h3>
        <ol aria-labelledby={headingId} className="list-none" style={{ display: "grid", gap: "var(--space-1)" }}>
          {connectedOrder.map(renderRow)}
        </ol>
      </div>
      {orphanIds.length > 0 ? (
        <div className="flex flex-col" style={{ gap: "var(--space-2)" }}>
          <InlineAlert variant="warning">{orphanHeadingText}</InlineAlert>
          <ol className="list-none" style={{ display: "grid", gap: "var(--space-1)" }}>
            {orphanIds.map(renderRow)}
          </ol>
        </div>
      ) : null}
    </div>
  );
}
