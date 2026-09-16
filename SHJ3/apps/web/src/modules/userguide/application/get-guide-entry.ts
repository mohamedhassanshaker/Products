import { GUIDE_REGISTRY, type GuideRegistryEntry } from "../domain/guide-registry.js";
import type { GuideLocale, GuidePageContent } from "../domain/guide-content.js";
import { CONTENT_BY_SLUG } from "../content/index.js";

export interface ResolvedGuideEntry {
  readonly registry: GuideRegistryEntry;
  readonly content: GuidePageContent;
}

/**
 * Resolve one guide entry by its deep-link slug (the `/help/[...slug]` catch-all's own
 * `params.slug.join("/")`) and locale. Returns `null` for an unknown slug — the route layer
 * turns that into a real 404 via `notFound()`, never a silent blank page.
 *
 * Pure and synchronous on purpose: both `CONTENT_BY_SLUG` and `GUIDE_REGISTRY` are plain,
 * already-imported modules (this is the "static content" seam `guide-content.ts`'s module
 * comment names — no I/O, so nothing here needs to be async, unlike every other module's
 * application-layer use cases that call a real port).
 */
export function getGuideEntry(slug: string, locale: GuideLocale): ResolvedGuideEntry | null {
  const registry = GUIDE_REGISTRY.find((entry) => entry.slug === slug);
  if (!registry) return null;

  const localized = CONTENT_BY_SLUG[slug];
  if (!localized) return null;

  return { registry, content: localized[locale] };
}
