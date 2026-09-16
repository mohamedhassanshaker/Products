"use client";

import * as React from "react";
import { Maximize, X, ZoomIn, ZoomOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icon";
import { IconButton } from "@/components/ui/icon-button";
import { SearchField } from "@/components/ui/search-field";
import { ToggleRow } from "@/components/ui/toggle-row";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { useResolvedDir } from "@/components/ui/use-resolved-dir";
import {
  GRAPH_ENTITY_TYPE_META,
  describeNode,
  indexNodesById,
  relationshipsForNode,
  type GraphDuplicateCandidate,
  type GraphEdge,
  type GraphEntityType,
  type GraphNode,
} from "./graph-canvas-types";
import { GraphCanvasListView } from "./graph-canvas-list-view";
import { GraphCanvasMergeDialog, type MergeConfirmationProps } from "./graph-canvas-merge-dialog";
import { useRovingNodeFocus } from "./use-nearest-neighbor-focus";

const NODE_WIDTH = 168;
const NODE_HEIGHT = 56;
const RAIL_WIDTH = 4;
const CANVAS_PADDING = 56;
const ZOOM_STEP = 0.2;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 2;

function clampZoom(value: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, value));
}

/** Content bounds across every node's box (not just its centre point), so the default viewBox never clips a node at the edge. */
function computeContentBounds(nodes: readonly GraphNode[]) {
  if (nodes.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const node of nodes) {
    minX = Math.min(minX, node.x);
    minY = Math.min(minY, node.y);
    maxX = Math.max(maxX, node.x + NODE_WIDTH);
    maxY = Math.max(maxY, node.y + NODE_HEIGHT);
  }
  return { minX, minY, maxX, maxY };
}

export type GraphCanvasVariant = "explore" | "focus" | "readonly";
export type GraphCanvasState = "default" | "loading" | "error";
type GraphCanvasView = "canvas" | "list";

export interface GraphCanvasProps {
  nodes: readonly GraphNode[];
  edges: readonly GraphEdge[];
  state?: GraphCanvasState;
  errorMessage?: string;
  variant?: GraphCanvasVariant;
  /** `variant="focus"` only — restricts rendering to this node and its direct neighbours. */
  focusNodeId?: string;
  selectedNodeId?: string;
  onSelectedNodeChange?: (nodeId: string | undefined) => void;
  duplicates?: readonly GraphDuplicateCandidate[];
  onMergeDuplicate?: (candidate: GraphDuplicateCandidate) => void;
  onIgnoreDuplicate?: (candidate: GraphDuplicateCandidate) => void;
  onAddSource?: () => void;
  /**
   * Overrides the built-in merge-confirmation dialog. Accepts the real
   * `Dialog` organism (design-system.md §5.5 #53) once it exists — see
   * `graph-canvas-merge-dialog.tsx`'s doc comment for the full cross-wave
   * dependency note. Signature matches `GraphCanvasMergeDialog`'s own props.
   */
  renderMergeConfirmation?: (props: MergeConfirmationProps) => React.ReactNode;
  /** English defaults per entity type, overridable once this screen is wired to next-intl. */
  entityTypeLabels?: Partial<Record<GraphEntityType, string>>;
  "aria-label"?: string;
  emptyStateAction?: { label: string };
  /**
   * Every other piece of UI chrome text below is an English default,
   * overridable once this screen is wired to next-intl — this component
   * stays framework-agnostic and does not import next-intl itself
   * (mono-sub-line.tsx's established precedent), so each default lives here
   * as a plain overridable prop rather than a hardcoded JSX literal (§12.3).
   */
  loadingMessage?: string;
  duplicatesHeading?: string;
  detailPanelLabel?: string;
  viewToggleLabel?: string;
  canvasViewLabel?: string;
  listViewLabel?: string;
  searchLabel?: string;
  searchPlaceholder?: string;
  zoomOutLabel?: string;
  zoomInLabel?: string;
  fitToViewLabel?: string;
  ignoreDuplicateLabel?: string;
  mergeDuplicateLabel?: string;
  className?: string;
}

interface GraphNodeShapeProps {
  node: GraphNode;
  edges: readonly GraphEdge[];
  labelPrefix: string;
  tabIndex: 0 | -1;
  isSelected: boolean;
  isDimmed: boolean;
  onFocusNode: (id: string) => void;
  onActivate: (id: string) => void;
  registerRef: (el: SVGGElement | null) => void;
}

/** One entity node: a rounded card with a type-coloured inline-start rail, a glyph, a type-prefixed label — never colour alone (§6.4). */
function GraphNodeShape({
  node,
  edges,
  labelPrefix,
  tabIndex,
  isSelected,
  isDimmed,
  onFocusNode,
  onActivate,
  registerRef,
}: GraphNodeShapeProps) {
  const meta = GRAPH_ENTITY_TYPE_META[node.type];
  const accessibleName = describeNode(node, edges, labelPrefix);

  return (
    <g
      ref={registerRef}
      tabIndex={tabIndex}
      role="button"
      aria-label={accessibleName}
      data-slot="graph-canvas-node"
      data-node-id={node.id}
      data-selected={isSelected ? "true" : undefined}
      className={cn(
        "cursor-pointer outline-none focus-visible:[outline:var(--focus-ring-width)_solid_var(--ring)] focus-visible:[outline-offset:var(--focus-ring-offset)]",
        isDimmed && "opacity-40",
      )}
      transform={`translate(${node.x}, ${node.y})`}
      onFocus={() => onFocusNode(node.id)}
      onClick={() => {
        onFocusNode(node.id);
        onActivate(node.id);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          onActivate(node.id);
        }
      }}
    >
      <rect
        width={NODE_WIDTH}
        height={NODE_HEIGHT}
        strokeWidth={isSelected ? 2 : 1}
        style={{
          rx: "var(--graph-node-radius)",
          ry: "var(--graph-node-radius)",
          fill: "var(--card)",
          stroke: isSelected ? "var(--ring)" : "var(--border-strong)",
        }}
      />
      {/* The type-coloured rail — always the shape's physical left edge. The
          graph's own layout never mirrors under RTL (§5.5 #44: an edge's
          direction is data), so this is deliberately not a logical
          inline-start offset; it is SVG geometry local to this node's own
          coordinate system, unaffected by page direction. */}
      <rect x={0} y={0} width={RAIL_WIDTH} height={NODE_HEIGHT} style={{ fill: meta.colorToken }} />
      <g transform={`translate(${RAIL_WIDTH + 10}, 10)`}>
        <Icon icon={meta.glyph} size={14} style={{ color: meta.colorToken }} />
      </g>
      {/* Structural UI microcopy (the type-prefix word), not code/ID content —
          §11.3 rule 1's forced dir="ltr" is for mono/endpoint/ID-shaped
          content specifically, which this is not, so it just inherits
          ambient direction like any other short label. */}
      <text
        x={RAIL_WIDTH + 32}
        y={20}
        style={{
          fontSize: "var(--text-2xs)",
          fill: meta.colorToken,
          fontWeight: "var(--font-weight-medium)",
        }}
      >
        {labelPrefix.toUpperCase()}
      </text>
      {/*
       * The entity name is user/domain content that can genuinely be Arabic
       * or Latin per node (§11.3 rule 2 names "node labels" as dir="auto"
       * content) — but React's SVG element attribute types have no `dir` of
       * their own (confirmed by `tsc`, the identical gap kpi-tile.tsx's
       * Sparkline already documents for the root `<svg>` itself). That
       * earlier fix (an ancestor HTML `dir`) does not actually solve *this*
       * case: it forces one fixed direction, but sibling nodes in the same
       * canvas can need *different* auto-detected directions at once, which
       * only a per-element mechanism can give. `unicode-bidi: plaintext` is
       * the real CSS-level equivalent of `dir="auto"`'s heuristic (the P2/P3
       * first-strong-character bidi rules, applied per element rather than
       * inherited) — and unlike the `dir` attribute, `unicode-bidi` is a
       * normal `style` property with full React/TS support on every element.
       */}
      <text
        x={RAIL_WIDTH + 12}
        y={40}
        style={{
          fontSize: "var(--text-sm)",
          fill: "var(--card-foreground)",
          unicodeBidi: "plaintext",
        }}
      >
        {node.label}
      </text>
    </g>
  );
}

/** One relationship: a stroked path plus a text label — direction is data and this shape never reverses it. */
function GraphEdgeShape({
  edge,
  nodesById,
}: {
  edge: GraphEdge;
  nodesById: ReadonlyMap<string, GraphNode>;
}) {
  const source = nodesById.get(edge.sourceId);
  const target = nodesById.get(edge.targetId);
  if (!source || !target) return null;

  const x1 = source.x + NODE_WIDTH / 2;
  const y1 = source.y + NODE_HEIGHT / 2;
  const x2 = target.x + NODE_WIDTH / 2;
  const y2 = target.y + NODE_HEIGHT / 2;
  const midX = (x1 + x2) / 2;
  const midY = (y1 + y2) / 2;

  return (
    <g data-slot="graph-canvas-edge" aria-hidden="true">
      <line
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        style={{ stroke: "var(--graph-edge-stroke)" }}
        strokeWidth={1.5}
        markerEnd="url(#graph-canvas-arrowhead)"
      />
      {/* Ordinary short relationship word, not code/ID content — see the
          identical reasoning on the node's own type-prefix text above. */}
      <text
        x={midX}
        y={midY - 4}
        textAnchor="middle"
        style={{ fontSize: "var(--text-2xs)", fill: "var(--muted-foreground)" }}
      >
        {edge.relationshipLabel}
      </text>
    </g>
  );
}

function DetailPanel({
  node,
  edges,
  nodesById,
  labelPrefix,
  headingRef,
  onClose,
  panelLabel = "Node details",
  closeLabel = "Back to canvas",
}: {
  node: GraphNode;
  edges: readonly GraphEdge[];
  nodesById: ReadonlyMap<string, GraphNode>;
  labelPrefix: string;
  headingRef: React.Ref<HTMLHeadingElement>;
  onClose: () => void;
  panelLabel?: string;
  closeLabel?: string;
}) {
  const relationships = relationshipsForNode(node.id, edges);

  // This is Escape-key event *delegation* from whichever focusable
  // descendant currently holds focus (the heading, the close button), not
  // fake pointer/keyboard interactivity bolted onto a landmark — the
  // `<aside>` itself is never a target a user tabs to or activates directly,
  // and does not need an interactive role to legitimately delegate a bubbled
  // key event, hence the targeted disable directly below rather than adding
  // one.
  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <aside
      data-slot="graph-canvas-detail-panel"
      aria-label={panelLabel}
      // `md:max-w-xs` was a dead class: this bridge's `--container-*` reset is never
      // re-mapped (tailwind-theme.ts, ADR-0007 "replace, not extend"), so no `max-w-*`
      // utility compiles — the same confirmed-empty gap already fixed at
      // `sign-in-form.tsx`. Unlike that fix, this one is genuinely breakpoint-gated
      // (full width below `md`, a capped sidebar above it, per the `flex-col
      // md:flex-row` layout this panel sits in) so a flat inline `style.maxWidth`
      // would wrongly cap it on mobile too. Fixed the same way `help-guide-shell.tsx`
      // fixes `w-72` — Tailwind v4's custom-property shorthand
      // (`md:max-w-(--detail-panel-max-width)`), which resolves to a real, breakpoint-
      // scoped `max-width: var(--detail-panel-max-width)` — with the variable's value
      // (`max-w-xs`'s own real 20rem) supplied via inline `style` below, since no
      // pre-existing design token names this one-off panel width.
      className="w-full shrink-0 border border-border bg-card md:max-w-(--detail-panel-max-width)"
      style={
        {
          borderRadius: "var(--radius-lg)",
          padding: "var(--space-4)",
          "--detail-panel-max-width": "20rem",
        } as React.CSSProperties
      }
      // A dedicated handler, not reliance on `handleCanvasKeyDown` bubbling
      // up from here — this panel is a DOM *sibling* of the `<svg>`, not a
      // descendant of it (see the layout below), so an event starting inside
      // this panel (e.g. on the heading `Enter` moved focus to) never
      // reaches a handler attached only to the canvas. Caught by this
      // organism's own Escape/focus-return test, not assumed to work from
      // the structure alone.
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onClose();
        }
      }}
    >
      <div className="flex items-start justify-between">
        <div>
          <p className="text-2xs font-medium tracking-wide text-muted-foreground uppercase">
            {labelPrefix}
          </p>
          {/* tabIndex=-1 heading is the documented technique this codebase
              already uses for "move focus into a panel that opened" (Wizard's
              step-pane heading, design-system.md §5.5 #42) — a non-interactive
              element made a one-time focus target. */}
          <h2
            ref={headingRef}
            tabIndex={-1}
            dir="auto"
            className="text-md font-semibold text-foreground outline-none focus-visible:[outline:var(--focus-ring-width)_solid_var(--ring)] focus-visible:[outline-offset:var(--focus-ring-offset)]"
          >
            {node.label}
          </h2>
        </div>
        <IconButton ariaLabel={closeLabel} variant="ghost" size="sm" onClick={onClose}>
          <Icon icon={X} size={14} />
        </IconButton>
      </div>
      <p className="mt-3 text-xs font-medium text-muted-foreground">
        {relationships.length} {relationships.length === 1 ? "relationship" : "relationships"}
      </p>
      <ul
        className="mt-1 list-none text-sm text-foreground"
        style={{ display: "grid", gap: "var(--space-1)" }}
      >
        {relationships.map((edge) => {
          const isSource = edge.sourceId === node.id;
          const other = nodesById.get(isSource ? edge.targetId : edge.sourceId);
          return (
            <li key={edge.id}>
              {isSource
                ? `${edge.relationshipLabel} → ${other?.label ?? ""}`
                : `${other?.label ?? ""} ${edge.relationshipLabel} →`}
            </li>
          );
        })}
      </ul>
    </aside>
  );
}

/**
 * B6 tab 2's entity graph (design-system.md §5.5 #44). Inline SVG rendered
 * from a plain node/edge model — no graph-visualisation dependency, matching
 * `KpiTile`'s sparkline precedent for the same reason.
 *
 * **Ships two synchronized representations, not one plus a fallback**
 * (§10.4): the SVG canvas here and `GraphCanvasListView` both render straight
 * from the same `nodes`/`edges` props, so there is exactly one data source
 * for both — proven in `graph-canvas.test.tsx` by rendering both views from
 * one fixture and asserting the same entities appear in each, rather than by
 * two independently-written expectations that could silently drift apart.
 */
export const GraphCanvas = React.forwardRef<HTMLDivElement, GraphCanvasProps>(function GraphCanvas(
  {
    nodes,
    edges,
    state = "default",
    errorMessage,
    variant = "explore",
    focusNodeId,
    selectedNodeId,
    onSelectedNodeChange,
    duplicates = [],
    onMergeDuplicate,
    onIgnoreDuplicate,
    onAddSource,
    renderMergeConfirmation,
    entityTypeLabels,
    "aria-label": ariaLabel = "Entity relationship graph",
    emptyStateAction,
    loadingMessage = "Loading graph…",
    duplicatesHeading = "Possible duplicate entities",
    detailPanelLabel = "Node details",
    viewToggleLabel = "Graph display mode",
    canvasViewLabel = "Canvas view",
    listViewLabel = "List view",
    searchLabel = "Search entities",
    searchPlaceholder = "Search entities",
    zoomOutLabel = "Zoom out",
    zoomInLabel = "Zoom in",
    fitToViewLabel = "Fit to view",
    ignoreDuplicateLabel = "Ignore",
    mergeDuplicateLabel = "Merge",
    className,
  },
  ref,
) {
  const dir = useResolvedDir();
  const [view, setView] = React.useState<GraphCanvasView>("canvas");
  const [zoom, setZoom] = React.useState(1);
  const [searchQuery, setSearchQuery] = React.useState("");
  const [detailNodeId, setDetailNodeId] = React.useState<string | undefined>(undefined);
  const [mergeTarget, setMergeTarget] = React.useState<GraphDuplicateCandidate | undefined>(
    undefined,
  );
  const searchInputRef = React.useRef<HTMLInputElement>(null);
  const detailHeadingRef = React.useRef<HTMLHeadingElement>(null);
  const lastFocusedNodeRef = React.useRef<string | undefined>(undefined);

  const readonly = variant === "readonly";

  const visibleNodes = React.useMemo(() => {
    if (variant !== "focus" || !focusNodeId) return nodes;
    const neighbourIds = new Set<string>([focusNodeId]);
    for (const edge of edges) {
      if (edge.sourceId === focusNodeId) neighbourIds.add(edge.targetId);
      if (edge.targetId === focusNodeId) neighbourIds.add(edge.sourceId);
    }
    return nodes.filter((node) => neighbourIds.has(node.id));
  }, [nodes, edges, variant, focusNodeId]);

  const visibleNodeIds = React.useMemo(
    () => new Set(visibleNodes.map((n) => n.id)),
    [visibleNodes],
  );
  const visibleEdges = React.useMemo(
    () =>
      edges.filter(
        (edge) => visibleNodeIds.has(edge.sourceId) && visibleNodeIds.has(edge.targetId),
      ),
    [edges, visibleNodeIds],
  );

  const nodesById = React.useMemo(() => indexNodesById(visibleNodes), [visibleNodes]);

  const resolveLabelPrefix = React.useCallback(
    (type: GraphEntityType) => entityTypeLabels?.[type] ?? GRAPH_ENTITY_TYPE_META[type].labelPrefix,
    [entityTypeLabels],
  );

  const matchingIds = React.useMemo(() => {
    if (searchQuery.trim() === "") return undefined;
    const query = searchQuery.trim().toLowerCase();
    return new Set(
      visibleNodes.filter((node) => node.label.toLowerCase().includes(query)).map((n) => n.id),
    );
  }, [visibleNodes, searchQuery]);

  const { focusedId, registerRef, handleArrowKeyDown, setFocusedId } = useRovingNodeFocus({
    items: visibleNodes,
    initialFocusedId: selectedNodeId,
    dir,
  });

  const handleFocusNode = React.useCallback(
    (id: string) => {
      lastFocusedNodeRef.current = id;
      setFocusedId(id);
      onSelectedNodeChange?.(id);
    },
    [setFocusedId, onSelectedNodeChange],
  );

  const openDetail = React.useCallback((id: string) => {
    setDetailNodeId(id);
  }, []);

  const closeDetail = React.useCallback(() => {
    setDetailNodeId(undefined);
    const returnTo = lastFocusedNodeRef.current;
    if (returnTo) {
      // Focus return to the originating node (§10.4) — works even though
      // `returnTo` is usually already the current `focusedId` value, because
      // `setFocusedId` keys its post-commit `.focus()` effect on a per-call
      // request token rather than on the id itself (see that hook's own doc
      // comment for the real bugs this replaced).
      setFocusedId(returnTo);
    }
  }, [setFocusedId]);

  React.useEffect(() => {
    if (detailNodeId !== undefined) {
      detailHeadingRef.current?.focus();
    }
  }, [detailNodeId]);

  const detailNode = detailNodeId ? nodesById.get(detailNodeId) : undefined;

  const handleCanvasKeyDown = (event: React.KeyboardEvent<SVGSVGElement>) => {
    if (handleArrowKeyDown(event)) return;

    if (event.key === "Enter" && focusedId) {
      event.preventDefault();
      openDetail(focusedId);
      return;
    }
    if (event.key === "Escape" && detailNodeId !== undefined) {
      event.preventDefault();
      closeDetail();
      return;
    }
    if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      setZoom((z) => clampZoom(z + ZOOM_STEP));
      return;
    }
    if (event.key === "-") {
      event.preventDefault();
      setZoom((z) => clampZoom(z - ZOOM_STEP));
      return;
    }
    if (event.key === "0") {
      event.preventDefault();
      setZoom(1);
      return;
    }
    if (event.key === "/") {
      event.preventDefault();
      searchInputRef.current?.focus();
    }
  };

  const bounds = React.useMemo(() => computeContentBounds(visibleNodes), [visibleNodes]);
  const viewBoxWidth = Math.max(
    bounds.maxX - bounds.minX + CANVAS_PADDING * 2,
    NODE_WIDTH + CANVAS_PADDING * 2,
  );
  const viewBoxHeight = Math.max(
    bounds.maxY - bounds.minY + CANVAS_PADDING * 2,
    NODE_HEIGHT + CANVAS_PADDING * 2,
  );
  const viewBoxX = bounds.minX - CANVAS_PADDING;
  const viewBoxY = bounds.minY - CANVAS_PADDING;
  const zoomCenterX = (bounds.minX + bounds.maxX) / 2;
  const zoomCenterY = (bounds.minY + bounds.maxY) / 2;

  const renderMerge =
    renderMergeConfirmation ??
    ((props: MergeConfirmationProps) => <GraphCanvasMergeDialog {...props} />);

  if (state === "loading") {
    return (
      <div
        ref={ref}
        data-slot="graph-canvas"
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
        ref={ref}
        data-slot="graph-canvas"
        data-state="error"
        role="alert"
        className={cn(
          "border border-destructive bg-card p-8 text-center text-sm text-destructive-strong",
          className,
        )}
        style={{ borderRadius: "var(--radius-lg)" }}
      >
        {errorMessage ?? "The graph could not be loaded."}
      </div>
    );
  }

  if (visibleNodes.length === 0) {
    return (
      <div ref={ref} data-slot="graph-canvas" data-state="empty" className={className}>
        <EmptyState
          variant="first-run"
          headline="No entities yet"
          cause="Connect a knowledge source to populate the entity graph."
          // Conditional spread, not `action={... : undefined}` — under this
          // project's `exactOptionalPropertyTypes`, `EmptyState`'s optional
          // `action` prop accepts being omitted but not an explicit
          // `undefined` value (checkbox.tsx's and search-field.tsx's
          // identical, already-established pattern for this exact problem).
          {...(onAddSource
            ? { action: { label: emptyStateAction?.label ?? "+ Add source", onClick: onAddSource } }
            : {})}
        />
      </div>
    );
  }

  return (
    <div
      ref={ref}
      data-slot="graph-canvas"
      data-variant={variant}
      className={cn("flex flex-col", className)}
      style={{ gap: "var(--space-3)" }}
    >
      <div
        className="flex flex-wrap items-center justify-between"
        style={{ gap: "var(--space-2)" }}
      >
        <ToggleRow
          aria-label={viewToggleLabel}
          value={view}
          onValueChange={(next) => setView(next as GraphCanvasView)}
          options={[
            { value: "canvas", label: canvasViewLabel },
            { value: "list", label: listViewLabel },
          ]}
        />
        <div className="flex items-center" style={{ gap: "var(--space-2)" }}>
          <SearchField
            ref={searchInputRef}
            aria-label={searchLabel}
            placeholder={searchPlaceholder}
            value={searchQuery}
            onValueChange={setSearchQuery}
            className="w-56"
          />
          {view === "canvas" ? (
            <div className="flex items-center" style={{ gap: "var(--space-1)" }}>
              <IconButton
                ariaLabel={zoomOutLabel}
                variant="outline"
                size="sm"
                onClick={() => setZoom((z) => clampZoom(z - ZOOM_STEP))}
              >
                <Icon icon={ZoomOut} size={14} />
              </IconButton>
              <IconButton
                ariaLabel={zoomInLabel}
                variant="outline"
                size="sm"
                onClick={() => setZoom((z) => clampZoom(z + ZOOM_STEP))}
              >
                <Icon icon={ZoomIn} size={14} />
              </IconButton>
              <IconButton
                ariaLabel={fitToViewLabel}
                variant="outline"
                size="sm"
                onClick={() => setZoom(1)}
              >
                <Icon icon={Maximize} size={14} />
              </IconButton>
            </div>
          ) : null}
        </div>
      </div>

      {view === "list" ? (
        <GraphCanvasListView
          nodes={visibleNodes}
          edges={visibleEdges}
          entityTypeLabels={{
            service: resolveLabelPrefix("service"),
            provider: resolveLabelPrefix("provider"),
            fee: resolveLabelPrefix("fee"),
            document: resolveLabelPrefix("document"),
            channel: resolveLabelPrefix("channel"),
          }}
          onSelectNode={(id) => {
            handleFocusNode(id);
            setView("canvas");
          }}
        />
      ) : (
        <div className="flex flex-col gap-3 md:flex-row">
          <svg
            role="application"
            aria-label={ariaLabel}
            onKeyDown={handleCanvasKeyDown}
            viewBox={`${viewBoxX} ${viewBoxY} ${viewBoxWidth} ${viewBoxHeight}`}
            className="min-h-80 w-full flex-1 border border-border"
            style={{
              backgroundColor: "var(--graph-canvas-surface)",
              borderRadius: "var(--radius-lg)",
            }}
          >
            <defs>
              <marker
                id="graph-canvas-arrowhead"
                markerWidth={8}
                markerHeight={8}
                refX={7}
                refY={4}
                orient="auto"
              >
                <path d="M0,0 L8,4 L0,8 z" style={{ fill: "var(--graph-edge-stroke)" }} />
              </marker>
            </defs>
            <g
              transform={`translate(${zoomCenterX}, ${zoomCenterY}) scale(${zoom}) translate(${-zoomCenterX}, ${-zoomCenterY})`}
            >
              {visibleEdges.map((edge) => (
                <GraphEdgeShape key={edge.id} edge={edge} nodesById={nodesById} />
              ))}
              {visibleNodes.map((node) => (
                <GraphNodeShape
                  key={node.id}
                  node={node}
                  edges={visibleEdges}
                  labelPrefix={resolveLabelPrefix(node.type)}
                  tabIndex={focusedId === node.id ? 0 : -1}
                  isSelected={focusedId === node.id}
                  isDimmed={matchingIds !== undefined && !matchingIds.has(node.id)}
                  onFocusNode={handleFocusNode}
                  onActivate={openDetail}
                  registerRef={registerRef(node.id)}
                />
              ))}
            </g>
          </svg>
          {detailNode ? (
            <DetailPanel
              node={detailNode}
              edges={visibleEdges}
              nodesById={nodesById}
              labelPrefix={resolveLabelPrefix(detailNode.type)}
              headingRef={detailHeadingRef}
              onClose={closeDetail}
              panelLabel={detailPanelLabel}
            />
          ) : null}
        </div>
      )}

      {!readonly && duplicates.length > 0 ? (
        <div
          data-slot="graph-canvas-duplicates"
          className="border border-border-strong bg-surface-sunken"
          style={{ borderRadius: "var(--radius-md)", padding: "var(--space-3)" }}
        >
          <p className="text-xs font-medium text-muted-foreground">{duplicatesHeading}</p>
          <ul className="mt-2 list-none" style={{ display: "grid", gap: "var(--space-2)" }}>
            {duplicates.map((candidate) => {
              const primary = nodesById.get(candidate.primaryNodeId);
              const duplicate = nodesById.get(candidate.duplicateNodeId);
              if (!primary || !duplicate) return null;
              return (
                <li
                  key={`${candidate.primaryNodeId}-${candidate.duplicateNodeId}`}
                  className="flex flex-wrap items-center justify-between"
                  style={{ gap: "var(--space-2)" }}
                >
                  <span dir="auto" className="text-sm text-foreground">
                    {primary.label} ↔ {duplicate.label}
                  </span>
                  <span className="flex items-center" style={{ gap: "var(--space-2)" }}>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onIgnoreDuplicate?.(candidate)}
                    >
                      {ignoreDuplicateLabel}
                    </Button>
                    <Button variant="primary" size="sm" onClick={() => setMergeTarget(candidate)}>
                      {mergeDuplicateLabel}
                    </Button>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {mergeTarget
        ? renderMerge({
            open: true,
            primaryLabel: nodesById.get(mergeTarget.primaryNodeId)?.label ?? "",
            duplicateLabel: nodesById.get(mergeTarget.duplicateNodeId)?.label ?? "",
            onConfirm: () => {
              onMergeDuplicate?.(mergeTarget);
              setMergeTarget(undefined);
            },
            onCancel: () => setMergeTarget(undefined),
          })
        : null}
    </div>
  );
});
