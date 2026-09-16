import type { HelpGuideShellNavGroup } from "@/components/patterns/help-guide-shell";
import { getGuideNav } from "../../../modules/userguide/application/get-guide-nav.js";
import type { GuideLocale } from "../../../modules/userguide/domain/guide-content.js";
import type { GuideModuleGroup } from "../../../modules/userguide/domain/guide-registry.js";

export interface GroupLabels {
  readonly admin: string;
  readonly settings: string;
  readonly citizen: string;
  readonly platform: string;
}

/**
 * Resolves `getGuideNav`'s pure, translation-free groups into `HelpGuideShell`'s own
 * `HelpGuideShellNavGroup[]` shape — translating each `GuideModuleGroup` into this locale's
 * real label (`messages/*.json`'s `help.adminGroupLabel` etc.) and turning each item's slug
 * into the real deep-link `href` (`/{locale}/help/{slug}`) both real pages
 * (`help/page.tsx`, `help/[...slug]/page.tsx`) need identically.
 */
export function buildNavGroups(
  locale: string,
  query: string,
  labels: GroupLabels,
): readonly HelpGuideShellNavGroup[] {
  const groupLabelByKey: Record<GuideModuleGroup, string> = {
    admin: labels.admin,
    settings: labels.settings,
    citizen: labels.citizen,
    platform: labels.platform,
  };

  return getGuideNav(locale as GuideLocale, query).map((group) => ({
    label: groupLabelByKey[group.group],
    items: group.items.map((item) => ({
      slug: item.slug,
      href: `/${locale}/help/${item.slug}`,
      label: item.label,
    })),
  }));
}
