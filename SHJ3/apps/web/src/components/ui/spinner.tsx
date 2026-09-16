import * as React from "react";
import { LoaderCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Icon, type IconSize } from "./icon";
import "./atom-motion.css";

const SPINNER_ICON_SIZE: Readonly<Record<"xs" | "sm" | "md", IconSize>> = {
  xs: 14,
  sm: 16,
  md: 20,
};

export interface SpinnerProps extends Omit<
  React.SVGProps<SVGSVGElement>,
  "color" | "fill" | "stroke" | "children" | "aria-hidden" | "aria-label" | "role"
> {
  size?: "xs" | "sm" | "md";
  /**
   * Visually-announced accessible name (e.g. "Loading results"). Omit when
   * the spinner sits next to visible status text that already says so (A3's
   * "◐ Still thinking…" row, for instance) — naming it twice is as wrong as
   * not naming it at all.
   */
  label?: string;
}

/**
 * Indeterminate work indicator (design-system.md §5.3 #18). Built on `Icon`
 * wrapping lucide's `LoaderCircle` rather than a hand-drawn SVG, so it
 * inherits the `currentColor`-only rule and the accessible-name contract for
 * free instead of re-solving both here.
 *
 * Not in the §5.2 eight-state table, and that omission is deliberate rather
 * than an oversight worth flagging: a spinner *is* the loading state for
 * whatever it sits inside (a button, a panel), so the state model applies to
 * the control it decorates, not to this glyph.
 *
 * Rotation comes from `shj3-animate-spin` (`atom-motion.css`), not a lucide
 * animation prop — see that file's header for the real reason: the generated
 * Tailwind theme bridge resets `--animate-*` to `initial` with no
 * replacement, which silently removes Tailwind's built-in `animate-spin`
 * everywhere in the app, not just here. Under `prefers-reduced-motion`, the
 * same stylesheet sets `animation: none`, which is what makes this render as
 * the static glyph design-system.md §5.3 requires — consistent with how
 * `Skeleton` solves the identical problem, rather than a second mechanism.
 */
export const Spinner = React.forwardRef<SVGSVGElement, SpinnerProps>(function Spinner(
  { size = "sm", label, className, ...props },
  ref,
) {
  return (
    <Icon
      ref={ref}
      icon={LoaderCircle}
      size={SPINNER_ICON_SIZE[size]}
      label={label}
      // §11.6: "the clock/spinner rotation direction" is explicitly listed
      // under "Does not mirror" — stated here rather than left to
      // MIRROR_IN_RTL_ICONS' absence-means-no default, so a reader does not
      // have to go check the allowlist to know this is intentional.
      mirrorInRtl={false}
      className={cn("shj3-animate-spin", className)}
      {...props}
    />
  );
});
