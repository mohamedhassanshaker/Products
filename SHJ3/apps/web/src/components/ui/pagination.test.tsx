import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { axe } from "jest-axe";
import { Pagination } from "./pagination";

describe("Pagination", () => {
  describe("numbered variant", () => {
    it("renders a <nav aria-label='pagination'> with the current page marked aria-current", () => {
      render(<Pagination currentPage={2} totalPages={5} onPageChange={vi.fn()} />);
      expect(screen.getByRole("navigation", { name: "pagination" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "2" })).toHaveAttribute("aria-current", "page");
      expect(screen.getByRole("button", { name: "1" })).not.toHaveAttribute("aria-current");
    });

    it("clicking a page number reports that page", () => {
      const onPageChange = vi.fn();
      render(<Pagination currentPage={1} totalPages={5} onPageChange={onPageChange} />);
      fireEvent.click(screen.getByRole("button", { name: "3" }));
      expect(onPageChange).toHaveBeenCalledWith(3);
    });

    it("Previous is disabled on the first page, Next is disabled on the last", () => {
      const { rerender } = render(
        <Pagination currentPage={1} totalPages={5} onPageChange={vi.fn()} />,
      );
      expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Next page" })).not.toBeDisabled();

      rerender(<Pagination currentPage={5} totalPages={5} onPageChange={vi.fn()} />);
      expect(screen.getByRole("button", { name: "Previous page" })).not.toBeDisabled();
      expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
    });

    it("collapses a long page range behind an ellipsis around the current page", () => {
      render(
        <Pagination currentPage={10} totalPages={20} onPageChange={vi.fn()} siblingCount={1} />,
      );
      // Expected window: 1, …, 9, 10, 11, …, 20
      expect(screen.getByRole("button", { name: "1" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "9" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "10" })).toHaveAttribute("aria-current", "page");
      expect(screen.getByRole("button", { name: "11" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "20" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "5" })).not.toBeInTheDocument();
      expect(screen.getAllByText("…")).toHaveLength(2);
    });

    it("renders every page with no ellipsis when the total fits inside the sibling window", () => {
      render(<Pagination currentPage={2} totalPages={4} onPageChange={vi.fn()} />);
      for (const page of [1, 2, 3, 4]) {
        expect(screen.getByRole("button", { name: String(page) })).toBeInTheDocument();
      }
      expect(screen.queryByText("…")).not.toBeInTheDocument();
    });
  });

  describe("cursor variant", () => {
    it("disables Previous/Next based on hasPrevious/hasNext and reports clicks", () => {
      const onPrevious = vi.fn();
      const onNext = vi.fn();
      render(
        <Pagination
          variant="cursor"
          hasPrevious={false}
          hasNext={true}
          onPrevious={onPrevious}
          onNext={onNext}
        />,
      );
      expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled();
      fireEvent.click(screen.getByRole("button", { name: "Next page" }));
      expect(onNext).toHaveBeenCalled();
      expect(onPrevious).not.toHaveBeenCalled();
    });
  });

  describe("load-more variant", () => {
    it("disables the button when there is nothing more to load, and reports a click otherwise", () => {
      const onLoadMore = vi.fn();
      const { rerender } = render(
        <Pagination variant="load-more" hasMore={false} onLoadMore={onLoadMore} />,
      );
      expect(screen.getByRole("button", { name: "Load more" })).toBeDisabled();

      rerender(<Pagination variant="load-more" hasMore={true} onLoadMore={onLoadMore} />);
      fireEvent.click(screen.getByRole("button", { name: "Load more" }));
      expect(onLoadMore).toHaveBeenCalled();
    });

    it("loading reuses Button's own busy state", () => {
      render(<Pagination variant="load-more" hasMore loading onLoadMore={vi.fn()} />);
      expect(screen.getByRole("button", { name: "Load more" })).toHaveAttribute(
        "aria-busy",
        "true",
      );
    });
  });

  it("has zero axe violations in the numbered variant", async () => {
    const { container } = render(
      <Pagination currentPage={2} totalPages={5} onPageChange={vi.fn()} />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
