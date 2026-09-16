import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/** See button.tsx for the full rationale — identical recipe, kept local per atom rather than shared. */
const FOCUS_VISIBLE_RING =
  "outline-none focus-visible:[outline:var(--focus-ring-width)_solid_var(--ring)] focus-visible:[outline-offset:var(--focus-ring-offset)]";

const iconButtonVariants = cva(
  cn(
    "inline-flex shrink-0 items-center justify-center rounded-md",
    "transition-colors active:shadow-inset",
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
        link: "bg-transparent text-primary hover:bg-accent hover:text-accent-foreground",
      },
      // Keyed off the `disabled` prop directly, never a `data-[disabled=true]:`
      // selector — see button.tsx's identical note (no-hardcoded-design-values.mjs's
      // arbitrary-variant-bracket ban applies to selectors as much as values).
      visuallyDisabled: {
        true: "bg-disabled-surface text-disabled-foreground hover:bg-disabled-surface",
        false: "",
      },
      // Toggle usage (e.g. Composer's mic button, §5.4) — a pressed icon button
      // reads as `--accent` surface, the selected/on state's non-colour marker
      // being `aria-pressed` itself, which a screen reader already announces.
      pressed: {
        true: "bg-accent text-accent-foreground",
        false: "",
      },
    },
    defaultVariants: {
      variant: "primary",
      visuallyDisabled: false,
      pressed: false,
    },
  },
);

/**
 * Both sizes clear the WCAG 2.5.8 24px target floor with room to spare
 * (`--control-height-sm` alone resolves to 32px), so no separate literal "24"
 * needs to exist anywhere in this file — the height token *is* the target size.
 */
const BOX_SIZE_BY_SIZE = {
  sm: "var(--control-height-sm)",
  md: "var(--control-height-md)",
} as const;

type IconButtonSize = keyof typeof BOX_SIZE_BY_SIZE;

export interface IconButtonProps
  extends
    Omit<React.ComponentPropsWithoutRef<"button">, "type" | "aria-label">,
    Omit<VariantProps<typeof iconButtonVariants>, "visuallyDisabled" | "pressed"> {
  /**
   * Required, not optional — deliberately typed with no `?` so
   * `<IconButton>{icon}</IconButton>` with no label fails to compile rather
   * than shipping a control a screen reader announces as nothing
   * (design-system.md §5.3 #2). There is no children-less *or* label-less
   * form, mirroring how `Badge.label` is made mechanical (§6.1).
   */
  ariaLabel: string;
  size?: IconButtonSize;
  type?: "button" | "submit" | "reset";
  /** The icon, supplied by the caller — this atom renders whatever `ReactNode` it is given rather than owning an icon set (the `Icon` atom is a sibling component, not a dependency of this one). */
  children: React.ReactNode;
  /** Toggle state for icon buttons used as a two-state control (mic on/off, thumbs up/down). Omit for a plain action button. */
  pressed?: boolean;
  /** §5.2 loading: the icon is replaced by a spinner, the control stays inert, `aria-busy` is set — see button.tsx for why this doesn't reuse the native-disabled *look*. */
  loading?: boolean;
}

/**
 * Icon-only control (design-system.md §5.3 #2). `error`/`empty` are not
 * implemented — an icon button carries no field validation and no
 * content-list emptiness (§5.2's own note on `empty`).
 */
export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  {
    className,
    variant,
    size = "md",
    type = "button",
    ariaLabel,
    pressed,
    loading = false,
    disabled = false,
    style,
    children,
    ...props
  },
  ref,
) {
  const inert = disabled || loading;
  const box = BOX_SIZE_BY_SIZE[size];

  return (
    <button
      ref={ref}
      type={type}
      aria-label={ariaLabel}
      aria-pressed={pressed}
      data-slot="icon-button"
      data-variant={variant ?? "primary"}
      data-size={size}
      disabled={inert ? true : undefined}
      aria-disabled={inert ? true : undefined}
      aria-busy={loading ? true : undefined}
      style={{
        borderRadius: "var(--button-radius)",
        width: box,
        height: box,
        ...style,
      }}
      className={cn(
        iconButtonVariants({ variant, visuallyDisabled: disabled, pressed }),
        className,
      )}
      {...props}
    >
      {loading ? (
        <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
      ) : (
        children
      )}
    </button>
  );
});
