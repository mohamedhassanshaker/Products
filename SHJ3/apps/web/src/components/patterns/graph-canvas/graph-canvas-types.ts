import type { LucideIcon } from "lucide-react";
import { Building2, Coins, FileText, Radio, Layers } from "lucide-react";

/**
 * The five entity types B6 tab 2's knowledge graph renders (design-system.md
 * §5.5 #44). A closed union, not a free string, because every consumer below
 * (the colour map, the glyph map, the label-prefix map) is a
 * `Record<GraphEntityType, …>` — an exhaustiveness-checked object literal — so
 * adding a sixth entity type anywhere in the graph's real data without also
 * updating this file fails to compile rather than silently rendering an
 * uncoloured, unlabelled node.
 */
export type GraphEntityType = "service" | "provider" | "fee" | "document" | "channel";

/**
 * One node in the entity graph. `x`/`y` are already-resolved layout
 * coordinates in SVG user units — this component consumes a layout, it does
 * not compute one (the brief's own scope boundary: no graph-visualisation/
 * force-layout library is pulled in here). Where those coordinates come from
 * (a stored layout, a future layout service) is a later wave's concern.
 */
export interface GraphNode {
  id: string;
  type: GraphEntityType;
  /** Entity name as stored, e.g. "SEWA" — the type prefix ("Provider:") is composed at render time, never baked into this string (§6.4). */
  label: string;
  x: number;
  y: number;
}

/** A directed relationship between two nodes. Direction is data (§5.5 #44's RTL note) — it is never inferred from render order. */
export interface GraphEdge {
  id: string;
  sourceId: string;
  targetId: string;
  /** e.g. "requires", "issued by" — rendered as the edge's visible label and as part of the relationship's accessible description. */
  relationshipLabel: string;
}

/** The one data source both the SVG canvas and the mandatory list view render from (§10.4's "kept in sync from one data source"). */
export interface GraphModel {
  nodes: readonly GraphNode[];
  edges: readonly GraphEdge[];
}

/** A candidate duplicate pair surfaced by B6's duplicate-detection (e.g. "SEWA" vs "Sharjah Electricity & Water Authority"). */
export interface GraphDuplicateCandidate {
  primaryNodeId: string;
  duplicateNodeId: string;
}

/** Per-type colour token, glyph and English label-prefix default — the mechanical form of §6.4's "type glyph and a 'Provider:' label prefix" second channel, never colour alone. */
export interface GraphEntityTypeMeta {
  /** One of `--chart-1`…`--chart-5` (§5.5 #44) — a `var()` reference, applied via `style`, never a literal. */
  colorToken: string;
  glyph: LucideIcon;
  /** English default; a caller wires a translated record once this screen exists behind next-intl (this component stays framework-agnostic, matching mono-sub-line.tsx's precedent). */
  labelPrefix: string;
}

/**
 * Fixed mapping, five types to `--chart-1`…`--chart-5` in the order §4.5's
 * token comment states they were assigned ("ordered by hue separation, not
 * brand priority") — one entity type per chart slot, none shared, `--chart-6`
 * deliberately unused here (FlowCanvas's Condition node claims it instead).
 */
export const GRAPH_ENTITY_TYPE_META: Readonly<Record<GraphEntityType, GraphEntityTypeMeta>> = {
  service: { colorToken: "var(--chart-1)", glyph: Layers, labelPrefix: "Service" },
  provider: { colorToken: "var(--chart-2)", glyph: Building2, labelPrefix: "Provider" },
  fee: { colorToken: "var(--chart-3)", glyph: Coins, labelPrefix: "Fee" },
  document: { colorToken: "var(--chart-4)", glyph: FileText, labelPrefix: "Document" },
  channel: { colorToken: "var(--chart-5)", glyph: Radio, labelPrefix: "Channel" },
};

/** Every relationship touching `nodeId`, in edge order — the one function both the canvas's accessible-name computation and the list view's "Relationships" column call, so they cannot drift apart. */
export function relationshipsForNode(
  nodeId: string,
  edges: readonly GraphEdge[],
): readonly GraphEdge[] {
  return edges.filter((edge) => edge.sourceId === nodeId || edge.targetId === nodeId);
}

/** `id -> node` index, built once per render rather than `.find()`-scanned per lookup — every canvas/list/focus computation below needs this repeatedly. */
export function indexNodesById(nodes: readonly GraphNode[]): ReadonlyMap<string, GraphNode> {
  return new Map(nodes.map((node) => [node.id, node]));
}

/**
 * The node's full accessible name, e.g. `"Provider: SEWA, 3 relationships"`
 * (§5.5 #44's own exact example). One function so the SVG node's `aria-label`
 * and any other surface announcing a node (the merge-confirmation dialog,
 * future callers) agree on the exact wording rather than composing it
 * ad hoc at each call site.
 */
export function describeNode(
  node: GraphNode,
  edges: readonly GraphEdge[],
  labelPrefix: string,
): string {
  const count = relationshipsForNode(node.id, edges).length;
  const relationshipWord = count === 1 ? "relationship" : "relationships";
  return `${labelPrefix}: ${node.label}, ${count} ${relationshipWord}`;
}
