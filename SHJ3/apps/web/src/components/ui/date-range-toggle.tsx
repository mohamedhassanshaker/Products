"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { ToggleRow, type ToggleRowOption } from "./toggle-row";
import { useUrlSyncedValue } from "./use-url-synced-value";

export interface DateRangeToggleProps {
  /** e.g. `{ value: "7d", label: "Last 7 days" }` — B1's Today / Last 7 days / Last 30 days. */
  options: readonly ToggleRowOption[];
  "aria-label": string;
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  /** Query-string key — see `use-url-synced-value.ts` for the full mechanism this shares with `SubTabBar`. Pass `null` to disable URL sync. */
  urlParam?: string | null;
  /** §5.2's loading state — B1 recomputing all three panels for the new range. */
  loading?: boolean;
  /**
   * Fully-formatted announcement for the polite live region, e.g. "Showing
   * last 7 days, 8,940 conversations" — this component does not compute the
   * count itself (no real data exists in this wave, per the brief); it
   * renders whatever the caller supplies, and re-announces it whenever the
   * text changes. Omit while no count is available yet.
   */
  announcement?: string;
  className?: string;
}

/**
 * "A `ToggleRow` with URL state" (design-system.md §5.4 #40 — B1's own
 * `Today / Last 7 days / Last 30 days`), built directly on this batch's own
 * `ToggleRow` (§5.4 #2) and the `useUrlSyncedValue` hook `sub-tab-bar.tsx`
 * already established — not a parallel implementation of either. Range
 * change re-renders B1's three panels and announces the new range plus its
 * count; the announcement text itself is caller-supplied (see `announcement`
 * above) rather than composed here, matching how `search-field.tsx`'s
 * `resultsAnnouncement` and `filter-bar.tsx`'s `resultCountAnnouncement`
 * handle the identical "a count needs locale-aware pluralization, which
 * belongs to the caller's `next-intl` catalogue" concern.
 */
export const DateRangeToggle = React.forwardRef<HTMLDivElement, DateRangeToggleProps>(
  function DateRangeToggle(
    {
      options,
      "aria-label": ariaLabel,
      value,
      defaultValue,
      onValueChange,
      urlParam = "range",
      loading,
      announcement,
      className,
    },
    ref,
  ) {
    const firstOption = options[0];
    const [resolvedValue, setValue] = useUrlSyncedValue({
      param: urlParam,
      value,
      defaultValue: defaultValue ?? firstOption?.value,
      onChange: onValueChange,
    });

    return (
      <div className={cn("flex flex-col", className)} style={{ gap: "var(--space-1)" }}>
        <ToggleRow
          ref={ref}
          options={options}
          variant="segmented"
          aria-label={ariaLabel}
          {...(resolvedValue !== undefined ? { value: resolvedValue } : {})}
          onValueChange={setValue}
          {...(loading !== undefined ? { loading } : {})}
        />
        {announcement !== undefined ? (
          <span role="status" aria-live="polite" className="text-xs text-muted-foreground">
            {announcement}
          </span>
        ) : null}
      </div>
    );
  },
);
