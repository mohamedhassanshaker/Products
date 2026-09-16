import { defineRouting } from "next-intl/routing";

/**
 * Central i18n routing config (architecture.md §9, design-system.md §11).
 *
 * `locales`/`defaultLocale` are the two locales this wave wires up end to
 * end; a third locale is not on the roadmap but would only require adding it
 * here plus its `messages/<locale>.json` catalogue and a `dir` entry in
 * `[locale]/layout.tsx`'s lookup map.
 *
 * `localePrefix: "always"` — every URL carries its locale explicitly
 * (`/en/...`, `/ar/...`), rather than leaving the default locale unprefixed
 * ("as-needed"). Chosen because both surfaces this config drives are ones a
 * bare, locale-less URL would be actively misleading for: the assistant
 * widget is embedded inside sharjah.ae (so its own URL identity matters once
 * it's addressed directly, e.g. for the WhatsApp deep link), and the
 * backoffice is bookmarked and shared between staff. With `"as-needed"`,
 * hitting "/" resolves to whichever locale the cookie or `Accept-Language`
 * header negotiates to — the URL alone can't tell you which locale you're
 * looking at. `"always"` makes every URL self-describing and is also this
 * package's own default, so nothing here overrides library behaviour.
 */
export const routing = defineRouting({
  locales: ["en", "ar"],
  defaultLocale: "en",
  localePrefix: "always",
});
