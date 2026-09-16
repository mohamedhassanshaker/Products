import { getTranslations } from "next-intl/server";
import { SHARJAH_DEFAULT } from "@shj3/tokens";
import { UnauthenticatedError } from "../../../../../modules/iam/adapters/inbound/auth-middleware.js";
import { withStaffAuth } from "../../../../../modules/iam/adapters/inbound/next-request-context.js";
import { requirePermission } from "../../../../../modules/iam/application/require-permission.js";
import { PermissionDeniedError } from "../../../../../modules/iam/domain/permissions.js";
import type { Principal } from "../../../../../modules/platform/tenancy/tenant-context.js";
import { resetOwnPreferenceAction, resetTenantBrandingAction } from "./actions.js";

/**
 * `/settings/appearance/reset` — the escape hatch (design-system.md §9.2 rule 5).
 *
 * "Always exposed... a plain, unthemed HTML page styled from the shipped default
 * with inline critical CSS... the route ignores the tenant theme entirely." Two
 * constraints follow, both honoured deliberately rather than by omission:
 *
 *  1. Every colour on this page is a literal value read from `SHARJAH_DEFAULT`
 *     (`@shj3/tokens`) and written as inline `style` attributes — never a `var(--…)`
 *     custom property. The root layout's own `<style id="shj3-theme">` block still
 *     renders above this page in the document (this route lives under `[locale]/`,
 *     inheriting that layout, for a real, load-bearing reason — see the module note
 *     below) — but nothing on THIS page's own content depends on it, so a broken
 *     custom property value upstream cannot make this page illegible.
 *  2. The mutation is real (`ResetAppearance`), not decorative — see that module's
 *     own doc comment for the two independent actions and how each is gated.
 *
 * ## The `AsyncLocalStorage` fix (2026-09-09)
 *
 * This page used to call a bare `tryGetTenantContext()`, which — per the B-2 wave's
 * empirically-confirmed finding (`tasks/lessons.md`) that a Server Component never
 * inherits an ambient context bound elsewhere — never resolved a real principal on any
 * real request, silently. Fixed the same way `settings/appearance/page.tsx` and every
 * `(backoffice)` route already were: `withStaffAuth()` resolves a fresh context for
 * this render, and an unauthenticated visitor is a real, expected, non-error outcome
 * for THIS route specifically (unlike a gated backoffice screen) — the escape hatch
 * has to render *something* for someone with no session at all, hence the `catch`
 * below collapsing `UnauthenticatedError` into the same "no principal" state the page
 * already rendered around, rather than letting it propagate as an error boundary.
 *
 * ## Why this route still lives under `[locale]/`, not outside it
 *
 * Next.js's App Router needs exactly one ancestor layout rendering `<html>`/`<body>`
 * for any route, and `[locale]/layout.tsx` is that layout for this entire app (the
 * true root `app/layout.tsx` was deliberately deleted in B-1 — confirmed by a real
 * `next build`, per that wave's own review). Moving this one route outside
 * `[locale]/` to escape that layout's theme `<style>` block entirely would mean
 * giving it its own `<html>`/`<body>` shell, which Next.js does not allow two
 * sibling segments to do independently without restructuring the whole app's
 * layout hierarchy — a change with real blast radius (i18n routing, the
 * `DirectionProvider` wiring, both already built and verified) for one escape-hatch
 * page. Rule 1 above is what actually delivers "ignores the tenant theme": this
 * page's own legibility never depends on the ambient stylesheet, regardless of
 * which element in the tree that stylesheet is attached to.
 */

const COLORS = SHARJAH_DEFAULT.tokens;

const PAGE_STYLE: React.CSSProperties = {
  backgroundColor: COLORS.background,
  color: COLORS.foreground,
  fontFamily: "system-ui, -apple-system, sans-serif",
  minHeight: "100vh",
  padding: "2rem",
  margin: 0,
};

const CARD_STYLE: React.CSSProperties = {
  backgroundColor: COLORS.card,
  color: COLORS.cardForeground,
  border: `1px solid ${COLORS.border}`, // design-gate-allow: §9.2 rule 5 — this page is deliberately literal, independent of the token system
  borderRadius: "0.5rem",
  padding: "1.5rem",
  maxWidth: "32rem",
  marginBottom: "1rem",
};

const BUTTON_STYLE: React.CSSProperties = {
  backgroundColor: COLORS.primary,
  color: COLORS.primaryForeground,
  border: "none",
  borderRadius: "0.375rem",
  padding: "0.5rem 1rem",
  fontSize: "0.875rem",
  cursor: "pointer",
};

const MUTED_STYLE: React.CSSProperties = { color: COLORS.mutedForeground, fontSize: "0.8125rem" };

export default async function AppearanceResetPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations("appearanceReset");
  const tCommon = await getTranslations("common");
  const signInHref = `/${locale}/sign-in?next=${encodeURIComponent(`/${locale}/settings/appearance/reset`)}`;

  let canManageTenantAppearance = false;
  let principal: Principal | null = null;
  try {
    principal = await withStaffAuth(async ({ principal: resolved }) => {
      try {
        requirePermission(resolved, "appearance:manage", "settings.appearance.reset (visibility)");
        canManageTenantAppearance = true;
      } catch (error) {
        if (!(error instanceof PermissionDeniedError)) throw error;
      }
      return resolved;
    });
  } catch (error) {
    if (!(error instanceof UnauthenticatedError)) throw error;
    // No session at all — this route's own reason for existing (see the module note
    // above): render around it rather than error, same as before this fix.
  }

  return (
    <main style={PAGE_STYLE}>
      <h1 style={{ fontSize: "1.375rem", fontWeight: 600, marginBottom: "0.5rem" }}>
        {t("title")}
      </h1>
      <p style={{ ...MUTED_STYLE, marginBottom: "1.5rem" }}>{t("intro")}</p>

      <section style={CARD_STYLE}>
        <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "0.5rem" }}>
          {t("personalHeading")}
        </h2>
        <p style={{ ...MUTED_STYLE, marginBottom: "1rem" }}>{t("personalDescription")}</p>
        {principal ? (
          <form action={resetOwnPreferenceAction}>
            <button type="submit" style={BUTTON_STYLE}>
              {t("personalButton")}
            </button>
          </form>
        ) : (
          <>
            <p style={MUTED_STYLE}>{t("personalSignInPrompt")}</p>
            <a
              href={signInHref}
              style={{
                ...BUTTON_STYLE,
                display: "inline-block",
                textDecoration: "none",
                marginTop: "0.5rem",
              }}
            >
              {tCommon("signInCta")}
            </a>
          </>
        )}
      </section>

      <section style={CARD_STYLE}>
        <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "0.5rem" }}>
          {t("tenantHeading")}
        </h2>
        <p style={{ ...MUTED_STYLE, marginBottom: "1rem" }}>{t("tenantDescription")}</p>
        {canManageTenantAppearance ? (
          <form action={resetTenantBrandingAction}>
            <button type="submit" style={BUTTON_STYLE}>
              {t("tenantButton")}
            </button>
          </form>
        ) : (
          <>
            <p style={MUTED_STYLE}>
              {principal ? t("tenantNoPermission") : t("tenantSignInPrompt")}
            </p>
            {principal ? null : (
              <a
                href={signInHref}
                style={{
                  ...BUTTON_STYLE,
                  display: "inline-block",
                  textDecoration: "none",
                  marginTop: "0.5rem",
                }}
              >
                {tCommon("signInCta")}
              </a>
            )}
          </>
        )}
      </section>
    </main>
  );
}
