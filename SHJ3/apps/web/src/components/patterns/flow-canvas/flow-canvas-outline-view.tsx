import * as React from "react";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icon";
import {
  FLOW_NODE_TYPE_META,
  computeTopologicalOrder,
  incomingConnections,
  indexFlowNodesById,
  outgoingConnections,
  type FlowModel,
} from "./flow-canvas-types";

export interface FlowCanvasOutlineViewProps {
  model: FlowModel;
  onSelectNode?: (nodeId: string) => void;
  /** English defaults, overridable — see flow-canvas.tsx's own note on staying framework-agnostic. */
  headingText?: string;
  selectRowLabel?: (title: string) => string;
  openButtonText?: string;
  /** A function, not a plain string — real pluralisation is a translation-layer concern once next-intl is wired here (§11.3 rule 4, summary-strip.tsx's `formatBlockedBy` precedent). */
  formatConnectionCount?: (count: number) => string;
  className?: string;
}

function defaultSelectRowLabel(title: string): string {
  return `Open ${title} in the flow`;
}

function defaultFormatConnectionCount(count: number): string {
  return count === 1 ? "1 connection" : `${count} connections`;
}

/**
 * The mandatory second representation for `FlowCanvas` (design-system.md
 * §5.5 #45, §10.4 — identical conformance reasoning to `GraphCanvas`'s own
 * list view). Renders every node from the *same* `model` the canvas
 * receives, in the *exact same order* the canvas's own roving-tabindex
 * keyboard navigation walks (`computeTopologicalOrder`, called here and
 * nowhere else duplicated) — so canvas keyboard order and outline reading
 * order are provably one sequence, not two hand-maintained ones that could
 * drift.
 *
 * A real `<ol>`, per §5.5 #47's identical instruction for `DiffTraceViewer`
 * and this organism's own a11y note ("a mandatory outline view… conveyed
 * structurally, not visually-only") — step order is structural, not merely a
 * visual list. Branch structure (which connection led to this node, and its
 * branch label when the parent is a `condition`) is rendered as each item's
 * own text rather than nested `<ol>` levels: a flow can merge (more than one
 * incoming connection) as well as branch, which a strict parent/child tree of
 * `<ol>`s cannot represent without duplicating a node under two parents —
 * this flat, order-preserving form has no such ambiguity and stays in exact
 * lockstep with the roving-tabindex sequence by construction.
 */
export function FlowCanvasOutlineView({
  model,
  onSelectNode,
  headingText = "Flow steps",
  selectRowLabel = defaultSelectRowLabel,
  openButtonText = "Open",
  formatConnectionCount = defaultFormatConnectionCount,
  className,
}: FlowCanvasOutlineViewProps) {
  const nodesById = indexFlowNodesById(model.nodes);
  const order = computeTopologicalOrder(model);
  const headingId = React.useId();

  return (
    <div
      className={cn("flex flex-col", className)}
      style={{ gap: "var(--space-2)" }}
      data-slot="flow-canvas-outline-view"
    >
      <h3
        id={headingId}
        className="text-xs font-medium tracking-wide text-muted-foreground uppercase"
      >
        {headingText}
      </h3>
      <ol
        aria-labelledby={headingId}
        className="list-none"
        style={{ display: "grid", gap: "var(--space-1)" }}
      >
        {order.map((id) => {
          const node = nodesById.get(id);
          if (!node) return null;
          const meta = FLOW_NODE_TYPE_META[node.type];
          const parents = incomingConnections(id, model.connections);
          const children = outgoingConnections(id, model.connections);
          const branchLabels = parents
            .map((connection) => connection.branchLabel)
            .filter((label): label is string => Boolean(label));

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
                    <p
                      className="flex items-center text-xs font-medium"
                      style={{ color: meta.colorToken, gap: "var(--space-1)" }}
                    >
                      <span>{meta.badgeLabel}</span>
                      {branchLabels.length > 0 ? (
                        <span className="text-muted-foreground">— {branchLabels.join(", ")}</span>
                      ) : null}
                    </p>
                    <p dir="auto" className="text-sm font-medium text-foreground">
                      {node.title}
                    </p>
                    <p dir="auto" className="text-xs text-muted-foreground">
                      {node.summary}
                    </p>
                    {children.length > 0 ? (
                      <p className="mt-1 text-2xs text-muted-foreground">
                        {formatConnectionCount(children.length)}
                        {": "}
                        {children
                          .map(
                            (connection) =>
                              nodesById.get(connection.targetId)?.title ?? connection.targetId,
                          )
                          .join(", ")}
                      </p>
                    ) : null}
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
        })}
      </ol>
    </div>
  );
}
