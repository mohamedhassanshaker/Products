import { beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { axe } from "jest-axe";
import { Combobox, type ComboboxOption } from "./combobox";

/**
 * Same jsdom gap select.test.tsx documents and stubs: Radix's Popper-based
 * positioning calls browser APIs jsdom does not implement.
 */
beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
  }
  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = () => {};
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
  if (!("ResizeObserver" in globalThis)) {
    class NoopResizeObserver implements ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    globalThis.ResizeObserver = NoopResizeObserver;
  }
});

const AGENT_OPTIONS: ComboboxOption[] = [
  { value: "billing", label: "Billing Agent" },
  { value: "faq", label: "General FAQ Agent" },
];

describe("Combobox — single", () => {
  it("shows the placeholder when nothing is selected", () => {
    render(
      <Combobox
        label="Agent"
        options={AGENT_OPTIONS}
        value={null}
        onValueChange={vi.fn()}
        placeholder="Select an agent"
      />,
    );
    expect(screen.getByRole("button", { name: "Select an agent" })).toBeInTheDocument();
  });

  it("filters the list from the search input and selecting an option calls onValueChange and closes", async () => {
    const onValueChange = vi.fn();
    render(
      <Combobox
        label="Agent"
        options={AGENT_OPTIONS}
        value={null}
        onValueChange={onValueChange}
        placeholder="Select an agent"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Select an agent" }));
    const search = await screen.findByRole("combobox", { name: "Agent" });
    expect(screen.getByText("Billing Agent")).toBeInTheDocument();
    expect(screen.getByText("General FAQ Agent")).toBeInTheDocument();

    fireEvent.change(search, { target: { value: "Billing" } });
    await waitFor(() => expect(screen.queryByText("General FAQ Agent")).not.toBeInTheDocument());
    expect(screen.getByText("Billing Agent")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Billing Agent"));
    expect(onValueChange).toHaveBeenCalledWith("billing");
    await waitFor(() =>
      expect(screen.queryByRole("combobox", { name: "Agent" })).not.toBeInTheDocument(),
    );
  });

  it("no-results renders the empty text for a search matching nothing", async () => {
    render(
      <Combobox
        label="Agent"
        options={AGENT_OPTIONS}
        value={null}
        onValueChange={vi.fn()}
        emptyText="No matching agents"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Select…" }));
    const search = await screen.findByRole("combobox", { name: "Agent" });
    fireEvent.change(search, { target: { value: "zzz-no-match" } });
    expect(await screen.findByText("No matching agents")).toBeInTheDocument();
  });

  it("offers to create a new entry when onCreate is provided and nothing matches", async () => {
    const onCreate = vi.fn();
    render(
      <Combobox
        label="Agent"
        options={AGENT_OPTIONS}
        value={null}
        onValueChange={vi.fn()}
        onCreate={onCreate}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Select…" }));
    const search = await screen.findByRole("combobox", { name: "Agent" });
    fireEvent.change(search, { target: { value: "Refund Agent" } });

    const createItem = await screen.findByText(/Create/);
    fireEvent.click(createItem);
    expect(onCreate).toHaveBeenCalledWith("Refund Agent");
  });

  it("loading renders a progressbar instead of the option list", async () => {
    render(<Combobox label="Agent" options={[]} value={null} onValueChange={vi.fn()} loading />);
    fireEvent.click(screen.getByRole("button", { name: "Select…" }));
    expect(await screen.findByRole("progressbar")).toBeInTheDocument();
  });
});

describe("Combobox — multi", () => {
  it("toggles membership on select without closing the popover", async () => {
    const onValueChange = vi.fn();
    render(
      <Combobox
        label="Agents"
        variant="multi"
        options={AGENT_OPTIONS}
        value={["billing"]}
        onValueChange={onValueChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Billing Agent" }));
    const faqOption = await screen.findByText("General FAQ Agent");

    fireEvent.click(faqOption);
    expect(onValueChange).toHaveBeenCalledWith(["billing", "faq"]);
    // Multi-select keeps the popover open for further picks.
    expect(screen.getByText("General FAQ Agent")).toBeInTheDocument();
  });

  it("shows a count once more than one option is selected", () => {
    render(
      <Combobox
        label="Agents"
        variant="multi"
        options={AGENT_OPTIONS}
        value={["billing", "faq"]}
        onValueChange={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "2 selected" })).toBeInTheDocument();
  });
});

describe("Combobox — async", () => {
  it("calls onSearchChange as the caller's search source of truth instead of filtering client-side", async () => {
    const onSearchChange = vi.fn();
    render(
      <Combobox
        label="Agent"
        variant="async"
        options={AGENT_OPTIONS}
        value={null}
        onValueChange={vi.fn()}
        onSearchChange={onSearchChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Select…" }));
    const search = await screen.findByRole("combobox", { name: "Agent" });
    fireEvent.change(search, { target: { value: "bill" } });
    expect(onSearchChange).toHaveBeenCalledWith("bill");
  });
});

describe("Combobox accessibility", () => {
  it("has zero axe violations once open", async () => {
    render(<Combobox label="Agent" options={AGENT_OPTIONS} value={null} onValueChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Select…" }));
    await screen.findByText("Billing Agent");
    expect(
      await axe(document.body, { rules: { region: { enabled: false } } }),
    ).toHaveNoViolations();
  });
});
