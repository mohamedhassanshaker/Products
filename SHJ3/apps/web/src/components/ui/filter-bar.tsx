"use client";

import * as React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { IconButton } from "./icon-button";
import { Icon } from "./icon";
import { Button } from "./button";

export interface FilterBarActiveFilter {
  /** Stable identity for removal — not necessarily the same string as `label`. */
  key: string;
  /** The chip's full visible text, already composed by the caller (e.g. "Status: Escalated") — this component does not assemble a "field: value" sentence itself, the same reasoning `summary-strip.tsx`'s structured-props approach follows for §11.3 rule 4 (never build a sentence by concatenation across a translated boundary). */
  label: string;
}

export interface FilterBarProps {
  activeFilters: readonly FilterBarActiveFilter[];
  onRemoveFilter: (key: string) => void;
  onClearAll?: () => void;
  /** Default is English; pass a translated string in real feature code — mirrors label.tsx's `requiredText`/`optionalText` pattern. */
  clearAllLabel?: string;
  /**
   * `chips` — this component renders only the removable-filter summary and
   * count; filter *selection* happens elsewhere (a `SelectablePill` row, a
   * table's own controls) and reports its result here as `activeFilters`.
   * `dropdowns`/`mixed` additionally render `filterControls` — the
   * caller-supplied pickers (typically `Select`s) that let a user *add* a
   * filter — inline before the chip row.
   */
  variant?: "chips" | "dropdowns" | "mixed";
  filterControls?: React.ReactNode;
  /**
   * Fully-formatted, already-pluralized result count text, e.g.
   * "8,940 conversations" — the same reasoning `search-field.tsx`'s
   * `resultsAnnouncement` documents: pluralization is a localization
   * decision that belongs in the caller's `next-intl` catalogue, not
   * composed from a raw count here.
   */
  resultCountAnnouncement?: string;
  /** Builds each chip's remove-button accessible name from its label. Default matches §5.4's own example verbatim (`"remove filter: Escalated"`); pass a translated template in real feature code. */
  removeFilterLabel?: (label: string) => string;
  className?: string;
}

function defaultRemoveFilterLabel(label: string): string {
  return `remove filter: ${label}`;
}

/**
 * Active-filter summary with removable chips and a live result count
 * (design-system.md §5.4 #29 — B1 tab 2, B8, B11 tab 4, B14 tab 2). Each
 * chip's remove control is a real `IconButton`, so it is independently
 * focusable and correctly labelled — never a bare clickable `X` glyph with no
 * accessible name.
 *
 * No existing atom models "label plus its own remove button" (`Badge` is
 * read-only per its own doc comment; `SelectablePill` is a toggle, not a
 * removable item), so the chip markup here is a small, deliberately minimal
 * composition rather than a stretch-fit of either.
 */
export const FilterBar = React.forwardRef<HTMLDivElement, FilterBarProps>(function FilterBar(
  {
    activeFilters,
    onRemoveFilter,
    onClearAll,
    clearAllLabel = "Clear all",
    variant = "chips",
    filterControls,
    resultCountAnnouncement,
    removeFilterLabel = defaultRemoveFilterLabel,
    className,
  },
  ref,
) {
  const showControls =
    (variant === "dropdowns" || variant === "mixed") && filterControls !== undefined;
  const hasActiveFilters = activeFilters.length > 0;

  return (
    <div
      ref={ref}
      data-slot="filter-bar"
      className={cn("flex flex-col", className)}
      style={{ gap: "var(--space-2)" }}
    >
      {showControls ? (
        <div className="flex flex-wrap items-center" style={{ gap: "var(--space-2)" }}>
          {filterControls}
        </div>
      ) : null}
      {hasActiveFilters ? (
        <div className="flex flex-wrap items-center" style={{ gap: "var(--space-2)" }}>
          {activeFilters.map((filter) => (
            <span
              key={filter.key}
              className="inline-flex items-center rounded-full border border-border-strong bg-accent text-xs text-accent-foreground"
              style={{
                paddingInlineStart: "var(--space-3)",
                paddingInlineEnd: "var(--space-1)",
                paddingBlock: "var(--space-1)",
                gap: "var(--space-1)",
              }}
            >
              {filter.label}
              <IconButton
                variant="ghost"
                size="sm"
                ariaLabel={removeFilterLabel(filter.label)}
                onClick={() => onRemoveFilter(filter.key)}
              >
                <Icon icon={X} size={14} />
              </IconButton>
            </span>
          ))}
          {onClearAll ? (
            <Button variant="link" size="sm" onClick={onClearAll}>
              {clearAllLabel}
            </Button>
          ) : null}
        </div>
      ) : null}
      {resultCountAnnouncement !== undefined ? (
        <span role="status" aria-live="polite" className="text-xs text-muted-foreground">
          {resultCountAnnouncement}
        </span>
      ) : null}
    </div>
  );
});
