"use client";

import * as React from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icon";
import { FLOW_NODE_TYPE_META, outgoingConnections, type FlowNode, type FlowModel } from "../flow-canvas/flow-canvas-types";

/**
 * The data every real xyflow node carries (`Node<FlowGraphNodeData>` —
 * xyflow's own `NodeProps` parameterises on this). `dir`, `tabIndex`,
 * `isSelected`/`isHighlighted` and the `onActivate`/`onSelect` callbacks are
 * threaded through as plain data fields rather than read via context or an
 * outer-scope closure: xyflow renders every node through its own internal
 * store subscription, not as a direct child of `FlowCanvasGraph`, so a data
 * field is the explicit, re-render-tracked way to reach a node.
 */
export interface FlowGraphNodeData extends Record<string, unknown> {
  node: FlowNode;
  model: FlowModel;
  dir: "ltr" | "rtl";
  tabIndex: 0 | -1;
  isSelected: boolean;
  isHighlighted: boolean;
  /** Explicitly `| undefined` (not bare `?:`) — `exactOptionalPropertyTypes` requires the field's type itself admit `undefined` for a `readonly` canvas to assign it explicitly rather than omit the key. */
  onActivate: ((id: string) => void) | undefined;
  onSelect: (id: string) => void;
}

/**
 * One shared node renderer registered under all five real node-type keys
 * (`flow-canvas-graph.tsx`'s `nodeTypes`) — the five types differ only in
 * `FLOW_NODE_TYPE_META`'s colour/glyph/badge (design-system.md §5.5 #45's
 * exact per-type mapping, already established by the old canvas's
 * `FlowNodeShape` and reused verbatim here), not in layout or interaction, so
 * one component keyed five times avoids five near-identical copies.
 *
 * Ports are logical (`design-system.md` §5.5 #45: "inline-start/inline-end
 * connection ports"), not xyflow's physical `Position.Left`/`Right` — under
 * RTL the target/source sides swap so a connection still visually flows from
 * the reading-start side to the reading-end side of each node, matching
 * `use-topological-focus.ts`'s identical "flip the key mapping, not the
 * geometry" precedent for `ArrowLeft`/`ArrowRight`.
 *
 * Click/Enter handling is self-contained on this component (mirroring the old
 * `FlowNodeShape`'s own `onClick`/`onKeyDown`) rather than relying solely on
 * xyflow's top-level `onNodeClick` prop, so a plain Enter key press activates
 * a focused node exactly like the old canvas did, independent of whatever
 * xyflow's own internal keyboard handling does with the same key.
 */
export function FlowGraphNode({ data }: NodeProps & { data: FlowGraphNodeData }) {
  const { node, model, dir, tabIndex, isSelected, isHighlighted, onActivate, onSelect } = data;
  const meta = FLOW_NODE_TYPE_META[node.type];
  const children = outgoingConnections(node.id, model.connections);
  const targetSide = dir === "rtl" ? Position.Right : Position.Left;
  const sourceSide = dir === "rtl" ? Position.Left : Position.Right;

  return (
    <div
      tabIndex={tabIndex}
      data-slot="flow-canvas-node"
      data-node-id={node.id}
      data-selected={isSelected ? "true" : undefined}
      role="button"
      aria-label={`${meta.badgeLabel}: ${node.title}`}
      style={{
        inlineSize: "var(--flow-node-inline-size)",
        borderColor: isSelected ? "var(--ring)" : "var(--border-strong)",
        borderWidth: isSelected ? 2 : 1,
        borderRadius: "var(--radius-md)",
        padding: "var(--space-3)",
        backgroundColor: isHighlighted ? "var(--accent)" : "var(--card)",
      }}
      className={cn(
        "cursor-grab border",
        "outline-none focus-visible:[outline:var(--focus-ring-width)_solid_var(--ring)] focus-visible:[outline-offset:var(--focus-ring-offset)]",
      )}
      onFocus={() => onSelect(node.id)}
      onClick={() => {
        onSelect(node.id);
        onActivate?.(node.id);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          onActivate?.(node.id);
        }
      }}
    >
      <Handle type="target" position={targetSide} />
      <p
        className="flex items-center text-2xs font-medium tracking-wide uppercase"
        style={{ color: meta.colorToken, gap: "var(--space-1)" }}
      >
        <Icon icon={meta.glyph} size={14} />
        <span>{meta.badgeLabel}</span>
      </p>
      <p dir="auto" className="mt-1 text-sm font-medium text-foreground">
        {node.title}
      </p>
      <p dir="auto" className="mt-0.5 text-xs text-muted-foreground">
        {node.summary}
      </p>
      {children.length > 0 ? (
        <ul className="mt-2 list-none border-t border-border pt-1.5 text-2xs text-muted-foreground">
          {children.map((connection) => (
            <li key={connection.id}>
              → {connection.branchLabel ? `${connection.branchLabel}: ` : ""}
              {model.nodes.find((n) => n.id === connection.targetId)?.title ?? connection.targetId}
            </li>
          ))}
        </ul>
      ) : null}
      <Handle type="source" position={sourceSide} />
    </div>
  );
}

/** One shared component, registered under every real node-type key so xyflow dispatches by `node.type` without a switch — see this file's own module doc comment. */
export const FLOW_GRAPH_NODE_TYPES = {
  message: FlowGraphNode,
  question: FlowGraphNode,
  "tool-call": FlowGraphNode,
  handover: FlowGraphNode,
  condition: FlowGraphNode,
} as const;
