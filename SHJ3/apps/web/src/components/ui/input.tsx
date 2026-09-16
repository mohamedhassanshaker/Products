import * as React from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/** See button.tsx for the full rationale. */
const FOCUS_VISIBLE_RING =
  "outline-none focus-visible:[outline:var(--focus-ring-width)_solid_var(--ring)] focus-visible:[outline-offset:var(--focus-ring-offset)]";

export interface InputProps extends Omit<React.ComponentPropsWithoutRef<"input">, "size"> {
  /**
   * `mono` is for endpoints/IDs/model names — anything from §11.3's LTR-only
   * list. It forces `dir="ltr"` and bidi isolation unconditionally, even
   * inside an Arabic page, so `mcp://sharjah-services.internal` cannot have
   * its segments reordered by surrounding RTL text.
   */
  variant?: "default" | "mono";
  /** Content before the field text (a currency symbol, a fixed protocol prefix). Rendered at the inline-start, so it swaps under RTL automatically. */
  startAdornment?: React.ReactNode;
  /** Content after the field text. Rendered at the inline-end. */
  endAdornment?: React.ReactNode;
  /** §5.2 loading: a trailing spinner, `aria-busy`, and the field stays editable-looking but inert is *not* implied — loading here means "validating", not "disabled"; pair with `disabled` explicitly if input must also stop. */
  loading?: boolean;
}

/**
 * Single-line text field (design-system.md §5.3 #3).
 *
 * Deliberately has **no `label` prop.** A label prop that silently renders
 * nothing (or worse, renders a floating placeholder standing in for one)
 * is how placeholder-as-label ships — labelling a control is `FormField`'s
 * job (§10.5: "placeholders are never labels"), and this component's API
 * is shaped so that misuse isn't available to reach for.
 *
 * `selected`/`empty` are not implemented: a text field is never a toggle, and
 * §5.2's empty state is the `EmptyState` molecule, which atoms do not render.
 */
export const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(
  {
    className,
    type = "text",
    variant = "default",
    startAdornment,
    endAdornment,
    loading = false,
    disabled = false,
    dir,
    style,
    ...props
  },
  ref,
) {
  const isMono = variant === "mono";

  return (
    <div className="relative inline-flex w-full items-center">
      {startAdornment ? (
        <span className="pointer-events-none absolute start-3 flex items-center justify-center text-muted-foreground">
          {startAdornment}
        </span>
      ) : null}
      <input
        ref={ref}
        type={type}
        // §11.3 rule 1: forced regardless of the ambient page direction. Any
        // other variant respects whatever `dir` the caller passed (typically
        // nothing, i.e. inherit from the page).
        dir={isMono ? "ltr" : dir}
        data-slot="input"
        data-variant={variant}
        disabled={disabled || undefined}
        aria-busy={loading ? true : undefined}
        style={{
          borderRadius: "var(--input-radius)",
          height: "var(--input-height)",
          paddingInlineStart: startAdornment ? "var(--control-height-sm)" : "var(--space-3)",
          paddingInlineEnd: endAdornment || loading ? "var(--control-height-sm)" : "var(--space-3)",
          // §11.3 rule 1: an isolate so a `mono` value's bidi context never
          // leaks into (or is disturbed by) surrounding RTL prose.
          unicodeBidi: isMono ? "isolate" : undefined,
          ...style,
        }}
        className={cn(
          "w-full min-w-0 border border-border-strong bg-input text-foreground",
          "text-sm placeholder:text-muted-foreground",
          isMono && "font-mono",
          "transition-colors",
          "disabled:cursor-not-allowed disabled:border-border disabled:bg-disabled-surface disabled:text-disabled-foreground",
          "aria-invalid:border-destructive",
          FOCUS_VISIBLE_RING,
          className,
        )}
        {...props}
      />
      {loading ? (
        <Loader2
          className="absolute end-3 size-4 shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none"
          aria-hidden="true"
        />
      ) : endAdornment ? (
        <span className="absolute end-3 flex items-center justify-center text-muted-foreground">
          {endAdornment}
        </span>
      ) : null}
    </div>
  );
});
