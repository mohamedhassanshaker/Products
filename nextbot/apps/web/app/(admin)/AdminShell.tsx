"use client";

import { Fragment, type ReactNode } from "react";
import NextLink from "next/link";
import { usePathname } from "next/navigation";
import { isAnyNavItemVisible, isNavItemVisible, type NavRule } from "@nextbot/ui";
import { Button } from "@nextbot/ui/components/ui/button";
import { Badge } from "@nextbot/ui/components/ui/badge";
import { Avatar, AvatarFallback } from "@nextbot/ui/components/ui/avatar";
import { Sidebar, SidebarNav, SidebarItem, SidebarSection } from "@nextbot/ui/components/ui/sidebar";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@nextbot/ui/components/ui/breadcrumb";
import type { PermissionMatrix, TenantBranding } from "@nextbot/contracts";
import { logoutAction } from "../login/actions";

/**
 * Screen inventory B.1.1 nav sections, gated per `docs/design/UX_GUIDELINES.md` §2:
 * an item is hidden entirely when the caller's effective matrix is `None` for its
 * module (fail-closed default), not merely disabled.
 */
const NAV_ITEMS: Array<{ href: string; label: string; section?: string } & (NavRule | { anyOf: NavRule[] })> = [
  { href: "/dashboard", label: "Dashboard", module: "reporting", required: "Read" },
  { href: "/conversations", label: "Conversations", module: "conversations", required: "Read" },
  { href: "/approvals", label: "Approval Queue", module: "approval_queue", required: "Read" },
  { href: "/escalations", label: "Escalation Queue", module: "escalations", required: "Read" },
  { href: "/channels", label: "Channels", module: "channels", required: "Read" },
  { href: "/connectors", label: "Connectors", module: "connectors", required: "Read" },
  // Phase 3 (BL-34, LLD §14.3) — the MCP Definition Registry (9-step enrolment
  // wizard). Same `connectors` RBAC module as the item above (Phase 0's own
  // established precedent — see `mcp-registry/http/admin-routes.ts`'s doc comment).
  { href: "/mcp/servers", label: "MCP Servers", module: "connectors", required: "Read" },
  { href: "/tools", label: "Tool Catalog", module: "tool_permissions", required: "Read" },
  // Phase 6 (BL-28, FR-MCP-17) — capability-group management screen. Same visibility
  // module as Tool Catalog (read-only viewing needs only `tool_permissions=Read`;
  // create/edit/delete controls are gated per-control on `agent_tool_config=Write`,
  // matching Tool Catalog's own read/mutate split).
  { href: "/tools/capability-groups", label: "Capability Groups", module: "tool_permissions", required: "Read" },
  { href: "/mcp-health", label: "MCP Health", module: "connectors", required: "Read" },
  // Target Architecture Blueprint Phase 7b (BL-38, ADR-0018, LLD §14.4) —
  // Knowledge Collections (collections/sources CRUD, ingestion pipeline status).
  // Gated on the new `knowledge` module (blueprint §5.2), distinct from the
  // narrower `knowledge_config` module that gates embedding/chunking/extraction
  // policy fields within the collection detail screen itself.
  { href: "/knowledge", label: "Knowledge", module: "knowledge", required: "Read" },
  // Phase 11 (BL-07) — Agent Platform Architecture Console (UX_GUIDELINES.md §6.1):
  // nested under a visual "Agent Platform" section label. §6.0/§6.1 deliberately omit
  // a "Deployments" sub-item this phase (BL-13 ships it) — these are the four real
  // sub-items: Definitions, Evals, Model Gateway, Runtime Traces.
  //
  // Plan Phase 2 (client-feedback-batch, sidebar rebuild): every item in this group
  // now carries `section: "Agent Platform"` (previously only the first did, back when
  // `section` merely inserted a visual label above the following flat items). The
  // new `SidebarSection` primitive is a genuine collapsible group, so
  // `groupNavItems()` below needs every member tagged to know where the group ends —
  // a local, reversible data-shape change, not a behavior change to the nav's
  // permission gating.
  { href: "/agent-platform/definitions", label: "Definitions", module: "agent_platform", required: "Read", section: "Agent Platform" },
  // Target Architecture Blueprint Phase 12 (BL-43, FR-AGT-15) — the Blueprints
  // Gallery, tenant-local starter templates only (same "Agent Platform" section
  // run, same `agent_platform` module gate as every other item in this group).
  { href: "/agent-platform/blueprints", label: "Blueprints", module: "agent_platform", required: "Read", section: "Agent Platform" },
  { href: "/agent-platform/evals", label: "Evals", module: "agent_platform", required: "Read", section: "Agent Platform" },
  { href: "/agent-platform/model-gateway", label: "Model Gateway", module: "agent_platform", required: "Read", section: "Agent Platform" },
  // Target Architecture Blueprint Phase 1 (BL-32, ADR-0011, LLD §14.8) — the new
  // Provider Registry + Model Catalog console (`@nextbot/model-gateway`), kept as its
  // own nav entry alongside the pre-existing v1 "Model Gateway" (Routes/Provider
  // Registry tabs) screen above rather than replacing it — that screen keeps working
  // unchanged (this phase's explicit regression requirement); Phase 2 (Route v2) is
  // what eventually folds the two together.
  { href: "/model-gateway", label: "Provider Registry & Catalog", module: "agent_platform", required: "Read", section: "Agent Platform" },
  { href: "/agent-platform/traces", label: "Runtime Traces", module: "agent_platform", required: "Read", section: "Agent Platform" },
  // Target Architecture Blueprint Phase 5 (BL-35, ADR-0015, LLD §14.5) — Skills
  // Library. Gated on `agent_platform` (spec §5.2's "Changed — now also gates
  // skills"), not a new RBAC module — kept in the same consecutive "Agent
  // Platform" section run so `groupNavItems()`'s single-representative-module
  // grouping still holds.
  { href: "/skills", label: "Skills Library", module: "agent_platform", required: "Read", section: "Agent Platform" },
  // Target Architecture Blueprint Phase 14 (BL-46, LLD §14.7.5) — Teams. Placed
  // INSIDE the contiguous "Agent Platform" run (see the note above): `groupNavItems()`
  // starts a new group the moment a `section` run is interrupted, so this must stay
  // adjacent to its siblings. `agent_platform` is the right RBAC module (teams are
  // part of the Agent Platform surface, the same precedent Skills Library set) — not
  // a new one.
  { href: "/teams", label: "Teams", module: "agent_platform", required: "Read", section: "Agent Platform" },
  // Target Architecture Blueprint Phase 15 (BL-47a, LLD §14.6.4) — Workflow
  // Designer (authoring half). Placed INSIDE the contiguous "Agent Platform" run
  // for the same `groupNavItems()` reason `Teams`'s own comment above documents.
  // `agent_platform` is the right RBAC module — workflows are part of the Agent
  // Platform surface, the same precedent Skills Library/Teams already set.
  { href: "/workflows", label: "Workflows", module: "agent_platform", required: "Read", section: "Agent Platform" },
  { href: "/roles", label: "Users & Roles", module: "users_roles", required: "Read" },
  { href: "/audit-log", label: "Audit Log", module: "audit_log", required: "Read" },
  // Plan Phase 3 (client-feedback-batch item 11): the 7 individual settings
  // entries (Branding, Escalation Routing, Integrations, PII & Guardrails,
  // Retention & Residency, Data Subject Requests) plus the standalone Connector
  // Alerts entry (folded into MCP Health as a tab — see mcp-health/page.tsx)
  // collapse into one hub link. `/settings/connector-alerts` itself still
  // resolves (redirects to `/mcp-health?tab=alerts`) so no bookmarked/old link
  // 404s, it's just no longer a nav entry of its own.
  //
  // Visibility uses `isAnyNavItemVisible`, not a single representative module:
  // the hub's cards are individually gated on `security_settings` (Branding,
  // PII & Guardrails, Retention & Residency, Data Subject Requests),
  // `escalations` (Escalation Routing), `agent_platform` (Integrations),
  // `users_roles`, and `audit_log` (the latter two also keep their own
  // top-level nav entries above — see the plan doc's explicit decision). Using
  // a single module here (e.g. always `security_settings`) would hide the
  // entry from a caller who can only read `escalations`, even though they'd
  // land on a hub with a real, usable card; picking "always visible" would do
  // the opposite and show an entry with zero usable cards to a caller who can
  // read none of them. "Any of" is the only option that matches every
  // destination's own fail-closed gate.
  {
    href: "/settings",
    label: "Settings",
    anyOf: [
      { module: "security_settings", required: "Read" },
      { module: "escalations", required: "Read" },
      { module: "agent_platform", required: "Read" },
      { module: "users_roles", required: "Read" },
      { module: "audit_log", required: "Read" },
    ],
  },
];

type NavItem = (typeof NAV_ITEMS)[number];

/** One flat nav link, or a named collapsible run of consecutive nav links sharing
 * the same `section` value — the shape `SidebarNav` renders from. */
type NavEntry = { type: "item"; item: NavItem } | { type: "section"; label: string; items: NavItem[] };

/**
 * Partitions the (already permission-filtered) nav items into flat links and
 * named groups for `SidebarSection`. Items are only ever grouped when they're
 * *consecutive* and share the same `section` value — this only needs to handle
 * that shape today (a single contiguous "Agent Platform" run, since every item in
 * that run requires the same `agent_platform` module permission and therefore
 * survives/fails `isNavItemVisible` filtering together), but degrades safely to
 * "start a new group" if a future item interrupts a run with a different section.
 */
function groupNavItems(items: NavItem[]): NavEntry[] {
  const entries: NavEntry[] = [];
  for (const item of items) {
    if (item.section) {
      const last = entries[entries.length - 1];
      if (last && last.type === "section" && last.label === item.section) {
        last.items.push(item);
      } else {
        entries.push({ type: "section", label: item.section, items: [item] });
      }
    } else {
      entries.push({ type: "item", item });
    }
  }
  return entries;
}

/** An item is "active" when the current route is exactly its `href`, or a
 * descendant route of it (`href + "/..."`) — e.g. `/agent-platform/definitions/<id>`
 * keeps the "Definitions" nav item highlighted. */
function isNavItemActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** QA Defect U7: humanizes a route segment when no more specific label is known
 * (e.g. a dynamic `[id]` segment) — best-effort only, this is a minimal breadcrumb,
 * not a data-fetching one (a truly friendly "Zendesk Support" label for a connector
 * id would need an extra fetch this component deliberately doesn't do). */
const SEGMENT_LABELS: Record<string, string> = {
  dashboard: "Dashboard",
  conversations: "Conversations",
  channels: "Channels",
  connectors: "Connectors",
  new: "Add",
  mcp: "MCP",
  servers: "Servers",
  drift: "Drift Review",
  tools: "Tool Catalog",
  "capability-groups": "Capability Groups",
  roles: "Users & Roles",
  settings: "Settings",
  branding: "Branding",
  "model-gateway": "Provider Registry & Catalog",
};
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function labelForSegment(segment: string): string {
  if (SEGMENT_LABELS[segment]) return SEGMENT_LABELS[segment];
  if (UUID_RE.test(segment)) return "Details";
  return segment.charAt(0).toUpperCase() + segment.slice(1).replace(/-/g, " ");
}

/** QA Defect (Batch D retry 1): the generic breadcrumb below builds every
 * intermediate path segment as a clickable link, but Batch D introduced routes
 * whose intermediate segments have no `page.tsx` of their own (only a deeper child
 * route exists) — clicking those segments produced a genuine Next.js 404.
 *
 * This is a small, bounded set of known gaps rather than something worth a runtime
 * route-tree lookup (Next.js doesn't expose one cheaply from a client component
 * anyway): each entry is a route "shape" — literal segments plus `"*"` standing in
 * for any dynamic segment (`[id]`, `[versionId]`, …) — matched against the
 * breadcrumb's intermediate path up to and including that segment. A match means
 * "render this segment as plain text, not a link."
 *
 * Update this list if a future batch adds another intermediate segment without an
 * index page, rather than letting the breadcrumb silently link to a 404 again.
 */
const NO_PAGE_SEGMENT_SHAPES: string[][] = [
  ["agent-platform"],
  ["agent-platform", "definitions", "*", "versions"],
  ["agent-platform", "versions"],
  ["tools", "*"],
  // Phase 3 (BL-34) — `/mcp` itself has no index page (only `/mcp/servers/**` and
  // the `/mcp/capability-groups` redirect do), and `/mcp/servers/*` (a server id)
  // has no page of its own separate from `/mcp/servers/[id]` itself... it does have
  // one, so only the bare `mcp` segment needs this treatment.
  ["mcp"],
];

/** True when `segments.slice(0, upToIndex + 1)` matches one of the known
 * `NO_PAGE_SEGMENT_SHAPES` (dynamic segments matched positionally via `"*"`). */
function isNoPageSegment(segments: string[], upToIndex: number): boolean {
  const prefix = segments.slice(0, upToIndex + 1);
  return NO_PAGE_SEGMENT_SHAPES.some((shape) => {
    if (shape.length !== prefix.length) return false;
    return shape.every((part, i) => part === "*" || part === prefix[i]);
  });
}

/** QA Defect U7 (`docs/design/UX_GUIDELINES.md` §2.5): "a context trail directly
 * below the top bar on every screen below the top level." Top-level screens (a
 * single path segment, e.g. `/connectors`) render no breadcrumb — they *are* the
 * top level. */
function AdminBreadcrumb() {
  const pathname = usePathname();
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length <= 1) return null;

  return (
    <Breadcrumb className="border-b bg-muted/40 px-6 py-2 text-sm">
      <BreadcrumbList>
        {segments.map((segment, index) => {
          const href = `/${segments.slice(0, index + 1).join("/")}`;
          const isLast = index === segments.length - 1;
          // QA fix (Batch D retry 1): an intermediate segment with no page of its
          // own must render as plain (non-clickable) text — linking it produces a
          // real 404, not just a dead end.
          const hasNoPage = !isLast && isNoPageSegment(segments, index);
          return (
            // `BreadcrumbSeparator` renders its own `<li>` — it must be a sibling
            // of `BreadcrumbItem` inside `BreadcrumbList`, never nested inside one
            // (nesting `<li>` inside `<li>` is invalid HTML and triggers a real
            // hydration mismatch, caught by this component's own unit test).
            <Fragment key={href}>
              <BreadcrumbItem>
                {isLast || hasNoPage ? (
                  <BreadcrumbPage className="font-medium">{labelForSegment(segment)}</BreadcrumbPage>
                ) : (
                  <BreadcrumbLink render={<NextLink href={href}>{labelForSegment(segment)}</NextLink>} />
                )}
              </BreadcrumbItem>
              {!isLast && <BreadcrumbSeparator />}
            </Fragment>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}

/**
 * FR-ADM-07: when the tenant has white-labeling enabled, `branding` carries its
 * brand profile and the shell's default NextBot chrome (sidebar wordmark, top-bar
 * accent) is replaced with it — `null` (the common case: white-labeling off, or no
 * profile configured yet) renders the unchanged default chrome.
 *
 * The sidebar background and the top-bar accent both read from CSS custom
 * properties (`--brand-sidebar`, `--brand-accent`) rather than `branding`'s raw
 * hex values directly — those two properties are set once, server-side, by
 * `(admin)/layout.tsx`'s `<style>` tag (`build-brand-style-tag.ts`), which is the
 * *only* place tenant hex values are ever interpolated into CSS (Plan Phase 1's
 * token contract). `globals.css` supplies defaults for both tokens for the
 * unbranded case, so this component never needs an `if (branding) ... else ...`
 * branch for either color.
 *
 * Post-QA scope-bug fix: the top-bar accent border deliberately reads the
 * dedicated `--brand-accent` token, never shadcn's own `--primary` — `--primary`
 * is the design system's own default-Button/link/accent token, consumed by every
 * shared `Button`/`Badge`/etc. primitive in `packages/ui`, so overriding it
 * globally recolored every button across the whole Admin Console whenever
 * white-labeling was on. FR-ADM-07 scopes tenant branding to "the top bar and
 * login screen" only.
 */
export function AdminShell({
  permissions,
  branding,
  children,
}: {
  permissions: PermissionMatrix;
  branding?: TenantBranding | null;
  children: ReactNode;
}) {
  const visibleItems = NAV_ITEMS.filter((item) =>
    "anyOf" in item ? isAnyNavItemVisible(permissions, item.anyOf) : isNavItemVisible(permissions, item),
  );
  const navEntries = groupNavItems(visibleItems);
  const pathname = usePathname();

  return (
    <div className="flex min-h-screen">
      <Sidebar aria-label="Primary" className="w-60 bg-[var(--brand-sidebar)] py-6 ps-4 pe-4 text-white">
        {branding?.logoLightUrl ? (
          // A plain <img>, not shadcn's Avatar/AvatarImage: Base UI's AvatarImage
          // (like Radix's) only renders once it has independently observed the
          // image successfully load, which never resolves for data: URLs decoded
          // synchronously in a test/jsdom environment (no real network round trip
          // to observe) — the tenant's logo must render immediately and
          // unconditionally here, matching this component's pre-migration Chakra
          // behavior, not gated behind a loading-state machine.
          <img src={branding.logoLightUrl} alt="Company logo" className="mb-8 ms-2 size-8 rounded-full object-cover" />
        ) : (
          <span className="mb-8 ps-2 text-lg font-bold">NextBot</span>
        )}
        <SidebarNav>
          {navEntries.map((entry) =>
            entry.type === "item" ? (
              <SidebarItem
                key={entry.item.href}
                active={isNavItemActive(pathname, entry.item.href)}
                render={<NextLink href={entry.item.href}>{entry.item.label}</NextLink>}
              />
            ) : (
              // Plan Phase 2: the "Agent Platform" group is now a real collapsible
              // (previously just a static label above flat items) — open by default,
              // its disclosure state persisted per browser via `localStorage` so a
              // user who deliberately collapses it doesn't have it re-expand on every
              // navigation/reload.
              <SidebarSection
                key={entry.label}
                label={entry.label}
                defaultOpen
                storageKey={`nextbot-admin-sidebar-section-${entry.label}`}
              >
                {entry.items.map((item) => (
                  <SidebarItem
                    key={item.href}
                    active={isNavItemActive(pathname, item.href)}
                    render={<NextLink href={item.href}>{item.label}</NextLink>}
                  />
                ))}
              </SidebarSection>
            )
          )}
        </SidebarNav>
      </Sidebar>
      <div className="flex-1">
        <header
          className="flex h-16 items-center justify-between border-b bg-card px-6"
          style={branding ? { borderTop: "3px solid var(--brand-accent)" } : undefined}
        >
          <div className="flex items-center gap-3">
            {/* Plan Phase 2 (client feedback item 2): the top bar previously had no
                brand slot at all — only the sidebar carried the wordmark/logo. Same
                data (`branding?.logoLightUrl`) and the same <img>-not-AvatarImage
                rationale as the sidebar's own logo above (Base UI's AvatarImage never
                resolves data: URLs in the test environment), just sized down for the
                shorter top bar. */}
            {branding?.logoLightUrl ? (
              // Distinct alt text from the sidebar's own logo `<img>` above (both
              // render the same `branding.logoLightUrl`, but two images sharing one
              // accessible name would be ambiguous to assistive tech and to any test
              // querying by role+name).
              <img
                src={branding.logoLightUrl}
                alt="Company logo, top bar"
                className="size-6 rounded-full object-cover"
              />
            ) : (
              <span role="img" aria-label="NextBot" className="text-sm font-bold text-muted-foreground">
                NB
              </span>
            )}
            <Badge variant="secondary">Sandbox</Badge>
          </div>
          <div className="flex items-center gap-4">
            {/* QA Defect U6: force a pre-verified-contrast (~7.9:1) pairing instead
                of a name-hashed background, which can fall below the 4.5:1 AA
                minimum for white initials text (QA measured ~3.93:1 previously). */}
            <Avatar size="sm" aria-label="Signed-in user">
              <AvatarFallback className="bg-[#4338ca] text-white">SU</AvatarFallback>
            </Avatar>
            <form action={logoutAction}>
              <Button type="submit" size="sm" variant="ghost">
                Sign out
              </Button>
            </form>
          </div>
        </header>
        <AdminBreadcrumb />
        {/* Plan Phase 3: the temporary `ChakraProvider` shim (Plan Phase 1) is
            removed here — every screen under `(admin)/**` finished its shadcn/
            Tailwind conversion in Plan Phase 2 (Batches A-D), so no screen needs a
            Chakra context mounted beneath this `<main>` anymore. */}
        <main role="main" className="p-8">
          {children}
        </main>
      </div>
    </div>
  );
}
