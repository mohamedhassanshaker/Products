import { GUIDE_REGISTRY, type GuideModuleGroup } from "../domain/guide-registry.js";
import type { GuideLocale } from "../domain/guide-content.js";
import { CONTENT_BY_SLUG } from "../content/index.js";

export interface GuideNavItem {
  readonly slug: string;
  readonly label: string;
}

export interface GuideNavGroup {
  readonly group: GuideModuleGroup;
  readonly items: readonly GuideNavItem[];
}

/**
 * Build `HelpGuideShell`'s side-menu model for one locale — grouped and ordered exactly the
 * way `GUIDE_REGISTRY` declares, with each item's visible label taken from that locale's own
 * content title (never the slug itself, which is an identifier, not a translated string).
 *
 * A `query` filters items whose label OR slug contains it (case-insensitive) — this is what
 * `HelpGuideShell`'s search field drives. Filtering happens here, not by hiding DOM nodes in
 * the component, so a future non-React consumer (a sitemap generator, a future search index)
 * gets identical results from the same pure function.
 */
export function getGuideNav(locale: GuideLocale, query = ""): readonly GuideNavGroup[] {
  const normalizedQuery = query.trim().toLowerCase();

  const groups = new Map<GuideModuleGroup, GuideNavItem[]>();
  for (const entry of GUIDE_REGISTRY) {
    const localized = CONTENT_BY_SLUG[entry.slug];
    if (!localized) continue;
    const label = localized[locale].title;

    if (
      normalizedQuery !== "" &&
      !label.toLowerCase().includes(normalizedQuery) &&
      !entry.slug.toLowerCase().includes(normalizedQuery)
    ) {
      continue;
    }

    const bucket = groups.get(entry.moduleGroup) ?? [];
    bucket.push({ slug: entry.slug, label });
    groups.set(entry.moduleGroup, bucket);
  }

  // Fixed, deliberate group order — admin first (the bulk of the real screens), settings,
  // citizen, then platform (the platform operator's own console, a distinct persona
  // reached separately from either) — rather than object-key insertion order, which JS
  // does not guarantee for a `Map` built by iterating an array in an arbitrary future
  // edit order.
  const GROUP_ORDER: readonly GuideModuleGroup[] = ["admin", "settings", "citizen", "platform"];

  return GROUP_ORDER.filter((group) => groups.has(group)).map((group) => {
    const items = groups.get(group) ?? [];
    const entryOrder = new Map(GUIDE_REGISTRY.map((entry) => [entry.slug, entry.order]));
    const sorted = [...items].sort(
      (a, b) => (entryOrder.get(a.slug) ?? 0) - (entryOrder.get(b.slug) ?? 0),
    );
    return { group, items: sorted };
  });
}
