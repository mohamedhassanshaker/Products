import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center gap-1 overflow-hidden whitespace-nowrap rounded-full font-medium",
  {
    variants: {
      // The status vocabulary (§6.2): four semantic families plus neutral and
      // a border-only outline. Each pairs a `-subtle` fill with the
      // corresponding `-strong` text, never the base role alone — §6.3's own
      // measured example (`--destructive` clears 4.87:1 as a white-on-fill
      // pair but only 4.46:1 as text on `--background`, failing AA) is why
      // the two tokens exist as a pair in the first place.
      variant: {
        success: "bg-success-subtle text-success-strong",
        warning: "bg-warning-subtle text-warning-strong",
        destructive: "bg-destructive-subtle text-destructive-strong",
        info: "bg-info-subtle text-info-strong",
        neutral: "bg-muted text-muted-foreground",
        outline: "border border-border-strong bg-transparent text-foreground",
      },
      size: {
        sm: "text-2xs",
        md: "text-xs",
      },
    },
    defaultVariants: { variant: "neutral", size: "md" },
  },
);

export interface BadgeProps
  extends
    Omit<React.ComponentPropsWithoutRef<"span">, "children">,
    VariantProps<typeof badgeVariants> {
  /**
   * Required, not optional. `<Badge variant="success" />` with no text must
   * not type-check — the mechanical form of §6.1: *"if `Healthy` were 'the
   * green one', a tenant with a red brand would ship a red `Healthy` badge.
   * The label is what survives."* There is deliberately no children-based
   * API either, so a caller cannot route around the requirement by passing
   * JSX children instead of `label`.
   */
  label: string;
  /** A second, optional non-colour channel alongside the mandatory text label (§6.1). Decorative — the label alone already carries the meaning. */
  icon?: React.ReactNode;
}

/**
 * Status badge (design-system.md §5.3 #10 — the wireframe's own "status").
 * `selected`/`active`/`loading`/`empty` are not implemented: a badge is a
 * read-only status marker, never an interactive control, so those states
 * have nothing to attach to (§5.2's model is written for interactive
 * components; a badge is the one atom in this batch that isn't one).
 */
export const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(function Badge(
  { className, variant, size, label, icon, style, ...props },
  ref,
) {
  return (
    <span
      ref={ref}
      data-slot="badge"
      data-variant={variant ?? "neutral"}
      style={{
        borderRadius: "var(--badge-radius)",
        paddingInline: "var(--badge-padding-inline)",
        paddingBlock: "var(--space-0)",
        ...style,
      }}
      className={cn(badgeVariants({ variant, size }), className)}
      {...props}
    >
      {icon ? (
        <span aria-hidden="true" className="flex shrink-0 items-center [&>svg]:size-3">
          {icon}
        </span>
      ) : null}
      {label}
    </span>
  );
});
