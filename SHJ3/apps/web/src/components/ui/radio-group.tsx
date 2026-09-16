"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { RadioGroup as RadioGroupPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";

/** See button.tsx for the full rationale. */
const FOCUS_VISIBLE_RING =
  "outline-none focus-visible:[outline:var(--focus-ring-width)_solid_var(--ring)] focus-visible:[outline-offset:var(--focus-ring-offset)]";

/**
 * Mirrors the group's resolved value so each `RadioGroupItem` can style
 * itself as checked/unchecked from a value it actually has in hand, rather
 * than a `data-[state=checked]:` selector — banned here the same way
 * checkbox.tsx explains (`no-hardcoded-design-values.mjs` matches the
 * arbitrary-*variant* bracket shape too, not only arbitrary values). This is
 * a plain internal context, not Radix's own (private) one.
 */
const RadioGroupValueContext = React.createContext<string | undefined>(undefined);

export type RadioGroupProps = React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Root>;

/**
 * One-of-several control (design-system.md §5.3 #7).
 *
 * Keyboard/selection behaviour is entirely Radix's: arrow keys move *and*
 * select, the group is a single tab stop. Not overridden — the brief for
 * this atom is explicit that Radix's defaults here are already correct.
 */
export const RadioGroup = React.forwardRef<
  React.ComponentRef<typeof RadioGroupPrimitive.Root>,
  RadioGroupProps
>(function RadioGroup({ className, value, defaultValue, onValueChange, ...props }, ref) {
  const [internalValue, setInternalValue] = React.useState<string | undefined>(defaultValue);
  const resolved = value ?? internalValue;

  const handleValueChange = React.useCallback(
    (next: string) => {
      setInternalValue(next);
      onValueChange?.(next);
    },
    [onValueChange],
  );

  return (
    <RadioGroupValueContext.Provider value={resolved}>
      <RadioGroupPrimitive.Root
        ref={ref}
        // See checkbox.tsx's identical note: conditional spread, not
        // `value={value}`, because `exactOptionalPropertyTypes` rejects an
        // explicit `undefined` against Radix's `value?: string`.
        {...(value !== undefined ? { value } : {})}
        {...(defaultValue !== undefined ? { defaultValue } : {})}
        onValueChange={handleValueChange}
        data-slot="radio-group"
        className={cn("grid gap-2", className)}
        {...props}
      />
    </RadioGroupValueContext.Provider>
  );
});

const radioItemVariants = cva(
  cn(
    "shrink-0 border transition-colors",
    "disabled:cursor-not-allowed disabled:border-border disabled:bg-disabled-surface",
    FOCUS_VISIBLE_RING,
  ),
  {
    variants: {
      checked: {
        true: "border-primary",
        false: "border-border-strong bg-input",
      },
      // `card` grows the item into a full-width bordered option — the
      // wireframe's "bordered options" — with the traditional circle drawn
      // separately inside it (see `dot` below). `default` keeps the item
      // itself as the circle. Either way this stays an unopinionated
      // building block: the label is the caller's own child content, not a
      // prop shape this atom imposes (B3's tone pills, B9's role cards, …).
      variant: {
        default: "size-4 rounded-full",
        card: "flex w-full items-center gap-2 rounded-md p-3 text-start",
      },
    },
    compoundVariants: [{ variant: "card", checked: true, class: "bg-accent" }],
    defaultVariants: { checked: false, variant: "default" },
  },
);

export interface RadioGroupItemProps
  extends
    Omit<React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Item>, "asChild">,
    Pick<VariantProps<typeof radioItemVariants>, "variant"> {}

export const RadioGroupItem = React.forwardRef<
  React.ComponentRef<typeof RadioGroupPrimitive.Item>,
  RadioGroupItemProps
>(function RadioGroupItem({ className, variant = "default", value, children, ...props }, ref) {
  const groupValue = React.useContext(RadioGroupValueContext);
  const checked = groupValue === value;

  const dot = (
    <RadioGroupPrimitive.Indicator
      data-slot="radio-group-indicator"
      className="flex h-full w-full items-center justify-center"
    >
      <span className="size-2 rounded-full bg-primary" />
    </RadioGroupPrimitive.Indicator>
  );

  return (
    <RadioGroupPrimitive.Item
      ref={ref}
      value={value}
      data-slot="radio-group-item"
      className={cn(radioItemVariants({ checked, variant }), className)}
      {...props}
    >
      {variant === "card" ? (
        <>
          <span
            className={cn(
              "flex size-4 shrink-0 items-center justify-center rounded-full border",
              checked ? "border-primary" : "border-border-strong bg-input",
            )}
          >
            {dot}
          </span>
          {children}
        </>
      ) : (
        dot
      )}
    </RadioGroupPrimitive.Item>
  );
});
