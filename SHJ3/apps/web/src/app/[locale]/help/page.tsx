import { getTranslations } from "next-intl/server";
import { buildNavGroups } from "./build-nav-groups.js";
import { HelpPageShell } from "./help-page-shell.js";

/**
 * `/help` — the index of the user-guide module (design-system.md §5.5 #56, Phase F).
 *
 * ## Deliberately public — a flagged, reasoned judgment call
 *
 * Every other real route this wave links from (`/iam`, `/agents`, ...) is gated behind
 * `withStaffAuth()`. This one is not, on purpose: the guide's own content is documentation
 * about how to use a screen, never the screen's actual tenant data — the real screens stay
 * exactly as protected as they already are (`requirePermission()` calls untouched), whether
 * or not their existence and usage is publicly documented. Treating internal product
 * documentation as itself sensitive would force a second, harder design (a staff-only guide
 * tree plus a separately-gated citizen-facing subset) for no real security benefit — the
 * same trade real products make constantly (a SaaS product's own public help centre
 * describes admin screens nobody outside the company can actually reach). It is also what
 * lets the one citizen-facing entry (`citizen-widget`) live in the same module instead of a
 * second, parallel route tree — see that entry's own content file for the "why one public
 * module, not a staff tree plus a separate public one" reasoning restated from the content
 * side.
 */
export default async function HelpIndexPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const { locale } = await params;
  const { q } = await searchParams;
  const query = q ?? "";
  const t = await getTranslations("help");

  const navGroups = buildNavGroups(locale, query, {
    admin: t("adminGroupLabel"),
    settings: t("settingsGroupLabel"),
    citizen: t("citizenGroupLabel"),
    platform: t("platformGroupLabel"),
  });

  return (
    <HelpPageShell
      navGroups={navGroups}
      activeSlug={null}
      guideTitle={t("pageTitle")}
      breadcrumb={[{ label: t("breadcrumbRoot") }]}
      breadcrumbAriaLabel={t("breadcrumbAriaLabel")}
      searchAriaLabel={t("searchAriaLabel")}
      searchPlaceholder={t("searchPlaceholder")}
      noResultsLabel={t("noResultsLabel")}
      query={query}
    >
      <h1 className="text-xl font-semibold text-foreground">{t("pageTitle")}</h1>
      <p className="text-sm text-muted-foreground" style={{ marginTop: "var(--space-2)" }}>
        {t("indexIntro")}
      </p>
    </HelpPageShell>
  );
}
