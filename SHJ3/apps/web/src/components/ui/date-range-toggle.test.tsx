import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { axe } from "jest-axe";
import { DateRangeToggle } from "./date-range-toggle";

const replace = vi.fn();
let currentSearch = "";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  usePathname: () => "/en/dashboard",
  useSearchParams: () => new URLSearchParams(currentSearch),
}));

const options = [
  { value: "today", label: "Today" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
];

beforeEach(() => {
  replace.mockClear();
  currentSearch = "";
});

afterEach(() => {
  document.documentElement.dir = "";
});

describe("DateRangeToggle", () => {
  it("is built on ToggleRow — a real radiogroup with the first option active by default", () => {
    render(<DateRangeToggle options={options} aria-label="Date range" />);
    expect(screen.getByRole("radiogroup", { name: "Date range" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Today" })).toHaveAttribute("aria-checked", "true");
  });

  it("reads the initial range from the URL (?range=)", () => {
    currentSearch = "range=7d";
    render(<DateRangeToggle options={options} aria-label="Date range" />);
    expect(screen.getByRole("radio", { name: "Last 7 days" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("selecting a range writes it to the URL under the `range` key (router.replace, not push)", () => {
    render(<DateRangeToggle options={options} aria-label="Date range" />);
    fireEvent.click(screen.getByRole("radio", { name: "Last 30 days" }));
    expect(screen.getByRole("radio", { name: "Last 30 days" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(replace).toHaveBeenCalledWith("/en/dashboard?range=30d", { scroll: false });
  });

  it("a custom urlParam uses that query key instead of the default 'range'", () => {
    render(<DateRangeToggle options={options} aria-label="Date range" urlParam="window" />);
    fireEvent.click(screen.getByRole("radio", { name: "Last 7 days" }));
    expect(replace).toHaveBeenCalledWith("/en/dashboard?window=7d", { scroll: false });
  });

  it("renders the caller-supplied announcement in a polite live region, without computing its own count", () => {
    render(
      <DateRangeToggle
        options={options}
        aria-label="Date range"
        announcement="Showing last 7 days, 8,940 conversations"
      />,
    );
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveTextContent("Showing last 7 days, 8,940 conversations");
  });

  it("loading marks the underlying ToggleRow aria-busy", () => {
    render(<DateRangeToggle options={options} aria-label="Date range" loading />);
    expect(screen.getByRole("radiogroup")).toHaveAttribute("aria-busy", "true");
  });

  it("has zero axe violations in its default state", async () => {
    const { container } = render(<DateRangeToggle options={options} aria-label="Date range" />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
