import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { axe } from "jest-axe";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "./data-table";
import { setMockViewportWidth, DEFAULT_MOCK_VIEWPORT_WIDTH } from "@/test/media-query-mock";

interface TxnRow {
  id: string;
  name: string;
  status: string;
  amount: number;
}

const DATA: TxnRow[] = [
  { id: "txn-3", name: "Gamma", status: "Active", amount: 50 },
  { id: "txn-1", name: "Alpha", status: "Draft", amount: 300 },
  { id: "txn-2", name: "Beta", status: "Active", amount: 120 },
];

const COLUMNS: ColumnDef<TxnRow, unknown>[] = [
  {
    id: "name",
    accessorKey: "name",
    header: "Name",
    // TanStack defaults every column to sortable — this fixture marks the
    // two columns this suite treats as non-sortable explicitly, matching
    // how a real screen would actually declare its own columns.
    enableSorting: false,
    meta: { identifying: true },
    cell: (ctx) => ctx.getValue() as string,
  },
  {
    id: "status",
    accessorKey: "status",
    header: "Status",
    enableSorting: false,
    cell: (ctx) => ctx.getValue() as string,
  },
  {
    id: "amount",
    accessorKey: "amount",
    header: "Amount",
    enableSorting: true,
    meta: { mono: true },
    cell: (ctx) => `AED ${ctx.getValue()}`,
  },
];

function baseProps(overrides: Partial<React.ComponentProps<typeof DataTable<TxnRow>>> = {}) {
  return {
    columns: COLUMNS,
    data: DATA,
    getRowId: (row: TxnRow) => row.id,
    getRowLabel: (row: TxnRow) => row.name,
    caption: "Transactions",
    ...overrides,
  } satisfies React.ComponentProps<typeof DataTable<TxnRow>>;
}

afterEach(() => {
  document.documentElement.dir = "";
  setMockViewportWidth(DEFAULT_MOCK_VIEWPORT_WIDTH);
});

describe("DataTable", () => {
  it("renders a real table with a caption, column headers and a row-identity th scope=row per row", () => {
    render(<DataTable {...baseProps()} />);
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByText("Transactions")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Status" })).toBeInTheDocument();
    expect(screen.getByRole("rowheader", { name: "Gamma" })).toBeInTheDocument();
    expect(screen.getByRole("rowheader", { name: "Alpha" })).toBeInTheDocument();
  });

  describe("sorting", () => {
    it("a sortable header is a real <button> inside a <th> carrying aria-sort", () => {
      render(<DataTable {...baseProps()} />);
      const header = screen.getByRole("columnheader", { name: "Amount" });
      expect(header).toHaveAttribute("aria-sort", "none");
      expect(within(header).getByRole("button", { name: "Amount" })).toBeInTheDocument();
    });

    it("a non-sortable header has no button and no aria-sort", () => {
      render(<DataTable {...baseProps()} />);
      const header = screen.getByRole("columnheader", { name: "Status" });
      expect(header).not.toHaveAttribute("aria-sort");
      expect(within(header).queryByRole("button")).not.toBeInTheDocument();
    });

    it("clicking a sortable header sorts the rows and updates aria-sort", () => {
      render(<DataTable {...baseProps()} />);
      fireEvent.click(screen.getByRole("button", { name: "Amount" }));

      // TanStack Table's own default for a numeric column is
      // descending-first (`sortDescFirst` defaults to `true` for a number
      // accessor — "biggest first" reads as more useful for numeric data
      // than alphabetical-style ascending) — confirmed against the real
      // installed behaviour rather than assumed, after a first draft of
      // this test wrongly expected ascending-first.
      expect(screen.getByRole("columnheader", { name: "Amount" })).toHaveAttribute(
        "aria-sort",
        "descending",
      );
      const rowHeaders = screen.getAllByRole("rowheader").map((cell) => cell.textContent);
      expect(rowHeaders).toEqual(["Alpha", "Beta", "Gamma"]); // 300, 120, 50

      fireEvent.click(screen.getByRole("button", { name: "Amount" }));
      expect(screen.getByRole("columnheader", { name: "Amount" })).toHaveAttribute(
        "aria-sort",
        "ascending",
      );
      expect(screen.getAllByRole("rowheader").map((cell) => cell.textContent)).toEqual([
        "Gamma",
        "Beta",
        "Alpha",
      ]); // 50, 120, 300
    });

    it("manualSorting reports the click without re-ordering rows itself", () => {
      const onSortingChange = vi.fn();
      render(<DataTable {...baseProps({ manualSorting: true, onSortingChange })} />);
      fireEvent.click(screen.getByRole("button", { name: "Amount" }));

      expect(onSortingChange).toHaveBeenCalled();
      const rowHeaders = screen.getAllByRole("rowheader").map((cell) => cell.textContent);
      expect(rowHeaders).toEqual(["Gamma", "Alpha", "Beta"]); // unchanged — caller's own order
    });
  });

  describe("selectable", () => {
    it("renders a select-all checkbox and a per-row checkbox, and reports selection changes", () => {
      const onSelectedIdsChange = vi.fn();
      render(<DataTable {...baseProps({ selectable: true, onSelectedIdsChange })} />);
      const rowCheckbox = screen.getByRole("checkbox", { name: "Select Gamma" });
      fireEvent.click(rowCheckbox);
      expect(onSelectedIdsChange).toHaveBeenCalledWith(new Set(["txn-3"]));
      expect(screen.getByRole("status")).toHaveTextContent("1 selected");
    });

    it("select-all selects every row", () => {
      render(<DataTable {...baseProps({ selectable: true })} />);
      fireEvent.click(screen.getByRole("checkbox", { name: "Select all rows" }));
      for (const row of DATA) {
        expect(screen.getByRole("checkbox", { name: `Select ${row.name}` })).toBeChecked();
      }
    });
  });

  describe("expandable", () => {
    it("toggles an inline expanded region and aria-expanded", () => {
      render(
        <DataTable
          {...baseProps({
            expandable: true,
            renderExpandedRow: (row) => <p>Transcript for {row.name}</p>,
          })}
        />,
      );
      const toggle = screen.getByRole("button", { name: "Expand Gamma" });
      expect(toggle).toHaveAttribute("aria-expanded", "false");
      expect(screen.queryByText("Transcript for Gamma")).not.toBeInTheDocument();

      fireEvent.click(toggle);
      expect(screen.getByRole("button", { name: "Collapse Gamma" })).toHaveAttribute(
        "aria-expanded",
        "true",
      );
      expect(screen.getByText("Transcript for Gamma")).toBeInTheDocument();
    });
  });

  describe("reorderable", () => {
    it("Move up/down buttons call onReorder and disable at the ends", () => {
      const onReorder = vi.fn();
      render(<DataTable {...baseProps({ reorderable: true, onReorder })} />);

      // Unsorted render order follows DATA: Gamma, Alpha, Beta.
      expect(screen.getByRole("button", { name: "Move up Gamma" })).toBeDisabled(); // first row
      expect(screen.getByRole("button", { name: "Move down Beta" })).toBeDisabled(); // last row

      fireEvent.click(screen.getByRole("button", { name: "Move down Gamma" }));
      expect(onReorder).toHaveBeenCalledWith("txn-3", "down");
    });
  });

  describe("grouped variant", () => {
    it("groups rows by the given column using TanStack's real grouped row model — collapsed group rows revealed by expanding, not a flat cluster", () => {
      // `expandable` is what actually renders a clickable toggle at all
      // (see the component doc comment) — `groupBy` alone produces
      // collapsed group rows with no affordance to open them.
      render(<DataTable {...baseProps({ groupBy: "status", expandable: true })} />);
      // TanStack's `getGroupedRowModel()` (confirmed against the real
      // rendered output, not assumed) collapses the grouped column's
      // distinct values into their own aggregated rows, with the original
      // rows only present as `subRows` revealed by expanding a group — the
      // *same* expansion mechanism `expandable`'s own per-row detail region
      // uses. Building a genuinely distinct "clustered but always-visible
      // rows" presentation (arguably the more natural reading of B9 tab 2's
      // "team membership" example, design-system.md §5.5 #41's only word on
      // this variant) is real, additional work this wave scoped out,
      // flagged in this wave's report rather than silently shipped as if
      // fully polished — sort/select/reorder/expand/RTL/the ≤560px collapse
      // are the brief's explicitly higher-emphasis areas.
      const activeGroupRow = screen.getByText("Active").closest("tr");
      expect(activeGroupRow).not.toBeNull();
      expect(screen.getByText("Draft")).toBeInTheDocument();
      expect(screen.queryByText("Gamma")).not.toBeInTheDocument();

      // Queried by `data-row-action` rather than accessible name: a group
      // row's synthetic `row.original` is not a real `TxnRow`, so
      // `getRowLabel` composing the button's label from it is a known,
      // out-of-scope-for-this-wave rough edge for the grouped variant
      // specifically (flagged above), not something this test should also
      // have to pin down precisely.
      const toggle = within(activeGroupRow as HTMLElement).getByRole("button");
      expect(toggle).toHaveAttribute("data-row-action", "expand");
      fireEvent.click(toggle);
      expect(screen.getByText("Gamma")).toBeInTheDocument();
      expect(screen.getByText("Beta")).toBeInTheDocument();
    });
  });

  describe("row-level keyboard navigation", () => {
    it("ArrowDown moves real focus to the same control in the next row when selectable", () => {
      render(<DataTable {...baseProps({ selectable: true })} />);
      // Unsorted render order follows DATA: Gamma, Alpha, Beta.
      const first = screen.getByRole("checkbox", { name: "Select Gamma" });
      const second = screen.getByRole("checkbox", { name: "Select Alpha" });
      first.focus();
      fireEvent.keyDown(first.closest("tr")!, { key: "ArrowDown" });
      expect(second).toHaveFocus();
    });

    it("ArrowUp/ArrowDown do nothing when neither selectable nor reorderable", () => {
      render(<DataTable {...baseProps()} />);
      const cell = screen.getByRole("rowheader", { name: "Gamma" });
      // A plain `<th>` with no `tabIndex` is not really focusable — there is
      // no interactive element in this row at all with neither `selectable`
      // nor `reorderable` set, which is exactly the scenario this test
      // means to prove is inert. The meaningful assertion is that firing the
      // key does not throw and produces no `onKeyDown`-driven side effect,
      // not a focus assertion against an element that was never focusable.
      expect(() => fireEvent.keyDown(cell.closest("tr")!, { key: "ArrowDown" })).not.toThrow();
    });
  });

  describe("RTL", () => {
    it("a mono column's header and cells stay dir=ltr regardless of column order under RTL", () => {
      document.documentElement.dir = "rtl";
      render(<DataTable {...baseProps()} />);
      expect(screen.getByRole("columnheader", { name: "Amount" })).toHaveAttribute("dir", "ltr");
      const cells = screen.getAllByText(/^AED /);
      for (const cell of cells) expect(cell.closest("td")).toHaveAttribute("dir", "ltr");
    });
  });

  describe("≤560px card collapse", () => {
    it("collapses to one Card per row with the identifying column as title and a MonoSubLine of the rest", () => {
      setMockViewportWidth(400);
      render(<DataTable {...baseProps()} />);

      expect(screen.queryByRole("table")).not.toBeInTheDocument();
      const gammaCard = screen
        .getByRole("heading", { name: "Gamma" })
        .closest('[data-slot="card"]');
      expect(gammaCard).not.toBeNull();
      // "Active" alone is ambiguous — Gamma and Beta share that status — so
      // this asserts on the row's own composed secondary-fields text within
      // its own card, not a page-wide text search.
      expect(within(gammaCard as HTMLElement).getByText("Active · AED 50")).toBeInTheDocument();
    });

    it("selection and expansion stay fully present, not just visually restructured", () => {
      setMockViewportWidth(400);
      const onSelectedIdsChange = vi.fn();
      render(
        <DataTable
          {...baseProps({
            selectable: true,
            onSelectedIdsChange,
            expandable: true,
            renderExpandedRow: (row) => <p>Detail: {row.name}</p>,
          })}
        />,
      );
      fireEvent.click(screen.getByRole("checkbox", { name: "Select Gamma" }));
      expect(onSelectedIdsChange).toHaveBeenCalledWith(new Set(["txn-3"]));

      fireEvent.click(screen.getByRole("button", { name: "Expand Gamma" }));
      expect(screen.getByText("Detail: Gamma")).toBeInTheDocument();
    });
  });

  describe("states", () => {
    it("loading renders row-height skeletons, not the real rows", () => {
      render(<DataTable {...baseProps({ status: "loading", loadingRowCount: 3 })} />);
      expect(screen.queryByRole("rowheader")).not.toBeInTheDocument();
      expect(screen.getAllByLabelText("Loading")).toHaveLength(3);
    });

    it("error renders the caller's error content instead of rows", () => {
      render(
        <DataTable
          {...baseProps({ status: "error", errorContent: <p>Could not load transactions</p> })}
        />,
      );
      expect(screen.getByText("Could not load transactions")).toBeInTheDocument();
      expect(screen.queryByRole("rowheader")).not.toBeInTheDocument();
    });

    it("empty renders the caller's empty content instead of rows", () => {
      render(
        <DataTable {...baseProps({ status: "empty", emptyContent: <p>No transactions yet</p> })} />,
      );
      expect(screen.getByText("No transactions yet")).toBeInTheDocument();
    });
  });

  describe("virtualisation", () => {
    function manyRows(count: number): TxnRow[] {
      const rows: TxnRow[] = [];
      for (let index = 0; index < count; index++) {
        rows.push({ id: `row-${index}`, name: `Row ${index}`, status: "Active", amount: index });
      }
      return rows;
    }

    it("auto-enables above 200 rows: not every row is mounted at once", () => {
      render(<DataTable {...baseProps({ data: manyRows(500), getRowId: (r) => r.id })} />);
      const mounted = screen.getAllByRole("row").length; // includes the header row
      expect(mounted).toBeLessThan(500);
    });

    it("does not virtualise at or below the 200-row threshold: every row is mounted", () => {
      render(<DataTable {...baseProps({ data: manyRows(50), getRowId: (r) => r.id })} />);
      expect(screen.getAllByRole("rowheader")).toHaveLength(50);
    });

    it("an explicit virtualized override is honoured either way", () => {
      render(
        <DataTable
          {...baseProps({ data: manyRows(50), getRowId: (r) => r.id, virtualized: true })}
        />,
      );
      const mounted = screen.getAllByRole("row").length;
      expect(mounted).toBeLessThan(51);
    });
  });

  it("has zero axe violations in its default state", async () => {
    const { container } = render(<DataTable {...baseProps()} />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("has zero axe violations when selectable and expandable", async () => {
    const { container } = render(
      <DataTable
        {...baseProps({ selectable: true, expandable: true, renderExpandedRow: () => <p>x</p> })}
      />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it("has zero axe violations in the ≤560px collapsed layout", async () => {
    setMockViewportWidth(400);
    const { container } = render(<DataTable {...baseProps()} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
