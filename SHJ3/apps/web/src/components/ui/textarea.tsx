import * as React from "react";
import { cn } from "@/lib/utils";

/** See button.tsx for the full rationale. */
const FOCUS_VISIBLE_RING =
  "outline-none focus-visible:[outline:var(--focus-ring-width)_solid_var(--ring)] focus-visible:[outline-offset:var(--focus-ring-offset)]";

export interface TextareaProps extends React.ComponentPropsWithoutRef<"textarea"> {
  /**
   * `auto-grow` uses Tailwind's `field-sizing-content` (a real, non-arbitrary
   * utility — not a token-bearing one, since element sizing behaviour isn't a
   * design value) so the box grows with its content instead of scrolling.
   */
  variant?: "default" | "auto-grow";
}

/**
 * Multi-line text field (design-system.md §5.3 #4).
 *
 * Unlike `Input`'s `mono` variant, Textarea is **always** `dir="auto"` — it
 * exists specifically for user-authored prose (B3 step 2's system prompt,
 * B2's change summary), so an Arabic paragraph must render RTL even inside an
 * English session, per-field, without the caller having to know the content's
 * language in advance (§11.3 rule 2).
 *
 * Same token family as `Input`; same reasons for omitting a `label` prop and
 * an `empty`/`selected` state (see input.tsx).
 */
export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, variant = "default", style, ...props },
  ref,
) {
  return (
    <textarea
      ref={ref}
      dir="auto"
      data-slot="textarea"
      data-variant={variant}
      style={{
        borderRadius: "var(--input-radius)",
        paddingInline: "var(--space-3)",
        paddingBlock: "var(--space-2)",
        minHeight: "var(--control-height-lg)",
        ...style,
      }}
      className={cn(
        "w-full min-w-0 resize-y border border-border-strong bg-input text-sm text-foreground",
        "placeholder:text-muted-foreground",
        variant === "auto-grow" && "field-sizing-content resize-none",
        "transition-colors",
        "disabled:cursor-not-allowed disabled:resize-none disabled:border-border disabled:bg-disabled-surface disabled:text-disabled-foreground",
        "aria-invalid:border-destructive",
        FOCUS_VISIBLE_RING,
        className,
      )}
      {...props}
    />
  );
});
