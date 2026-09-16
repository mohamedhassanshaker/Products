"use client";

import * as React from "react";
import { Label as LabelPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";

export interface LabelProps extends Omit<
  React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root>,
  "htmlFor"
> {
  /**
   * The id of the field this label describes. Required, not optional: a
   * label with nothing to associate with is a defect, not a valid use
   * (design-system.md §5.3 #15) — it cannot be reached by clicking the label
   * text, and a screen reader cannot connect it to the field it names.
   */
  htmlFor: string;
  variant?: "default" | "required" | "optional";
  /** Visible required-marker text. Default is English; pass a translated string in real feature code. */
  requiredText?: string;
  /** Visible optional-marker text. Default is English; pass a translated string in real feature code. */
  optionalText?: string;
}

/**
 * Field label (design-system.md §5.3 #15). Adapted from the shadcn scaffold:
 * Radix's `Label.Root` already supplies the one behaviour worth keeping
 * (a `mousedown` handler that stops double/triple-clicking the label text
 * from selecting it — confirmed in `@radix-ui/react-label`'s source, which is
 * also why this stays `"use client"`); the required/optional marker and the
 * token/prop-contract layer are new.
 *
 * **The required marker is the word "Required" (or a caller-supplied
 * equivalent), never an asterisk alone** (§5.3 #15). An asterisk-only marker
 * fails for anyone who cannot see it (a screen reader does not announce `*`
 * as "required" by default) or does not already know the convention — a
 * plain-language word passes both.
 */
export const Label = React.forwardRef<React.ComponentRef<typeof LabelPrimitive.Root>, LabelProps>(
  function Label(
    {
      htmlFor,
      variant = "default",
      requiredText = "Required",
      optionalText = "Optional",
      className,
      children,
      ...props
    },
    ref,
  ) {
    return (
      <LabelPrimitive.Root
        ref={ref}
        htmlFor={htmlFor}
        data-slot="label"
        className={cn(
          "inline-flex items-center gap-1 text-sm leading-none font-medium text-foreground select-none",
          "peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
          className,
        )}
        {...props}
      >
        {children}
        {/* `font-regular`, not Tailwind's stock `font-normal` — this theme's
            font-weight scale only re-bridges regular/medium/semibold/bold
            (probed directly; `font-normal` compiles to nothing here). */}
        {variant === "required" && (
          <span className="text-2xs font-regular text-destructive-strong">{requiredText}</span>
        )}
        {variant === "optional" && (
          <span className="text-2xs font-regular text-muted-foreground">{optionalText}</span>
        )}
      </LabelPrimitive.Root>
    );
  },
);
