import * as React from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icon";

/** See button.tsx for the full rationale. */
const FOCUS_VISIBLE_RING =
  "outline-none focus-visible:[outline:var(--focus-ring-width)_solid_var(--ring)] focus-visible:[outline-offset:var(--focus-ring-offset)]";

export interface DataTableColumnHeaderProps {
  children: React.ReactNode;
  // `| undefined` explicitly on these two, not just `?:` — `data-table.tsx`
  // forwards TanStack's own `getIsSorted()`/conditional `getToggleSortingHandler()`
  // results straight through, and under this project's
  // `exactOptionalPropertyTypes` a computed-but-possibly-`undefined` value
  // passed as a named prop needs the type to say so explicitly (this file's
  // own type, fixed at the source rather than a conditional spread at every
  // call site — see `use-permission-matrix-grid.ts`'s identical note).
  /** TanStack's own `column.getIsSorted()` return shape — passed straight through rather than re-derived. */
  sortDirection?: (false | "asc" | "desc") | undefined;
  /** TanStack's own `column.getToggleSortingHandler()`, or omitted for a non-sortable column. */
  onToggleSort?: React.MouseEventHandler<HTMLButtonElement> | undefined;
  /** Keeps this column's header text `dir="ltr"` — for a numeric/mono column, matching the corresponding body cells (§11.3, §5.5 #41's RTL note). */
  mono?: boolean;
  style?: React.CSSProperties;
  className?: string;
}

const SORT_ICON: Readonly<Record<"asc" | "desc" | "none", typeof ArrowUp>> = {
  asc: ArrowUp,
  desc: ArrowDown,
  none: ChevronsUpDown,
};

/**
 * `DataTable`'s column header cell (design-system.md §5.5 #41): *"Sortable
 * headers are `<button>` inside `<th>` with
 * `aria-sort='ascending|descending|none'`."* Read literally that sentence
 * places `aria-sort` on the button, but the ARIA spec scopes `aria-sort` to
 * an element with the `columnheader` role — i.e. the `<th>` itself, not a
 * `role="button"` descendant — confirmed against the same class of gap
 * `wizard.tsx`'s `MobileStepPicker` found for `role="combobox"`'s naming
 * rules (a real, structurally identical lesson, applied here proactively
 * rather than re-discovered the hard way a third time). The `<button>` still
 * exists exactly as specified — it is the real click/keyboard-activation
 * target — `aria-sort` just lives one level up, on this file's own `<th>`.
 *
 * A non-sortable column (`onToggleSort` omitted) renders as a plain `<th>`
 * with no button and no `aria-sort` at all, per the same spec sentence
 * ("sortable headers are...", implying an unsortable one is not this shape).
 */
export const DataTableColumnHeader = React.forwardRef<
  HTMLTableCellElement,
  DataTableColumnHeaderProps
>(function DataTableColumnHeader(
  { children, sortDirection = false, onToggleSort, mono = false, style, className },
  ref,
) {
  const ariaSort = onToggleSort
    ? sortDirection === "asc"
      ? "ascending"
      : sortDirection === "desc"
        ? "descending"
        : "none"
    : undefined;
  const SortIcon = SORT_ICON[sortDirection === false ? "none" : sortDirection];

  return (
    <th
      ref={ref}
      scope="col"
      aria-sort={ariaSort}
      dir={mono ? "ltr" : undefined}
      className={cn(
        "sticky bg-table-header-surface text-sm font-semibold text-foreground",
        mono && "text-end",
        className,
      )}
      style={{
        insetBlockStart: 0,
        zIndex: "var(--z-sticky)",
        paddingInline: "var(--table-cell-padding-inline)",
        paddingBlock: "var(--space-2)",
        blockSize: "var(--table-row-height)",
        ...style,
      }}
    >
      {onToggleSort ? (
        <button
          type="button"
          onClick={onToggleSort}
          className={cn(
            "inline-flex items-center gap-1 rounded-xs whitespace-nowrap",
            FOCUS_VISIBLE_RING,
          )}
        >
          {children}
          <Icon icon={SortIcon} size={14} className="text-muted-foreground" mirrorInRtl={false} />
        </button>
      ) : (
        children
      )}
    </th>
  );
});
