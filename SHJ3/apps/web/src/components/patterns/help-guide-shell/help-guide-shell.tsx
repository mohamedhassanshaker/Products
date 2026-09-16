"use client";

import * as React from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icon";
import { SearchField } from "@/components/ui/search-field";
import type {
  HelpGuideShellBreadcrumbItem,
  HelpGuideShellLinkRenderer,
  HelpGuideShellNavGroup,
} from "./help-guide-shell-types.js";

/** See button.tsx for the full rationale — identical recipe, kept local per organism rather than shared. */
const FOCUS_VISIBLE_RING =
  "outline-none focus-visible:[outline:var(--focus-ring-width)_solid_var(--ring)] focus-visible:[outline-offset:var(--focus-ring-offset)]";

const defaultLinkRenderer: HelpGuideShellLinkRenderer = ({ href, children, ...rest }) => (
  <a href={href} {...rest}>
    {children}
  </a>
);

export interface HelpGuideShellProps {
  /**
   * Every guide entry, grouped and ordered exactly the way
   * `modules/userguide/application/get-guide-nav.ts` (built from the same
   * `GUIDE_REGISTRY` `AppShell`'s own nav items are built from — see that
   * module's doc comment) resolves it for one locale. A route re-resolves
   * this on every request (server-rendered), so navigating between guide
   * entries never shows a stale menu.
   */
  navGroups: readonly HelpGuideShellNavGroup[];
  /** The currently-open entry's slug, or `null` on the index page. Matched for `aria-current`. */
  activeSlug: string | null;
  renderLink?: HelpGuideShellLinkRenderer;

  /** "Help" / "دليل الاستخدام" — the root breadcrumb crumb and the side menu's own heading. */
  guideTitle: string;
  breadcrumb: readonly HelpGuideShellBreadcrumbItem[];
  breadcrumbAriaLabel?: string;

  searchAriaLabel: string;
  searchPlaceholder?: string;
  /** Shown above the nav when a search query matches nothing. */
  noResultsLabel: string;

  /** The guide entry's own rendered content — purpose, walkthrough, how-to, permissions. */
  children: React.ReactNode;
  className?: string;
}

/**
 * `HelpGuideShell` (design-system.md §5.5 #56) — the Phase F organism, the last of the 57
 * named design-system components, built once real navigation data from every feature module
 * (B-2 through B-9) existed to build its side menu from.
 *
 * ## Deliberately framework-agnostic, exactly like `AppShell`
 *
 * No `next/link`, no `next/navigation` — `renderLink` is the seam a real route composes
 * through (see that type's own doc comment), and search is a plain, uncontrolled-by-default
 * text input filtering `navGroups` that the *caller* already resolved (server-side, via
 * `getGuideNav(locale, query)` — a pure function, not a client-side re-filter of a static
 * prop). That is a deliberate choice, not an oversight: it's what makes "search filters the
 * side menu" and "search is itself part of the deep-linkable, server-rendered page" the same
 * mechanism rather than two — the search input's value round-trips through the URL's own
 * `?q=` query param, which is why `onQueryChange` exists here as a plain callback rather than
 * this component owning filtered state internally.
 *
 * ## Responsive shape
 *
 * Stacks (nav above content) below `--bp-md`, sits side-by-side above it — the same
 * `flex-col md:flex-row` convention `AppShell` and `DiagnosticsRail` both already
 * establish, rather than inventing a fourth responsive recipe for a fourth organism.
 */
export const HelpGuideShell = React.forwardRef<
  HTMLDivElement,
  HelpGuideShellProps & {
    /** Current search query (server-resolved, so this is a controlled display value, not internal state) — always supplied by a real caller, so kept required rather than optional-with-a-fallback. */
    query: string;
    /** Fires on every keystroke — the caller re-resolves `navGroups` (typically via a URL navigation to `?q=`). */
    onQueryChange: (query: string) => void;
  }
>(function HelpGuideShell(
  {
    navGroups,
    activeSlug,
    renderLink = defaultLinkRenderer,
    guideTitle,
    breadcrumb,
    breadcrumbAriaLabel = "Breadcrumb",
    searchAriaLabel,
    searchPlaceholder,
    noResultsLabel,
    query,
    onQueryChange,
    children,
    className,
  },
  ref,
) {
  const hasAnyItems = navGroups.some((group) => group.items.length > 0);

  return (
    <div
      ref={ref}
      data-slot="help-guide-shell"
      className={cn("flex min-h-dvh w-full flex-col md:flex-row", className)}
    >
      {
        // `md:self-start` + sticky + a real `maxBlockSize` is the fix for a real bug this
        // organism shipped with and a live-infrastructure check caught before this wave's own
        // verification pass finished: without `self-start`, a flex row's default `align-items:
        // stretch` makes this `<aside>` match its sibling's height exactly — and a long guide
        // entry's content column can legitimately run to several viewport-heights tall, which
        // silently stretched the *nav* to match (confirmed directly: a real Arabic
        // `settings/appearance` entry rendered an 8434px-tall `<aside>`, verified via
        // `getBoundingClientRect()` against the real running page, not assumed from reading the
        // JSX). `AppShell`'s own sidebar never hits this because every *page* it wraps manages
        // its own internal scrolling; this organism's content is raw, unbounded prose, so it
        // needed the fix `AppShell` never had to make. Sticky + bounded `maxBlockSize` is what
        // makes the nav a real, independently-scrollable pane pinned to the viewport, the
        // standard docs-site sidebar behaviour, rather than scrolling away with a long entry.
        //
        // A second, distinct real bug lived on this same element, found live at a real
        // 1440×900 viewport (`getBoundingClientRect()`/computed style against the actual
        // running page, not read off the JSX): `md:w-72` never took effect, so the base
        // (always-on) `w-full` stayed in force at every width, and the aside rendered at the
        // full row width instead of 18rem. Root cause, confirmed by walking the real compiled
        // CSS (`document.styleSheets`) for a fresh `next dev` build: `.w-72`/`.md\:w-72` were
        // never generated at all. `tailwind-theme.generated.css`'s own reset (ADR-0007,
        // "replace, not extend") sets `--spacing: initial`, and its bridge re-declares only a
        // curated `--spacing-{0,px,1,2,3,4,5,6,8,10,12,16,20,24}` allowlist tied to this
        // design system's real `--space-*` tokens — `72` was never in it, so `w-72` is not a
        // silently-mis-scaled class here, it is not a class at all (an unrecognized Tailwind
        // utility renders no CSS and no error). `AppShell`'s own sidebar (`app-shell.tsx`)
        // never hits this class of bug because it never uses a numeric Tailwind width utility
        // in the first place — it sizes itself with `inlineSize: "var(--sidebar-width)"`, a
        // real token, exactly like every other token-driven value in this component (see the
        // inline `style` below). Fixed by reusing that same `--sidebar-width` token via
        // Tailwind v4's custom-property shorthand (`w-(--sidebar-width)`), which resolves to
        // a literal `width: var(--sidebar-width)` — bypassing the reset spacing scale
        // entirely, rather than by widening the bridge's allowlist to include `72` (that would
        // reintroduce exactly the raw-numeric-utility-over-a-token dependency ADR-0007 and
        // this project's own "no hardcoded spacing, tokens only" rule exist to prevent, for a
        // value only this one element needs). This also makes the two organisms' sidebars
        // literally the same width, which was already the de facto intent.
      }
      <aside
        className="flex w-full shrink-0 flex-col overflow-y-auto border-b border-border md:sticky md:top-0 md:w-(--sidebar-width) md:self-start md:border-b-0 md:border-e"
        style={{ padding: "var(--space-3)", gap: "var(--space-3)", maxBlockSize: "100dvh" }}
      >
        <h2 className="text-sm font-semibold text-foreground">{guideTitle}</h2>

        <SearchField
          aria-label={searchAriaLabel}
          value={query}
          onValueChange={onQueryChange}
          {...(searchPlaceholder !== undefined ? { placeholder: searchPlaceholder } : {})}
        />

        {hasAnyItems ? (
          <div
            className="flex min-w-0 flex-1 flex-col overflow-y-auto"
            style={{ gap: "var(--space-4)" }}
          >
            {navGroups.map((group, groupIndex) =>
              group.items.length === 0 ? null : (
                <nav
                  key={groupIndex}
                  aria-label={typeof group.label === "string" ? group.label : undefined}
                >
                  <p
                    aria-hidden="true"
                    className="truncate text-2xs font-medium tracking-wide text-muted-foreground uppercase"
                    style={{ paddingBlockEnd: "var(--space-1)" }}
                  >
                    {group.label}
                  </p>
                  <ul className="flex flex-col" style={{ gap: "var(--space-1)" }}>
                    {group.items.map((item) => {
                      const isActive = item.slug === activeSlug;
                      return (
                        <li key={item.slug}>
                          {renderLink({
                            href: item.href,
                            "aria-current": isActive ? "page" : undefined,
                            className: cn(
                              "block truncate text-sm font-medium transition-colors",
                              isActive
                                ? "bg-accent text-accent-foreground"
                                : "text-foreground hover:bg-accent hover:text-accent-foreground",
                              FOCUS_VISIBLE_RING,
                            ),
                            style: {
                              borderRadius: "var(--radius-md)",
                              paddingInline: "var(--space-3)",
                              paddingBlock: "var(--space-2)",
                            } as React.CSSProperties,
                            children: item.label,
                          })}
                        </li>
                      );
                    })}
                  </ul>
                </nav>
              ),
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{noResultsLabel}</p>
        )}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <nav
          aria-label={breadcrumbAriaLabel}
          className="border-b border-border"
          style={{ paddingInline: "var(--space-4)", paddingBlock: "var(--space-2)" }}
        >
          <ol className="flex min-w-0 items-center text-sm" style={{ gap: "var(--space-1)" }}>
            {breadcrumb.map((crumb, index) => {
              const isLast = index === breadcrumb.length - 1;
              return (
                <li
                  key={index}
                  className="flex min-w-0 items-center"
                  style={{ gap: "var(--space-1)" }}
                >
                  {index > 0 ? (
                    <Icon
                      icon={ChevronRight}
                      size={14}
                      className="shrink-0 text-muted-foreground"
                    />
                  ) : null}
                  {!isLast && crumb.href ? (
                    renderLink({
                      href: crumb.href,
                      className: cn(
                        "truncate text-muted-foreground hover:text-foreground",
                        FOCUS_VISIBLE_RING,
                      ),
                      children: crumb.label,
                    })
                  ) : (
                    <span
                      aria-current={isLast ? "page" : undefined}
                      className={cn(
                        "truncate",
                        isLast ? "font-medium text-foreground" : "text-muted-foreground",
                      )}
                    >
                      {crumb.label}
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
        </nav>

        <div className="min-w-0 flex-1 overflow-y-auto" style={{ padding: "var(--space-4)" }}>
          {children}
        </div>
      </div>
    </div>
  );
});
