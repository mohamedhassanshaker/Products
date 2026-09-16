import * as React from "react";
import { Separator as SeparatorPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";

export interface SeparatorProps extends React.ComponentPropsWithoutRef<
  typeof SeparatorPrimitive.Root
> {
  orientation?: "horizontal" | "vertical";
}

/**
 * Divider (design-system.md §5.3 #6). Adapted from the shadcn scaffold: the
 * only real change is replacing its `data-[orientation=…]:` attribute-variant
 * classes with a plain `orientation`-conditional class list — this project's
 * token gate treats *any* Tailwind `word-[…]` bracket form as an arbitrary
 * value (confirmed empirically while adapting `Avatar`, whose upstream
 * `data-[size=lg]:size-10` tripped the same rule even though it names a
 * selector, not a literal value), so components in this codebase decide
 * variant classes in JS rather than in a bracketed CSS selector.
 *
 * `decorative` defaults to `true` (Radix's own default): a divider is purely
 * visual unless the caller states it separates semantically meaningful
 * groups, in which case passing `decorative={false}` gives it a real
 * `role="separator"` instead of `aria-hidden` (§5.3 #6) — Radix's primitive
 * already implements exactly this switch, so no extra logic is needed here.
 *
 * Not `"use client"`: `@radix-ui/react-separator`'s compiled source has
 * neither a `"use client"` directive nor any hook — a genuinely static,
 * presentational primitive, confirmed by reading it directly rather than
 * copying the scaffold's default.
 */
export const Separator = React.forwardRef<
  React.ComponentRef<typeof SeparatorPrimitive.Root>,
  SeparatorProps
>(function Separator({ className, orientation = "horizontal", decorative = true, ...props }, ref) {
  return (
    <SeparatorPrimitive.Root
      ref={ref}
      data-slot="separator"
      decorative={decorative}
      orientation={orientation}
      className={cn(
        "shrink-0 bg-border",
        orientation === "horizontal" ? "h-px w-full" : "h-full w-px",
        className,
      )}
      {...props}
    />
  );
});
