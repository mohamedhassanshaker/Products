"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  AppShell,
  type AppShellHelpAffordance,
  type AppShellLogo,
  type AppShellNavItem,
  type AppShellThemeMode,
} from "@/components/patterns/app-shell";

export interface BackofficeShellProps {
  /** Every nav item across both sidebar groups — see `AppShell`'s own doc comment on why this is a plain prop, not a hardcoded list. */
  readonly navItems: readonly AppShellNavItem[];
  readonly breadcrumbLabel: string;
  readonly locale: string;
  /** §9.1's Brand section, resolved server-side from the SAME `resolveTheme()`
   *  call that already produces `initialThemeMode`/`appTitle` — `undefined` when
   *  the tenant has uploaded no logo at all (see `(backoffice)/layout.tsx` for
   *  how this is computed, including the light/dark fallback when only one of
   *  the two has been uploaded). */
  readonly logo?: AppShellLogo | undefined;
  /**
   * The real, server-resolved colour (`resolveTheme()`'s own request-scoped merge,
   * `[locale]/layout.tsx`'s `theme.mode` — the same value already burned into
   * `<html data-theme>`) — used as this component's initial `themeMode` state instead
   * of reading `document.documentElement.dataset.theme` client-side. That client-side
   * read was a real, reported hydration-mismatch bug: its own `typeof document ===
   * "undefined"` branch is exactly the "server/client branch on `typeof window`"
   * anti-pattern React's own hydration-mismatch error names — on the server that
   * branch always returns `"system"`, and on the client's *first* (hydration) render
   * it reads the real DOM attribute instead, so whenever the resolved theme was
   * actually "light" or "dark" (the common case), server and client render two
   * different `aria-checked`/`data-state` values for the theme radiogroup and React
   * refuses to patch it up. Passing the one real, already-resolved value down as a
   * prop means server and client start from the identical known value — no branch,
   * no mismatch, by construction.
   *
   * One real, narrower gap this does not close, named rather than silently
   * expanded into this fix's scope: `resolveTheme()`'s output is always a concrete
   * `"light" | "dark"` (`ColorMode`) — the user's raw stored preference (which can
   * genuinely be `"System"`, `DbMode`'s third value) is resolved away inside
   * `ResolveTheme` and never reaches `ResolvedTheme`. So even with this fix, a user
   * whose real preference is "System" sees this toggle initialise to whichever of
   * Light/Dark that preference currently resolves to, not to "System" itself — a
   * separate, pre-existing UX gap, not a hydration bug, and not fixed here.
   */
  readonly initialThemeMode: "light" | "dark";
  readonly assistantGroupLabel: string;
  readonly adminGroupLabel: string;
  readonly breadcrumbAriaLabel: string;
  readonly localeSwitchLabel: string;
  readonly themeSwitchLabel: string;
  readonly lightModeLabel: string;
  readonly darkModeLabel: string;
  readonly systemModeLabel: string;
  readonly collapseLabel: string;
  readonly expandLabel: string;
  readonly helpLabel: string;
  readonly skipLinkLabel: string;
  /** The signed-in principal's display name — `undefined` on the (never expected in
   *  practice) render where `layout.tsx`'s own `withStaffAuth()` call finds no session,
   *  in which case no user menu renders at all (`AppShell`'s own contract). */
  readonly user?: { readonly displayName: string } | undefined;
  /** The real sign-out Server Action, passed down as a plain function reference —
   *  Next.js lets a Server Component hand a `"use server"` action to a Client
   *  Component this way; see `layout.tsx` for where it is actually bound. */
  readonly onSignOut?: (() => Promise<void>) | undefined;
  readonly userMenuLabel: string;
  readonly signOutLabel: string;
  readonly children: React.ReactNode;
}

/** Short codes shown on the switcher trigger — full names belong in translated `aria-label`s, not this glyph-adjacent text (matching `AppShellLocaleOption`'s own doc comment). */
const LOCALES = [
  { value: "en", label: "EN" },
  { value: "ar", label: "AR" },
];

function resolvedSystemMode(): "light" | "dark" {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/**
 * The first real mount of `AppShell` (design-system.md §5.5 #51, B-2) — a thin client
 * wrapper supplying the callback props `AppShell` needs (`renderLink`, `onLocaleChange`,
 * `onThemeModeChange`) that cannot cross the Server -> Client Component boundary as plain
 * functions (only Server Actions can, and none of these three are one). Everything else is
 * plain data, resolved server-side by `layout.tsx` and passed down as props.
 *
 * Two judgment calls, both scope-limited and flagged rather than silently built out:
 *
 *  - **The theme-mode toggle is client-local only, not yet persisted.** Persisting it for
 *    real means merging one field into a user's existing personal-preference row
 *    (`modules/theming`'s `ManageAppearance.savePersonalPreferenceScalars`, which takes all
 *    five personal scalars together) — reading the current preference first, patching one
 *    field, writing it back. That is real, correct work for whichever wave next revisits
 *    this shell's own settings integration, not a B-2 (IAM) concern, and wiring it here
 *    would duplicate theming's own save path from outside its module. The *initial* mode
 *    the page loads with is still the real, server-resolved one (`data-theme` on `<html>`,
 *    set by the root layout's already-real `resolveTheme()`) — only the in-session *toggle*
 *    is unpersisted for now, and reverts on the next full load.
 *  - **The locale switch performs a real navigation**, to the same path under the other
 *    locale prefix — this one needs no persistence at all, so it is fully real.
 *
 * **`activeHref` is resolved here, client-side, from a live `usePathname()` read** —
 * replacing an earlier hardcoded `/iam` (a "KNOWN, FLAGGED SIMPLIFICATION" left by B-2,
 * since a Server Component layout has no built-in way to read the request's own pathname:
 * `usePathname()` is client-only). The match is longest-`href`-prefix-wins against
 * `navItems` (e.g. `/en/agents/new` and `/en/agents/[id]/edit` both resolve to the
 * `/en/agents` nav item, not to nothing), falling back to the current pathname itself if
 * no nav item matches — matching `AppShell`'s own contract that `activeHref` need not be a
 * literal nav item href.
 */
export function BackofficeShell({
  navItems,
  breadcrumbLabel,
  locale,
  logo,
  initialThemeMode,
  assistantGroupLabel,
  adminGroupLabel,
  breadcrumbAriaLabel,
  localeSwitchLabel,
  themeSwitchLabel,
  lightModeLabel,
  darkModeLabel,
  systemModeLabel,
  collapseLabel,
  expandLabel,
  helpLabel,
  skipLinkLabel,
  user,
  onSignOut,
  userMenuLabel,
  signOutLabel,
  children,
}: BackofficeShellProps): React.ReactElement {
  const router = useRouter();
  const pathname = usePathname();
  const activeHref = React.useMemo(() => {
    let best: string | null = null;
    for (const item of navItems) {
      if (pathname === item.href || pathname.startsWith(`${item.href}/`)) {
        if (best === null || item.href.length > best.length) best = item.href;
      }
    }
    return best ?? pathname;
  }, [navItems, pathname]);
  // No `typeof document` branch: `initialThemeMode` is the same real, server-resolved
  // value on both the server render and the client's hydration render, so there is
  // nothing for the two to disagree about (see this prop's own doc comment on the
  // hydration-mismatch bug this replaces).
  const [themeMode, setThemeMode] = React.useState<AppShellThemeMode>(initialThemeMode);

  // Phase F's Help module (`HelpGuideShell`) now exists for real — replaces the earlier
  // no-op `onClick` placeholder this file carried while B-2 through B-9's real navigation
  // data didn't exist yet to build its side menu from. `/help` is a real, public,
  // deep-linkable route (`app/[locale]/help/`) — see that route's own doc comment for why
  // it is deliberately not gated behind `withStaffAuth()` like every other href this shell
  // renders. `AppShellHelpAffordance`'s own union makes a bare, broken control impossible to
  // construct, so switching from `onClick` to `href` here is exactly what "the real thing,
  // not a placeholder" means for this specific prop.
  const help: AppShellHelpAffordance = { href: `/${locale}/help`, label: helpLabel };

  return (
    <AppShell
      navItems={navItems}
      activeHref={activeHref}
      logo={logo}
      renderLink={({
        href,
        children: linkChildren,
        className,
        style,
        "aria-current": ariaCurrent,
      }) => (
        // Explicit props, not a blanket `{...rest}` spread: `next/link`'s own `LinkProps`
        // is stricter than a plain `<a>`'s attributes under `exactOptionalPropertyTypes`
        // (confirmed directly — a spread of `AppShellLinkRenderer`'s full props object
        // fails to typecheck against it), and every real caller of `renderLink`
        // (`app-shell.tsx`'s `NavGroup` and breadcrumb) only ever supplies these four.
        <Link href={href} className={className} style={style} aria-current={ariaCurrent}>
          {linkChildren}
        </Link>
      )}
      assistantGroupLabel={assistantGroupLabel}
      adminGroupLabel={adminGroupLabel}
      breadcrumb={[{ label: breadcrumbLabel }]}
      breadcrumbAriaLabel={breadcrumbAriaLabel}
      locales={LOCALES}
      activeLocale={locale}
      onLocaleChange={(nextLocale) => {
        const rest = activeHref.startsWith(`/${locale}/`)
          ? activeHref.slice(locale.length + 1)
          : "/";
        router.push(`/${nextLocale}${rest}`);
      }}
      localeSwitchLabel={localeSwitchLabel}
      themeMode={themeMode}
      onThemeModeChange={(mode) => {
        setThemeMode(mode);
        document.documentElement.dataset.theme = mode === "system" ? resolvedSystemMode() : mode;
      }}
      themeSwitchLabel={themeSwitchLabel}
      lightModeLabel={lightModeLabel}
      darkModeLabel={darkModeLabel}
      systemModeLabel={systemModeLabel}
      collapseLabel={collapseLabel}
      expandLabel={expandLabel}
      help={help}
      user={user}
      onSignOut={
        onSignOut
          ? () => {
              // The action destroys the real server-side session and clears the
              // cookie; only then does this client-side navigation land the now-
              // signed-out user on `/sign-in` — regardless of which page they signed
              // out from (`activeHref` has no meaning once the session is gone).
              // Navigating first would race the cookie clear.
              void onSignOut().then(() => router.push(`/${locale}/sign-in`));
            }
          : undefined
      }
      userMenuLabel={userMenuLabel}
      signOutLabel={signOutLabel}
      skipLinkLabel={skipLinkLabel}
    >
      {children}
    </AppShell>
  );
}
