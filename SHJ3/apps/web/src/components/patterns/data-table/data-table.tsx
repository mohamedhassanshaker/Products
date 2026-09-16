"use client";

import * as React from "react";
import {
  type ColumnDef,
  type ExpandedState,
  type OnChangeFn,
  type Row,
  type RowData,
  type RowSelectionState,
  type SortingState,
  flexRender,
  getCoreRowModel,
  getExpandedRowModel,
  getGroupedRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";
import { IconButton } from "@/components/ui/icon-button";
import { Icon } from "@/components/ui/icon";
import { Skeleton } from "@/components/ui/skeleton";
import { useIsBelowBreakpoint } from "@/components/ui/use-media-query";
import { DataTableColumnHeader } from "./data-table-column-header";
import { DataTableCardRow } from "./data-table-card-row";

/**
 * Per-column metadata `DataTable` reads to drive its own generic behaviour —
 * the standard TanStack v8 extension point (`ColumnMeta` is declared as an
 * empty interface upstream specifically for a consuming app to augment, not
 * a gap this file works around). Kept to exactly what design-system.md §5.5
 * #41 requires: identifying the row (`<th scope="row">`, the ≤560px card
 * title), which columns stay `dir="ltr"` regardless of column order under
 * RTL, which secondary columns feed the card's `MonoSubLine`, and which
 * cells are editable.
 */
declare module "@tanstack/react-table" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- TValue is part of the upstream interface's own signature; this augmentation does not need it, but must match the shape it extends.
  interface ColumnMeta<TData extends RowData, TValue> {
    /** Exactly one column per table should set this — the row's identity: `<th scope="row">`, and the ≤560px `Card` title. */
    identifying?: boolean;
    /** Numeric/mono content — `dir="ltr"` and excluded from the RTL column-order reversal's meaning change (§11.3, §5.5 #41). */
    mono?: boolean;
    /** Included in the ≤560px card's `MonoSubLine` of secondary fields. Defaults to `true` for every non-identifying column. */
    showInCardSummary?: boolean;
    /** `editable-cell` variant: renders `renderEditableCell` instead of the plain `cell` renderer. */
    editable?: boolean;
    renderEditableCell?: (row: TData, onCommit: (value: unknown) => void) => React.ReactNode;
  }
}

export type DataTableStatus = "ready" | "loading" | "error" | "empty" | "filtered-empty";

export interface DataTableProps<TRow> {
  columns: ColumnDef<TRow, unknown>[];
  data: readonly TRow[];
  getRowId: (row: TRow, index: number) => string;
  /** Accessible label for a row, used to compose the selection checkbox's and reorder buttons' names ("Select TXN-88213", "Move TXN-88213 up"). Defaults to the row id. */
  getRowLabel?: (row: TRow) => string;
  caption: React.ReactNode;
  captionVisuallyHidden?: boolean;

  /** Adds a leading checkbox column and row-selection state — "the wireframe lists bulk operations as a gap in §8; the wrapper supports it and screens opt in." */
  selectable?: boolean;
  selectedIds?: ReadonlySet<string>;
  onSelectedIdsChange?: (ids: ReadonlySet<string>) => void;

  /** Adds a leading expand/collapse toggle and an inline expanded-row region. */
  expandable?: boolean;
  renderExpandedRow?: (row: TRow) => React.ReactNode;
  expandedIds?: ReadonlySet<string>;
  onExpandedIdsChange?: (ids: ReadonlySet<string>) => void;

  /** Adds "Move up"/"Move down" buttons to the row-actions slot (B8's routing rules). `DataTable` holds no row-order state itself — the caller re-renders `data` in the new order and this file announces the result. */
  reorderable?: boolean;
  onReorder?: (rowId: string, direction: "up" | "down") => void;
  moveUpLabel?: string;
  moveDownLabel?: string;

  /** `grouped` variant (B9 tab 2's team membership) — a column id to group rows by. */
  groupBy?: string;

  sorting?: SortingState;
  onSortingChange?: OnChangeFn<SortingState>;
  /** Caller already sorted `data` (server-side) — `DataTable` reports header clicks via `onSortingChange` without re-ordering rows itself. Mirrors TanStack's own `manualSorting` option name. */
  manualSorting?: boolean;

  status?: DataTableStatus;
  loadingRowCount?: number;
  /** Rendered in place of rows when `status` is `"error"`. */
  errorContent?: React.ReactNode;
  /** Rendered in place of rows when `status` is `"empty"` or `"filtered-empty"` — typically a real `<EmptyState/>`, chosen by the caller from *why* the table is empty (§5.5 #41). */
  emptyContent?: React.ReactNode;

  /** Row ids currently being saved (an optimistic `editable-cell` write in flight) — renders `aria-busy` on the row. */
  savingRowIds?: ReadonlySet<string>;

  renderRowActions?: (row: TRow) => React.ReactNode;
  /** Optional `FilterBar` (or any) slot rendered above the table. */
  filterBar?: React.ReactNode;
  /** Typically a `Pagination` element — `DataTable` renders it in its own footer next to the selection summary it computes itself. */
  footer?: React.ReactNode;

  /** Auto-enabled above 200 rows (design-system.md §5.5 #41); override either way. */
  virtualized?: boolean;
  /** Heading level for the ≤560px card view's title — see `card.tsx`'s identical "heading level is a prop, never hardcoded" rule. */
  cardTitleLevel?: 1 | 2 | 3 | 4 | 5 | 6;
  /** Accessible label for the horizontal-scroll region (§5.5 #41: "the horizontal scroll container is focusable with an aria-label so keyboard users can scroll it"). */
  scrollRegionLabel?: string;
  className?: string;
}

const DEFAULT_LOADING_ROW_COUNT = 5;
const DEFAULT_MOVE_UP_LABEL = "Move up";
const DEFAULT_MOVE_DOWN_LABEL = "Move down";
const DEFAULT_SCROLL_REGION_LABEL = "Scrollable table";
const VIRTUALIZE_THRESHOLD = 200;
/** A bootstrap-only guess for `@tanstack/react-virtual`'s scroll-math — immediately corrected by real measurement via `measureElement` once rows mount (dynamic-size virtualization, not a rendered value), so this is not a design token. */
const ESTIMATED_ROW_HEIGHT_PX = 48;

function toRowSelectionState(ids: ReadonlySet<string> | undefined): RowSelectionState {
  if (!ids) return {};
  const state: RowSelectionState = {};
  for (const id of ids) state[id] = true;
  return state;
}

function toIdSet(state: RowSelectionState | Record<string, boolean>): ReadonlySet<string> {
  return new Set(
    Object.entries(state)
      .filter(([, checked]) => checked)
      .map(([id]) => id),
  );
}

function toExpandedState(ids: ReadonlySet<string> | undefined): ExpandedState {
  if (!ids) return {};
  const state: Record<string, boolean> = {};
  for (const id of ids) state[id] = true;
  return state;
}

/**
 * One TanStack Table wrapper, reused everywhere (design-system.md §5.5 #41,
 * ADR-0007): *"TanStack Table must be wrapped once, well, and reused across
 * all 14 screens rather than assembled per screen."* This is the single
 * highest-leverage component in the whole system.
 *
 * ## TanStack Table v8, not v9 — a deliberate version choice
 *
 * `@tanstack/react-table`'s `latest` npm tag is 9.x, a ground-up rewrite
 * around a signals/atoms reactive model (`useTable` + `tableFeatures()` +
 * `table.Subscribe`) — confirmed by reading the installed 9.2.4 package
 * directly, not assumed from the version number: the familiar v8 surface
 * this file uses (`useReactTable`, `getCoreRowModel`, `flexRender`, a plain
 * `ColumnDef[]`) still exists in v9 only as an explicitly `@deprecated`
 * compatibility shim (`useLegacyTable`). For the one component every future
 * table-bearing screen in this system depends on being right, building fresh
 * against a brand-new, less-battle-tested API (or a shim already marked for
 * removal) is the wrong trade against the mature, extensively documented v8
 * line, which remains a currently-published, non-deprecated major version.
 * Installed and pinned as `^8.21.3` instead of whatever `pnpm add` would
 * have resolved by default.
 *
 * ## Structural columns
 *
 * The selection checkbox, expand toggle, and reorder/action buttons are
 * synthetic columns this file prepends/appends to the caller's own
 * `columns` array before constructing the table — the standard TanStack
 * pattern for a column with no real data behind it (`column.id` only, no
 * `accessorKey`), not a parallel mechanism.
 *
 * ## a11y — row-level, not cell-level keyboard navigation
 *
 * §5.5 #41 deliberately reserves full 2D grid navigation for
 * `PermissionMatrix`: *"imposing it on 20 tables costs more than it gives."*
 * Here, `Tab` reaches every real interactive element in DOM order — nothing
 * intercepts it — and `ArrowUp`/`ArrowDown`, when `selectable` or
 * `reorderable`, move real DOM focus between the *same* interactive element
 * in the previous/next row (matched by a stable `data-row-action` key),
 * clamped at the first/last row rather than wrapping, the same convention
 * `PermissionMatrix`'s own arrow keys use. `aria-activedescendant` on the
 * scroll region additionally names the row that currently holds real focus —
 * a supplementary marker here (real focus already moves), not the primary
 * mechanism `PermissionMatrix`'s virtual cursor relies on.
 *
 * ## Virtualisation preserves real `<table>` semantics
 *
 * `@tanstack/react-virtual`'s usual recipe absolutely-positions each row,
 * which does not compose with genuine `<table>`/`<tbody>`/`<tr>` layout in
 * most browsers. This file uses the library's own documented alternative
 * instead — two `<tr>` "padding" spacer rows (before and after the rendered
 * window, sized to the total height of the rows they stand in for) around a
 * normal-flow slice of *real* `<tr>` rows — so every rendered row keeps its
 * genuine `<th scope="row">`/`<td>` structure; only the count of rows
 * actually mounted at once shrinks. §5.5 #41's a11y paragraph requires real
 * table semantics unconditionally, not "except when virtualised."
 */
export function DataTable<TRow>({
  columns,
  data,
  getRowId,
  getRowLabel,
  caption,
  captionVisuallyHidden = false,
  selectable = false,
  selectedIds,
  onSelectedIdsChange,
  expandable = false,
  renderExpandedRow,
  expandedIds,
  onExpandedIdsChange,
  reorderable = false,
  onReorder,
  moveUpLabel = DEFAULT_MOVE_UP_LABEL,
  moveDownLabel = DEFAULT_MOVE_DOWN_LABEL,
  groupBy,
  sorting,
  onSortingChange,
  manualSorting = false,
  status = "ready",
  loadingRowCount = DEFAULT_LOADING_ROW_COUNT,
  errorContent,
  emptyContent,
  savingRowIds,
  renderRowActions,
  filterBar,
  footer,
  virtualized,
  cardTitleLevel = 3,
  scrollRegionLabel = DEFAULT_SCROLL_REGION_LABEL,
  className,
}: DataTableProps<TRow>): React.ReactElement {
  const isCompact = useIsBelowBreakpoint(560);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const tableId = React.useId();

  const [internalSorting, setInternalSorting] = React.useState<SortingState>([]);
  const resolvedSorting = sorting ?? internalSorting;
  const handleSortingChange = React.useCallback<OnChangeFn<SortingState>>(
    (updater) => {
      const next = typeof updater === "function" ? updater(resolvedSorting) : updater;
      setInternalSorting(next);
      onSortingChange?.(next);
    },
    [onSortingChange, resolvedSorting],
  );

  const [internalRowSelection, setInternalRowSelection] = React.useState<RowSelectionState>(
    toRowSelectionState(selectedIds),
  );
  const resolvedRowSelection = selectedIds
    ? toRowSelectionState(selectedIds)
    : internalRowSelection;
  const handleRowSelectionChange = React.useCallback<OnChangeFn<RowSelectionState>>(
    (updater) => {
      const next = typeof updater === "function" ? updater(resolvedRowSelection) : updater;
      setInternalRowSelection(next);
      onSelectedIdsChange?.(toIdSet(next));
    },
    [onSelectedIdsChange, resolvedRowSelection],
  );

  const [internalExpanded, setInternalExpanded] = React.useState<ExpandedState>(
    toExpandedState(expandedIds),
  );
  const resolvedExpanded = expandedIds ? toExpandedState(expandedIds) : internalExpanded;
  const handleExpandedChange = React.useCallback<OnChangeFn<ExpandedState>>(
    (updater) => {
      const next = typeof updater === "function" ? updater(resolvedExpanded) : updater;
      setInternalExpanded(next);
      onExpandedIdsChange?.(toIdSet(next === true ? {} : next));
    },
    [onExpandedIdsChange, resolvedExpanded],
  );

  const resolvedColumns = React.useMemo<ColumnDef<TRow, unknown>[]>(() => {
    const leading: ColumnDef<TRow, unknown>[] = [];
    if (selectable) {
      leading.push({
        id: "__select",
        header: ({ table }) => (
          <Checkbox
            checked={
              table.getIsAllRowsSelected()
                ? true
                : table.getIsSomeRowsSelected()
                  ? "indeterminate"
                  : false
            }
            aria-label={SELECT_ALL_LABEL}
            onCheckedChange={(value) => table.toggleAllRowsSelected(value === true)}
          />
        ),
        cell: ({ row }) => (
          <Checkbox
            data-row-action="select"
            checked={row.getIsSelected()}
            aria-label={`${SELECT_ROW_LABEL_PREFIX} ${getRowLabel?.(row.original) ?? row.id}`}
            onCheckedChange={(value) => row.toggleSelected(value === true)}
          />
        ),
      });
    }
    if (expandable) {
      leading.push({
        id: "__expand",
        // Visually hidden, not `() => null` — a structural (no visible
        // caption) but genuinely empty `<th>` fails axe's own
        // `empty-table-header` rule (WCAG 1.3.1) — the same real bug
        // `permission-matrix.tsx`'s corner cell and this file's own
        // `__actions` column both needed the identical fix for, caught by
        // this file's `jest-axe` run, not assumed fine because the wireframe
        // shows this header cell visually blank.
        header: () => <span className="sr-only">{EXPAND_COLUMN_LABEL}</span>,
        cell: ({ row }) => (
          <IconButton
            data-row-action="expand"
            variant="ghost"
            size="sm"
            ariaLabel={`${row.getIsExpanded() ? COLLAPSE_ROW_LABEL_PREFIX : EXPAND_ROW_LABEL_PREFIX} ${getRowLabel?.(row.original) ?? row.id}`}
            aria-expanded={row.getIsExpanded()}
            onClick={row.getToggleExpandedHandler()}
          >
            <Icon
              icon={ChevronDown}
              size={16}
              className={row.getIsExpanded() ? "rotate-180" : undefined}
              mirrorInRtl={false}
            />
          </IconButton>
        ),
      });
    }

    const trailing: ColumnDef<TRow, unknown>[] = [];
    if (reorderable || renderRowActions) {
      trailing.push({
        id: "__actions",
        header: () => <span className="sr-only">{ACTIONS_COLUMN_LABEL}</span>,
        cell: ({ row }) => {
          const label = getRowLabel?.(row.original) ?? row.id;
          return (
            <div className="flex items-center justify-end" style={{ gap: "var(--space-1)" }}>
              {renderRowActions?.(row.original)}
              {reorderable ? (
                <>
                  <IconButton
                    data-row-action="move-up"
                    variant="ghost"
                    size="sm"
                    ariaLabel={`${moveUpLabel} ${label}`}
                    disabled={row.index === 0}
                    onClick={() => onReorder?.(row.id, "up")}
                  >
                    <Icon icon={ChevronUp} size={16} mirrorInRtl={false} />
                  </IconButton>
                  <IconButton
                    data-row-action="move-down"
                    variant="ghost"
                    size="sm"
                    ariaLabel={`${moveDownLabel} ${label}`}
                    disabled={row.index === data.length - 1}
                    onClick={() => onReorder?.(row.id, "down")}
                  >
                    <Icon icon={ChevronDown} size={16} mirrorInRtl={false} />
                  </IconButton>
                </>
              ) : null}
            </div>
          );
        },
      });
    }

    return [...leading, ...columns, ...trailing];
  }, [
    columns,
    data.length,
    expandable,
    getRowLabel,
    moveDownLabel,
    moveUpLabel,
    onReorder,
    reorderable,
    renderRowActions,
    selectable,
  ]);

  const table = useReactTable({
    data: data as TRow[],
    columns: resolvedColumns,
    getRowId,
    state: {
      sorting: resolvedSorting,
      rowSelection: resolvedRowSelection,
      expanded: resolvedExpanded,
      ...(groupBy ? { grouping: [groupBy] } : {}),
    },
    onSortingChange: handleSortingChange,
    onRowSelectionChange: handleRowSelectionChange,
    onExpandedChange: handleExpandedChange,
    manualSorting,
    enableRowSelection: selectable,
    // TanStack's row-expansion feature is built for hierarchical/`subRows`
    // data: `row.getCanExpand()` defaults to `false` whenever a row has no
    // `subRows`, *regardless* of `expanded` state — confirmed by reading
    // `RowExpanding.js` directly, not assumed, after an initial draft's
    // expand toggle silently did nothing (`getToggleExpandedHandler()`
    // no-ops when `getCanExpand()` is false). This organism uses "expanded"
    // for an arbitrary inline detail region (a transcript, B2's version
    // history), not tree data, so every row must be allowed to expand
    // regardless of children it does not have.
    getRowCanExpand: () => expandable,
    getExpandedRowModel: getExpandedRowModel(),
    getCoreRowModel: getCoreRowModel(),
    ...(manualSorting ? {} : { getSortedRowModel: getSortedRowModel() }),
    ...(groupBy ? { getGroupedRowModel: getGroupedRowModel() } : {}),
  });

  const rows = table.getRowModel().rows;
  const shouldVirtualize = virtualized ?? rows.length > VIRTUALIZE_THRESHOLD;

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ESTIMATED_ROW_HEIGHT_PX,
    overscan: 10,
    enabled: shouldVirtualize,
  });

  const identifyingColumnId = React.useMemo(
    () => columns.find((column) => column.meta?.identifying)?.id,
    [columns],
  );

  const [focusedRowId, setFocusedRowId] = React.useState<string | null>(null);

  const handleRowKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLTableRowElement>, rowIndex: number) => {
      if (!selectable && !reorderable) return;
      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
      const targetIndex = event.key === "ArrowUp" ? rowIndex - 1 : rowIndex + 1;
      const targetRow = rows[targetIndex];
      if (!targetRow) return;
      event.preventDefault();
      const actionKey = (event.target as HTMLElement).closest<HTMLElement>("[data-row-action]")
        ?.dataset.rowAction;
      const rowElement = scrollRef.current?.querySelector<HTMLElement>(
        `[data-row-id="${targetRow.id}"]`,
      );
      const nextFocusTarget =
        (actionKey && rowElement?.querySelector<HTMLElement>(`[data-row-action="${actionKey}"]`)) ||
        rowElement?.querySelector<HTMLElement>(
          "[data-row-action], button, [href], input, select, textarea",
        );
      nextFocusTarget?.focus();
    },
    [reorderable, rows, selectable],
  );

  const selectedCount = Object.values(resolvedRowSelection).filter(Boolean).length;

  if (isCompact) {
    return (
      <div data-slot="data-table" data-variant="compact" className={className}>
        <p className="sr-only">{caption}</p>
        {filterBar}
        {status === "loading" ? (
          <CompactLoadingSkeletons count={loadingRowCount} />
        ) : status === "error" ? (
          errorContent
        ) : status === "empty" || status === "filtered-empty" ? (
          emptyContent
        ) : (
          <div className="flex flex-col" style={{ gap: "var(--space-3)" }}>
            {rows.map((row) => (
              <DataTableCardRow
                key={row.id}
                cardTitleLevel={cardTitleLevel}
                title={
                  identifyingColumnId
                    ? flexRender(
                        row.getVisibleCells().find((c) => c.column.id === identifyingColumnId)
                          ?.column.columnDef.cell,
                        row
                          .getVisibleCells()
                          .find((c) => c.column.id === identifyingColumnId)
                          ?.getContext() as never,
                      )
                    : row.id
                }
                secondaryFields={row
                  .getVisibleCells()
                  .filter(
                    (cell) =>
                      cell.column.id !== identifyingColumnId &&
                      cell.column.id !== "__select" &&
                      cell.column.id !== "__expand" &&
                      cell.column.id !== "__actions" &&
                      (cell.column.columnDef.meta?.showInCardSummary ?? true),
                  )
                  .map((cell) => flexRender(cell.column.columnDef.cell, cell.getContext()))}
                actions={renderRowActions?.(row.original)}
                selectable={selectable}
                selected={row.getIsSelected()}
                selectLabel={`${SELECT_ROW_LABEL_PREFIX} ${getRowLabel?.(row.original) ?? row.id}`}
                onSelectedChange={(value) => row.toggleSelected(value)}
                expandable={expandable}
                expanded={row.getIsExpanded()}
                onToggleExpanded={row.getToggleExpandedHandler()}
                // Composed the same way the desktop `__expand` column's
                // button label is — an earlier draft omitted this entirely,
                // silently falling back to a generic, row-unaware "Show
                // details" here while the desktop view correctly said
                // "Expand Gamma" — caught by this file's own test suite,
                // not shipped inconsistent between the two layouts.
                expandToggleLabel={`${row.getIsExpanded() ? COLLAPSE_ROW_LABEL_PREFIX : EXPAND_ROW_LABEL_PREFIX} ${getRowLabel?.(row.original) ?? row.id}`}
                expandedContent={renderExpandedRow?.(row.original)}
              />
            ))}
          </div>
        )}
        <DataTableFooter selectedCount={selectedCount} selectable={selectable} footer={footer} />
      </div>
    );
  }

  const virtualItems = shouldVirtualize ? rowVirtualizer.getVirtualItems() : null;
  const paddingTop = virtualItems && virtualItems.length > 0 ? virtualItems[0]!.start : 0;
  const paddingBottom =
    virtualItems && virtualItems.length > 0
      ? rowVirtualizer.getTotalSize() - virtualItems[virtualItems.length - 1]!.end
      : 0;
  const visibleRowEntries = virtualItems
    ? virtualItems.map((item) => ({
        row: rows[item.index]!,
        index: item.index,
        measure: rowVirtualizer.measureElement,
      }))
    : rows.map((row, index) => ({ row, index, measure: undefined }));

  return (
    <div data-slot="data-table" data-variant="default" className={className}>
      {filterBar}
      {/* `tabIndex={0}` with no interactive role is the deliberate WCAG
          2.1.1/1.4.10 "scrollable region focusable" pattern §5.5 #41 itself
          calls for ("the horizontal scroll container is focusable...so
          keyboard users can scroll it") — axe-core ships a rule of that
          exact name (`scrollable-region-focusable`) checking *for* this
          shape, not against it. `jsx-a11y/no-noninteractive-tabindex`
          blanket-flags any `tabIndex` on a `<div>` regardless of role,
          confirmed by reading the installed rule's real source
          (`eslint-plugin-jsx-a11y@6.10`) rather than guessed from the error
          text — there is no `role` value that satisfies both it and this
          element's genuine semantics (a scroll container is not a widget,
          so an interactive ARIA role would be a lie). A scoped,
          documented suppression, the same "visible, justified exception"
          discipline this repo's own `design-gate-allow:` comments apply. */}
      <div
        ref={scrollRef}
        aria-label={scrollRegionLabel}
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- see the comment above this element.
        tabIndex={0}
        aria-activedescendant={focusedRowId ? `${tableId}-row-${focusedRowId}` : undefined}
        className="overflow-x-auto"
        style={{
          maxBlockSize: shouldVirtualize ? "32rem" : undefined,
          overflowY: shouldVirtualize ? "auto" : undefined,
        }}
      >
        <table id={tableId} className="w-full border-collapse">
          <caption
            className={
              captionVisuallyHidden ? "sr-only" : "mb-2 text-start text-sm text-muted-foreground"
            }
          >
            {caption}
          </caption>
          <thead>
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <DataTableColumnHeader
                    key={header.id}
                    mono={header.column.columnDef.meta?.mono ?? false}
                    sortDirection={header.column.getIsSorted()}
                    onToggleSort={
                      header.column.getCanSort()
                        ? header.column.getToggleSortingHandler()
                        : undefined
                    }
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </DataTableColumnHeader>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {status === "loading" ? (
              <DesktopLoadingSkeletonRows
                count={loadingRowCount}
                columnCount={resolvedColumns.length}
              />
            ) : status === "error" ? (
              <tr>
                <td colSpan={resolvedColumns.length}>{errorContent}</td>
              </tr>
            ) : status === "empty" || status === "filtered-empty" ? (
              <tr>
                <td colSpan={resolvedColumns.length}>{emptyContent}</td>
              </tr>
            ) : (
              <>
                {paddingTop > 0 ? (
                  <tr aria-hidden="true" style={{ blockSize: `${paddingTop}px` }}>
                    <td colSpan={resolvedColumns.length} />
                  </tr>
                ) : null}
                {visibleRowEntries.map(({ row, index, measure }) => (
                  <DataTableRow
                    key={row.id}
                    row={row}
                    rowId={`${tableId}-row-${row.id}`}
                    identifyingColumnId={identifyingColumnId}
                    expandable={expandable}
                    renderExpandedRow={renderExpandedRow}
                    columnCount={resolvedColumns.length}
                    saving={savingRowIds?.has(row.id) ?? false}
                    onKeyDown={(event) => handleRowKeyDown(event, index)}
                    onFocus={() => setFocusedRowId(row.id)}
                    measureRef={measure}
                  />
                ))}
                {paddingBottom > 0 ? (
                  <tr aria-hidden="true" style={{ blockSize: `${paddingBottom}px` }}>
                    <td colSpan={resolvedColumns.length} />
                  </tr>
                ) : null}
              </>
            )}
          </tbody>
        </table>
      </div>
      <DataTableFooter selectedCount={selectedCount} selectable={selectable} footer={footer} />
    </div>
  );
}

const SELECT_ALL_LABEL = "Select all rows";
const SELECT_ROW_LABEL_PREFIX = "Select";
const EXPAND_ROW_LABEL_PREFIX = "Expand";
const COLLAPSE_ROW_LABEL_PREFIX = "Collapse";
const EXPAND_COLUMN_LABEL = "Expand row";
const ACTIONS_COLUMN_LABEL = "Actions";

interface DataTableRowProps<TRow> {
  row: Row<TRow>;
  rowId: string;
  identifyingColumnId: string | undefined;
  expandable: boolean;
  renderExpandedRow?: ((row: TRow) => React.ReactNode) | undefined;
  columnCount: number;
  saving: boolean;
  onKeyDown: React.KeyboardEventHandler<HTMLTableRowElement>;
  onFocus: React.FocusEventHandler<HTMLTableRowElement>;
  measureRef?: ((node: Element | null) => void) | undefined;
}

function DataTableRow<TRow>({
  row,
  rowId,
  identifyingColumnId,
  expandable,
  renderExpandedRow,
  columnCount,
  saving,
  onKeyDown,
  onFocus,
  measureRef,
}: DataTableRowProps<TRow>): React.ReactElement {
  return (
    <>
      <tr
        id={rowId}
        ref={measureRef as React.Ref<HTMLTableRowElement>}
        data-row-id={row.id}
        data-index={row.index}
        aria-busy={saving ? true : undefined}
        aria-selected={row.getIsSelected() ? true : undefined}
        onKeyDown={onKeyDown}
        onFocus={onFocus}
        className={cn("border-b border-border", row.getIsSelected() && "bg-accent")}
        style={{ blockSize: "var(--table-row-height)" }}
      >
        {row.getVisibleCells().map((cell) => {
          const isIdentifying = cell.column.id === identifyingColumnId;
          const isMono = cell.column.columnDef.meta?.mono ?? false;
          const Tag = isIdentifying ? "th" : "td";
          return (
            <Tag
              key={cell.id}
              {...(isIdentifying ? { scope: "row" as const } : {})}
              dir={isMono ? "ltr" : undefined}
              className={cn(
                "text-start text-sm text-foreground",
                isIdentifying && "font-medium",
                isMono && "text-end font-mono",
              )}
              style={{
                paddingInline: "var(--table-cell-padding-inline)",
                paddingBlock: "var(--space-2)",
              }}
            >
              {flexRender(cell.column.columnDef.cell, cell.getContext())}
            </Tag>
          );
        })}
      </tr>
      {/* Guarded by `!row.getIsGrouped()`: a grouped row's "expanded"
          content is its real `subRows` — TanStack's own `getGroupedRowModel`
          already inserts them into `table.getRowModel().rows` once
          expanded, rendered as their own ordinary `<tr>`s by the `.map()`
          this component is itself called from, nothing extra needed here.
          This custom detail region exists only for a genuine leaf row's
          *caller-supplied* expanded content (a transcript, a version
          history) — calling `renderExpandedRow` against a group row's
          aggregate, non-`TRow`-shaped `row.original` would be meaningless. */}
      {expandable && row.getIsExpanded() && !row.getIsGrouped() ? (
        <tr>
          <td
            colSpan={columnCount}
            style={{
              paddingInline: "var(--table-cell-padding-inline)",
              paddingBlock: "var(--space-3)",
            }}
          >
            {renderExpandedRow?.(row.original)}
          </td>
        </tr>
      ) : null}
    </>
  );
}

function DesktopLoadingSkeletonRows({
  count,
  columnCount,
}: {
  count: number;
  columnCount: number;
}): React.ReactElement {
  const rows: React.ReactNode[] = [];
  for (let index = 0; index < count; index++) {
    rows.push(
      <tr key={index} style={{ blockSize: "var(--table-row-height)" }}>
        <td colSpan={columnCount} style={{ paddingInline: "var(--table-cell-padding-inline)" }}>
          <Skeleton variant="row" aria-label="Loading" />
        </td>
      </tr>,
    );
  }
  return <>{rows}</>;
}

function CompactLoadingSkeletons({ count }: { count: number }): React.ReactElement {
  const items: React.ReactNode[] = [];
  for (let index = 0; index < count; index++) {
    items.push(
      <Skeleton key={index} variant="block" className="h-20 w-full" aria-label="Loading" />,
    );
  }
  return (
    <div className="flex flex-col" style={{ gap: "var(--space-3)" }}>
      {items}
    </div>
  );
}

function DataTableFooter({
  selectedCount,
  selectable,
  footer,
}: {
  selectedCount: number;
  selectable: boolean;
  footer?: React.ReactNode;
}): React.ReactElement | null {
  if (!selectable && !footer) return null;
  return (
    <div className="mt-3 flex items-center justify-between">
      {selectable ? (
        <span role="status" aria-live="polite" className="text-sm text-muted-foreground">
          {selectedCount > 0 ? `${selectedCount} selected` : ""}
        </span>
      ) : (
        <span />
      )}
      {footer}
    </div>
  );
}
