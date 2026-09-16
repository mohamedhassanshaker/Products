import { hasLocale } from "next-intl";
import { getRequestConfig } from "next-intl/server";
import { routing } from "./routing.js";

/**
 * Per-request i18n config, read by next-intl on every render
 * (architecture.md §9, design-system.md §11.2).
 *
 * `requestLocale` is marked `@deprecated` in next-intl's own types in favour
 * of `next/root-params` — but on the Next.js version this repo is pinned to
 * (15.5.25), `next/root-params` is still an unreplaced compiler placeholder
 * (its own shipped source throws "this is a bug in Next.js" if ever
 * executed), not a usable API. `requestLocale` remains fully supported and is
 * the correct choice until root params actually ships; verified by reading
 * both packages' installed source rather than assumed from the deprecation
 * notice alone.
 */
export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale;

  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
