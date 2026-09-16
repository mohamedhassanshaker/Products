import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { axe } from "jest-axe";
import { SearchField } from "./search-field";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("SearchField", () => {
  it("renders a search box with the given accessible name", () => {
    render(<SearchField aria-label="Search sources" />);
    expect(screen.getByRole("searchbox", { name: "Search sources" })).toBeInTheDocument();
  });

  it("onValueChange fires immediately per keystroke, undebounced", () => {
    const onValueChange = vi.fn();
    render(<SearchField aria-label="Search sources" onValueChange={onValueChange} />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "sewa" } });
    expect(onValueChange).toHaveBeenCalledWith("sewa");
  });

  it("onSearch is debounced — not called before the delay, called once after it with the settled value", () => {
    const onSearch = vi.fn();
    render(<SearchField aria-label="Search sources" debounceMs={300} onSearch={onSearch} />);
    const input = screen.getByRole("searchbox");
    fireEvent.change(input, { target: { value: "s" } });
    vi.advanceTimersByTime(150);
    fireEvent.change(input, { target: { value: "sewa" } });
    // Still inside the debounce window measured from the *second* keystroke —
    // the first keystroke's timer must have been superseded, not fired too.
    vi.advanceTimersByTime(150);
    expect(onSearch).not.toHaveBeenCalled();
    vi.advanceTimersByTime(150);
    expect(onSearch).toHaveBeenCalledTimes(1);
    expect(onSearch).toHaveBeenCalledWith("sewa");
  });

  it("Escape clears the field immediately, bypassing the debounce, and fires both callbacks with the empty string", () => {
    const onValueChange = vi.fn();
    const onSearch = vi.fn();
    render(
      <SearchField
        aria-label="Search sources"
        debounceMs={300}
        onValueChange={onValueChange}
        onSearch={onSearch}
      />,
    );
    const input = screen.getByRole("searchbox");
    fireEvent.change(input, { target: { value: "sewa" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(input).toHaveValue("");
    expect(onValueChange).toHaveBeenLastCalledWith("");
    expect(onSearch).toHaveBeenCalledWith("");
    // Bypassed the debounce — called synchronously, no timer advance needed.
    onSearch.mockClear();
    vi.advanceTimersByTime(300);
    // The settling debounce for the now-empty value fires once more, which is
    // correct (the value genuinely changed) — assert it is "" again, not a
    // stale "sewa".
    expect(onSearch).toHaveBeenCalledWith("");
  });

  it("Escape on an already-empty field does not stop propagation, so a parent's own Escape handling (e.g. closing a dialog) still runs", () => {
    const onParentKeyDown = vi.fn();
    render(
      // eslint-disable-next-line jsx-a11y/no-static-element-interactions -- test-only wrapper, not feature code.
      <div onKeyDown={onParentKeyDown}>
        <SearchField aria-label="Search sources" />
      </div>,
    );
    fireEvent.keyDown(screen.getByRole("searchbox"), { key: "Escape" });
    expect(onParentKeyDown).toHaveBeenCalled();
  });

  it("renders the results announcement in a polite live region", () => {
    render(<SearchField aria-label="Search sources" resultsAnnouncement="12 results for 'sewa'" />);
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveTextContent("12 results for 'sewa'");
  });

  it("searching marks the field aria-busy (Input's own loading contract) and hides the clear button", () => {
    render(<SearchField aria-label="Search sources" defaultValue="sewa" searching />);
    expect(screen.getByRole("searchbox")).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByRole("button", { name: "Clear search" })).not.toBeInTheDocument();
  });

  it("with-scope variant renders a separately-labelled scope selector alongside the search box", () => {
    render(
      <SearchField
        aria-label="Search sources"
        variant="with-scope"
        scopeAriaLabel="Search scope"
        scopeOptions={[
          { value: "all", label: "All sources" },
          { value: "documents", label: "Documents only" },
        ]}
      />,
    );
    expect(screen.getByRole("combobox", { name: "Search scope" })).toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "Search sources" })).toBeInTheDocument();
  });

  it("has zero axe violations in its default state", async () => {
    // jest-axe's own async scan relies on real timers internally; under the
    // fake ones this file's `beforeEach` installs for the debounce tests, its
    // internal await never resolves and the test hangs until Vitest's own
    // timeout kills it — confirmed directly (it failed exactly this way
    // before this line was added, not assumed). Real timers for this test
    // only; `afterEach`'s `vi.useRealTimers()` still runs regardless.
    vi.useRealTimers();
    const { container } = render(<SearchField aria-label="Search sources" />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
