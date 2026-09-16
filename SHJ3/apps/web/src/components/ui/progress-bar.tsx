import * as React from "react";
import { Progress as ProgressPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";
import "./atom-motion.css";

/**
 * Segment shape a later `Wizard`/stepper organism can plausibly reuse
 * (design-system.md §5.3 #12 — "support a `segments` prop shape a stepper
 * could plausibly consume", not this batch's job to build the wizard itself).
 * `total` + `completed` mirrors how a wizard already thinks about its own
 * state (a step count and a current-step index), rather than an array the
 * caller would have to synthesize just to render a bar.
 */
export interface ProgressBarSegments {
  readonly total: number;
  readonly completed: number;
}

interface ProgressBarSharedProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "children"> {
  /**
   * Visible numeric label (design-system.md §5.3 #12: "must be readable, not
   * inferred from bar width" — rendered as real text, never only an ARIA
   * attribute). For `determinate`, defaults to a Latin-digit
   * `Intl.NumberFormat` percent of `value`; pass explicitly to override or
   * when `locale` alone is not enough (e.g. a caller-composed "70% indexed"
   * sentence). Effectively required for `indeterminate`/`segmented`, where
   * there is no single percentage to default to.
   */
  label?: React.ReactNode;
  /**
   * BCP-47 locale tag used only for the default `determinate` label's
   * `Intl.NumberFormat`. This atom does not import `next-intl` itself — kept
   * framework-agnostic per this batch's dependency list — so pass the
   * caller's already-resolved `useLocale()` value down. Omitted, formatting
   * falls back to the runtime default locale.
   */
  locale?: string;
}

interface ProgressBarDeterminateProps extends ProgressBarSharedProps {
  variant?: "determinate";
  /** 0–100. */
  value: number;
}

interface ProgressBarIndeterminateProps extends Omit<ProgressBarSharedProps, "label"> {
  variant: "indeterminate";
  /**
   * Required — unlike `determinate`, there is no single meaningful
   * percentage to fall back to, and `role="progressbar"` must always have an
   * accessible name (WCAG 4.1.2 / axe's `aria-progressbar-name` rule; caught
   * by this atom's own `jest-axe` run against an earlier draft that made this
   * optional, not assumed up front).
   */
  label: React.ReactNode;
}

// `Omit<…, "locale">`, not the full `ProgressBarSharedProps`: `segmented`
// never calls `formatPercentLabel` (its fallback label is a plain
// "completed/total" count, not a percentage), so there is nothing for
// `locale` to do here — omitted from the type rather than destructured and
// discarded at runtime, which this project's lint config would reject as an
// unused variable (`no-unused-vars` with no underscore-prefix escape hatch).
interface ProgressBarSegmentedProps extends Omit<ProgressBarSharedProps, "locale"> {
  variant: "segmented";
  segments: ProgressBarSegments;
}

export type ProgressBarProps =
  ProgressBarDeterminateProps | ProgressBarIndeterminateProps | ProgressBarSegmentedProps;

/** Clamp to the 0–100 range a percentage bar can actually render. */
function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}

/**
 * `Intl`-based percent formatting (design-system.md §11.5 — "all formatting
 * goes through Intl, never a hand-rolled formatter"), forced to Latin digits
 * (§11.4: "every ID, amount and version in this system is Latin-digit") even
 * though the row's own EN/AR example columns happen to render identically
 * for percent — using `Intl.NumberFormat` rather than a `${n}%` template is
 * about following the one stated rule, not about this specific pair of
 * strings differing.
 */
function formatPercentLabel(percent: number, locale: string | undefined): string {
  return new Intl.NumberFormat(locale, { style: "percent", numberingSystem: "latn" }).format(
    percent / 100,
  );
}

/**
 * Thin track, primary-coloured fill, completeness percentage
 * (design-system.md §5.3 #12 — the wireframe's own named component).
 * Adapted from shadcn's `progress.tsx` scaffold (renamed to match this
 * project's naming — "Progress" is not a name design-system.md uses) rather
 * than rebuilt from scratch, since Radix's Progress primitive already
 * supplies the correct `role="progressbar"` + `aria-valuenow/min/max` wiring
 * for `determinate`/`indeterminate` (confirmed by reading
 * `@radix-ui/react-progress`'s source, not assumed) — the scaffold's token,
 * RTL and label gaps are what needed real work.
 *
 * **Fills from inline-start, and this genuinely mirrors under RTL — the
 * single most load-bearing detail in this file.** The raw scaffold computed
 * the fill with `transform: translateX(-${100 - value}%)` against a
 * full-width element: a physical transform anchored to the left edge, which
 * does not reverse under `dir="rtl"` even though the fill should logically
 * still read as "grown from the start". The fix is CSS logical positioning —
 * `inset-inline-start: 0` plus `inline-size: <percent>%` on an absolutely
 * positioned indicator inside a `position: relative` track — which the
 * browser flips automatically under RTL with zero JS (confirmed by compiling
 * `rtl:-scale-x-100`-style logical selectors through this project's real
 * Tailwind v4 pipeline while building `Icon`; the same `:dir(rtl)`/`[dir]`
 * mechanism applies to plain logical CSS properties, not just Tailwind's
 * `rtl:` variant). `ProgressBarSegmented.test.tsx`'s RTL assertion checks the
 * *resolved* inline style, not just that a prop was passed through.
 *
 * The `segmented` variant is hand-rolled rather than built on
 * `Progress.Root` — Radix's primitive models one continuous 0–100 value, not
 * N discrete steps, so reusing it here would mean fighting its ARIA model
 * instead of using it. It reimplements the same `role="progressbar"`
 * contract by hand instead.
 *
 * Not `"use client"`: `@radix-ui/react-progress` carries its own "use client"
 * (confirmed by reading its compiled source) and has no internal state of its
 * own — a stateless wrapper around an already-client primitive does not need
 * to re-declare the boundary.
 */
export const ProgressBar = React.forwardRef<HTMLDivElement, ProgressBarProps>(
  function ProgressBar(props, ref) {
    // One id shared by all three branches, connecting the visible label to the
    // `role="progressbar"` element via `aria-labelledby`. Required, not a nice-
    // to-have: axe's `aria-progressbar-name` rule (WCAG 4.1.2) failed on an
    // earlier draft that rendered the visible percentage *next to* the bar
    // without associating it — a real finding from this atom's own `jest-axe`
    // run, not a hypothetical. `useId` is one of the few hooks safe in a Server
    // Component (React generates a deterministic id at render time, no browser
    // API needed), so this does not force `"use client"` on the whole file.
    const labelId = React.useId();

    if (props.variant === "segmented") {
      const { segments, label, className, ...divProps } = props;
      const resolvedLabel = label ?? `${segments.completed}/${segments.total}`;
      const segmentEls: React.ReactNode[] = [];
      for (let index = 0; index < segments.total; index++) {
        segmentEls.push(
          <span
            key={index}
            aria-hidden="true"
            className={cn(
              "h-full flex-1 first:rounded-s-full last:rounded-e-full",
              index < segments.completed ? "bg-primary" : "bg-transparent",
            )}
          />,
        );
      }

      return (
        <div
          ref={ref}
          data-slot="progress-bar"
          data-variant="segmented"
          className={cn("w-full", className)}
          {...divProps}
        >
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={segments.total}
            aria-valuenow={segments.completed}
            aria-labelledby={labelId}
            className="relative flex items-center gap-px overflow-hidden rounded-full bg-muted"
            style={{ blockSize: "var(--progress-track-height)" }}
          >
            {segmentEls}
          </div>
          <span id={labelId} className="mt-1 block text-2xs text-muted-foreground">
            {resolvedLabel}
          </span>
        </div>
      );
    }

    if (props.variant === "indeterminate") {
      const { label, className, ...rootProps } = props;

      return (
        <div data-slot="progress-bar" className={cn("w-full", className)}>
          <ProgressPrimitive.Root
            ref={ref}
            value={null}
            aria-labelledby={labelId}
            className="relative w-full overflow-hidden rounded-full bg-muted"
            style={{ blockSize: "var(--progress-track-height)" }}
            {...rootProps}
          >
            <ProgressPrimitive.Indicator
              data-slot="progress-bar-indicator"
              className="shj3-animate-sweep absolute rounded-full bg-primary"
              // `insetBlockStart`/`blockSize` (not a Tailwind `inset-block-0`
              // class — probed directly through this project's real Tailwind v4
              // pipeline while building this atom, and no such utility
              // compiles: the `--container-*` namespace it would need is reset
              // to `initial` by the same theme bridge that removed
              // `animate-pulse`, with no replacement) fill the track's full
              // height regardless of direction — only the inline axis mirrors.
              style={{
                insetBlockStart: 0,
                blockSize: "100%",
                insetInlineStart: 0,
                inlineSize: "40%",
              }}
            />
          </ProgressPrimitive.Root>
          <span id={labelId} className="mt-1 block text-2xs text-muted-foreground">
            {label}
          </span>
        </div>
      );
    }

    const { value, label, locale, className, ...rootProps } = props;
    const percent = clampPercent(value);
    const resolvedLabel = label ?? formatPercentLabel(percent, locale);

    return (
      <div data-slot="progress-bar" className={cn("w-full", className)}>
        <ProgressPrimitive.Root
          ref={ref}
          value={percent}
          aria-labelledby={labelId}
          className="relative w-full overflow-hidden rounded-full bg-muted"
          style={{ blockSize: "var(--progress-track-height)" }}
          {...rootProps}
        >
          <ProgressPrimitive.Indicator
            data-slot="progress-bar-indicator"
            className="ease-standard absolute rounded-full bg-primary"
            style={{
              insetBlockStart: 0,
              blockSize: "100%",
              insetInlineStart: 0,
              inlineSize: `${percent}%`,
              transitionProperty: "inline-size",
              transitionDuration: "var(--duration-normal)",
            }}
          />
        </ProgressPrimitive.Root>
        <span id={labelId} className="mt-1 block text-2xs text-muted-foreground">
          {resolvedLabel}
        </span>
      </div>
    );
  },
);
