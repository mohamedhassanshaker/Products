"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight, CircleHelp, Globe, Monitor, Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icon";
import { IconButton } from "@/components/ui/icon-button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ToggleRow, type ToggleRowOption } from "@/components/ui/toggle-row";

/** See button.tsx for the full rationale — identical recipe, kept local per component rather than shared. */
const FOCUS_VISIBLE_RING =
  "outline-none focus-visible:[outline:var(--focus-ring-width)_solid_var(--ring)] focus-visible:[outline-offset:var(--focus-ring-offset)]";

export type AppShellSidebarGroup = "assistant" | "admin";
export type AppShellSidebarStyle = "neutral" | "brand" | "contrast";
export type AppShellThemeMode = "light" | "dark" | "system";

export interface AppShellNavItem {
  /** Stable identity, and the href handed to `renderLink` — also matched against `activeHref` for `aria-current`. */
  href: string;
  label: React.ReactNode;
  /** Which sidebar landmark this item renders under — design-system.md §5.5 #51's "Assistant window" / "Admin / configurator" grouping. */
  group: AppShellSidebarGroup;
  /** Decorative leading glyph. Not required, but the collapsed rail (see `collapsible`) has nothing else to show when a caller omits it. */
  icon?: React.ReactNode;
}

export interface AppShellBreadcrumbItem {
  label: React.ReactNode;
  /** Omit on the last (current-page) crumb — it renders as text with `aria-current="page"`, never a link to itself. */
  href?: string;
}

export interface AppShellLocaleOption {
  value: string;
  /** Short visible label for the trigger and menu, e.g. "EN" / "AR" — full names belong in `aria-label`s, not this glyph-adjacent text. */
  label: string;
}

/**
 * Tenant branding's logo (design-system.md §9.1's Brand section), read once,
 * server-side, and handed down as plain data — this component stays framework-
 * agnostic (no fetch, no theme-resolution knowledge) the same way `renderLink`
 * keeps routing out of this file. Both URLs render at once; which one is VISIBLE
 * is a pure CSS decision keyed off `[data-theme]` on `<html>` (the same "one
 * attribute repaints everything" mechanism design-system.md §9.4 already
 * establishes for colour), so the correct logo is already showing on the very
 * first paint — no client-side branch, no hydration mismatch, no flash of the
 * wrong logo while JavaScript loads.
 */
export interface AppShellLogo {
  readonly lightSrc: string;
  readonly darkSrc: string;
  /** Real alt text — an app name, not a generic "Logo" (WCAG 2.1 AA). */
  readonly alt: string;
}

/**
 * Anchor renderer, so this pure component library never imports `next/link`
 * itself (`eslint.config.mjs`'s `components` boundary: "Tailwind + Radix +
 * React only — no backend/domain dependency" — a framework router is exactly
 * the kind of dependency that stops a component being swappable independently
 * of the app that consumes it). Mirrors `Card`'s own `asChild`/`Slot` recipe
 * in spirit: the real interactive element is always supplied by the caller,
 * never constructed by this component. The default renders a plain `<a>`,
 * which is what every test in this file exercises; a Next.js page passes
 * `renderLink={({ href, children, ...rest }) => <Link href={href}
 * {...rest}>{children}</Link>}`.
 */
export type AppShellLinkRenderer = (
  props: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string },
) => React.ReactElement;

const defaultLinkRenderer: AppShellLinkRenderer = ({ href, children, ...rest }) => (
  <a href={href} {...rest}>
    {children}
  </a>
);

/**
 * Exactly one working affordance, mechanically — the same "no bare/broken
 * control" enforcement `IconButton.ariaLabel` and `Badge.label` already use.
 * The Help icon is Phase F's persistent, always-present header affordance
 * (design-system.md §5.5 #51); a `<button>` with no `onClick` and no `href`
 * would compile but do nothing, which is exactly the silently-broken control
 * this union makes impossible to construct.
 */
export type AppShellHelpAffordance =
  | { href: string; onClick?: undefined; label?: string }
  | { href?: undefined; onClick: () => void; label?: string };

export interface AppShellProps {
  /**
   * Every nav item across both sidebar groups, in the order they render.
   * Real navigation data doesn't exist yet (B-2 through B-9 aren't built) —
   * this is a plain prop rather than 14 hardcoded backoffice routes so a
   * later wave wires the real set in without touching this component.
   */
  navItems: readonly AppShellNavItem[];
  /** Matched against each item's `href` for `aria-current="page"`. */
  activeHref: string;
  renderLink?: AppShellLinkRenderer;
  /** §9.1's Brand section — omitted entirely (not passed, or `undefined`) when
   *  the tenant has uploaded neither logo, in which case no logo renders and
   *  the sidebar's existing layout is unaffected (see this prop's own doc
   *  comment on `AppShellLogo`). Typed with an explicit `| undefined` (not just
   *  `logo?:`) because this project's `exactOptionalPropertyTypes` distinguishes
   *  "prop omitted" from "prop explicitly passed as `undefined`" — a real caller
   *  (`BackofficeShell`) computes `logo` as a possibly-`undefined` value and
   *  passes it through directly, rather than conditionally spreading the prop
   *  in/out. */
  logo?: AppShellLogo | undefined;
  /** Accessible name for the "Assistant window" sidebar landmark. Default is English; pass a translated string in real feature code. */
  assistantGroupLabel?: string;
  /** Accessible name for the "Admin / configurator" sidebar landmark. */
  adminGroupLabel?: string;

  breadcrumb: readonly AppShellBreadcrumbItem[];
  /** Accessible name for the breadcrumb `<nav>`. Default is English. */
  breadcrumbAriaLabel?: string;

  sidebarStyle?: AppShellSidebarStyle;

  /**
   * Whether the desktop (≥`--bp-md`) sidebar can collapse to an icon-only
   * rail at `--sidebar-width-collapsed` — a real, previously-unconsumed
   * component token (`packages/tokens/src/components.ts`) that only makes
   * sense at the level this organism owns. Defaults on; a caller with no
   * per-item `icon` should pass `false`, since a collapsed rail with nothing
   * but invisible (`sr-only`) labels is not a usable state.
   */
  collapsible?: boolean;
  collapsed?: boolean;
  defaultCollapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
  /** Default is English; pass a translated pair in real feature code. */
  collapseLabel?: string;
  expandLabel?: string;

  locales: readonly AppShellLocaleOption[];
  activeLocale: string;
  onLocaleChange: (locale: string) => void;
  /** Accessible name for the locale switch trigger. Default is English. */
  localeSwitchLabel?: string;

  themeMode: AppShellThemeMode;
  onThemeModeChange: (mode: AppShellThemeMode) => void;
  /** Accessible name for the theme-mode group. Default is English. */
  themeSwitchLabel?: string;
  /** Per-option visible/accessible text (icon-only buttons still need a real name) — defaults are English. */
  lightModeLabel?: string;
  darkModeLabel?: string;
  systemModeLabel?: string;

  help: AppShellHelpAffordance;

  /**
   * The signed-in principal, for the header's "who am I, and how do I leave"
   * affordance — genuinely absent (not merely `undefined` by omission) on any
   * surface with no session concept at all. Omitted entirely (not passed) when
   * there is no signed-in principal to show, mirroring `logo`'s own contract.
   */
  user?: { readonly displayName: string } | undefined;
  /** Ends the session. Required whenever `user` is provided — a name with no way to sign out is a dead end, not a feature. May return a `Promise` (the real caller wraps a Server Action). */
  onSignOut?: (() => void | Promise<void>) | undefined;
  /** Accessible name for the user menu trigger. Default is English. */
  userMenuLabel?: string;
  /** Default is English. */
  signOutLabel?: string;

  /** `id` the skip link jumps to, and that `<main>` renders. */
  mainId?: string;
  /** Visible only once focused (standard skip-link pattern) — default is English. */
  skipLinkLabel?: string;

  children: React.ReactNode;
  className?: string;
}

const SIDEBAR_STYLE_CLASSES: Record<
  AppShellSidebarStyle,
  { root: string; itemActive: string; itemInactive: string; muted: string }
> = {
  // Today's token set as-is: `--sidebar*` was built for exactly this case.
  neutral: {
    root: "bg-sidebar text-sidebar-foreground border-sidebar-border",
    itemActive: "bg-sidebar-active-surface text-sidebar-foreground",
    itemInactive: "text-sidebar-foreground hover:bg-sidebar-active-surface/60",
    muted: "text-sidebar-muted-foreground",
  },
  // [ASSUMPTION] design-system.md §5.5 #51 names `brand`/`contrast` as
  // variants with no further visual spec — no dedicated tokens exist for
  // them beyond `--sidebar*`, so this reuses the brand-role tokens every
  // other component already draws on (`--primary`) rather than inventing new
  // ones, and documents the interpretation here instead of silently guessing.
  brand: {
    root: "bg-primary text-primary-foreground border-primary-hover",
    itemActive: "bg-primary-hover text-primary-foreground",
    itemInactive: "text-primary-foreground/85 hover:bg-primary-hover/70",
    muted: "text-primary-foreground/70",
  },
  // [ASSUMPTION] — see `brand` above. A dark, high-contrast rail (the
  // "dark fill" treatment `ToggleRow`'s active segment already established
  // for this design system) with `--primary` reserved for the active-item
  // rail so it still reads as "selected" against the inverted surface.
  contrast: {
    root: "bg-foreground text-background border-background/15",
    itemActive: "bg-background/15 text-background",
    itemInactive: "text-background/80 hover:bg-background/10",
    muted: "text-background/65",
  },
};

/** Order matches the segmented toggle's visual order — an array, not a `Record`, because render order is part of this constant's contract. */
const THEME_MODE_OPTIONS: readonly { value: AppShellThemeMode; icon: typeof Sun }[] = [
  { value: "light", icon: Sun },
  { value: "dark", icon: Moon },
  { value: "system", icon: Monitor },
];

/** Small, local visual recipe for a link styled like a ghost `IconButton` — `renderLink` returns a real `<a>`, which cannot compose `IconButton` (a `<button>`) directly, so the handful of shared classes are restated here rather than reaching into `icon-button.tsx`'s private `cva` config. Same "kept local per component" convention `FOCUS_VISIBLE_RING` above documents. */
const ICON_LINK_CLASSES = cn(
  "inline-flex shrink-0 items-center justify-center rounded-md text-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
  FOCUS_VISIBLE_RING,
);

function NavGroup({
  label,
  items,
  activeHref,
  renderLink,
  collapsed,
  styleClasses,
}: {
  label: string;
  items: readonly AppShellNavItem[];
  activeHref: string;
  renderLink: AppShellLinkRenderer;
  collapsed: boolean;
  styleClasses: (typeof SIDEBAR_STYLE_CLASSES)["neutral"];
}) {
  if (items.length === 0) return null;

  return (
    <nav aria-label={label} className="min-w-0">
      {
        // Visible group heading above `--bp-md` only — the horizontal mobile
        // strip has no vertical room for it, and the `aria-label` above
        // already carries the same name for assistive tech at every size.
        //
        // `uppercase` here repeats the same known, pre-existing, flagged gap
        // `kpi-tile.tsx`'s `KpiTileChrome` documents rather than re-deriving
        // its own fix: §11.4 requires `text-transform: uppercase` to apply
        // only under `:not(:lang(ar))` (Arabic has no case), but that scoping
        // is base-layer work (`globals.css`) that hasn't landed yet — a
        // one-off selector in this file would fix only this component
        // instead of the rule §11.4 actually states, so this stays plain
        // `uppercase`, matching that file's own documented choice.
      }
      <p
        aria-hidden="true"
        className={cn(
          "hidden truncate text-2xs font-medium tracking-wide uppercase md:block",
          styleClasses.muted,
        )}
        style={{ paddingInline: "var(--space-3)", paddingBlockEnd: "var(--space-1)" }}
      >
        {collapsed ? null : label}
      </p>
      <ul
        className="flex flex-row gap-1 overflow-x-auto md:flex-col md:overflow-visible"
        style={{ padding: "var(--space-1)" }}
      >
        {items.map((item) => {
          const isActive = item.href === activeHref;
          return (
            <li key={item.href} className="shrink-0 md:shrink">
              {renderLink({
                href: item.href,
                "aria-current": isActive ? "page" : undefined,
                className: cn(
                  "flex items-center whitespace-nowrap text-sm font-medium transition-colors",
                  isActive ? styleClasses.itemActive : styleClasses.itemInactive,
                  FOCUS_VISIBLE_RING,
                ),
                style: {
                  gap: "var(--space-2)",
                  paddingInline: "var(--space-3)",
                  paddingBlock: "var(--space-2)",
                  borderRadius: "var(--sidebar-item-radius)",
                } as React.CSSProperties,
                children: (
                  <>
                    {item.icon ? (
                      <span aria-hidden="true" className="flex shrink-0 items-center">
                        {item.icon}
                      </span>
                    ) : null}
                    {
                      // `md:sr-only`, not `sr-only md:not-sr-only`: the base
                      // (unprefixed) rule must stay plain "visible" so the
                      // ≤`--bp-md` horizontal strip always shows labels
                      // regardless of the *desktop* collapsed preference —
                      // `resolvedCollapsed` is a plain boolean with no
                      // viewport gate of its own (the toggle that sets it is
                      // hidden below `md`, but a controlled/`defaultCollapsed`
                      // caller could still set it while the viewport is
                      // narrow), so only the `md:` variant may hide it.
                    }
                    <span className={collapsed ? "md:sr-only" : undefined}>{item.label}</span>
                  </>
                ),
              })}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * The application shell (design-system.md §5.5 #51): sidebar grouped into
 * "Assistant window" / "Admin / configurator", a header with breadcrumb,
 * locale switch, theme-mode switch and the persistent Help icon Phase F
 * mandates, and the skip link that has to be the very first focusable thing
 * in the tree.
 *
 * Deliberately *not* a data view — the eight-state model (§5.2) belongs to
 * what this shell wraps (`children`), not to the chrome around it; there is
 * no loading/error/empty state here to implement, the same reasoning
 * `Button`'s doc comment gives for the states it omits.
 *
 * Framework-agnostic by construction: no `next/link`, no `next/navigation`.
 * `renderLink` is the seam a real app composes through — see that type's own
 * doc comment. One real, known gap left deliberately unfixed here rather
 * than faked: §10.3 also wants a route change to move focus to the page
 * `<h1>` and announce the new page name. That genuinely needs the *page*'s
 * own heading, which this shell — wrapping arbitrary `children` it does not
 * control the internals of — has no seam to reach into without either
 * importing `next/navigation` (breaking the framework-agnostic contract
 * above) or polling the DOM for an `<h1>` (a fragile heuristic, not a fix).
 * Left for the concrete `app/` integration that owns both the router and the
 * page heading, rather than guessed at here.
 */
export const AppShell = React.forwardRef<HTMLDivElement, AppShellProps>(function AppShell(
  {
    navItems,
    activeHref,
    renderLink = defaultLinkRenderer,
    logo,
    assistantGroupLabel = "Assistant window",
    adminGroupLabel = "Admin / configurator",
    breadcrumb,
    breadcrumbAriaLabel = "Breadcrumb",
    sidebarStyle = "neutral",
    collapsible = true,
    collapsed,
    defaultCollapsed = false,
    onCollapsedChange,
    collapseLabel = "Collapse sidebar",
    expandLabel = "Expand sidebar",
    locales,
    activeLocale,
    onLocaleChange,
    localeSwitchLabel = "Change language",
    themeMode,
    onThemeModeChange,
    themeSwitchLabel = "Theme",
    lightModeLabel = "Light",
    darkModeLabel = "Dark",
    systemModeLabel = "System",
    help,
    user,
    onSignOut,
    userMenuLabel = "Account menu",
    signOutLabel = "Sign out",
    mainId = "main-content",
    skipLinkLabel = "Skip to main content",
    children,
    className,
  },
  ref,
) {
  const [internalCollapsed, setInternalCollapsed] = React.useState(defaultCollapsed);
  const resolvedCollapsed = collapsible && (collapsed ?? internalCollapsed);
  const styleClasses = SIDEBAR_STYLE_CLASSES[sidebarStyle];
  const activeLocaleOption = locales.find((locale) => locale.value === activeLocale);

  const handleToggleCollapsed = () => {
    const next = !resolvedCollapsed;
    setInternalCollapsed(next);
    onCollapsedChange?.(next);
  };

  const assistantItems = navItems.filter((item) => item.group === "assistant");
  const adminItems = navItems.filter((item) => item.group === "admin");

  const themeModeLabelByValue: Record<AppShellThemeMode, string> = {
    light: lightModeLabel,
    dark: darkModeLabel,
    system: systemModeLabel,
  };
  const themeOptions: readonly ToggleRowOption[] = THEME_MODE_OPTIONS.map(({ value, icon }) => ({
    value,
    label: <ThemeOptionLabel icon={icon} text={themeModeLabelByValue[value]} />,
  }));

  return (
    <div
      ref={ref}
      data-slot="app-shell"
      data-sidebar-style={sidebarStyle}
      className={cn("flex min-h-dvh flex-col md:flex-row", className)}
    >
      {
        // §10.3: the skip link must be the first focusable element in the
        // tree — rendered before the sidebar, not just visually first.
        // `tabIndex={-1}` on the `<main>` target plus a plain `href="#id"` is
        // the standard technique (no click handler needed): a browser
        // focuses a fragment target that carries `tabindex="-1"` on
        // same-page navigation, it just isn't in the normal tab sequence
        // afterwards, which is exactly right for a one-shot jump target.
      }
      <a
        href={`#${mainId}`}
        className="sr-only focus:not-sr-only focus:fixed focus:start-4 focus:top-4"
        style={{
          zIndex: "var(--z-overlay)",
          borderRadius: "var(--radius-md)",
          paddingInline: "var(--space-4)",
          paddingBlock: "var(--space-2)",
          background: "var(--primary)",
          color: "var(--primary-foreground)",
        }}
      >
        {skipLinkLabel}
      </a>

      <aside
        className={cn(
          "flex shrink-0 flex-col border-b md:border-e md:border-b-0",
          styleClasses.root,
        )}
        style={{
          inlineSize: resolvedCollapsed ? "var(--sidebar-width-collapsed)" : "var(--sidebar-width)",
          transitionProperty: "inline-size",
          transitionDuration: "var(--duration-normal)",
          transitionTimingFunction: "var(--ease-standard)",
        }}
      >
        {logo ? (
          <div
            className="flex shrink-0 items-center overflow-hidden"
            style={{ paddingInline: "var(--space-3)", paddingBlock: "var(--space-2)" }}
          >
            {
              // Both render always; CSS (globals.css, keyed off `[data-theme]` on
              // `<html>`) decides which is visible — see `AppShellLogo`'s own doc
              // comment for why this is not a client-side conditional.
            }
            <img
              data-slot="app-shell-logo-light"
              src={logo.lightSrc}
              alt={logo.alt}
              className="max-h-8 max-w-full object-contain"
            />
            <img
              data-slot="app-shell-logo-dark"
              src={logo.darkSrc}
              alt={logo.alt}
              className="max-h-8 max-w-full object-contain"
            />
          </div>
        ) : null}
        <div className="flex min-w-0 flex-1 flex-col gap-1 overflow-y-auto md:py-2">
          <NavGroup
            label={assistantGroupLabel}
            items={assistantItems}
            activeHref={activeHref}
            renderLink={renderLink}
            collapsed={resolvedCollapsed}
            styleClasses={styleClasses}
          />
          <NavGroup
            label={adminGroupLabel}
            items={adminItems}
            activeHref={activeHref}
            renderLink={renderLink}
            collapsed={resolvedCollapsed}
            styleClasses={styleClasses}
          />
        </div>
        {collapsible ? (
          <div className="hidden shrink-0 md:block" style={{ padding: "var(--space-1)" }}>
            <IconButton
              ariaLabel={resolvedCollapsed ? expandLabel : collapseLabel}
              variant="ghost"
              size="sm"
              onClick={handleToggleCollapsed}
              aria-expanded={!resolvedCollapsed}
              className="w-full"
            >
              <Icon
                icon={resolvedCollapsed ? ChevronRight : ChevronLeft}
                size={16}
                // Genuinely directional here: this chevron always points
                // toward the reading-start edge to mean "collapse toward the
                // sidebar's own edge" and toward reading-end to mean
                // "expand" — `icon.tsx`'s existing allowlist already covers
                // both names for exactly this "points toward start/end"
                // convention (pagination.tsx's identical reasoning), so no
                // allowlist change is needed.
              />
            </IconButton>
          </div>
        ) : null}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header
          className="flex items-center justify-between border-b border-border bg-card"
          style={{
            position: "sticky",
            insetBlockStart: 0,
            zIndex: "var(--z-sticky)",
            paddingInline: "var(--space-4)",
            paddingBlock: "var(--space-2)",
            gap: "var(--space-4)",
          }}
        >
          <nav aria-label={breadcrumbAriaLabel} className="min-w-0">
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

          <div className="flex shrink-0 items-center" style={{ gap: "var(--space-2)" }}>
            <ToggleRow
              options={themeOptions}
              aria-label={themeSwitchLabel}
              value={themeMode}
              onValueChange={(value) => onThemeModeChange(value as AppShellThemeMode)}
            />

            <DropdownMenu>
              {
                // Styled directly on `DropdownMenuTrigger` itself rather than
                // wrapped via `asChild` around `IconButton` — `select.tsx`'s
                // `SelectTrigger` and `combobox.tsx` establish this as the
                // house pattern for a styled Radix trigger (Radix's
                // `Trigger` already renders a real, correctly-wired
                // `<button>` on its own), so no extra composition layer is
                // needed here either. Shows the active locale's short code
                // (e.g. "EN") as real visible text — `activeLocaleOption`
                // is genuinely consumed, not just threaded through as an
                // unused prop.
              }
              <DropdownMenuTrigger
                aria-label={localeSwitchLabel}
                className={cn(
                  "inline-flex items-center rounded-md text-sm font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
                  FOCUS_VISIBLE_RING,
                )}
                style={{
                  gap: "var(--space-1)",
                  paddingInline: "var(--space-2)",
                  height: "var(--control-height-md)",
                  borderRadius: "var(--button-radius)",
                }}
              >
                <Icon icon={Globe} size={16} mirrorInRtl={false} />
                {activeLocaleOption?.label ?? activeLocale}
              </DropdownMenuTrigger>
              <DropdownMenuContent side="bottom" align="end">
                {locales.map((locale) => {
                  const isActive = locale.value === activeLocale;
                  return (
                    <DropdownMenuItem
                      key={locale.value}
                      aria-current={isActive ? "true" : undefined}
                      onSelect={() => onLocaleChange(locale.value)}
                    >
                      {locale.label}
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>

            {user ? (
              <DropdownMenu>
                <DropdownMenuTrigger
                  aria-label={userMenuLabel}
                  className={cn(
                    "inline-flex max-w-40 items-center truncate rounded-md text-sm font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
                    FOCUS_VISIBLE_RING,
                  )}
                  style={{
                    gap: "var(--space-1)",
                    paddingInline: "var(--space-2)",
                    height: "var(--control-height-md)",
                    borderRadius: "var(--button-radius)",
                  }}
                >
                  <span className="truncate">{user.displayName}</span>
                </DropdownMenuTrigger>
                <DropdownMenuContent side="bottom" align="end">
                  <DropdownMenuItem onSelect={() => onSignOut?.()}>{signOutLabel}</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}

            {help.href !== undefined ? (
              renderLink({
                href: help.href,
                "aria-label": help.label ?? "Help",
                className: cn(ICON_LINK_CLASSES),
                style: {
                  inlineSize: "var(--control-height-md)",
                  blockSize: "var(--control-height-md)",
                  borderRadius: "var(--button-radius)",
                } as React.CSSProperties,
                children: <Icon icon={CircleHelp} size={20} mirrorInRtl={false} />,
              })
            ) : (
              <IconButton ariaLabel={help.label ?? "Help"} variant="ghost" onClick={help.onClick}>
                <Icon icon={CircleHelp} size={20} mirrorInRtl={false} />
              </IconButton>
            )}
          </div>
        </header>

        {
          // §10.3: focus is never removed without a replacement ring — this
          // is the skip link's jump target, so it is exactly the one place a
          // *visible* landing ring matters most, not a place to suppress one.
          // Reuses the same token ring recipe as every focusable control in
          // this file rather than a one-off.
        }
        <main
          id={mainId}
          tabIndex={-1}
          className={cn("min-w-0 flex-1", FOCUS_VISIBLE_RING)}
          style={{ padding: "var(--page-gutter)" }}
        >
          {children}
        </main>
      </div>
    </div>
  );
});

/** Icon + visually-hidden text so an icon-only theme-mode segment still has a real accessible name (Radix `ToggleGroup.Item`'s name comes from its rendered text content). */
function ThemeOptionLabel({ icon, text }: { icon: typeof Sun; text: string }) {
  return (
    <span className="inline-flex items-center" style={{ gap: "var(--space-1)" }}>
      <Icon icon={icon} size={14} mirrorInRtl={false} />
      <span className="sr-only">{text}</span>
    </span>
  );
}
