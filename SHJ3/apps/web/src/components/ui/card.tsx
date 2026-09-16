import * as React from "react";
import { Slot } from "radix-ui";
import { ChevronDown } from "lucide-react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { Icon } from "./icon";
import { Skeleton } from "./skeleton";

/** See button.tsx for the full rationale — identical recipe, kept local per component rather than shared. */
const FOCUS_VISIBLE_RING =
  "outline-none focus-visible:[outline:var(--focus-ring-width)_solid_var(--ring)] focus-visible:[outline-offset:var(--focus-ring-offset)]";

const cardVariants = cva(
  cn("relative bg-card text-card-foreground transition-shadow", FOCUS_VISIBLE_RING),
  {
    variants: {
      variant: {
        default: "border border-border shadow-sm",
        // Hover shadow only applies to `interactive` (design-system.md §5.4 Card
        // States row) — a static card gaining a hover shadow would imply it does
        // something on click when it does not.
        interactive: "border border-border shadow-sm hover:shadow-md cursor-pointer",
        // `border-s` (Tailwind's logical inline-start border-width utility,
        // §11.1's own sanctioned list) rather than a literal pixel value: no
        // width is published for this rail in design-system.md's Card row (only
        // SummaryStrip's row spells out "3px", which is why summary-strip.tsx
        // sources its rail from the real `--summary-strip-border-inline-start`
        // component token instead) — Tailwind's un-suffixed default border
        // width is the honest choice when no width is spec'd, rather than
        // inventing a pixel number that would fail the token gate anyway.
        selected: "border-s border-primary bg-accent",
        nested: "border border-border shadow-none",
        metric: "border border-border shadow-sm",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export type CardVariant = NonNullable<VariantProps<typeof cardVariants>["variant"]>;

interface CardSharedProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "role"> {
  /**
   * §5.2 loading: renders a fixed-height skeleton in place of `children` so the
   * card's block size does not collapse and reflow the rest of the list.
   */
  loading?: boolean;
  /**
   * §5.2 error: renders the `--destructive` inline-start rail plus this message
   * instead of `children` — a card that failed to load its record shows why,
   * not a blank shell.
   */
  error?: string;
}

/**
 * `variant: "interactive"` requires `asChild: true`, mechanically — the
 * mirror of Button's own `asChild`/Slot recipe (button.tsx). §5.4's own rule
 * is explicit: *"interactive cards are `<a>` or `<button>`, never a `div`
 * with `onClick`"* — the only way to guarantee that is for Card to never
 * itself render the interactive element, forcing the caller to supply the
 * real `<a>`/`<button>` as the single child that Radix `Slot` then merges
 * this component's surface styling onto. `<Card variant="interactive">` with
 * no `asChild` therefore does not type-check, the same mechanical-over-
 * documented pattern as `Badge.label` and `IconButton.ariaLabel`.
 */
export type CardProps =
  | (CardSharedProps & { variant?: Exclude<CardVariant, "interactive">; asChild?: false })
  | (CardSharedProps & { variant: "interactive"; asChild: true });

/**
 * One record — design-system.md §5.4's full-prose `Card`: *"white, thin
 * border, title + mono sub-line; one record."* The single most-repeated
 * surface in the system (agents, sources, MCP servers, rules, users,
 * campaigns, policies, golden sets, environments all use it, none of them
 * built in this batch) — so this file's job is a general-enough API, not a
 * screen.
 *
 * Deliberately a compound component (`CardHeader`/`CardTitle`/`CardContent`/
 * `CardFooter`/`CardDisclosure` below) rather than `title`/`badge`/`body`
 * props: every consumer listed above composes a `Badge` and a `MonoSubLine`
 * differently, and a fixed-prop API would fight that instead of hosting it.
 *
 * Not `"use client"`: the default/selected/nested/metric branches have no
 * interactivity of their own. `Slot` (used only for the `asChild` branch)
 * carries its own client boundary internally the same way `Button` relies on
 * it, so this file does not need to redeclare one just for that branch.
 */
export const Card = React.forwardRef<HTMLDivElement, CardProps>(function Card(
  { className, variant, asChild, loading = false, error, style, children, ...props },
  ref,
) {
  const Comp = asChild ? Slot.Root : "div";
  const resolvedVariant = variant ?? "default";

  return (
    <Comp
      ref={ref}
      data-slot="card"
      data-variant={resolvedVariant}
      data-loading={loading ? "true" : undefined}
      style={{
        borderRadius: "var(--card-radius)",
        padding: "var(--card-padding)",
        ...style,
      }}
      className={cn(
        cardVariants({ variant: resolvedVariant }),
        // §5.2 error overrides the variant's own rail/surface with the
        // destructive family — same `border-s` reasoning as `selected` above.
        error && "border-s border-destructive-strong",
        className,
      )}
      {...props}
    >
      {loading ? (
        <Skeleton variant="block" className="h-24 w-full" aria-label="Loading" />
      ) : error ? (
        <p role="alert" className="text-sm text-destructive-strong">
          {error}
        </p>
      ) : (
        children
      )}
    </Comp>
  );
});

export type CardHeaderProps = React.HTMLAttributes<HTMLDivElement>;

/** Title (inline-start) + optional `Badge`/actions (inline-end) row — caller composes both as children. */
export const CardHeader = React.forwardRef<HTMLDivElement, CardHeaderProps>(function CardHeader(
  { className, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      data-slot="card-header"
      className={cn("flex items-start justify-between gap-2", className)}
      {...props}
    />
  );
});

export interface CardTitleProps extends React.HTMLAttributes<HTMLHeadingElement> {
  /**
   * Required, not defaulted to `h3` or similar — design-system.md §5.4's a11y
   * note is explicit: *"heading level is a prop, never hardcoded, so a card
   * inside a tab panel produces a correct outline."* A hardcoded level here
   * would silently produce a skipped or duplicated outline level the moment a
   * caller nests this in a heading context this component cannot see.
   */
  level: 1 | 2 | 3 | 4 | 5 | 6;
}

export const CardTitle = React.forwardRef<HTMLHeadingElement, CardTitleProps>(function CardTitle(
  { level, className, ...props },
  ref,
) {
  const Heading = `h${level}` as const;
  return (
    <Heading
      ref={ref}
      data-slot="card-title"
      className={cn("text-md font-semibold text-card-foreground", className)}
      {...props}
    />
  );
});

export type CardContentProps = React.HTMLAttributes<HTMLDivElement>;

export const CardContent = React.forwardRef<HTMLDivElement, CardContentProps>(function CardContent(
  { className, ...props },
  ref,
) {
  return <div ref={ref} data-slot="card-content" className={cn("mt-2", className)} {...props} />;
});

export type CardFooterProps = React.HTMLAttributes<HTMLDivElement>;

/** Footer action row — inline `Button`s, right-aligned in both directions via `justify-end` (flex row order already follows `dir`). */
export const CardFooter = React.forwardRef<HTMLDivElement, CardFooterProps>(function CardFooter(
  { className, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      data-slot="card-footer"
      className={cn("mt-3 flex items-center justify-end gap-2", className)}
      {...props}
    />
  );
});

export interface CardDisclosureProps {
  /** Visible trigger text, e.g. "Version history" (B2's inline expandable region). */
  label: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
  className?: string;
}

/**
 * Optional expandable region (§5.4's anatomy line, B2's inline version
 * history). Controlled rather than owning its own state — every other
 * stateful piece of this file is a plain prop-driven presentational
 * component, and a controlled disclosure is what lets a caller persist
 * "expanded" across a list re-render (e.g. re-sorting the agent registry
 * without collapsing an open history panel).
 */
export function CardDisclosure({
  label,
  open,
  onOpenChange,
  children,
  className,
}: CardDisclosureProps) {
  const contentId = React.useId();

  return (
    <div data-slot="card-disclosure" className={className}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={contentId}
        onClick={() => onOpenChange(!open)}
        className={cn(
          "inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground",
          FOCUS_VISIBLE_RING,
        )}
      >
        <Icon
          icon={ChevronDown}
          size={14}
          // A disclosure chevron rotates to point "away from" expanded
          // content regardless of reading direction — not one of §11.6's
          // listed directional icons (those mirror on the *horizontal* axis;
          // this is a vertical open/close rotation), so `mirrorInRtl={false}`
          // is stated explicitly rather than left to the allowlist's silent
          // default, the same way `Spinner` states it for its own rotation.
          mirrorInRtl={false}
          className={cn("transition-transform", open && "rotate-180")}
        />
        {label}
      </button>
      {open && (
        <div id={contentId} data-slot="card-disclosure-content" className="mt-2">
          {children}
        </div>
      )}
    </div>
  );
}
