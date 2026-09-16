"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import {
  HelpGuideShell,
  type HelpGuideShellBreadcrumbItem,
  type HelpGuideShellNavGroup,
} from "@/components/patterns/help-guide-shell";

export interface HelpPageShellProps {
  navGroups: readonly HelpGuideShellNavGroup[];
  activeSlug: string | null;
  guideTitle: string;
  breadcrumb: readonly HelpGuideShellBreadcrumbItem[];
  breadcrumbAriaLabel: string;
  searchAriaLabel: string;
  searchPlaceholder: string;
  noResultsLabel: string;
  /** The `?q=` value this render was resolved with — see the module comment. */
  query: string;
  children: React.ReactNode;
}

/**
 * The one real client boundary `/help` needs — mirrors `(backoffice)/backoffice-shell.tsx`'s
 * own reason for existing: `renderLink` composes `next/link`, which cannot cross the Server
 * → Client Component prop boundary as a plain function (only `HelpGuideShell`'s own
 * `AppShellLinkRenderer`-shaped seam can receive it, and only from a Client Component that
 * defines it locally, same as `BackofficeShell` does for `AppShell`).
 *
 * ## Search is a real URL round-trip, not client-side re-filtering
 *
 * `HelpGuideShell`'s own doc comment states the design: `onQueryChange` here pushes a new
 * `?q=` on the *current* pathname (index or a deep-linked entry both keep their own URL, the
 * query is just appended) rather than filtering an already-fetched `navGroups` array in the
 * browser. That round-trip re-runs `getGuideNav(locale, query)` server-side on the next
 * render — the same "search is a first-class part of the deep-linkable page" property this
 * module's callers rely on (a search result can itself be bookmarked/shared as a URL).
 */
export function HelpPageShell({
  navGroups,
  activeSlug,
  guideTitle,
  breadcrumb,
  breadcrumbAriaLabel,
  searchAriaLabel,
  searchPlaceholder,
  noResultsLabel,
  query,
  children,
}: HelpPageShellProps) {
  const router = useRouter();
  const pathname = usePathname();

  return (
    <HelpGuideShell
      navGroups={navGroups}
      activeSlug={activeSlug}
      renderLink={({
        href,
        children: linkChildren,
        className,
        style,
        "aria-current": ariaCurrent,
      }) => (
        <Link href={href} className={className} style={style} aria-current={ariaCurrent}>
          {linkChildren}
        </Link>
      )}
      guideTitle={guideTitle}
      breadcrumb={breadcrumb}
      breadcrumbAriaLabel={breadcrumbAriaLabel}
      searchAriaLabel={searchAriaLabel}
      searchPlaceholder={searchPlaceholder}
      noResultsLabel={noResultsLabel}
      query={query}
      onQueryChange={(next) => {
        const params = new URLSearchParams();
        if (next !== "") params.set("q", next);
        const queryString = params.toString();
        router.push(queryString !== "" ? `${pathname}?${queryString}` : pathname);
      }}
    >
      {children}
    </HelpGuideShell>
  );
}
