import * as React from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { Icon } from "./icon";
import { Skeleton } from "./skeleton";

interface KpiDelta {
  /** The literal numeric direction the value moved — the glyph always tracks this, regardless of whether the move is good or bad. */
  direction: "up" | "down";
  /** Caller-formatted magnitude phrase, e.g. "3 pts", "0.7 pts" — this component composes only the glyph and the up/down/worse/better word around it (§11.3 rule 4: no sentence built by concatenating raw numbers). */
  magnitudeText: string;
}

// A type alias, not an (empty) `interface extends` — this project's lint
// config flags an interface that declares no members beyond its supertype
// (kbd.tsx's identical note).
type KpiTileDomProps = Omit<React.HTMLAttributes<HTMLElement>, "children">;

interface KpiTileSharedProps extends KpiTileDomProps {
  /** `<figcaption>` text — B1 tab 1's "Total conversations", "Containment rate", etc. */
  label: string;
  /**
   * A metric where *down* is the good direction (B1's tool error rate). Only
   * this flag decides whether "up" reads as success or destructive — the
   * glyph direction never changes, only the word and the colour, so the
   * meaning survives a colour-blind read exactly as §5.4 requires.
   */
  invertedGood?: boolean;
  delta?: KpiDelta;
  /** Values for a minimal inline sparkline. No charting library — see the module doc comment. */
  sparklineValues?: readonly number[];
  /**
   * Accessible name for the `state="empty"` value, overridable so a caller
   * can supply a translated string once this screen is wired to next-intl —
   * this component does not import next-intl itself (framework-agnostic,
   * matching progress-bar.tsx's precedent), so the English default lives
   * here as an overridable prop rather than a hardcoded literal (§12.3).
   */
  emptyLabel?: string;
}

export type KpiTileProps =
  | (KpiTileSharedProps & { state?: "default"; value: string })
  | (KpiTileSharedProps & { state: "loading" })
  | (KpiTileSharedProps & { state: "error"; errorMessage: string })
  | (KpiTileSharedProps & { state: "empty" });

const SPARKLINE_VIEWBOX_WIDTH = 100;
const SPARKLINE_VIEWBOX_HEIGHT = 28;

/**
 * Minimal inline sparkline — a plain SVG polyline driven by a numeric array,
 * deliberately not a charting library (B1's brief explicitly scopes that to
 * the later `ChartFrame` organism, which wraps a real chart library once).
 * No RTL flip class, and wrapped in a `dir="ltr"` element (React's
 * `SVGProps` type has no `dir` of its own to put directly on the `<svg>` —
 * confirmed by `tsc`, not assumed — so the isolation is established on its
 * parent instead, which is exactly how ancestor-`dir` bidi scoping works):
 * §11.6 lists chart time axes under "does not mirror" — a mirrored sparkline
 * would read as time running backwards.
 */
function Sparkline({
  values,
  toneClassName,
}: {
  values: readonly number[];
  toneClassName: string;
}) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const points = values
    .map((value, index) => {
      const x = (index / Math.max(values.length - 1, 1)) * SPARKLINE_VIEWBOX_WIDTH;
      const y = SPARKLINE_VIEWBOX_HEIGHT - ((value - min) / range) * SPARKLINE_VIEWBOX_HEIGHT;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <div dir="ltr" className="mt-2">
      <svg
        viewBox={`0 0 ${SPARKLINE_VIEWBOX_WIDTH} ${SPARKLINE_VIEWBOX_HEIGHT}`}
        preserveAspectRatio="none"
        aria-hidden="true"
        className={cn("h-7 w-full", toneClassName)}
      >
        <polyline points={points} fill="none" stroke="currentColor" strokeWidth={1.5} />
      </svg>
    </div>
  );
}

function resolveDeltaWord(direction: "up" | "down", invertedGood: boolean): string {
  if (!invertedGood) return direction;
  return direction === "up" ? "worse" : "better";
}

function resolveDeltaIsGood(direction: "up" | "down", invertedGood: boolean): boolean {
  return invertedGood ? direction === "down" : direction === "up";
}

function DeltaLine({ delta, invertedGood }: { delta: KpiDelta; invertedGood: boolean }) {
  const isGood = resolveDeltaIsGood(delta.direction, invertedGood);
  return (
    <p
      className={cn(
        "mt-1 flex items-center gap-1 text-xs font-medium",
        isGood ? "text-success-strong" : "text-destructive-strong",
      )}
    >
      <Icon
        icon={delta.direction === "up" ? ArrowUp : ArrowDown}
        size={14}
        // Vertical trend arrows, not the horizontal navigational kind §11.6's
        // `MIRROR_IN_RTL_ICONS` allowlist covers — stated explicitly rather
        // than left to the allowlist's silent default, the same way
        // `Spinner` states its own rotation.
        mirrorInRtl={false}
      />
      <span dir="ltr" style={{ unicodeBidi: "isolate" }}>
        {resolveDeltaWord(delta.direction, invertedGood)} {delta.magnitudeText}
      </span>
    </p>
  );
}

interface ChromeProps extends KpiTileDomProps {
  label: string;
  state: "default" | "loading" | "error" | "empty";
  children: React.ReactNode;
}

/**
 * Shared `<figure>`/`<figcaption>` chrome. Factored out for the same reason
 * `summary-strip.tsx`'s `SummaryStripShell` is: each branch of the
 * `KpiTileProps` union destructures only the fields it actually has (`value`
 * only exists on the default branch, `errorMessage` only on error), so
 * nothing state-specific ever survives into `...domProps` and leaks onto the
 * rendered `<figure>` as an invalid DOM attribute.
 */
const KpiTileChrome = React.forwardRef<HTMLElement, ChromeProps>(function KpiTileChrome(
  { label, state, className, style, children, ...domProps },
  ref,
) {
  return (
    <figure
      ref={ref}
      data-slot="kpi-tile"
      data-state={state}
      style={{
        borderRadius: "var(--radius-xl)",
        padding: "var(--card-padding)",
        ...style,
      }}
      className={cn("border border-border bg-card text-card-foreground shadow-sm", className)}
      {...domProps}
    >
      {
        // §11.4: `text-transform: uppercase` on a micro-label must apply only
        // under `:not(:lang(ar))` — Arabic has no case, and uppercase breaks
        // it. That scoping is base-layer work (globals.css), and as of this
        // batch globals.css only scopes `--font-arabic` (§11.2), not
        // `text-transform`/`tracking-*` — a real, pre-existing gap this is
        // the first component to actually hit (no earlier atom combined
        // `uppercase`+`tracking-wide`), flagged here rather than silently
        // worked around with a one-off selector in this file, which would
        // fix only this component instead of the rule §11.4 actually states.
      }
      <figcaption className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </figcaption>
      {children}
    </figure>
  );
});

/**
 * A single current value + trend dashboard tile (design-system.md §5.4, full prose,
 * written against B1 tab 1's four metrics). `<figure>` + `<figcaption>` rather than a
 * generic `Card` composition — see this file's anatomy: figure/figcaption is the
 * semantically correct wrapper for "a value with a caption," and `Card`'s children
 * model is generic prose, not this fixed label/value/delta shape. Shares `--card-*`
 * tokens with `Card`'s `metric` variant (same surface, same radius, same shadow)
 * without composing `Card` itself, so both stay visually identical while each keeps a
 * structure suited to its own content.
 *
 * **Not actually consumed by B1 tab 1 — a deliberate divergence, confirmed against the
 * real wireframe, not an oversight** (found and left this way rather than force-fit,
 * 2026-09-10). `command-centre/overview-tab.tsx` renders the KPI grid as a
 * `DataTable<KpiTableRow>` instead: `docs/SHJ3-wireframes-guide.md`'s own B1 tab 1
 * section is a literal 4-row × 3-column table (`Today` / `Last 7 days` / `Last 30
 * days` as three PERMANENT columns shown simultaneously, not three states of one
 * toggled view — `GetOverviewMetrics`'s own doc comment states this explicitly, having
 * been read from the real wireframe rather than assumed). This tile's whole anatomy —
 * one value, one delta, one optional sparkline — represents exactly one range at a
 * time; it cannot represent a 3-column simultaneous comparison without either losing
 * two of the three columns or rendering three tiles per metric, which is not what any
 * spec (this file's own §5.4 entry included) describes. §5.4's prose was written
 * generically for "a dashboard KPI tile" before the wireframe's specific 3-column shape
 * for B1 tab 1 was reconciled against it — this component remains real, tested, and
 * ready for the shape it actually fits: a single-range dashboard tile with a
 * trend/delta against a prior period, wherever this codebase next needs exactly that
 * (a future screen showing one selected range at a time, not a fixed side-by-side
 * comparison of several ranges at once).
 */
export const KpiTile = React.forwardRef<HTMLElement, KpiTileProps>(function KpiTile(props, ref) {
  // Each branch below destructures fresh from the narrowed `props` (matching
  // progress-bar.tsx's own established shape for this problem) rather than
  // hoisting one shared destructure above the branches: `value` only exists
  // on the default branch and `errorMessage` only on error, so a single
  // top-level destructure can't cleanly separate "known field" from
  // "...domProps" for every branch at once — and every named field has to be
  // pulled out of `domProps` somewhere, or it leaks onto the `<figure>` as an
  // invalid DOM attribute (a real bug an earlier draft of this file shipped
  // with, caught by this component's own render test logging a React DOM
  // warning for `errorMessage`).

  if (props.state === "loading") {
    const { label, invertedGood, delta, sparklineValues, emptyLabel, state, ...domProps } = props;
    void invertedGood;
    void delta;
    void sparklineValues;
    void emptyLabel;
    return (
      <KpiTileChrome ref={ref} label={label} state={state} {...domProps}>
        <Skeleton variant="text" className="mt-2 h-8 w-20" aria-label="Loading" />
      </KpiTileChrome>
    );
  }

  if (props.state === "error") {
    const {
      label,
      invertedGood,
      delta,
      sparklineValues,
      emptyLabel,
      state,
      errorMessage,
      ...domProps
    } = props;
    void invertedGood;
    void delta;
    void sparklineValues;
    void emptyLabel;
    return (
      <KpiTileChrome ref={ref} label={label} state={state} {...domProps}>
        <p role="alert" className="mt-2 text-sm text-destructive-strong">
          {errorMessage}
        </p>
      </KpiTileChrome>
    );
  }

  if (props.state === "empty") {
    const {
      label,
      invertedGood,
      delta,
      sparklineValues,
      emptyLabel = "no data for this range",
      state,
      ...domProps
    } = props;
    void invertedGood;
    void delta;
    void sparklineValues;
    return (
      <KpiTileChrome ref={ref} label={label} state={state} {...domProps}>
        <p className="mt-2 font-mono text-2xl font-semibold tabular-nums" aria-label={emptyLabel}>
          —
        </p>
      </KpiTileChrome>
    );
  }

  const {
    label,
    invertedGood = false,
    delta,
    sparklineValues,
    emptyLabel,
    state = "default",
    value,
    ...domProps
  } = props;
  void emptyLabel;
  const sparklineToneClassName = delta
    ? resolveDeltaIsGood(delta.direction, invertedGood)
      ? "text-success-strong"
      : "text-destructive-strong"
    : "text-chart-1";

  return (
    <KpiTileChrome ref={ref} label={label} state={state} {...domProps}>
      <p className="mt-2 font-mono text-2xl font-semibold tabular-nums">{value}</p>
      {delta ? <DeltaLine delta={delta} invertedGood={invertedGood} /> : null}
      {sparklineValues && sparklineValues.length > 1 ? (
        <Sparkline values={sparklineValues} toneClassName={sparklineToneClassName} />
      ) : null}
    </KpiTileChrome>
  );
});
