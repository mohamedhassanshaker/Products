"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { ToggleRow } from "@/components/ui/toggle-row";

export type ChartFrameVariant = "bar" | "line";
export type ChartFrameOrientation = "vertical" | "horizontal";

export interface ChartFrameSeries {
  id: string;
  /** Series name — also the table fallback's row/column header, and the legend text. */
  label: string;
  /** One value per entry in `categories`, same order. */
  values: readonly number[];
}

const VIEWBOX_WIDTH = 480;
const VIEWBOX_HEIGHT = 240;
const PLOT_PADDING = 32;

/**
 * Four visually distinct SVG fill patterns, cycled by series index —
 * design-system.md §6.1: *"every chart series carries a pattern as well as
 * a hue."* Each pattern draws in `currentColor` and is referenced through a
 * `fill="url(#…)"`, so the same four `<pattern>` definitions serve every
 * series regardless of which `--chart-N` colour that series' ancestor `<g>`
 * sets — one definition per pattern shape, not one per colour×pattern
 * combination.
 */
const PATTERN_KINDS = ["solid", "diagonal", "dots", "horizontal"] as const;
type PatternKind = (typeof PATTERN_KINDS)[number];

function PatternDefs({ idPrefix }: { idPrefix: string }): React.ReactElement {
  return (
    <defs>
      <pattern id={`${idPrefix}-solid`} width={8} height={8} patternUnits="userSpaceOnUse">
        <rect width={8} height={8} fill="currentColor" />
      </pattern>
      <pattern
        id={`${idPrefix}-diagonal`}
        width={8}
        height={8}
        patternUnits="userSpaceOnUse"
        patternTransform="rotate(45)"
      >
        <rect width={8} height={8} fill="currentColor" fillOpacity={0.25} />
        <rect width={4} height={8} fill="currentColor" />
      </pattern>
      <pattern id={`${idPrefix}-dots`} width={8} height={8} patternUnits="userSpaceOnUse">
        <rect width={8} height={8} fill="currentColor" fillOpacity={0.25} />
        <circle cx={4} cy={4} r={2} fill="currentColor" />
      </pattern>
      <pattern id={`${idPrefix}-horizontal`} width={8} height={8} patternUnits="userSpaceOnUse">
        <rect width={8} height={8} fill="currentColor" fillOpacity={0.25} />
        <rect width={8} height={3} fill="currentColor" />
      </pattern>
    </defs>
  );
}

function patternFill(idPrefix: string, index: number): string {
  const kind: PatternKind = PATTERN_KINDS[index % PATTERN_KINDS.length]!;
  return `url(#${idPrefix}-${kind})`;
}

/**
 * A legend swatch that renders the *same* pattern kind as its series' bars
 * — a self-contained `<svg>` with its own tiny local `<defs>`, rather than
 * a `fill="url(#id)"` reference into the main chart's `<defs>`. SVG `url()`
 * references resolve by document id, and while modern engines generally
 * resolve one across sibling SVG roots, that is a cross-browser assumption
 * this file has no way to verify directly (unlike, say, the Tailwind
 * compiled-output claims elsewhere in this wave, which were checked against
 * a real build) — a self-contained 12×12 definition costs nothing at this
 * size and needs no such assumption at all. Also: CSS `background-color`
 * cannot reference an SVG pattern (`url(#id)` is only a valid `fill`/
 * `stroke` value in SVG, not a CSS background value) — a real, easy mistake
 * this component avoids by never attempting it.
 */
function LegendSwatch({ index }: { index: number }): React.ReactElement {
  const localId = React.useId().replace(/[^a-zA-Z0-9-]/g, "");
  return (
    <svg width={12} height={12} aria-hidden="true" className={seriesColorClassName(index)}>
      <PatternDefs idPrefix={localId} />
      <rect width={12} height={12} fill={patternFill(localId, index)} />
    </svg>
  );
}

/** `--chart-1`…`--chart-6` (design-system.md §4.5), cycled past 6 series — matches `Icon`'s own "cycle, don't error" posture for an unbounded caller-supplied list. */
const CHART_COLOR_CLASSES = [
  "text-chart-1",
  "text-chart-2",
  "text-chart-3",
  "text-chart-4",
  "text-chart-5",
  "text-chart-6",
] as const;

function seriesColorClassName(index: number): string {
  return CHART_COLOR_CLASSES[index % CHART_COLOR_CLASSES.length]!;
}

function defaultValueFormatter(value: number): string {
  return String(value);
}

// ---------------------------------------------------------------------------
// Bar rendering
// ---------------------------------------------------------------------------

function BarChart({
  categories,
  series,
  orientation,
  idPrefix,
  valueFormatter,
}: {
  categories: readonly string[];
  series: readonly ChartFrameSeries[];
  orientation: ChartFrameOrientation;
  idPrefix: string;
  valueFormatter: (value: number) => string;
}): React.ReactElement {
  const maxValue = Math.max(1, ...series.flatMap((s) => s.values));
  const plotWidth = VIEWBOX_WIDTH - PLOT_PADDING * 2;
  const plotHeight = VIEWBOX_HEIGHT - PLOT_PADDING * 2;
  const groupCount = categories.length;
  const groupGap = 12;
  const groupWidth = groupCount > 0 ? (plotWidth - groupGap * (groupCount - 1)) / groupCount : 0;
  const barGap = 3;
  const barWidth =
    series.length > 0 ? (groupWidth - barGap * (series.length - 1)) / series.length : groupWidth;

  return (
    <g>
      {categories.map((category, categoryIndex) => {
        const groupStart =
          orientation === "vertical"
            ? PLOT_PADDING + categoryIndex * (groupWidth + groupGap)
            : PLOT_PADDING + categoryIndex * (groupWidth + groupGap);

        return (
          <g key={category}>
            {series.map((s, seriesIndex) => {
              const value = s.values[categoryIndex] ?? 0;
              const ratio = value / maxValue;

              if (orientation === "vertical") {
                const barHeight = ratio * plotHeight;
                const x = groupStart + seriesIndex * (barWidth + barGap);
                const y = PLOT_PADDING + plotHeight - barHeight;
                return (
                  <g key={s.id} className={seriesColorClassName(seriesIndex)}>
                    <rect
                      x={x}
                      y={y}
                      width={barWidth}
                      height={barHeight}
                      fill={patternFill(idPrefix, seriesIndex)}
                    >
                      <title>{`${s.label}, ${category}: ${valueFormatter(value)}`}</title>
                    </rect>
                    <text
                      x={x + barWidth / 2}
                      y={y - 4}
                      textAnchor="middle"
                      fill="var(--foreground)"
                      style={{ fontSize: 8 }}
                    >
                      {valueFormatter(value)}
                    </text>
                  </g>
                );
              }

              // Horizontal: groups stack top-to-bottom, bars extend along
              // the inline axis. The SVG coordinate system itself has no
              // `dir` concept — mirroring the whole chart under RTL (rather
              // than only the surrounding chrome) is a deliberate choice for
              // *categorical* bars, unlike the temporal-axis case this
              // module's `ChartFrame` doc comment covers, so this orientation
              // is wrapped in a `dir="auto"`-inheriting group by the caller
              // rather than forced `ltr` here.
              const trackHeight = barWidth;
              const trackY = groupStart + seriesIndex * (trackHeight + barGap);
              const barLength = ratio * plotWidth;
              return (
                <g key={s.id} className={seriesColorClassName(seriesIndex)}>
                  <rect
                    x={PLOT_PADDING}
                    y={trackY}
                    width={barLength}
                    height={trackHeight}
                    fill={patternFill(idPrefix, seriesIndex)}
                  >
                    <title>{`${s.label}, ${category}: ${valueFormatter(value)}`}</title>
                  </rect>
                  <text
                    x={PLOT_PADDING + barLength + 4}
                    y={trackY + trackHeight / 2 + 3}
                    fill="var(--foreground)"
                    style={{ fontSize: 8 }}
                  >
                    {valueFormatter(value)}
                  </text>
                </g>
              );
            })}
            <text
              x={orientation === "vertical" ? groupStart + groupWidth / 2 : PLOT_PADDING - 4}
              y={
                orientation === "vertical"
                  ? VIEWBOX_HEIGHT - PLOT_PADDING + 14
                  : groupStart + groupWidth / 2 + 3
              }
              textAnchor={orientation === "vertical" ? "middle" : "end"}
              fill="var(--muted-foreground)"
              style={{ fontSize: 9 }}
            >
              {category}
            </text>
          </g>
        );
      })}
    </g>
  );
}

// ---------------------------------------------------------------------------
// Line rendering
// ---------------------------------------------------------------------------

/** Dash patterns, cycled by series index — the line-chart equivalent of the bar chart's fill patterns, since a stroke has no area for a tiled fill pattern to render into. */
const LINE_DASH_PATTERNS = [undefined, "5 3", "1 3", "8 3 2 3"] as const;

function LineChart({
  categories,
  series,
  valueFormatter,
}: {
  categories: readonly string[];
  series: readonly ChartFrameSeries[];
  valueFormatter: (value: number) => string;
}): React.ReactElement {
  const maxValue = Math.max(1, ...series.flatMap((s) => s.values));
  const minValue = Math.min(0, ...series.flatMap((s) => s.values));
  const range = maxValue - minValue || 1;
  const plotWidth = VIEWBOX_WIDTH - PLOT_PADDING * 2;
  const plotHeight = VIEWBOX_HEIGHT - PLOT_PADDING * 2;

  const xForIndex = (index: number) =>
    PLOT_PADDING + (index / Math.max(categories.length - 1, 1)) * plotWidth;
  const yForValue = (value: number) =>
    PLOT_PADDING + plotHeight - ((value - minValue) / range) * plotHeight;

  return (
    <g>
      {categories.map((category, index) => (
        <text
          key={category}
          x={xForIndex(index)}
          y={VIEWBOX_HEIGHT - PLOT_PADDING + 14}
          textAnchor="middle"
          fill="var(--muted-foreground)"
          style={{ fontSize: 9 }}
        >
          {category}
        </text>
      ))}
      {series.map((s, seriesIndex) => {
        const points = s.values
          .map((value, index) => `${xForIndex(index)},${yForValue(value)}`)
          .join(" ");
        const dash = LINE_DASH_PATTERNS[seriesIndex % LINE_DASH_PATTERNS.length];
        return (
          <g key={s.id} className={seriesColorClassName(seriesIndex)}>
            <polyline
              points={points}
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              {...(dash !== undefined ? { strokeDasharray: dash } : {})}
            />
            {s.values.map((value, index) => (
              <circle
                key={index}
                cx={xForIndex(index)}
                cy={yForValue(value)}
                r={2.5}
                fill="currentColor"
              >
                <title>{`${s.label}, ${categories[index]}: ${valueFormatter(value)}`}</title>
              </circle>
            ))}
          </g>
        );
      })}
    </g>
  );
}

// ---------------------------------------------------------------------------
// Table fallback
// ---------------------------------------------------------------------------

function ChartFrameTable({
  title,
  seriesColumnLabel,
  categories,
  series,
  valueFormatter,
}: {
  title: string;
  seriesColumnLabel: string;
  categories: readonly string[];
  series: readonly ChartFrameSeries[];
  valueFormatter: (value: number) => string;
}): React.ReactElement {
  return (
    // The one legitimate `<table>` outside `components/patterns/data-table/`
    // — this wave's `ChartFrame` brief is explicit that a plain, real
    // `<table>` is the right fallback for one specific chart's own data,
    // never a reusable table component (`no-raw-table.mjs`'s own header
    // comment states its exemption the same way, for the same reason).
    <table className="w-full border-collapse text-sm">
      <caption className="sr-only">{title}</caption>
      <thead>
        <tr>
          <th
            scope="col"
            className="border-b border-border text-start text-muted-foreground"
            style={{ padding: "var(--space-2)" }}
          >
            {
              // Visually blank — the corner cell of a series×category matrix
              // has no visible name of its own — but a *real* accessible
              // name, `sr-only`: an empty `<th>` is a genuine axe violation
              // (`empty-table-header`), not a stylistic nicety, since a
              // screen-reader user landing on it by header navigation would
              // otherwise hear nothing at all.
            }
            <span className="sr-only">{seriesColumnLabel}</span>
          </th>
          {categories.map((category) => (
            <th
              key={category}
              scope="col"
              className="border-b border-border text-start font-medium"
              style={{ padding: "var(--space-2)" }}
            >
              {category}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {series.map((s) => (
          <tr key={s.id}>
            <th
              scope="row"
              className="border-b border-border text-start font-medium"
              style={{ padding: "var(--space-2)" }}
            >
              {s.label}
            </th>
            {s.values.map((value, index) => (
              <td
                key={index}
                dir="ltr"
                style={{ unicodeBidi: "isolate", padding: "var(--space-2)" }}
                className="border-b border-border font-mono tabular-nums"
              >
                {valueFormatter(value)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ---------------------------------------------------------------------------
// ChartFrame
// ---------------------------------------------------------------------------

export interface ChartFrameProps {
  variant: ChartFrameVariant;
  /** `bar` only; ignored for `line`. Default `"vertical"`. */
  orientation?: ChartFrameOrientation;
  /** Accessible **and** visible title — rendered as the `<figure>`'s `<figcaption>` (mirrors `KpiTile`'s identical `<figure>`/`<figcaption>` convention for a data visualisation's name). Mandatory (design-system.md §5.5 #57). */
  title: string;
  /** Mandatory accessible description — one sentence of context a title alone can't carry (e.g. "Conversations by channel, last 7 days"). */
  description: string;
  categories: readonly string[];
  series: readonly ChartFrameSeries[];
  /** Formats a raw value for both the direct SVG labels and the table fallback — `Intl.NumberFormat` in real feature code, never a hand-rolled formatter (§11.5). Default is a bare `String(value)`. */
  valueFormatter?: (value: number) => string;
  /**
   * States that `categories` is a time axis (dates, hours) rather than a
   * category axis (channel names, intent labels) — design-system.md §11.6:
   * *"Chart time axes … time still runs left→right, because a mirrored time
   * axis reads as reversed causality."* When `true`, the plotted chart
   * (never the surrounding chrome — title, description, legend, toggle all
   * still follow the page's own direction) is wrapped `dir="ltr"` so the
   * axis cannot flip under an RTL page, matching exactly how `MonoSubLine`/
   * `CodeBlock`/`KpiTile`'s own sparkline isolate LTR-only content (§11.3).
   * Left `false` for genuinely categorical axes (B1's channel split), which
   * mirror normally along with the rest of the page layout.
   */
  xAxisIsTemporal?: boolean;
  /** Default is English; pass a translated pair in real feature code. */
  chartViewLabel?: string;
  tableViewLabel?: string;
  viewToggleAriaLabel?: string;
  /** Accessible-only name for the table fallback's leading (series) header column — see `ChartFrameTable`'s doc comment. Default is English. */
  seriesColumnLabel?: string;
  className?: string;
}

/**
 * Wraps a chart implementation once (design-system.md §5.5 #57 — B1's
 * channel-split bars, top-intents list, KPI sparklines). **No charting
 * library added.** Checked what's installed first (nothing chart-specific —
 * `apps/web/package.json` has no `dependencies` for one), then worked
 * through whether the two chart types this wave actually needs — bars,
 * line/sparkline — are reasonably buildable as plain inline SVG the way
 * `kpi-tile.tsx`'s own sparkline already does for a simpler case. Both are:
 * a bar is a `<rect>` sized by a ratio, a line is a `<polyline>` — neither
 * needs a scale/axis/tooltip engine to do honestly. Choosing inline SVG over
 * a dependency also sidesteps the one real risk the brief flags for this
 * component specifically — a charting library whose own theming config only
 * accepts literal hex/rgb colours would either fight the token gate
 * (`no-hardcoded-design-values.mjs` bans a hex literal in `.tsx` precisely
 * *because* `GraphCanvas`/`ChartFrame` are "exactly where a hardcoded hex
 * would otherwise survive review" — that gate's own comment) or need a
 * runtime bridge from CSS custom properties into the library's own colour
 * objects. Plain SVG has neither problem: every colour here is
 * `var(--chart-N)` via a Tailwind `text-chart-N` class feeding `currentColor`,
 * exactly like every other component in this system.
 *
 * Mandatory per §5.5 #57, all real, none deferred: an accessible title
 * (`title`, required) and description (`description`, required); a
 * `"View as table"` toggle rendering the identical series×category data as
 * a real `<table>` (see `ChartFrameTable`) — the same dual-representation
 * philosophy `GraphCanvas`/`FlowCanvas` already use for their own
 * mandatory list/outline views, so the plotted SVG here is `aria-hidden`
 * rather than hand-rolling per-bar ARIA that the real table already covers
 * more robustly; `--chart-1`…`6` plus a cycled pattern fill per series
 * (§6.1 — colour is never the only channel); direct value labels on every
 * bar/point rather than a legend as the primary read (a compact legend row
 * still renders for `series.length > 1`, as a supplementary aid, since §6.1
 * *prefers* direct labels rather than banning a legend outright).
 */
export const ChartFrame = React.forwardRef<HTMLElement, ChartFrameProps>(function ChartFrame(
  {
    variant,
    orientation = "vertical",
    title,
    description,
    categories,
    series,
    valueFormatter = defaultValueFormatter,
    xAxisIsTemporal = false,
    chartViewLabel = "Chart",
    tableViewLabel = "Table",
    viewToggleAriaLabel = "Chart display",
    seriesColumnLabel = "Series",
    className,
  },
  ref,
) {
  const idPrefix = React.useId().replace(/[^a-zA-Z0-9-]/g, "");
  const [view, setView] = React.useState<"chart" | "table">("chart");

  const viewOptions = [
    { value: "chart", label: chartViewLabel },
    { value: "table", label: tableViewLabel },
  ];

  return (
    <figure
      ref={ref}
      data-slot="chart-frame"
      className={cn("flex flex-col", className)}
      style={{ gap: "var(--space-3)" }}
    >
      <div
        className="flex flex-wrap items-center justify-between"
        style={{ gap: "var(--space-2)" }}
      >
        <div>
          <figcaption className="text-sm font-semibold text-foreground">{title}</figcaption>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
        <ToggleRow
          options={viewOptions}
          aria-label={viewToggleAriaLabel}
          value={view}
          onValueChange={(value) => setView(value as "chart" | "table")}
        />
      </div>

      {view === "table" ? (
        <ChartFrameTable
          title={title}
          seriesColumnLabel={seriesColumnLabel}
          categories={categories}
          series={series}
          valueFormatter={valueFormatter}
        />
      ) : (
        <>
          <div dir={xAxisIsTemporal ? "ltr" : undefined}>
            <svg
              viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
              // The plotted graphic is decorative: every value it carries is
              // also, and more robustly, available through the real
              // `<table>` one toggle away — see the component doc comment.
              aria-hidden="true"
              className="h-auto w-full"
            >
              <PatternDefs idPrefix={idPrefix} />
              {variant === "bar" ? (
                <BarChart
                  categories={categories}
                  series={series}
                  orientation={orientation}
                  idPrefix={idPrefix}
                  valueFormatter={valueFormatter}
                />
              ) : (
                <LineChart
                  categories={categories}
                  series={series}
                  valueFormatter={valueFormatter}
                />
              )}
            </svg>
          </div>
          {series.length > 1 ? (
            <ul className="flex flex-wrap items-center" style={{ gap: "var(--space-4)" }}>
              {series.map((s, index) => (
                <li key={s.id} className="flex items-center" style={{ gap: "var(--space-1)" }}>
                  <LegendSwatch index={index} />
                  <span className="text-xs text-muted-foreground">{s.label}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      )}
    </figure>
  );
});
