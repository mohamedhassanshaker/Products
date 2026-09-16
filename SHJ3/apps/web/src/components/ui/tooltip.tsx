"use client";

import * as React from "react";
import { Tooltip as TooltipPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";

/**
 * Short explanation on hover/focus (design-system.md §5.3 #20). Adapted from
 * the shadcn scaffold: Radix's `Tooltip.Trigger` already wires `onFocus`
 * (opens, unless the trigger was just activated by a pointer press) *and*
 * `onPointerMove`/`onPointerLeave` (hover) in the same handler set —
 * confirmed by reading `@radix-ui/react-tooltip`'s compiled source directly
 * rather than assuming the brief's "it should" — so "opens on focus as well
 * as hover" needed no extra wiring here, only verifying it was already true.
 *
 * Token/RTL/z-index adaptation is the real change from the scaffold: the raw
 * arbitrary-value classes (`z-50`, `origin-(--radix-tooltip-content-
 * transform-origin)`, `data-[side=…]:slide-in-from-…`, `rounded-[2px]`) are
 * all gone. The `data-[state=…]`/`data-[side=…]` enter/exit animation the
 * scaffold had is not reinstated: this project's token gate treats *any*
 * Tailwind `word-[…]` bracket form as an arbitrary value (confirmed while
 * adapting `Avatar`), which forecloses the usual `data-[state=open]:` Tailwind
 * pattern, and Radix does not hand the open/close state back as a prop this
 * component could branch on in JS instead — so this ships correctly
 * positioned, tokened and accessible, without a bracket-selector-dependent
 * transition. A CSS-file-based `[data-state]` transition (like
 * `atom-motion.css`'s approach for `Skeleton`/`Spinner`) is a reasonable
 * follow-up, not done here since motion polish is not one of §5.3's stated
 * requirements for this atom.
 */
function TooltipProvider({
  delayDuration = 0,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delayDuration={delayDuration}
      {...props}
    />
  );
}

/**
 * design-system.md §5.3 #20 notes this component "requires `TooltipProvider`
 * at a root". Confirmed by reading `@radix-ui/react-tooltip`'s source: every
 * `Tooltip.Root` reads open/close delay timing from provider context via
 * `useTooltipProviderContext`, which throws outside a provider. Wiring
 * `TooltipProvider` into the app shell's root layout is a later wave's job
 * (out of scope here) — this component only needs to *work* when a provider
 * exists above it, which it does; nothing here silently supplies its own.
 */
function Tooltip({ ...props }: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  return <TooltipPrimitive.Root data-slot="tooltip" {...props} />;
}

function TooltipTrigger({ ...props }: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />;
}

/** The logical side vocabulary this component's own public API uses — see `resolvePhysicalSide`. */
type LogicalSide = "top" | "bottom" | "inline-start" | "inline-end";

/**
 * Radix's own `side` prop is **physical** screen geometry, not logical —
 * `"right"` always means physically right regardless of `dir`. Confirmed by
 * reading `@radix-ui/react-popper`'s compiled source directly rather than
 * trusting design-system.md §5.3's own claim that "Radix's own `side`
 * semantics already respect `dir`": `side`/`align` are concatenated into a
 * floating-ui placement string (`side + (align !== "center" ? "-"+align :
 * "")`) with no direction-based translation of left/right anywhere in that
 * path. What *is* genuinely direction-aware is the **align** axis — Radix's
 * `align="start"/"end"` are already logical keywords that floating-ui
 * resolves against the element's computed `direction` — so §5.3's claim holds
 * for `align`, not for `side`.
 *
 * Tooltip placement is listed under "Mirrors under RTL" in §11.6's table, so
 * this component exposes a **logical** `side` (`"inline-start"`/
 * `"inline-end"` alongside the direction-agnostic `"top"`/`"bottom"`) and
 * translates it to Radix's physical prop here — otherwise a caller writing
 * `side="inline-end"` would render on the *same* physical edge in both LTR
 * and RTL, which is exactly the bug §11.6 rules out.
 *
 * Reads `document.documentElement.dir` directly rather than Radix's own
 * `useDirection()` — this app never wires a `DirectionProvider` (§11.2:
 * direction is a server-set `<html dir>` attribute, not a React context), so
 * `useDirection()` would silently always resolve to `"ltr"` here. Safe to
 * call unconditionally: this only ever runs client-side, since Tooltip
 * content only mounts once open, which cannot happen during SSR.
 */
function resolvePhysicalSide(side: LogicalSide): "top" | "bottom" | "left" | "right" {
  if (side === "top" || side === "bottom") return side;
  const isRtl = typeof document !== "undefined" && document.documentElement.dir === "rtl";
  if (side === "inline-start") return isRtl ? "right" : "left";
  return isRtl ? "left" : "right";
}

export interface TooltipContentProps extends Omit<
  React.ComponentProps<typeof TooltipPrimitive.Content>,
  "side"
> {
  /**
   * `default` is a single short line; `rich` allows more content — a reason
   * plus a link, not just a label (design-system.md §5.3 #20) — via more
   * generous padding and width rather than a different structural contract.
   * Tooltip's own API stays `children` (the trigger) + this content, never
   * content-only, so a caller cannot accidentally make a tooltip the *sole*
   * carrier of essential information (§5.3's own caution — enforced by
   * convention/review, not mechanically by this atom).
   */
  variant?: "default" | "rich";
  side?: LogicalSide;
}

function TooltipContent({
  className,
  sideOffset = 6,
  side = "top",
  align = "center",
  variant = "default",
  children,
  ...props
}: TooltipContentProps) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        side={resolvePhysicalSide(side)}
        align={align}
        sideOffset={sideOffset}
        className={cn(
          "rounded-md border border-border bg-popover text-popover-foreground shadow-md",
          variant === "rich" ? "p-3 text-sm" : "px-2 py-1 text-xs",
          className,
        )}
        style={{
          // No Tailwind `z-tooltip` utility exists to reach for here — probed
          // directly through this project's real Tailwind v4 pipeline while
          // building this batch: the `--z-*` tokens have no bridged theme
          // namespace (confirmed independently in the same generated-CSS file
          // `atom-motion.css`'s header documents for `--animate-*`), so
          // `var(--z-tooltip)` is consumed as a raw custom property, exactly
          // as design-system.md §12.2 itself prescribes for this case.
          zIndex: "var(--z-tooltip)",
          maxInlineSize: variant === "rich" ? "20rem" : "16rem",
        }}
        {...props}
      >
        {children}
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  );
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };
