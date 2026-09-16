import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { UnauthenticatedError } from "../../../modules/iam/adapters/inbound/auth-middleware.js";
import { withStaffAuth } from "../../../modules/iam/adapters/inbound/next-request-context.js";
import { signOutAction } from "../sign-in/actions.js";

/**
 * `(platform-admin)` — the platform operator's own console (Part E of the
 * platform-admin wave). Parallel to `(backoffice)`, not nested inside it:
 * `(backoffice)/layout.tsx` renders one tenant's OWN resolved branding
 * (`resolveThemeForRequest`/`BackofficeShell`), and a platform operator's
 * screens must look identical regardless of which tenant they are currently
 * viewing or editing (Part D) — even though the operator's own session is,
 * technically, bound to the real Platform tenant (`sharjah`, Part B). So this
 * layout deliberately never calls `resolveThemeForRequest`: fixed, neutral
 * chrome, not tenant chrome.
 *
 * No *authorization* check lives here, matching `(backoffice)/layout.tsx`'s own
 * documented reasoning exactly: a layout-bound `AsyncLocalStorage` context
 * does not survive to a nested page render or Server Action (confirmed
 * empirically for that layout, and unchanged since). Every real page under
 * this layout (`tenants/page.tsx`, `branding/page.tsx`) calls `withStaffAuth()`
 * and `requirePlatformOperator()` itself. This shell's nav is visibility only —
 * the real enforcement is server-side, in every page and action.
 *
 * This layout DOES call `withStaffAuth()` once itself, read-only, purely to show
 * "Signed in as {name}" and a real Sign out control — the exact same gap-closing this
 * wave's own `(backoffice)/layout.tsx` addresses, and for the identical reason: a
 * platform operator landing here had no visible way to tell who they were signed in
 * as or how to end the session. `UnauthenticatedError` here renders the header with
 * no user info at all — the page underneath still renders its own sign-in prompt.
 * The Sign out control is a plain server-rendered `<form>`, not a client component:
 * after it runs, Next re-renders this route's Server Components, and the nested
 * page's own `withStaffAuth()` call then sees no session and renders its own
 * unauthenticated state — no client-side navigation needed.
 */
export default async function PlatformAdminLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations("platformAdmin");

  let displayName: string | undefined;
  try {
    await withStaffAuth(async ({ principal }) => {
      displayName = principal.displayName;
    });
  } catch (error) {
    if (!(error instanceof UnauthenticatedError)) throw error;
  }

  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <header className="border-b border-border">
        <div className="flex items-center justify-between gap-6 px-6 py-3">
          <div className="flex items-center gap-6">
            <span className="text-sm font-semibold">{t("consoleTitle")}</span>
            <nav className="flex gap-4 text-sm">
              <Link href={`/${locale}/tenants`} className="text-muted-foreground hover:text-foreground">
                {t("nav.tenants")}
              </Link>
              <Link href={`/${locale}/branding`} className="text-muted-foreground hover:text-foreground">
                {t("nav.branding")}
              </Link>
              <Link href={`/${locale}/command-centre`} className="text-muted-foreground hover:text-foreground">
                {t("nav.backToBackoffice")}
              </Link>
            </nav>
          </div>
          {displayName ? (
            <div className="flex items-center gap-3 text-sm">
              <span className="text-muted-foreground">{t("signedInAs", { name: displayName })}</span>
              <form action={signOutAction}>
                <button type="submit" className="text-foreground underline">
                  {t("signOutLabel")}
                </button>
              </form>
            </div>
          ) : null}
        </div>
      </header>
      <main className="flex-1 p-6">{children}</main>
    </div>
  );
}
