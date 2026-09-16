import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { axe } from "jest-axe";
import { SubTabBar, SubTabBarPanel } from "./sub-tab-bar";

// `use-url-synced-value.ts` calls these directly — mocked module-wide so
// SubTabBar can render outside a real Next.js router, and so the "writes to
// the URL" contract (design-system.md §5.4) is asserted against the actual
// call this component makes, not inferred.
const replace = vi.fn();
let currentSearch = "";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  usePathname: () => "/en/agents",
  useSearchParams: () => new URLSearchParams(currentSearch),
}));

const tabs = [
  { value: "overview", label: "Overview" },
  { value: "versions", label: "Versions", count: 3 },
  { value: "activity", label: "Activity" },
];

/**
 * Radix `Tabs.Trigger` activates on `mousedown` (and on `focus`, since this
 * component always sets `activationMode="automatic"`) — **not** `click`,
 * confirmed by reading `@radix-ui/react-tabs`'s compiled source directly
 * rather than assumed (its underlying button wires `onMouseDown`/`onFocus`
 * for selection and has no `onClick` handler at all). `fireEvent.click`
 * alone never dispatches a `mousedown`, so a real interaction test has to
 * fire the event this component's real dependency actually listens for.
 */
function selectTab(name: string | RegExp): void {
  fireEvent.mouseDown(screen.getByRole("tab", { name }), { button: 0 });
}

/** Real panels, so a trigger's `aria-controls` resolves to an actual element — required for the axe test below to be a meaningful assertion rather than one that trivially passes on an incomplete composition. */
function renderPanels() {
  return tabs.map((tab) => (
    <SubTabBarPanel key={tab.value} value={tab.value}>
      {tab.label} panel content
    </SubTabBarPanel>
  ));
}

beforeEach(() => {
  replace.mockClear();
  currentSearch = "";
});

afterEach(() => {
  document.documentElement.dir = "";
});

describe("SubTabBar", () => {
  it("renders a tablist with the given tabs and activates the first by default", () => {
    render(<SubTabBar tabs={tabs} aria-label="Agent sections" />);
    expect(screen.getByRole("tablist", { name: "Agent sections" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: /Versions/ })).toHaveAttribute("aria-selected", "false");
  });

  it("reads the initially active tab from the URL", () => {
    currentSearch = "tab=activity";
    render(<SubTabBar tabs={tabs} aria-label="Agent sections" />);
    expect(screen.getByRole("tab", { name: "Activity" })).toHaveAttribute("aria-selected", "true");
  });

  it("selecting a tab both activates it and writes the new value to the URL (router.replace, not push)", () => {
    render(<SubTabBar tabs={tabs} aria-label="Agent sections" />);
    selectTab(/Versions/);
    expect(screen.getByRole("tab", { name: /Versions/ })).toHaveAttribute("aria-selected", "true");
    expect(replace).toHaveBeenCalledWith("/en/agents?tab=versions", { scroll: false });
  });

  it("with-counts variant renders each tab's trailing count as a real Badge", () => {
    render(<SubTabBar tabs={tabs} variant="with-counts" aria-label="Agent sections" />);
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("a fully controlled value bypasses URL sync entirely", () => {
    const onValueChange = vi.fn();
    render(
      <SubTabBar
        tabs={tabs}
        aria-label="Agent sections"
        value="versions"
        onValueChange={onValueChange}
      />,
    );
    expect(screen.getByRole("tab", { name: /Versions/ })).toHaveAttribute("aria-selected", "true");
    selectTab("Overview");
    expect(onValueChange).toHaveBeenCalledWith("overview");
    expect(replace).not.toHaveBeenCalled();
  });

  it("urlParam=null disables URL sync and runs as a plain uncontrolled Tabs instance", () => {
    render(<SubTabBar tabs={tabs} aria-label="Agent sections" urlParam={null} />);
    selectTab(/Versions/);
    expect(screen.getByRole("tab", { name: /Versions/ })).toHaveAttribute("aria-selected", "true");
    expect(replace).not.toHaveBeenCalled();
  });

  describe("RTL arrow-key reversal — real focus target, not merely a class or prop (§5.4's claim, independently re-verified)", () => {
    it("ArrowRight moves focus to the next tab when the document is LTR", async () => {
      document.documentElement.dir = "ltr";
      render(<SubTabBar tabs={tabs} aria-label="Agent sections" />);
      const overview = screen.getByRole("tab", { name: "Overview" });
      overview.focus();
      fireEvent.keyDown(overview, { key: "ArrowRight" });
      await waitFor(() => expect(screen.getByRole("tab", { name: /Versions/ })).toHaveFocus());
    });

    it("ArrowRight moves focus to the PREVIOUS tab once the ambient <html dir> is rtl", async () => {
      document.documentElement.dir = "rtl";
      render(<SubTabBar tabs={tabs} aria-label="Agent sections" defaultValue="versions" />);
      const versions = await screen.findByRole("tab", { name: /Versions/ });
      versions.focus();
      fireEvent.keyDown(versions, { key: "ArrowRight" });
      await waitFor(() => expect(screen.getByRole("tab", { name: "Overview" })).toHaveFocus());
    });
  });

  it("has zero axe violations, tabs and panels together", async () => {
    const { container } = render(
      <SubTabBar tabs={tabs} aria-label="Agent sections">
        {renderPanels()}
      </SubTabBar>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
