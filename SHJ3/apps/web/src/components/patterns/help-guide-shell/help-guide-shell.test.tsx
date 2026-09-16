import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { axe } from "jest-axe";
import { HelpGuideShell } from "./help-guide-shell";
import type { HelpGuideShellNavGroup } from "./help-guide-shell-types";

const NAV_GROUPS: readonly HelpGuideShellNavGroup[] = [
  {
    label: "Admin / configurator",
    items: [
      { slug: "iam", href: "/en/help/iam", label: "Users, teams & roles" },
      { slug: "agents", href: "/en/help/agents", label: "Agents" },
    ],
  },
  {
    label: "Settings",
    items: [
      { slug: "settings/appearance", href: "/en/help/settings/appearance", label: "Appearance" },
    ],
  },
];

function renderShell(overrides?: Partial<React.ComponentProps<typeof HelpGuideShell>>) {
  return render(
    <HelpGuideShell
      navGroups={NAV_GROUPS}
      activeSlug="agents"
      guideTitle="User guide"
      breadcrumb={[{ label: "Help", href: "/en/help" }, { label: "Agents" }]}
      searchAriaLabel="Search the guide"
      noResultsLabel="No matching pages"
      query=""
      onQueryChange={() => {}}
      {...overrides}
    >
      <h1>Agents</h1>
      <p>Real content for the agents guide entry.</p>
    </HelpGuideShell>,
  );
}

describe("HelpGuideShell", () => {
  it("renders every group and item from navGroups, mirroring real navigation", () => {
    renderShell();
    expect(screen.getByRole("link", { name: "Users, teams & roles" })).toHaveAttribute(
      "href",
      "/en/help/iam",
    );
    expect(screen.getByRole("link", { name: "Appearance" })).toHaveAttribute(
      "href",
      "/en/help/settings/appearance",
    );
  });

  it("marks the active entry with aria-current, and no other entry", () => {
    renderShell();
    expect(screen.getByRole("link", { name: "Agents" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Users, teams & roles" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("renders the breadcrumb, with only the last crumb non-linked", () => {
    renderShell();
    expect(screen.getByRole("link", { name: "Help" })).toHaveAttribute("href", "/en/help");
    expect(screen.getByText("Agents", { selector: "span" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("renders the supplied content as children", () => {
    renderShell();
    expect(screen.getByRole("heading", { name: "Agents", level: 1 })).toBeInTheDocument();
    expect(screen.getByText("Real content for the agents guide entry.")).toBeInTheDocument();
  });

  it("fires onQueryChange as the search field is typed into, without owning filtered state itself", () => {
    const onQueryChange = vi.fn();
    renderShell({ onQueryChange, query: "" });
    const search = screen.getByRole("searchbox", { name: "Search the guide" });
    fireEvent.change(search, { target: { value: "iam" } });
    expect(onQueryChange).toHaveBeenCalledWith("iam");
  });

  it("shows the no-results label when every group is empty (a real, server-filtered zero-match state)", () => {
    renderShell({ navGroups: [{ label: "Admin", items: [] }] });
    expect(screen.getByText("No matching pages")).toBeInTheDocument();
  });

  it("has no obvious accessibility violations", async () => {
    const { container } = renderShell();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("sizes the nav aside from the real --sidebar-width token, never a raw numeric Tailwind width utility", () => {
    // Regression test for a real bug found live at a real 1440×900 viewport: `md:w-72`
    // silently generated no CSS at all in this design system (tailwind-theme.generated.css's
    // own `--spacing: initial` reset, ADR-0007, plus a curated `--spacing-*` bridge that
    // stops at 24 — 72 was never in it), so the aside rendered at the full row width instead
    // of a real sidebar width. jsdom does not run Tailwind, so this cannot assert the
    // rendered pixel width the way the live browser check did — it asserts the one thing a
    // unit test *can* prove: the className names a real design token
    // (`w-(--sidebar-width)`, the same one `AppShell`'s own sidebar sizes itself with via
    // `inlineSize`), not a bare numeric utility that this codebase's own token reset makes a
    // silent no-op.
    const { container } = renderShell();
    const aside = container.querySelector("aside");
    expect(aside?.className).toContain("w-(--sidebar-width)");
    expect(aside?.className).not.toMatch(/(?:^|\s)(?:md:)?w-\d+(?:\s|$)/);
  });
});
