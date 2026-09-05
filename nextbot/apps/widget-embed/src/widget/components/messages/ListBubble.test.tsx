// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { useWidgetStore } from "../../store.js";
import { ListBubble } from "./ListBubble.js";

describe("ListBubble (A.2.3)", () => {
  beforeEach(() => {
    useWidgetStore.setState({ send: vi.fn().mockResolvedValue(undefined) });
  });
  afterEach(() => cleanup());

  const smallPayload = {
    contentType: "List" as const,
    title: "Choose an account",
    items: [
      { id: "a", label: "Checking" },
      { id: "b", label: "Savings" },
    ],
  };

  it("renders without a search bar for <=8 items", () => {
    render(<ListBubble payload={smallPayload} />);
    expect(screen.queryByLabelText("Search list options")).not.toBeInTheDocument();
    expect(screen.getByText("Checking")).toBeInTheDocument();
  });

  it("shows a search bar for >8 items and filters live", () => {
    const items = Array.from({ length: 10 }, (_, i) => ({ id: `i${i}`, label: `Item ${i}` }));
    render(<ListBubble payload={{ ...smallPayload, items }} />);
    const search = screen.getByLabelText("Search list options");
    fireEvent.change(search, { target: { value: "Item 3" } });
    expect(screen.getByText("Item 3")).toBeInTheDocument();
    expect(screen.queryByText("Item 0")).not.toBeInTheDocument();
  });

  it("shows 'No matching options' when the filter matches nothing", () => {
    const items = Array.from({ length: 9 }, (_, i) => ({ id: `i${i}`, label: `Item ${i}` }));
    render(<ListBubble payload={{ ...smallPayload, items }} />);
    fireEvent.change(screen.getByLabelText("Search list options"), { target: { value: "zzz" } });
    expect(screen.getByText("No matching options")).toBeInTheDocument();
  });

  it("selecting an item sends it and collapses to a compact summary", () => {
    render(<ListBubble payload={smallPayload} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Select" })[0]!);

    expect(useWidgetStore.getState().send).toHaveBeenCalledWith("List", { ...smallPayload, selectedItemId: "a" });
    expect(screen.getByText("You selected: Checking")).toBeInTheDocument();
  });

  it("renders the already-answered summary directly when disabled with a prior selection", () => {
    render(<ListBubble payload={{ ...smallPayload, selectedItemId: "b" }} disabled />);
    expect(screen.getByText("You selected: Savings")).toBeInTheDocument();
  });
});
