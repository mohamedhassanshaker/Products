import * as React from "react";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icon";
import {
  GRAPH_ENTITY_TYPE_META,
  indexNodesById,
  relationshipsForNode,
  type GraphEdge,
  type GraphNode,
} from "./graph-canvas-types";

export interface GraphCanvasListViewProps {
  nodes: readonly GraphNode[];
  edges: readonly GraphEdge[];
  entityTypeLabels: Readonly<Record<string, string>>;
  onSelectNode?: (nodeId: string) => void;
  /** English defaults, overridable — see graph-canvas.tsx's own note on staying framework-agnostic. */
  captionText?: string;
  entityColumnLabel?: string;
  typeColumnLabel?: string;
  relationshipsColumnLabel?: string;
  selectRowLabel?: (label: string) => string;
  /** Rendered instead of the table when `nodes` is empty. Omitted: this view renders an empty `<table>` body, exactly as before this prop existed — a caller opts in rather than every existing consumer silently changing shape. */
  emptyContent?: React.ReactNode;
  className?: string;
}

function defaultSelectRowLabel(label: string): string {
  return `View ${label} on the canvas`;
}

/**
 * The mandatory second representation for `GraphCanvas` (design-system.md
 * §10.4: *"render the same model twice — a canvas for spatial reasoning and a
 * list/outline for sequential reasoning — and keep them in sync from one data
 * source... a real conformance path, not a fallback"*). Renders the identical
 * `nodes`/`edges` the SVG canvas receives — there is no second, hand-authored
 * copy of the graph's content anywhere, which is exactly what
 * `graph-canvas.test.tsx`'s shared-data-source test asserts.
 *
 * A real `<table>`, deliberately, per the brief's own instruction: this is
 * this organism's own non-reusable fallback content, not a shared data grid —
 * `DataTable` (design-system.md §5.5 #41) is a separate, not-yet-built
 * organism for genuinely reusable tabular screens, and reaching for
 * ARIA-`role="table"` `div`s here instead of a real `<table>` purely to dodge
 * `no-raw-table.mjs` would trade native table semantics (far more robustly
 * supported by assistive tech than a hand-rolled ARIA grid) for a mechanical
 * pass — the wrong trade for the *conformant path* §10.4 calls this view. So:
 * a real `<table>`, with the gate's own documented `design-gate-allow`
 * escape hatch on the one line that needs it, same mechanism
 * `chip-input.tsx` already uses for its own narrow, evidence-based exception.
 *
 * **The `<table>` tag itself carries no `className`/`data-slot` — verified,
 * not assumed.** `no-raw-table.mjs` requires the `design-gate-allow` comment
 * on the exact same source line as the `<table` match, but a real `prettier
 * --write` run against a `<table className="..." data-slot="...">` with the
 * comment attached anywhere in that attribute list always breaks the tag
 * across multiple lines and re-groups the comment with whichever attribute
 * follows it — never with `<table` itself — which would silently turn this
 * into an *undetected* `<table>` (no violation, but no counted exception
 * either) the moment either the attribute list or Prettier's line-wrapping
 * ever changed. The one placement confirmed stable under real formatting is
 * `<table>` with zero attributes immediately followed by the comment; the
 * visual styling that table-level className used to carry (`w-full` moved to
 * the wrapping `<div>` below; `text-sm` moved onto each cell, where most of
 * it was already being redundantly re-specified anyway; `border-collapse`
 * dropped as genuinely non-load-bearing for a row-only-bottom-border table
 * with no vertical cell grid lines) is unaffected.
 */
export function GraphCanvasListView({
  nodes,
  edges,
  entityTypeLabels,
  onSelectNode,
  captionText = "Entities and their relationships",
  entityColumnLabel = "Entity",
  typeColumnLabel = "Type",
  relationshipsColumnLabel = "Relationships",
  selectRowLabel = defaultSelectRowLabel,
  emptyContent,
  className,
}: GraphCanvasListViewProps) {
  const nodesById = indexNodesById(nodes);

  if (nodes.length === 0 && emptyContent) {
    return (
      <div className={cn("w-full", className)} data-slot="graph-canvas-list-view" data-state="empty">
        {emptyContent}
      </div>
    );
  }

  return (
    <div className={cn("w-full overflow-x-auto", className)} data-slot="graph-canvas-list-view">
      <table /* design-gate-allow: a real, non-reusable <table> — GraphCanvas's own mandatory list-view fallback (design-system.md §5.5 #44, §10.4), not a shared data grid; DataTable (§5.5 #41) is a separate, not-yet-built organism for reusable tabular screens */
      >
        <caption className="sr-only">{captionText}</caption>
        <thead>
          <tr className="border-b border-border-strong text-start text-sm">
            <th scope="col" className="px-2 py-2 text-start font-medium text-muted-foreground">
              {entityColumnLabel}
            </th>
            <th scope="col" className="px-2 py-2 text-start font-medium text-muted-foreground">
              {typeColumnLabel}
            </th>
            <th scope="col" className="px-2 py-2 text-start font-medium text-muted-foreground">
              {relationshipsColumnLabel}
            </th>
          </tr>
        </thead>
        <tbody>
          {nodes.map((node) => {
            const meta = GRAPH_ENTITY_TYPE_META[node.type];
            const relationships = relationshipsForNode(node.id, edges);
            const label = entityTypeLabels[node.type] ?? meta.labelPrefix;
            return (
              <tr key={node.id} className="border-b border-border text-sm">
                <th scope="row" className="px-2 py-2 text-start font-normal text-foreground">
                  {onSelectNode ? (
                    <button
                      type="button"
                      onClick={() => onSelectNode(node.id)}
                      aria-label={selectRowLabel(node.label)}
                      className={cn(
                        "text-start text-foreground underline-offset-4 hover:underline",
                        "outline-none focus-visible:[outline:var(--focus-ring-width)_solid_var(--ring)] focus-visible:[outline-offset:var(--focus-ring-offset)]",
                      )}
                    >
                      {node.label}
                    </button>
                  ) : (
                    node.label
                  )}
                </th>
                <td className="px-2 py-2">
                  <span className="inline-flex items-center gap-1.5">
                    <Icon icon={meta.glyph} size={14} style={{ color: meta.colorToken }} />
                    <span className="text-foreground">{label}</span>
                  </span>
                </td>
                <td className="px-2 py-2 text-muted-foreground">
                  {relationships.length === 0 ? (
                    <span>—</span>
                  ) : (
                    <ul className="list-none">
                      {relationships.map((edge) => {
                        const isSource = edge.sourceId === node.id;
                        const otherId = isSource ? edge.targetId : edge.sourceId;
                        const other = nodesById.get(otherId);
                        const otherLabel = other?.label ?? otherId;
                        return (
                          <li key={edge.id}>
                            {isSource ? (
                              <span>
                                {edge.relationshipLabel} → {otherLabel}
                              </span>
                            ) : (
                              <span>
                                {otherLabel} {edge.relationshipLabel} → {node.label}
                              </span>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
