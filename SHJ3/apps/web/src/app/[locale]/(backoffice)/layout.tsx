import { getTranslations } from "next-intl/server";
import type { AppShellNavItem } from "@/components/patterns/app-shell";
import { BackofficeShell } from "./backoffice-shell.js";
import { resolveThemeForRequest, type AppLocale } from "../layout.js";
import { UnauthenticatedError } from "../../../modules/iam/adapters/inbound/auth-middleware.js";
import { withStaffAuth } from "../../../modules/iam/adapters/inbound/next-request-context.js";
import {
  PlatformOperatorDeniedError,
  RequirePlatformOperator,
} from "../../../modules/platform/application/require-platform-operator.js";
import { PrismaTenantProfileReader } from "../../../modules/platform/adapters/outbound/sql/prisma-tenant-profile-reader.js";
import { signOutAction } from "../sign-in/actions.js";

/**
 * `(backoffice)` — the first real route group in this app (architecture.md §9's
 * intended tree), and the first real mount of `AppShell`.
 *
 * Route groups are purely organisational in the App Router: this segment name never
 * appears in the URL — `(backoffice)/iam/page.tsx` resolves to `/{locale}/iam`, not
 * `/{locale}/(backoffice)/iam`. Confirmed directly (not assumed) against the real,
 * running dev server as part of this wave's own verification.
 *
 * No *authorization* check lives here — `withStaffAuth()` (`modules/iam/adapters/inbound/
 * next-request-context.ts`) cannot be called once, ambiently, at this layer and cover every
 * nested page and Server Action for free — proven empirically before this file was
 * written (see that module's own doc comment for the throwaway `next dev` experiment
 * that confirmed a layout-bound `AsyncLocalStorage` context does not propagate to a
 * nested page render or a Server Action). So real permission checks stay exactly where
 * they were: every page under this layout (`iam/page.tsx` today) calls `withStaffAuth()`
 * itself for its own data and permission check, and the client-side hiding this shell's
 * nav provides is exactly that — hiding, never the enforcement (architecture.md §9's own
 * RBAC rule).
 *
 * This layout DOES call `withStaffAuth()` once itself, though — not to gate anything, only
 * to read the signed-in principal's display name (for the header's "who am I" menu) and
 * to show/hide the "Platform console" nav link for a real platform operator (Part E of the
 * platform-admin wave, 2026-09-13). Both are read-only, best-effort UI affordances: an
 * `UnauthenticatedError` here renders the shell with no user menu (a signed-out visitor
 * reaching a page under this layout is the page's own concern, e.g. `SignInPrompt`, not
 * this layout's), and `RequirePlatformOperator` failing just hides one nav link. This is a
 * second, genuinely redundant session resolution on every request under this layout — each
 * page's own `withStaffAuth()` call resolves the same session again — accepted rather than
 * engineered around: `AsyncLocalStorage` context cannot cross the layout/page boundary (see
 * above), so there is no way to share the one resolution between them, and this whole
 * module's own doc comment already accepts "more work than decoding a token" as the price
 * of re-reading state on every request.
 *
 * `navItems` now names `command-centre` (B1), `iam` (B9), `agents` (B2/B3), `tools`
 * (B5), `orchestrator` (a real diagnostic screen over B-5's own execution traces),
 * `knowledge` (B6), `channels`
 * (B10), `escalations` (B8/B-7), `evaluation` (B13), `governance` (B14, B-9 wave,
 * 2026-09-10) and `guardrails` (the global policy catalogue B-5's own review entry named as
 * deliberately deferred, closed by a later wave) — the real backoffice screens built so far
 * (this comment itself had drifted behind `channels`'s own addition before an earlier edit —
 * `tasks/lessons.md`'s own "a doc's worked example/comment can be stale" family of
 * findings, caught again here rather than left for the next wave). Every
 * other module (B11) does not exist as a real screen yet, and `AppShell`'s own doc
 * comment is explicit that a later wave adds the rest as they are built, not fake
 * entries for screens that don't exist.
 *
 * The standalone `flow-designer` entry point (a picker screen onto the SAME real flow
 * canvas the agent wizard's step 6 already ships) was removed per review-comments-3
 * feedback: it was pure duplication with no capability of its own, so the wizard's own
 * Flows step is now the only place a flow is authored.
 */
export default async function BackofficeLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations("backoffice");
  // `resolveThemeForRequest` is wrapped in React's `cache()` in the parent `[locale]`
  // layout — this second call within the same request is a free cache hit, not a real
  // re-resolution. Cast is safe: this layout only ever renders once the parent layout
  // has already called `notFound()` for any locale `hasLocale()` would reject, so
  // `locale` is guaranteed a real `AppLocale` here even though `params` itself types it
  // as a bare `string`.
  const theme = await resolveThemeForRequest(locale as AppLocale);

  // `theme.logoLightUrl`/`logoDarkUrl` below inherit the SAME pre-existing,
  // already-documented gap `[locale]/layout.tsx`'s own `generateMetadata` doc
  // comment names for `faviconUrl`/`appTitle`: this layout never has a bound
  // `TenantContext` today (this file's own module doc comment, above — "No auth
  // check lives here"), so `logo` below resolves `undefined` on every real
  // request regardless of what a tenant has uploaded, until B-2/B-6 bind one
  // upstream. Confirmed live alongside that same finding, not assumed
  // separately. The logo-rendering code itself (this block, `AppShell`'s own
  // `logo` prop, `globals.css`'s mode-swap rule) is real and already correct —
  // it starts working the moment a real `TenantContext` exists here, with zero
  // further changes, exactly like `appTitle`/every other tenant-tier field.
  //
  // §9.1's Brand section: a tenant may genuinely upload only one of the two
  // (light-mode-only branding is a real, common starting point) — falling back
  // to whichever exists for the other mode means the sidebar never shows no
  // logo in one mode and a real one in the other. `undefined` (not passed to
  // `BackofficeShell`) only when neither has ever been uploaded.
  const resolvedLogoSrc = theme.logoLightUrl ?? theme.logoDarkUrl;
  const logo =
    resolvedLogoSrc !== null
      ? {
          lightSrc: theme.logoLightUrl ?? resolvedLogoSrc,
          darkSrc: theme.logoDarkUrl ?? resolvedLogoSrc,
          alt: theme.appTitle,
        }
      : undefined;

  // Best-effort only — see the module comment above. `UnauthenticatedError` and
  // `PlatformOperatorDeniedError` both collapse to "nothing to show," never a thrown
  // error, so a signed-out or ordinary-tenant visitor sees the same chrome as ever.
  let user: { readonly displayName: string } | undefined;
  let isPlatformOperator = false;
  try {
    await withStaffAuth(async ({ principal }) => {
      user = { displayName: principal.displayName };
      try {
        await new RequirePlatformOperator({
          tenantProfile: new PrismaTenantProfileReader(),
        }).execute(principal, "backoffice.nav (visibility)");
        isPlatformOperator = true;
      } catch (error) {
        if (!(error instanceof PlatformOperatorDeniedError)) throw error;
      }
    });
  } catch (error) {
    if (!(error instanceof UnauthenticatedError)) throw error;
  }

  const navItems: readonly AppShellNavItem[] = [
    { href: `/${locale}/command-centre`, label: t("nav.commandCentre"), group: "admin" },
    { href: `/${locale}/agents`, label: t("nav.agents"), group: "admin" },
    { href: `/${locale}/ai-settings`, label: t("nav.aiSettings"), group: "admin" },
    { href: `/${locale}/tools`, label: t("nav.tools"), group: "admin" },
    { href: `/${locale}/orchestrator`, label: t("nav.orchestrator"), group: "admin" },
    { href: `/${locale}/knowledge`, label: t("nav.knowledge"), group: "admin" },
    { href: `/${locale}/iam`, label: t("nav.iam"), group: "admin" },
    { href: `/${locale}/channels`, label: t("nav.channels"), group: "admin" },
    { href: `/${locale}/escalations`, label: t("nav.escalations"), group: "admin" },
    { href: `/${locale}/evaluation`, label: t("nav.evaluation"), group: "admin" },
    { href: `/${locale}/governance`, label: t("nav.governance"), group: "admin" },
    { href: `/${locale}/guardrails`, label: t("nav.guardrails"), group: "admin" },
    ...(isPlatformOperator
      ? [{ href: `/${locale}/tenants`, label: t("nav.platformConsole"), group: "admin" as const }]
      : []),
  ];

  // Real, per-request mechanism (replaces the earlier hardcoded `/iam` — see git
  // history): a layout has no built-in way to read the request's own pathname
  // server-side (`usePathname()` is client-only), so `BackofficeShell` itself resolves
  // `activeHref` from a live `usePathname()` read rather than the server passing one
  // down. `navItems` is still supplied here since it needs translated labels.
  return (
    <BackofficeShell
      navItems={navItems}
      breadcrumbLabel={t("breadcrumbRoot")}
      locale={locale}
      logo={logo}
      initialThemeMode={theme.mode}
      assistantGroupLabel={t("assistantGroupLabel")}
      adminGroupLabel={t("adminGroupLabel")}
      breadcrumbAriaLabel={t("breadcrumbAriaLabel")}
      localeSwitchLabel={t("localeSwitchLabel")}
      themeSwitchLabel={t("themeSwitchLabel")}
      lightModeLabel={t("lightMode")}
      darkModeLabel={t("darkMode")}
      systemModeLabel={t("systemMode")}
      collapseLabel={t("collapseSidebar")}
      expandLabel={t("expandSidebar")}
      helpLabel={t("helpLabel")}
      skipLinkLabel={t("skipLinkLabel")}
      user={user}
      onSignOut={signOutAction}
      userMenuLabel={t("userMenuLabel")}
      signOutLabel={t("signOutLabel")}
    >
      {children}
    </BackofficeShell>
  );
}
