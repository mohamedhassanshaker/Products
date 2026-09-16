import type * as React from "react";

/** One entry in the side menu — a single guide page. */
export interface HelpGuideShellNavItem {
  /** Stable identity — matched against `activeSlug` for `aria-current`. */
  slug: string;
  href: string;
  label: React.ReactNode;
}

/** One named module group in the side menu (design-system.md §5.5 #56: "mirroring app navigation"). */
export interface HelpGuideShellNavGroup {
  label: React.ReactNode;
  items: readonly HelpGuideShellNavItem[];
}

export interface HelpGuideShellBreadcrumbItem {
  label: React.ReactNode;
  href?: string;
}

/**
 * Anchor renderer — the same seam `AppShell`'s `AppShellLinkRenderer` establishes, for the
 * identical reason: this component library never imports `next/link` itself
 * (`eslint.config.mjs`'s `components` boundary). A Next.js page passes
 * `renderLink={({ href, children, ...rest }) => <Link href={href} {...rest}>{children}</Link>}`.
 */
export type HelpGuideShellLinkRenderer = (
  props: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string },
) => React.ReactElement;
