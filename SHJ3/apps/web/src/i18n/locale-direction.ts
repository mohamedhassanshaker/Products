/**
 * `dir` per locale (design-system.md §11.2) — a lookup, not a ternary chain, so a
 * third locale added to `routing.locales` fails to compile here until its direction
 * is declared, rather than silently defaulting to `"ltr"`.
 *
 * Extracted from `[locale]/layout.tsx`'s own inline table (added for the SkinEditor
 * wave, 2026-09-09): a SECOND real caller now needs the identical mapping —
 * `settings/appearance/page.tsx` derives a sensible starting `defaultDirection` for a
 * tenant's first-ever `TenantBranding` row from the admin's OWN current locale,
 * rather than silently hardcoding `"LTR"` (which would flip an Arabic-locale tenant's
 * default direction the moment any admin saved an unrelated appearance setting — a
 * real, subtle bug this project's own Arabic-parity concerns make worth avoiding).
 * One shared source rather than two hand-typed copies that could drift.
 */

import type { routing } from "./routing.js";

export type AppLocale = (typeof routing.locales)[number];

const LOCALE_DIRECTIONS: Record<AppLocale, "ltr" | "rtl"> = {
  en: "ltr",
  ar: "rtl",
};

/** The lowercase CSS `dir` value for a locale (`"ltr"` / `"rtl"`). */
export function cssDirectionForLocale(locale: AppLocale): "ltr" | "rtl" {
  return LOCALE_DIRECTIONS[locale];
}

/** The uppercase `DbDirection` form the theming module's rows and scalars use
 *  (`"LTR"` / `"RTL"`) — `modules/theming/domain/theme.ts`'s own `DbDirection`. */
export function dbDirectionForLocale(locale: AppLocale): "LTR" | "RTL" {
  return cssDirectionForLocale(locale) === "rtl" ? "RTL" : "LTR";
}
