import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getGuideEntry } from "../../../../modules/userguide/application/get-guide-entry.js";
import type { GuideLocale } from "../../../../modules/userguide/domain/guide-content.js";
import { buildNavGroups } from "../build-nav-groups.js";
import { HelpPageShell } from "../help-page-shell.js";
import { HelpEntryView } from "../help-entry-view.js";

/**
 * `/help/[...slug]` — one real, deep-linkable URL per guide entry (e.g. `/en/help/agents/
 * wizard`, `/en/help/settings/appearance`) — a catch-all rather than one file per entry
 * because `GUIDE_REGISTRY`'s slugs are themselves multi-segment (`"agents/wizard"`,
 * `"settings/appearance/reset"`); a fixed-depth `[slug]` route could not represent them.
 *
 * `notFound()` for an unknown slug is a real Next.js 404, not a silently-empty guide page —
 * matching how every other real route in this app treats an invalid identifier.
 */
export default async function HelpEntryPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; slug: string[] }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const { locale, slug } = await params;
  const { q } = await searchParams;
  const query = q ?? "";
  const t = await getTranslations("help");

  const resolvedSlug = slug.join("/");
  const entry = getGuideEntry(resolvedSlug, locale as GuideLocale);
  if (!entry) notFound();

  const navGroups = buildNavGroups(locale, query, {
    admin: t("adminGroupLabel"),
    settings: t("settingsGroupLabel"),
    citizen: t("citizenGroupLabel"),
    platform: t("platformGroupLabel"),
  });

  return (
    <HelpPageShell
      navGroups={navGroups}
      activeSlug={resolvedSlug}
      guideTitle={t("pageTitle")}
      breadcrumb={[
        { label: t("breadcrumbRoot"), href: `/${locale}/help` },
        { label: entry.content.title },
      ]}
      breadcrumbAriaLabel={t("breadcrumbAriaLabel")}
      searchAriaLabel={t("searchAriaLabel")}
      searchPlaceholder={t("searchPlaceholder")}
      noResultsLabel={t("noResultsLabel")}
      query={query}
    >
      <HelpEntryView
        content={entry.content}
        labels={{
          featureWalkthroughHeading: t("featureWalkthroughHeading"),
          howToHeading: t("howToHeading"),
          permissionsHeading: t("permissionsHeading"),
          lastVerifiedLabel: t("lastVerifiedLabel"),
        }}
      />
    </HelpPageShell>
  );
}
