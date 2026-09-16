import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { axe } from "jest-axe";
import { AppShell, type AppShellNavItem } from "./app-shell";

/**
 * Same jsdom gap `dropdown-menu.test.tsx` already documents and stubs for
 * this exact primitive (the locale switch is a real `DropdownMenu`): Radix's
 * Popper-based positioning calls a handful of browser APIs jsdom does not
 * implement. Scoped to this file rather than the shared vitest.setup.ts,
 * matching that file's own per-file scoping rationale.
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
});

/**
 * Radix's `DropdownMenuTrigger` opens on `pointerdown`, not `click` —
 * `dropdown-menu.test.tsx`'s identical helper and doc comment explain why a
 * bare `fireEvent.click` silently never opens it.
 */
function openLocaleMenu() {
  fireEvent.pointerDown(screen.getByRole("button", { name: "Change language" }));
}

const navItems: AppShellNavItem[] = [
  { href: "/assistant/widget", label: "Widget preview", group: "assistant" },
  { href: "/assistant/config", label: "Assistant config", group: "assistant" },
  { href: "/admin/agents", label: "Agents", group: "admin" },
  { href: "/admin/users", label: "Users, teams & roles", group: "admin" },
];

const locales = [
  { value: "en", label: "EN" },
  { value: "ar", label: "AR" },
];

function renderShell(overrides: Partial<React.ComponentProps<typeof AppShell>> = {}) {
  const onLocaleChange = vi.fn();
  const onThemeModeChange = vi.fn();
  const onHelpClick = vi.fn();

  const utils = render(
    <AppShell
      navItems={navItems}
      activeHref="/admin/agents"
      breadcrumb={[{ label: "Admin", href: "/admin" }, { label: "Agents" }]}
      locales={locales}
      activeLocale="en"
      onLocaleChange={onLocaleChange}
      themeMode="system"
      onThemeModeChange={onThemeModeChange}
      help={{ onClick: onHelpClick, label: "Help" }}
      {...overrides}
    >
      <h1>Agents</h1>
      <p>Page content</p>
    </AppShell>,
  );

  return { ...utils, onLocaleChange, onThemeModeChange, onHelpClick };
}

afterEach(() => {
  document.documentElement.dir = "";
});

describe("AppShell", () => {
  it("renders both sidebar landmarks with their own accessible names", () => {
    renderShell();
    expect(screen.getByRole("navigation", { name: "Assistant window" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Admin / configurator" })).toBeInTheDocument();
  });

  it("renders no logo at all when the `logo` prop is omitted (no tenant upload)", () => {
    renderShell();
    expect(screen.queryByAltText("SHJ3 Assistant")).not.toBeInTheDocument();
  });

  it("renders both the light and dark logo images, both real, with real alt text", () => {
    renderShell({
      logo: {
        lightSrc: "/uploads/brand-assets/sewa/light.png",
        darkSrc: "/uploads/brand-assets/sewa/dark.png",
        alt: "SEWA Assistant",
      },
    });
    const images = screen.getAllByAltText("SEWA Assistant");
    expect(images).toHaveLength(2);
    expect(images[0]).toHaveAttribute("src", "/uploads/brand-assets/sewa/light.png");
    expect(images[0]).toHaveAttribute("data-slot", "app-shell-logo-light");
    expect(images[1]).toHaveAttribute("src", "/uploads/brand-assets/sewa/dark.png");
    expect(images[1]).toHaveAttribute("data-slot", "app-shell-logo-dark");
  });

  it("marks the active nav item with aria-current=page and no other item", () => {
    renderShell();
    expect(screen.getByRole("link", { name: "Agents" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Users, teams & roles" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("groups nav items under the correct landmark", () => {
    renderShell();
    const assistantNav = screen.getByRole("navigation", { name: "Assistant window" });
    expect(within(assistantNav).getByRole("link", { name: "Widget preview" })).toBeInTheDocument();
    expect(within(assistantNav).queryByRole("link", { name: "Agents" })).not.toBeInTheDocument();
  });

  it("renders the skip link as the very first focusable element, targeting <main>", () => {
    renderShell();
    const skipLink = screen.getByRole("link", { name: "Skip to main content" });
    expect(skipLink).toHaveAttribute("href", "#main-content");
    const main = document.getElementById("main-content");
    expect(main?.tagName).toBe("MAIN");
    expect(main).toHaveAttribute("tabindex", "-1");

    // "First focusable" — no earlier focusable element precedes it in the DOM.
    const focusable = document.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    expect(focusable[0]).toBe(skipLink);
  });

  it("renders the breadcrumb with the current page as text, not a link", () => {
    renderShell();
    const nav = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(within(nav).getByRole("link", { name: "Admin" })).toBeInTheDocument();
    const current = within(nav).getByText("Agents");
    expect(current.tagName).not.toBe("A");
    expect(current).toHaveAttribute("aria-current", "page");
  });

  it("switching locale calls onLocaleChange with the selected value", async () => {
    const { onLocaleChange } = renderShell();
    openLocaleMenu();
    fireEvent.click(await screen.findByRole("menuitem", { name: "AR" }));
    expect(onLocaleChange).toHaveBeenCalledWith("ar");
  });

  it("the active locale is marked aria-current inside the menu", async () => {
    renderShell();
    openLocaleMenu();
    expect(await screen.findByRole("menuitem", { name: "EN" })).toHaveAttribute(
      "aria-current",
      "true",
    );
    expect(screen.getByRole("menuitem", { name: "AR" })).not.toHaveAttribute("aria-current");
  });

  it("switching theme mode calls onThemeModeChange with the selected mode", () => {
    const { onThemeModeChange } = renderShell();
    fireEvent.click(screen.getByRole("radio", { name: "Dark" }));
    expect(onThemeModeChange).toHaveBeenCalledWith("dark");
  });

  it("clicking the Help affordance calls onClick when configured as a button", () => {
    const { onHelpClick } = renderShell();
    fireEvent.click(screen.getByRole("button", { name: "Help" }));
    expect(onHelpClick).toHaveBeenCalledTimes(1);
  });

  it("renders the Help affordance as a real link when given href instead of onClick", () => {
    renderShell({ help: { href: "/help", label: "Help" } });
    const helpLink = screen.getByRole("link", { name: "Help" });
    expect(helpLink).toHaveAttribute("href", "/help");
  });

  it("renders no user menu at all when `user` is omitted (no signed-in principal to show)", () => {
    renderShell();
    expect(screen.queryByRole("button", { name: "Account menu" })).not.toBeInTheDocument();
  });

  it("shows the signed-in principal's display name and calls onSignOut from the menu", () => {
    const onSignOut = vi.fn();
    renderShell({ user: { displayName: "Ahmed Saeed" }, onSignOut });

    expect(screen.getByText("Ahmed Saeed")).toBeInTheDocument();

    fireEvent.pointerDown(screen.getByRole("button", { name: "Account menu" }));
    fireEvent.click(screen.getByText("Sign out"));
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });

  it("the desktop collapse toggle switches to the collapsed width and back", () => {
    renderShell();
    const toggle = screen.getByRole("button", { name: "Collapse sidebar" });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: "Expand sidebar" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("omitting collapsible removes the collapse toggle entirely", () => {
    renderShell({ collapsible: false });
    expect(screen.queryByRole("button", { name: "Collapse sidebar" })).not.toBeInTheDocument();
  });

  it("data-sidebar-style reflects the sidebarStyle prop", () => {
    const { container } = renderShell({ sidebarStyle: "brand" });
    expect(container.querySelector('[data-slot="app-shell"]')).toHaveAttribute(
      "data-sidebar-style",
      "brand",
    );
  });

  it("uses a caller-supplied renderLink instead of a plain <a> when provided", () => {
    const renderLink: React.ComponentProps<typeof AppShell>["renderLink"] = ({
      href,
      children,
      ...rest
    }) => (
      <a href={href} data-custom-router="true" {...rest}>
        {children}
      </a>
    );
    renderShell({ renderLink });
    expect(screen.getByRole("link", { name: "Agents" })).toHaveAttribute(
      "data-custom-router",
      "true",
    );
  });

  it("renders arbitrary page content in <main>", () => {
    renderShell();
    expect(screen.getByRole("heading", { level: 1, name: "Agents" })).toBeInTheDocument();
    expect(screen.getByText("Page content")).toBeInTheDocument();
  });

  it("has zero axe violations in its default state", async () => {
    const { container } = renderShell();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("has zero axe violations with the locale menu open", async () => {
    renderShell();
    openLocaleMenu();
    await screen.findByRole("menuitem", { name: "AR" });
    // Radix portals the menu content to `document.body`, outside the
    // render `container` — scanning the whole body, with the page-level
    // "region" rule disabled, matches `dropdown-menu.test.tsx`'s identical,
    // already-justified exclusion for this exact isolated-component shape.
    expect(
      await axe(document.body, { rules: { region: { enabled: false } } }),
    ).toHaveNoViolations();
  });
});
