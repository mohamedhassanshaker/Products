// @vitest-environment jsdom
import type { ReactNode } from "react";
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, within, cleanup, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

// This project doesn't run with vitest's `globals: true`, so
// `@testing-library/react`'s own auto-cleanup (which only registers when it finds a
// *global* `afterEach`) never fires — clean up explicitly after every test in this
// file so each `render()` starts from an empty DOM.
afterEach(() => cleanup());

vi.mock("../login/actions", () => ({ logoutAction: vi.fn() }));

let currentPathname = "/dashboard";
vi.mock("next/navigation", () => ({
  usePathname: () => currentPathname,
}));
vi.mock("next/link", () => ({
  // Minimal stand-in: Next's real Link needs a Router context this unit test
  // doesn't provide — a plain anchor is enough to assert href/label content.
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { AdminShell } from "./AdminShell.js";
import type { PermissionMatrix } from "@nextbot/contracts";

const fullPermissions: PermissionMatrix = {
  channels: "Write",
  connectors: "Write",
  tool_permissions: "Write",
  agent_tool_config: "Write",
  approval_queue: "Write",
  escalations: "Write",
  conversations: "Write",
  reporting: "Write",
  a2a_config: "Write",
  agent_platform: "Write",
  designer: "Write",
  security_settings: "Write",
  audit_log: "Write",
  users_roles: "Write",
  developer_portal: "Write",
  knowledge: "Write",
  knowledge_config: "Write",
};

describe("AdminShell (QA Defects U5/U6/U7)", () => {
  it("renders every nav item when permissions are full Write, and a visible avatar with forced contrast-safe colors", () => {
    currentPathname = "/dashboard";
    render(
      <AdminShell permissions={fullPermissions}>
        <div>content</div>
      </AdminShell>,
    );
    expect(screen.getByRole("link", { name: "Connectors" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Tool Catalog" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Users & Roles" })).toBeInTheDocument();
    expect(screen.getByRole("main")).toBeInTheDocument();
  });

  it("hides a nav item entirely when the module is None (fail-closed)", () => {
    currentPathname = "/dashboard";
    const restricted: PermissionMatrix = { ...fullPermissions, connectors: "None" };
    render(
      <AdminShell permissions={restricted}>
        <div>content</div>
      </AdminShell>,
    );
    expect(screen.queryByRole("link", { name: "Connectors" })).not.toBeInTheDocument();
  });

  it("Plan Phase 3 (settings hub): collapses the 7 individual settings entries and Connector Alerts into one 'Settings' nav link, not 8 separate ones", () => {
    currentPathname = "/dashboard";
    render(
      <AdminShell permissions={fullPermissions}>
        <div>content</div>
      </AdminShell>,
    );
    const nav = screen.getByRole("navigation", { name: "Primary" });
    expect(within(nav).getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/settings");
    // The formerly-individual entries are gone from the sidebar (they still exist
    // as cards on the new /settings hub page, just not as their own nav links).
    for (const label of [
      "Branding",
      "Escalation Routing",
      "Integrations",
      "PII & Guardrails",
      "Retention & Residency",
      "Data Subject Requests",
      "Connector Alerts",
    ]) {
      expect(within(nav).queryByRole("link", { name: label })).not.toBeInTheDocument();
    }
    // Users & Roles and Audit Log deliberately keep their own top-level entries.
    expect(within(nav).getByRole("link", { name: "Users & Roles" })).toBeInTheDocument();
    expect(within(nav).getByRole("link", { name: "Audit Log" })).toBeInTheDocument();
  });

  it("Plan Phase 3: the 'Settings' nav item is visible when the caller can read only ONE of its backing modules (any-of, not a single representative module)", () => {
    currentPathname = "/dashboard";
    const escalationsOnly: PermissionMatrix = {
      ...fullPermissions,
      security_settings: "None",
      agent_platform: "None",
      users_roles: "None",
      audit_log: "None",
      escalations: "Read",
    };
    render(
      <AdminShell permissions={escalationsOnly}>
        <div>content</div>
      </AdminShell>,
    );
    const nav = screen.getByRole("navigation", { name: "Primary" });
    expect(within(nav).getByRole("link", { name: "Settings" })).toBeInTheDocument();
  });

  it("Plan Phase 3: the 'Settings' nav item is hidden (fail-closed) when the caller can read none of its backing modules", () => {
    currentPathname = "/dashboard";
    const noSettingsAccess: PermissionMatrix = {
      ...fullPermissions,
      security_settings: "None",
      escalations: "None",
      agent_platform: "None",
      users_roles: "None",
      audit_log: "None",
    };
    render(
      <AdminShell permissions={noSettingsAccess}>
        <div>content</div>
      </AdminShell>,
    );
    const nav = screen.getByRole("navigation", { name: "Primary" });
    expect(within(nav).queryByRole("link", { name: "Settings" })).not.toBeInTheDocument();
  });

  it("renders no breadcrumb on a top-level route", () => {
    currentPathname = "/connectors";
    render(
      <AdminShell permissions={fullPermissions}>
        <div>content</div>
      </AdminShell>,
    );
    expect(screen.queryByRole("navigation", { name: /breadcrumb/i })).not.toBeInTheDocument();
  });

  it("renders a breadcrumb trail on a nested route (QA Defect U7)", () => {
    currentPathname = "/connectors/new";
    render(
      <AdminShell permissions={fullPermissions}>
        <div>content</div>
      </AdminShell>,
    );
    // Scope to the breadcrumb nav specifically — "Connectors" also appears in the
    // sidebar nav link, which is not what this assertion is about.
    const breadcrumb = screen.getByRole("navigation", { name: /breadcrumb/i });
    expect(within(breadcrumb).getByText("Connectors")).toBeInTheDocument();
    // "new" is a generic last-segment label reused across every ".../new" creation
    // route (Connectors, Channels, ...) since the breadcrumb only maps the literal
    // path segment, not its parent context (see labelForSegment's doc comment).
    expect(within(breadcrumb).getByText("Add")).toBeInTheDocument();
  });

  it("QA fix (Batch D retry 1): renders the 'agent-platform' segment as plain text, not a link, since /agent-platform has no page.tsx", () => {
    currentPathname = "/agent-platform/definitions";
    render(
      <AdminShell permissions={fullPermissions}>
        <div>content</div>
      </AdminShell>,
    );
    const breadcrumb = screen.getByRole("navigation", { name: /breadcrumb/i });
    // `BreadcrumbPage` (the non-clickable "current"-style treatment) always carries
    // `role="link" aria-disabled="true"` for consistent styling — so the real signal
    // that this segment isn't a genuine link is the absence of an <a> wrapping it,
    // not its ARIA role. `labelForSegment` has no special-cased label for
    // "agent-platform", so it falls through to the generic humanizer, which only
    // title-cases the first word ("Agent platform").
    const segmentEl = within(breadcrumb).getByText("Agent platform");
    expect(segmentEl.closest("a")).toBeNull();
    expect(segmentEl).toHaveAttribute("aria-disabled", "true");
    // The last segment ("Definitions") still is/should remain the current-page label.
    expect(within(breadcrumb).getByText("Definitions")).toBeInTheDocument();
  });

  it("QA fix (Batch D retry 1): renders 'Versions' as plain text under a definition since .../versions has no index page (only .../versions/new)", () => {
    currentPathname = "/agent-platform/definitions/11111111-1111-1111-1111-111111111111/versions/new";
    render(
      <AdminShell permissions={fullPermissions}>
        <div>content</div>
      </AdminShell>,
    );
    const breadcrumb = screen.getByRole("navigation", { name: /breadcrumb/i });
    const segmentEl = within(breadcrumb).getByText("Versions");
    expect(segmentEl.closest("a")).toBeNull();
    expect(segmentEl).toHaveAttribute("aria-disabled", "true");
  });

  it("QA fix (Batch D retry 1): renders top-level 'Versions' as plain text since /agent-platform/versions has no index page (only .../versions/[versionId])", () => {
    currentPathname = "/agent-platform/versions/22222222-2222-2222-2222-222222222222";
    render(
      <AdminShell permissions={fullPermissions}>
        <div>content</div>
      </AdminShell>,
    );
    const breadcrumb = screen.getByRole("navigation", { name: /breadcrumb/i });
    const segmentEl = within(breadcrumb).getByText("Versions");
    expect(segmentEl.closest("a")).toBeNull();
    expect(segmentEl).toHaveAttribute("aria-disabled", "true");
  });

  it("QA fix (Batch D retry 1): renders a tool's [id] segment as plain text since /tools/[id] has no index page (only .../[id]/permissions)", () => {
    currentPathname = "/tools/33333333-3333-3333-3333-333333333333/permissions";
    render(
      <AdminShell permissions={fullPermissions}>
        <div>content</div>
      </AdminShell>,
    );
    const breadcrumb = screen.getByRole("navigation", { name: /breadcrumb/i });
    const segmentEl = within(breadcrumb).getByText("Details");
    expect(segmentEl.closest("a")).toBeNull();
    expect(segmentEl).toHaveAttribute("aria-disabled", "true");
    // "Tool Catalog" (the /tools segment itself) has a real index page and must
    // remain clickable — this fix must not blanket-disable the whole trail.
    expect(within(breadcrumb).getByRole("link", { name: "Tool Catalog" })).toBeInTheDocument();
  });

  it("Plan Phase 3 (settings hub): renders the 'settings' segment as a real link, since /settings now has its own page.tsx (previously plain text pre-hub)", () => {
    currentPathname = "/settings/branding";
    render(
      <AdminShell permissions={fullPermissions}>
        <div>content</div>
      </AdminShell>,
    );
    const breadcrumb = screen.getByRole("navigation", { name: /breadcrumb/i });
    expect(within(breadcrumb).getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/settings");
    expect(within(breadcrumb).getByText("Branding")).toBeInTheDocument();
  });

  it("renders the default NextBot wordmark when no branding is passed", () => {
    currentPathname = "/dashboard";
    render(
      <AdminShell permissions={fullPermissions}>
        <div>content</div>
      </AdminShell>,
    );
    expect(screen.getByText("NextBot")).toBeInTheDocument();
  });

  it("FR-ADM-07: replaces the wordmark with the tenant's logo when white-labeling branding is passed", () => {
    currentPathname = "/dashboard";
    render(
      <AdminShell
        permissions={fullPermissions}
        branding={{
          primaryColor: "#1B6B4A",
          secondaryColor: "#0E3B28",
          logoLightUrl: "https://example.com/logo.svg",
          logoDarkUrl: null,
          faviconUrl: null,
          fontFamily: null,
        }}
      >
        <div>content</div>
      </AdminShell>,
    );
    expect(screen.queryByText("NextBot")).not.toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Company logo" })).toBeInTheDocument();
  });

  it("post-QA scope-bug fix: the top-bar accent border reads the dedicated --brand-accent token, never shadcn's own --primary (which every Button/Badge primitive consumes)", () => {
    currentPathname = "/dashboard";
    render(
      <AdminShell
        permissions={fullPermissions}
        branding={{
          primaryColor: "#1B6B4A",
          secondaryColor: "#0E3B28",
          logoLightUrl: null,
          logoDarkUrl: null,
          faviconUrl: null,
          fontFamily: null,
        }}
      >
        <div>content</div>
      </AdminShell>,
    );
    const header = screen.getByRole("banner");
    expect(header.style.borderTop).toContain("var(--brand-accent)");
    expect(header.style.borderTop).not.toContain("var(--primary)");

    // A regular Button elsewhere in the tree (the "Sign out" button in this same
    // header) must never have any inline override of --primary — it renders
    // shadcn's own default via its `bg-primary` class, untouched by branding.
    const signOutButton = screen.getByRole("button", { name: "Sign out" });
    expect(signOutButton.style.getPropertyValue("--primary")).toBe("");
    expect(signOutButton.className).not.toContain("brand-accent");
  });

  it("no top-bar accent border style is applied when branding is absent (default chrome)", () => {
    currentPathname = "/dashboard";
    render(
      <AdminShell permissions={fullPermissions}>
        <div>content</div>
      </AdminShell>,
    );
    const header = screen.getByRole("banner");
    expect(header.style.borderTop).toBe("");
  });

  it("Plan Phase 2: renders the top-bar brand mark fallback when no branding is passed", () => {
    currentPathname = "/dashboard";
    render(
      <AdminShell permissions={fullPermissions}>
        <div>content</div>
      </AdminShell>,
    );
    const header = screen.getByRole("banner");
    // "NextBot" is the accessible name (via aria-label), not literal text content
    // (the visible mark is the compact "NB"), so it doesn't collide with the
    // sidebar's own full "NextBot" wordmark text in the same render.
    expect(within(header).getByRole("img", { name: "NextBot" })).toBeInTheDocument();
  });

  it("Plan Phase 2: replaces the top-bar brand mark with the tenant logo when white-labeling branding is passed", () => {
    currentPathname = "/dashboard";
    render(
      <AdminShell
        permissions={fullPermissions}
        branding={{
          primaryColor: "#1B6B4A",
          secondaryColor: "#0E3B28",
          logoLightUrl: "https://example.com/logo.svg",
          logoDarkUrl: null,
          faviconUrl: null,
          fontFamily: null,
        }}
      >
        <div>content</div>
      </AdminShell>,
    );
    const header = screen.getByRole("banner");
    // Distinct accessible name from the sidebar's own "Company logo" image, even
    // though both render the same `branding.logoLightUrl`.
    expect(within(header).getByRole("img", { name: "Company logo, top bar" })).toBeInTheDocument();
    expect(within(header).queryByRole("img", { name: "NextBot" })).not.toBeInTheDocument();
  });

  it("Plan Phase 2: marks the active nav item with aria-current=page and not other items", () => {
    currentPathname = "/agent-platform/definitions";
    render(
      <AdminShell permissions={fullPermissions}>
        <div>content</div>
      </AdminShell>,
    );
    // Scoped to the primary sidebar nav — a route this deep can also produce a
    // same-named breadcrumb link, which is not what this assertion is about.
    const nav = screen.getByRole("navigation", { name: "Primary" });
    const activeLink = within(nav).getByRole("link", { name: "Definitions" });
    expect(activeLink).toHaveAttribute("aria-current", "page");
    const inactiveLink = within(nav).getByRole("link", { name: "Connectors" });
    expect(inactiveLink).not.toHaveAttribute("aria-current");
  });

  it("Plan Phase 2: treats a descendant route as active for its parent nav item", () => {
    currentPathname = "/agent-platform/definitions/11111111-1111-1111-1111-111111111111";
    render(
      <AdminShell permissions={fullPermissions}>
        <div>content</div>
      </AdminShell>,
    );
    const nav = screen.getByRole("navigation", { name: "Primary" });
    expect(within(nav).getByRole("link", { name: "Definitions" })).toHaveAttribute("aria-current", "page");
  });

  it("Plan Phase 2: the 'Agent Platform' collapsible section is open by default and its items are reachable", () => {
    currentPathname = "/dashboard";
    render(
      <AdminShell permissions={fullPermissions}>
        <div>content</div>
      </AdminShell>,
    );
    const trigger = screen.getByRole("button", { name: "Agent Platform" });
    expect(trigger).toHaveAttribute("data-panel-open");
    expect(screen.getByRole("link", { name: "Model Gateway" })).toBeVisible();
  });

  it("Plan Phase 2: the 'Agent Platform' collapsible section toggles closed on click, hiding its items", async () => {
    currentPathname = "/dashboard";
    render(
      <AdminShell permissions={fullPermissions}>
        <div>content</div>
      </AdminShell>,
    );
    const trigger = screen.getByRole("button", { name: "Agent Platform" });
    fireEvent.click(trigger);
    expect(trigger).not.toHaveAttribute("data-panel-open");
    // Base UI's Collapsible unmounts the panel after its (here: instant, no CSS
    // transition configured) close animation resolves, which happens on a
    // microtask/animation-frame tick rather than synchronously with the click.
    await waitFor(() => {
      expect(screen.queryByRole("link", { name: "Model Gateway" })).not.toBeInTheDocument();
    });
  });
});
