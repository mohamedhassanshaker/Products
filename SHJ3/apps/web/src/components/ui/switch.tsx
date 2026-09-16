"use client";

import * as React from "react";
import { Switch as SwitchPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";

/** See button.tsx for the full rationale. */
const FOCUS_VISIBLE_RING =
  "outline-none focus-visible:[outline:var(--focus-ring-width)_solid_var(--ring)] focus-visible:[outline-offset:var(--focus-ring-offset)]";

const TRACK_SIZE = {
  sm: { height: "var(--space-4)", width: "var(--space-8)" },
  md: { height: "var(--space-5)", width: "var(--space-10)" },
} as const;

const THUMB_SIZE = {
  sm: "var(--space-4)",
  md: "var(--space-5)",
} as const;

export interface SwitchProps extends React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root> {
  size?: "sm" | "md";
}

/**
 * Pill toggle (design-system.md §5.3 #8 — the wireframe's own "pill toggle,
 * green when on"). `role="switch"` + `aria-checked` are Radix's, unmodified.
 *
 * ## The RTL thumb problem
 *
 * The raw shadcn scaffold moved the thumb with
 * `data-[state=checked]:translate-x-[calc(100%-2px)]` — an arbitrary value
 * (banned) that is also *physically* wrong under `dir="rtl"`: `translate-x`
 * always moves right, so a checked switch in Arabic would slide toward the
 * reading *start*, not the end, while `aria-checked="true"` still (correctly)
 * says "on" — a visual/semantic mismatch.
 *
 * Fixed two ways, neither of them a fudge:
 *
 * 1. **No custom travel distance at all.** The track is sized exactly twice
 *    the thumb (`--space-8`/`--space-4` for `sm`, `--space-10`/`--space-5`
 *    for `md`) with the thumb flush against the track's own edges, so
 *    "travel one full track" is *always* exactly `translateX(100%)` —
 *    Tailwind's named, non-arbitrary `translate-x-full` utility, relative to
 *    the thumb's own box per the CSS transform spec. No pixel math, no
 *    per-size constant to keep in sync.
 * 2. **The sign flips under RTL via Tailwind's `rtl:`/`ltr:` variants**
 *    (compiled to `:where(:dir(rtl), [dir="rtl"], [dir="rtl"] *)` —
 *    confirmed by inspecting the real compiled output, not assumed),
 *    stacked on `group-aria-checked/switch:` so the thumb reads Radix's own
 *    `aria-checked` on the root rather than a mirrored copy of it. This is
 *    the "CSS custom property/arbitrary-property escape hatch that resolves
 *    through a token" the brief describes, using Tailwind's built-in
 *    direction variants instead of a hand-rolled property, since those
 *    already resolve per-element against `:dir()`.
 *
 * `switch.test.tsx` renders both directions and reads the real computed
 * `--tw-translate-x` custom property (the property Tailwind v4's `translate-x-*`
 * utilities actually set — verified against the compiled CSS directly, since
 * v4 uses the standalone `translate` property, not `transform`) to prove the
 * two renders resolve to opposite signs, not merely that a class differs.
 */
export const Switch = React.forwardRef<
  React.ComponentRef<typeof SwitchPrimitive.Root>,
  SwitchProps
>(function Switch({ className, size = "md", style, ...props }, ref) {
  const track = TRACK_SIZE[size];

  return (
    <SwitchPrimitive.Root
      ref={ref}
      data-slot="switch"
      data-size={size}
      className={cn(
        // Named group (not the bare `group` class) so a switch nested
        // inside some other grouped ancestor can't cross-trigger this one.
        "group/switch peer inline-flex shrink-0 items-center rounded-full border border-transparent bg-input transition-colors",
        "aria-checked:bg-primary",
        "disabled:cursor-not-allowed disabled:bg-disabled-surface",
        FOCUS_VISIBLE_RING,
        className,
      )}
      style={{ height: track.height, width: track.width, ...style }}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          "pointer-events-none block shrink-0 rounded-full bg-card shadow-sm transition-transform",
          "translate-x-0",
          // See the component doc comment: flush 2:1 track:thumb sizing
          // makes "travel one track" exactly 100% of the thumb's own box,
          // and the ltr/rtl stack supplies the correct sign.
          "group-aria-checked/switch:ltr:translate-x-full",
          "group-aria-checked/switch:rtl:-translate-x-full",
        )}
        style={{ height: THUMB_SIZE[size], width: THUMB_SIZE[size] }}
      />
    </SwitchPrimitive.Root>
  );
});
