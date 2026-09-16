import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import "./atom-motion.css";

const skeletonVariants = cva("bg-skeleton", {
  variants: {
    variant: {
      // One text-line's approximate block size; full width so it fills
      // whatever line the caller is standing in for.
      text: "h-4 w-full rounded-xs",
      // Fills its container — the caller sizes it via className.
      block: "h-full w-full rounded-md",
      // `--table-row-height` ties this to the same component token
      // `DataTable` will use, so a row skeleton is never a guessed height.
      row: "w-full rounded-xs",
      circle: "size-10 rounded-full",
    },
  },
  defaultVariants: { variant: "block" },
});

export interface SkeletonProps
  extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof skeletonVariants> {}

/**
 * Loading placeholder (design-system.md §5.3 #17). No shadcn base worth
 * keeping beyond the single div the scaffold already was — its
 * `animate-pulse` class was already silently dead (see `atom-motion.css`'s
 * header for why), so the shimmer is rebuilt on this batch's own token-driven
 * mechanism instead of inheriting a no-op.
 *
 * `aria-busy="true"` on the region (§5.3 #17) rather than `aria-hidden`: a
 * skeleton stands in for content that is *coming*, so a screen reader should
 * know the region is busy loading rather than being told nothing is there.
 *
 * Shimmer is suppressed under `prefers-reduced-motion` via the same
 * `shj3-animate-shimmer` mechanism `atom-motion.css` documents once for this
 * whole batch — consumed here rather than a second, component-local
 * `prefers-reduced-motion` query, per this atom's own spec note to be
 * consistent with `Spinner` rather than solve the problem twice.
 */
export const Skeleton = React.forwardRef<HTMLDivElement, SkeletonProps>(function Skeleton(
  { variant, className, style, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      data-slot="skeleton"
      aria-busy="true"
      className={cn("shj3-animate-shimmer", skeletonVariants({ variant }), className)}
      style={variant === "row" ? { blockSize: "var(--table-row-height)", ...style } : style}
      {...props}
    />
  );
});
