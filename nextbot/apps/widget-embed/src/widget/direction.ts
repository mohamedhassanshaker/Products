/**
 * D7 fix (QA fix pass): resolves the widget's effective text direction for
 * whichever language is *currently active in this session* — re-evaluated every
 * time the active language changes (`store.ts`'s `language` field), not computed
 * once from the static embed config at mount and then frozen for the rest of the
 * session (the original bug: switching languages in the Language Selection Modal
 * never re-derived `dir`, so an RTL language never actually mirrored the layout).
 *
 * A host page's explicit `direction: "ltr" | "rtl"` embed override (`NextBot.init({
 * direction: ... })`) is a deliberate fixed choice and always wins outright —
 * only `"auto"`/absent falls through to language-based auto-detection.
 *
 * **Scope note (documented, not silently dropped):** this only fixes the
 * `dir`-mirroring reactivity itself — a full translation dictionary for the
 * spec's 40+ supported languages is out of scope for this fix pass (visible
 * strings stay in whatever language they were authored in; only the logical
 * reading direction changes).
 */

/** ISO 639-1/639-2 base subtags whose scripts read right-to-left. Not
 * exhaustive of every language NextBot might ever support, but covers every
 * commonly-deployed RTL language family (Arabic, Hebrew, Persian/Farsi, Urdu,
 * and the other widely-used RTL scripts) rather than just the two languages
 * `LanguageModal.tsx` currently offers a picker for. */
const RTL_LANGUAGE_PREFIXES: ReadonlySet<string> = new Set([
  "ar", // Arabic
  "he", // Hebrew
  "fa", // Persian/Farsi
  "ur", // Urdu
  "ps", // Pashto
  "sd", // Sindhi
  "ug", // Uyghur
  "yi", // Yiddish
  "dv", // Divehi
  "ckb", // Central Kurdish (Sorani)
]);

/**
 * @param configDirection the embed config's static `direction` field (`"auto"`,
 *   `"ltr"`, `"rtl"`, or absent).
 * @param language the BCP-47 (or plain two/three-letter) language code currently
 *   active in this session (`store.ts`'s `language` state — reflects the
 *   Language Selection Modal's live selection, not just the initial embed config).
 */
export function resolveDirection(configDirection: "auto" | "ltr" | "rtl" | undefined, language: string): "ltr" | "rtl" {
  if (configDirection === "ltr" || configDirection === "rtl") return configDirection;
  const base = language.split("-")[0]?.toLowerCase() ?? "";
  return RTL_LANGUAGE_PREFIXES.has(base) ? "rtl" : "ltr";
}
