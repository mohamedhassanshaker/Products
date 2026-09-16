"use client";

import * as React from "react";
import { Check, Minus } from "lucide-react";
import { Checkbox as CheckboxPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";

/** See button.tsx for the full rationale. */
const FOCUS_VISIBLE_RING =
  "outline-none focus-visible:[outline:var(--focus-ring-width)_solid_var(--ring)] focus-visible:[outline-offset:var(--focus-ring-offset)]";

type CheckedState = boolean | "indeterminate";

export type CheckboxProps = Omit<
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>,
  "asChild"
>;

/**
 * Boolean control for a list (design-system.md §5.3 #6).
 *
 * The checked/indeterminate state is mirrored into local state — rather than
 * styled from Radix's own `data-state`/`aria-checked` attributes via a CSS
 * selector — for two independent reasons: (1) the check-vs-dash *glyph*
 * choice is a JS decision (which child to render), so the value has to exist
 * in JS regardless; (2) `no-hardcoded-design-values.mjs`'s arbitrary-value
 * ban matches any `word-[...]` shape, including Tailwind's arbitrary-variant
 * bracket form (`data-[state=checked]:…`), not only arbitrary *values* — so
 * that selector is unavailable here even though it is the shadcn-standard
 * approach. Mirroring is the same controlled/uncontrolled-merge pattern
 * `RadioGroup` and `Switch` use for the same reason.
 *
 * `error` is supported via the caller passing `aria-invalid` (Tailwind's
 * built-in `aria-invalid:` variant needs no brackets). `selected` *is* this
 * component's checked state, so it is not a separate concept; `empty` does
 * not apply (§5.2).
 */
export const Checkbox = React.forwardRef<
  React.ComponentRef<typeof CheckboxPrimitive.Root>,
  CheckboxProps
>(function Checkbox({ className, checked, defaultChecked, onCheckedChange, style, ...props }, ref) {
  const [internalChecked, setInternalChecked] = React.useState<CheckedState>(
    defaultChecked ?? false,
  );
  const resolved = checked ?? internalChecked;
  const isChecked = resolved === true;
  const isIndeterminate = resolved === "indeterminate";

  const handleCheckedChange = React.useCallback(
    (value: CheckedState) => {
      setInternalChecked(value);
      onCheckedChange?.(value);
    },
    [onCheckedChange],
  );

  return (
    <CheckboxPrimitive.Root
      ref={ref}
      // Spread conditionally rather than `checked={checked}`: under
      // `exactOptionalPropertyTypes`, Radix's own `checked?: CheckedState`
      // (no `| undefined` in its declared type) rejects an *explicit*
      // `undefined` — only an omitted key satisfies "optional" here.
      {...(checked !== undefined ? { checked } : {})}
      {...(defaultChecked !== undefined ? { defaultChecked } : {})}
      onCheckedChange={handleCheckedChange}
      data-slot="checkbox"
      className={cn(
        "peer inline-flex size-4 shrink-0 items-center justify-center rounded-xs border transition-colors",
        "disabled:cursor-not-allowed disabled:border-border disabled:bg-disabled-surface",
        isChecked || isIndeterminate
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border-strong bg-input text-transparent",
        "aria-invalid:border-destructive",
        FOCUS_VISIBLE_RING,
        className,
      )}
      style={style}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="flex items-center justify-center text-current"
      >
        {isIndeterminate ? (
          <Minus className="size-3.5" aria-hidden="true" />
        ) : (
          <Check className="size-3.5" aria-hidden="true" />
        )}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
});
