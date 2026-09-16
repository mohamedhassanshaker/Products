import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import { Slot } from "radix-ui";
import { cn } from "@/lib/utils";

/**
 * Focus-visible ring recipe (design-system.md §10.3): `outline`, never
 * `box-shadow`/Tailwind's `ring-*`, so the ring survives `overflow: hidden`
 * ancestors (the sticky table header, the widget shell). Applied only via
 * `:focus-visible` so a click never leaves a ring but a Tab does.
 *
 * `--focus-ring-width`/`--focus-ring-offset` have no Tailwind theme namespace
 * (`tailwind-theme.generated.css`'s own generator docstring lists them as
 * unbridged) yet both are on `SKINNABLE_COMPONENT_TOKENS` — an admin can move
 * them from Settings → Appearance. Hardcoding `outline-2` would silently stop
 * responding to that. Tailwind's arbitrary-*property* escape hatch (a bare
 * `[prop:value]`, distinct from the banned arbitrary-*value* form the token
 * gate targets — `no-hardcoded-design-values.mjs` only matches a
 * utility-name immediately followed by `-[`, which this is not) is the only
 * route that keeps the reference live without inventing a new bridged token.
 */
const FOCUS_VISIBLE_RING =
  "outline-none focus-visible:[outline:var(--focus-ring-width)_solid_var(--ring)] focus-visible:[outline-offset:var(--focus-ring-offset)]";

const buttonVariants = cva(
  cn(
    "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap",
    "text-sm font-medium transition-colors",
    // Pressed state (§5.2): a shadow, never a transform — a transform-based
    // "press" (e.g. scale-95) cannot be suppressed by `--motion-scale: 0`,
    // since Tailwind bakes the keyframe, not a token, into the utility.
    "active:shadow-inset",
    // Interaction is disabled by the native attribute (shared by `disabled`
    // and `loading` — see the component doc comment).
    "disabled:pointer-events-none disabled:cursor-not-allowed",
    FOCUS_VISIBLE_RING,
  ),
  {
    variants: {
      variant: {
        primary: "bg-primary text-primary-foreground hover:bg-primary-hover",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-accent hover:text-accent-foreground",
        outline:
          "border border-border-strong bg-transparent text-foreground hover:bg-accent hover:text-accent-foreground",
        ghost: "bg-transparent text-foreground hover:bg-accent hover:text-accent-foreground",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive-strong",
        link: "bg-transparent text-primary underline-offset-4 hover:underline",
      },
      size: {
        sm: "text-xs",
        md: "text-sm",
        lg: "text-base",
      },
      // Keyed off the *prop* directly (never a `data-[disabled=true]:` selector —
      // Tailwind's arbitrary-variant bracket syntax is banned by the same gate
      // rule that bans arbitrary values; see `no-hardcoded-design-values.mjs`'s
      // `tailwind-arbitrary-value` pattern, which matches any `word-[...]`
      // regardless of whether the bracket holds a value or a selector). The grey
      // "disabled" look is opt-in here so a `loading` button — inert for the
      // same reason, via the same native `disabled` attribute — keeps its
      // ordinary variant colour instead of reading as broken.
      visuallyDisabled: {
        true: "bg-disabled-surface text-disabled-foreground hover:bg-disabled-surface",
        false: "",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
      visuallyDisabled: false,
    },
  },
);

/** The one geometry input that genuinely varies by size — everything else is a shared component token. */
const HEIGHT_BY_SIZE = {
  sm: "var(--control-height-sm)",
  md: "var(--control-height-md)",
  lg: "var(--control-height-lg)",
} as const;

export interface ButtonProps
  extends
    Omit<React.ComponentPropsWithoutRef<"button">, "type">,
    VariantProps<typeof buttonVariants> {
  /** Renders the child element in place of a `<button>` (Radix `Slot`), e.g. for a link styled as a button. */
  asChild?: boolean;
  /**
   * Native `button[type]`, required with no implicit fallback to the HTML
   * default ("submit") — an untyped button inside a form silently submitting
   * it is a real, recurring class of bug (design-system.md §5.3 #1).
   */
  type?: "button" | "submit" | "reset";
  /** Icon rendered before the label, in DOM order — flex row order already follows `dir`, so this swaps under RTL for free. Replaced by a spinner while `loading`. */
  iconStart?: React.ReactNode;
  /** Icon rendered after the label. Untouched by `loading` (§5.2: the spinner replaces only the *leading* slot). */
  iconEnd?: React.ReactNode;
  /**
   * §5.2 loading state: spinner replaces `iconStart`, the label stays put,
   * `aria-busy` is set, and the button is inert — but not *styled* disabled,
   * since a loading primary button should still read as primary, just busy.
   */
  loading?: boolean;
}

/**
 * Primary interactive control (design-system.md §5.3 #1).
 *
 * `selected`/`error`/`empty` are not implemented: Button is never a toggle
 * (that is `ToggleRow`/`SelectablePill`'s job) and never carries field
 * validation or an empty-content state (§5.2's own note — atoms don't render
 * `EmptyState`). Every other state in the eight-state model applies.
 */
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    className,
    variant,
    size = "md",
    asChild = false,
    type = "button",
    iconStart,
    iconEnd,
    loading = false,
    disabled = false,
    style,
    children,
    ...props
  },
  ref,
) {
  const Comp = asChild ? Slot.Root : "button";
  const inert = disabled || loading;
  const resolvedSize = size ?? "md";

  return (
    <Comp
      ref={ref}
      // A native <button> defaults to type="submit" when unset; Slot.Root
      // forwards whatever the child already is, so `type` is only meaningful
      // for the real button case, but passing it through is harmless either way.
      type={asChild ? undefined : type}
      data-slot="button"
      data-variant={variant ?? "primary"}
      data-size={resolvedSize}
      data-disabled={disabled ? "true" : undefined}
      data-loading={loading ? "true" : undefined}
      disabled={!asChild && inert ? true : undefined}
      aria-disabled={inert ? true : undefined}
      aria-busy={loading ? true : undefined}
      style={{
        borderRadius: "var(--button-radius)",
        paddingInline: "var(--button-padding-inline)",
        height: HEIGHT_BY_SIZE[resolvedSize],
        ...style,
      }}
      className={cn(buttonVariants({ variant, size, visuallyDisabled: disabled }), className)}
      {...props}
    >
      {loading ? (
        <Loader2
          className="size-4 shrink-0 animate-spin motion-reduce:animate-none"
          aria-hidden="true"
        />
      ) : (
        iconStart
      )}
      {/* `asChild`'s `Comp` is Radix `Slot.Root`, which only accepts a single element child
          unless the one it should merge its own props onto is marked `Slot.Slottable` — found
          the hard way (B-3's live-infra proof: a real `Slot failed to slot onto its children`
          500 on `/agents`, the first real `<Button asChild>` consumer in this app) rather than
          assumed from Radix's docs. Marking `children` here is a no-op when `Comp` is a plain
          `<button>` (Slottable's own behaviour outside a `Slot.Root` ancestor is to render its
          children through unchanged), so this is safe unconditionally rather than branched. */}
      <Slot.Slottable>{children}</Slot.Slottable>
      {!loading && iconEnd}
    </Comp>
  );
});
