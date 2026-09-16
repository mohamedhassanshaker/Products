"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { ToggleGroup as ToggleGroupPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";
import { Spinner } from "./spinner";
import { useResolvedDir } from "./use-resolved-dir";

/** See button.tsx for the full rationale. */
const FOCUS_VISIBLE_RING =
  "outline-none focus-visible:[outline:var(--focus-ring-width)_solid_var(--ring)] focus-visible:[outline-offset:var(--focus-ring-offset)]";

/** `with-dot`'s status colour — the dot is a second, non-colour-independent channel alongside the mandatory word (§5.4). */
const DOT_COLOR_BY_STATUS = {
  success: "bg-success",
  warning: "bg-warning",
  neutral: "bg-muted-foreground",
} as const;

export interface ToggleRowOption {
  value: string;
  label: React.ReactNode;
  /** A mode genuinely unavailable for the current agent (§5.4's real `disabled` state — distinct from `SubTabBar`'s RBAC-hide). */
  disabled?: boolean;
  /** `with-dot` variant only. */
  dotStatus?: "success" | "warning" | "neutral";
}

const trackVariants = cva("inline-flex items-center", {
  variants: {
    variant: {
      segmented: "rounded-full border border-border-strong bg-transparent",
      standalone: "flex-wrap",
      "with-dot": "flex-wrap",
    },
  },
});

const itemVariants = cva(
  cn(
    "inline-flex shrink-0 items-center justify-center whitespace-nowrap text-sm font-medium transition-colors",
    "disabled:cursor-not-allowed disabled:text-disabled-foreground disabled:hover:bg-transparent",
    FOCUS_VISIBLE_RING,
  ),
  {
    variants: {
      variant: {
        // The wireframe's own "dark fill" (§5.4): --foreground fill with
        // --background text on the active segment, 14.27:1 per the spec.
        segmented: cn(
          "rounded-full text-foreground hover:bg-accent hover:text-accent-foreground",
          "data-[state=on]:bg-foreground data-[state=on]:text-background data-[state=on]:hover:bg-foreground",
        ),
        standalone: cn(
          "rounded-full border border-border-strong text-foreground hover:bg-accent hover:text-accent-foreground",
          "data-[state=on]:border-foreground data-[state=on]:bg-foreground data-[state=on]:text-background data-[state=on]:hover:bg-foreground",
        ),
        "with-dot": cn(
          "rounded-full border border-border-strong text-foreground hover:bg-accent hover:text-accent-foreground",
          "data-[state=on]:border-foreground data-[state=on]:bg-foreground data-[state=on]:text-background data-[state=on]:hover:bg-foreground",
        ),
      },
    },
  },
);

export interface ToggleRowProps extends VariantProps<typeof itemVariants> {
  options: readonly ToggleRowOption[];
  /** Accessible name for the group, e.g. "Widget display mode". */
  "aria-label": string;
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  /** §5.2 loading: the *active* segment (the mode currently being recomputed, e.g. B4's trace) shows a spinner and the row is `aria-busy`. */
  loading?: boolean;
  className?: string;
}

/**
 * Pill buttons, dark fill when active, mutually exclusive (design-system.md
 * §5.4 — the wireframe's own named component: A1's Docked/Expanded/WhatsApp,
 * A3's AI-thinking/Escalated, B1's date range, B4's execution modes, B8's
 * agent status). Built on Radix `ToggleGroup type="single"`, which supplies
 * `role="radiogroup"` on the root and `role="radio"` + `aria-checked` on each
 * item automatically (confirmed by reading `@radix-ui/react-toggle-group`'s
 * compiled source — `role: "radiogroup"` is applied precisely when
 * `type === "single"`, not assumed from the prose alone) — "arrow keys move
 * *and* select; the group announces '2 of 3'" is this role, unmodified.
 *
 * **Radix's single-type `ToggleGroup` allows deselecting the active item**
 * (clicking it again reports `value=""`) — correct for an optional filter
 * toggle, wrong here: §5.4 states these are "mutually exclusive states of one
 * view," i.e. always exactly one active, the same contract a radio group
 * gives for free. An empty-string report is therefore ignored rather than
 * forwarded, keeping the previous selection pinned — `toggle-row.test.tsx`
 * asserts a click on the already-active segment leaves it active rather than
 * clearing the group.
 *
 * ## The RTL arrow-key problem
 *
 * Identical root cause to `sub-tab-bar.tsx`'s note, re-verified independently
 * for this primitive rather than assumed to be the same fix by analogy:
 * `ToggleGroup`'s arrow-key handling is the same `@radix-ui/react-roving-focus`
 * package `Tabs` uses, calling the identical `useDirection(dir)`, which
 * resolves to `"ltr"` with no `dir` prop and no `DirectionProvider` (neither
 * exists here). Fixed the same way, via `useResolvedDir()`.
 */
export const ToggleRow = React.forwardRef<
  React.ComponentRef<typeof ToggleGroupPrimitive.Root>,
  ToggleRowProps
>(function ToggleRow(
  {
    options,
    variant = "segmented",
    "aria-label": ariaLabel,
    value,
    defaultValue,
    onValueChange,
    loading = false,
    className,
  },
  ref,
) {
  const dir = useResolvedDir();
  const [internalValue, setInternalValue] = React.useState<string | undefined>(
    defaultValue ?? options[0]?.value,
  );
  const resolvedVariant = variant ?? "segmented";
  const activeValue = value ?? internalValue;

  const handleValueChange = React.useCallback(
    (next: string) => {
      // Radix's own "deselect the active item" behaviour for type="single" —
      // see the component doc comment. ToggleRow has no "none selected" state.
      if (next === "") return;
      setInternalValue(next);
      onValueChange?.(next);
    },
    [onValueChange],
  );

  return (
    <ToggleGroupPrimitive.Root
      ref={ref}
      type="single"
      dir={dir}
      aria-label={ariaLabel}
      // Always a controlled `value` fed from *our own* resolved
      // `activeValue` — never Radix's own `defaultValue`/uncontrolled path.
      // §5.4 states these segments are "mutually exclusive states of one
      // view," i.e. always exactly one active; Radix's single-type
      // `ToggleGroup` has no "fall back to the first option" behaviour of its
      // own, so leaving it uncontrolled with nothing supplied (the original,
      // real bug this comment replaces: forwarding only the *raw* `value`/
      // `defaultValue` props, both `undefined` in the common no-args case)
      // renders with nothing selected at all, contradicting the component's
      // own contract — caught by this component's own render test asserting
      // the first option is active by default, not assumed to work.
      // Conditional spread, not `value={activeValue}` unconditionally — see
      // checkbox.tsx's identical note: `exactOptionalPropertyTypes` rejects
      // an explicit `undefined` against Radix's `value?: string`, which
      // `activeValue` can still be for the degenerate empty-`options` case.
      {...(activeValue !== undefined ? { value: activeValue } : {})}
      onValueChange={handleValueChange}
      aria-busy={loading ? true : undefined}
      className={cn(trackVariants({ variant: resolvedVariant }), className)}
      style={{
        gap: "var(--space-1)",
        padding: resolvedVariant === "segmented" ? "var(--space-1)" : undefined,
      }}
    >
      {options.map((option) => {
        const isActive = option.value === activeValue;
        return (
          <ToggleGroupPrimitive.Item
            key={option.value}
            value={option.value}
            disabled={option.disabled}
            className={itemVariants({ variant: resolvedVariant })}
            style={{
              paddingInline: "var(--space-3)",
              paddingBlock: "var(--space-1)",
              gap: "var(--space-1)",
            }}
          >
            {resolvedVariant === "with-dot" && option.dotStatus ? (
              <span
                aria-hidden="true"
                className={cn(
                  "size-2 shrink-0 rounded-full",
                  DOT_COLOR_BY_STATUS[option.dotStatus],
                )}
              />
            ) : null}
            {loading && isActive ? <Spinner size="xs" /> : null}
            {option.label}
          </ToggleGroupPrimitive.Item>
        );
      })}
    </ToggleGroupPrimitive.Root>
  );
});
