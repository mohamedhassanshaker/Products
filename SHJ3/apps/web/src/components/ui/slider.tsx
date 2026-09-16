"use client";

import * as React from "react";
import { Slider as SliderPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";
import { useResolvedDir } from "./use-resolved-dir";

interface SliderBaseProps {
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  /** BCP-47 locale for the default `Intl.NumberFormat` label — see progress-bar.tsx's identical `locale` prop for why this is a plain string rather than a `next-intl` import. */
  locale?: string;
  /** Overrides the default `Intl.NumberFormat` rendering of one thumb's value, e.g. to append a unit ("70%", "240 ms"). */
  formatValue?: (value: number) => string;
  className?: string;
  id?: string;
}

export interface SliderSingleProps extends SliderBaseProps {
  variant?: "single" | "stepped";
  /** Accessible name for the one thumb. */
  "aria-label": string;
  value?: number;
  defaultValue?: number;
  onValueChange?: (value: number) => void;
  onValueCommit?: (value: number) => void;
}

export interface SliderRangeProps extends SliderBaseProps {
  variant: "range";
  /**
   * Accessible names for each thumb, in track order (start thumb, end
   * thumb) — a range has two, so one string cannot name both. Deliberately
   * not called `aria-label` the way the single-thumb variant's prop is:
   * `jsx-a11y/aria-proptypes` correctly assumes a literal `aria-label`
   * attribute is always a string, and overloading that exact name with a
   * tuple type here — even though it is *this component's own prop*, not
   * the native DOM attribute — trips that rule. A distinct name sidesteps
   * the collision rather than suppressing a lint rule that is right about
   * the real, native `aria-label` attribute everywhere else it fires.
   */
  thumbAriaLabels: readonly [string, string];
  value?: readonly [number, number];
  defaultValue?: readonly [number, number];
  onValueChange?: (value: readonly [number, number]) => void;
  onValueCommit?: (value: readonly [number, number]) => void;
}

export type SliderProps = SliderSingleProps | SliderRangeProps;

/** `Intl`-based formatting (design-system.md §11.5), Latin digits (§11.4) — the same rule and mechanism `progress-bar.tsx`'s `formatPercentLabel` follows, generalised from percent to a plain number since Slider has no fixed unit. */
function defaultFormat(value: number, locale: string | undefined): string {
  return new Intl.NumberFormat(locale, { numberingSystem: "latn" }).format(value);
}

interface SliderThumbSpec {
  value: number;
  ariaLabel: string;
}

/** `stepped` variant's tick marks — one per step, purely decorative (the thumb's own value already carries the meaning). */
function SliderTicks({
  min,
  max,
  step,
}: {
  min: number;
  max: number;
  step: number;
}): React.ReactElement {
  const count = step > 0 ? Math.floor((max - min) / step) + 1 : 0;
  // Not `Array.from({ length: count }, (_, index) => index)`: this project's
  // lint config rejects any named unused callback parameter.
  const ticks: number[] = [];
  for (let index = 0; index < count; index++) ticks.push(index);
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 flex items-center justify-between"
    >
      {ticks.map((index) => (
        <span
          key={index}
          className="rounded-full bg-border-strong"
          style={{ inlineSize: "var(--space-px)", blockSize: "var(--space-2)" }}
        />
      ))}
    </div>
  );
}

/**
 * Radix Slider (design-system.md §5.4 #28 — B6 tab 3's 60/40 hybrid
 * weighting, the radius/shadow controls in §9). The live numeric label is
 * **mandatory, not tooltip-only**: rendered as real, always-present text
 * (never a hover-only affordance), so it reads correctly both visually and
 * to a screen reader with no interaction required to reveal it — plus
 * `aria-valuetext` on each thumb so assistive tech announces the same
 * formatted string, not a raw unformatted number.
 *
 * `min`/`max`/`step`, `Home`/`End`/arrow keys and `PageUp`/`PageDown`
 * stepping are Radix's own — confirmed by reading `@radix-ui/react-slider`'s
 * compiled source (`onStepKeyDown` handles arrows, Home/End and Page keys
 * uniformly) rather than assumed, and not reimplemented here.
 *
 * ## The RTL problem — Slider does NOT reverse correctly out of the box
 *
 * design-system.md §10.1 lists "value announcements, keyboard stepping, RTL
 * reversal" under what Radix supplies for `Slider`/`Progress`, and this
 * batch's own brief repeats the claim as (unlike `side`) accurate. Verified
 * directly against the installed package rather than taken on trust — the
 * same discipline that found `Tooltip`'s `side` claim false, applied here
 * too: `@radix-ui/react-slider`'s `SliderHorizontal` computes
 * `isDirectionLTR`/`isSlidingFromLeft` from `useDirection(dir)`, the
 * identical `@radix-ui/react-direction` helper `sub-tab-bar.tsx` and
 * `toggle-row.tsx` document (`localDir || globalDir || "ltr"`). With no
 * `DirectionProvider` anywhere in this app (§11.2) and no `dir` prop supplied
 * by default, `Slider` silently renders and steps as `"ltr"` forever,
 * regardless of the page's real direction — **§10.1's row and §5.4's row 28
 * are both wrong as stated**, corrected in the same commit that adds this
 * fix. Resolved via the shared `useResolvedDir()` hook and passed through
 * explicitly, exactly like the other two. `slider.test.tsx` steps a thumb
 * under both directions and asserts the *resolved* fill percentage and which
 * physical edge grows, not merely that a `dir` prop was forwarded.
 */
export const Slider = React.forwardRef<
  React.ComponentRef<typeof SliderPrimitive.Root>,
  SliderProps
>(function Slider(props, ref) {
  const dir = useResolvedDir();
  const { min = 0, max = 100, step = 1, disabled, locale, formatValue, className, id } = props;
  const format = formatValue ?? ((value: number) => defaultFormat(value, locale));
  const labelId = React.useId();

  let thumbs: SliderThumbSpec[];
  let emitChange: (next: number[]) => void;
  let emitCommit: (next: number[]) => void;

  if (props.variant === "range") {
    const {
      value,
      defaultValue,
      onValueChange,
      onValueCommit,
      thumbAriaLabels: ariaLabels,
    } = props;
    const seed = value ?? defaultValue ?? [min, max];
    thumbs = [
      { value: seed[0], ariaLabel: ariaLabels[0] },
      { value: seed[1], ariaLabel: ariaLabels[1] },
    ];
    emitChange = (next) => onValueChange?.([next[0] ?? min, next[1] ?? max]);
    emitCommit = (next) => onValueCommit?.([next[0] ?? min, next[1] ?? max]);
  } else {
    const { value, defaultValue, onValueChange, onValueCommit, "aria-label": ariaLabel } = props;
    thumbs = [{ value: value ?? defaultValue ?? min, ariaLabel }];
    emitChange = (next) => onValueChange?.(next[0] ?? min);
    emitCommit = (next) => onValueCommit?.(next[0] ?? min);
  }

  const resolvedValues = thumbs.map((thumb) => thumb.value);
  const labelText = thumbs.map((thumb) => format(thumb.value)).join(" – ");

  return (
    <div className={cn("w-full", className)}>
      <SliderPrimitive.Root
        ref={ref}
        dir={dir}
        min={min}
        max={max}
        step={step}
        // Conditional spreads, not `id={id}`/`disabled={disabled}` — see
        // checkbox.tsx's identical note: `exactOptionalPropertyTypes`
        // rejects an explicit `undefined` against Radix's own `id?: string`
        // / `disabled?: boolean`, and both are `| undefined` here whenever
        // the caller omitted them.
        {...(id !== undefined ? { id } : {})}
        {...(disabled !== undefined ? { disabled } : {})}
        value={resolvedValues}
        onValueChange={emitChange}
        onValueCommit={emitCommit}
        aria-describedby={labelId}
        className="relative flex w-full touch-none items-center"
        style={{ blockSize: "var(--control-height-sm)" }}
      >
        <SliderPrimitive.Track
          className="relative grow overflow-hidden rounded-full bg-muted"
          style={{ blockSize: "var(--space-1)" }}
        >
          <SliderPrimitive.Range
            className="absolute rounded-full bg-primary"
            style={{ blockSize: "100%" }}
          />
        </SliderPrimitive.Track>
        {props.variant === "stepped" ? <SliderTicks min={min} max={max} step={step} /> : null}
        {thumbs.map((thumb, index) => (
          <SliderPrimitive.Thumb
            key={index}
            aria-label={thumb.ariaLabel}
            aria-valuetext={format(thumb.value)}
            className={cn(
              "block shrink-0 rounded-full border-2 border-primary bg-card shadow-sm transition-colors",
              "outline-none",
              "focus-visible:[outline:var(--focus-ring-width)_solid_var(--ring)] focus-visible:[outline-offset:var(--focus-ring-offset)]",
              "disabled:cursor-not-allowed disabled:border-border-strong",
            )}
            style={{ inlineSize: "var(--space-4)", blockSize: "var(--space-4)" }}
          />
        ))}
      </SliderPrimitive.Root>
      <span id={labelId} className="mt-1 block font-mono text-2xs text-muted-foreground">
        {labelText}
      </span>
    </div>
  );
});
