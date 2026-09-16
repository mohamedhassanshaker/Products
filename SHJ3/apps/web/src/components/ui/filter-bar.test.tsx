import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { axe } from "jest-axe";
import { FilterBar } from "./filter-bar";

const filters = [
  { key: "status", label: "Status: Escalated" },
  { key: "channel", label: "Channel: WhatsApp" },
];

describe("FilterBar", () => {
  it("renders each active filter as a chip with a correctly labelled, independently focusable remove button", () => {
    render(<FilterBar activeFilters={filters} onRemoveFilter={vi.fn()} />);
    expect(screen.getByText("Status: Escalated")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "remove filter: Status: Escalated" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "remove filter: Channel: WhatsApp" }),
    ).toBeInTheDocument();
  });

  it("clicking a chip's remove button reports that filter's key, not another one's", () => {
    const onRemoveFilter = vi.fn();
    render(<FilterBar activeFilters={filters} onRemoveFilter={onRemoveFilter} />);
    fireEvent.click(screen.getByRole("button", { name: "remove filter: Channel: WhatsApp" }));
    expect(onRemoveFilter).toHaveBeenCalledWith("channel");
    expect(onRemoveFilter).not.toHaveBeenCalledWith("status");
  });

  it("a custom removeFilterLabel template overrides the English default", () => {
    render(
      <FilterBar
        activeFilters={filters}
        onRemoveFilter={vi.fn()}
        removeFilterLabel={(label) => `إزالة الفلتر: ${label}`}
      />,
    );
    expect(
      screen.getByRole("button", { name: "إزالة الفلتر: Status: Escalated" }),
    ).toBeInTheDocument();
  });

  it("renders no chips and no clear-all when there are no active filters", () => {
    render(<FilterBar activeFilters={[]} onRemoveFilter={vi.fn()} onClearAll={vi.fn()} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("clear all fires onClearAll", () => {
    const onClearAll = vi.fn();
    render(<FilterBar activeFilters={filters} onRemoveFilter={vi.fn()} onClearAll={onClearAll} />);
    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    expect(onClearAll).toHaveBeenCalled();
  });

  it("renders the result count in a polite live region", () => {
    render(
      <FilterBar
        activeFilters={filters}
        onRemoveFilter={vi.fn()}
        resultCountAnnouncement="8,940 conversations"
      />,
    );
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveTextContent("8,940 conversations");
  });

  it("dropdowns/mixed variants render the caller's filterControls; chips does not", () => {
    const controls = <button type="button">Add filter</button>;
    const { rerender } = render(
      <FilterBar
        activeFilters={[]}
        onRemoveFilter={vi.fn()}
        variant="dropdowns"
        filterControls={controls}
      />,
    );
    expect(screen.getByRole("button", { name: "Add filter" })).toBeInTheDocument();

    rerender(
      <FilterBar
        activeFilters={[]}
        onRemoveFilter={vi.fn()}
        variant="chips"
        filterControls={controls}
      />,
    );
    expect(screen.queryByRole("button", { name: "Add filter" })).not.toBeInTheDocument();
  });

  it("has zero axe violations with active filters present", async () => {
    const { container } = render(
      <FilterBar activeFilters={filters} onRemoveFilter={vi.fn()} onClearAll={vi.fn()} />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
