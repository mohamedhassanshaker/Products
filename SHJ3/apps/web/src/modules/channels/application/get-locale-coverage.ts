import type { LocaleRepository } from "../ports/locale-repository.js";

export interface LocaleCoverageSummary {
  readonly localeCode: string;
  readonly missing: number;
  readonly draft: number;
  readonly translated: number;
  readonly reviewed: number;
  readonly total: number;
}

/**
 * `GET /channels/locales/{code}/coverage` (B10 tab 5 -> B13 tab 3: "the mechanism behind the
 * locale gate"). Returns the per-state string counts this tenant's `TranslationStrings`
 * actually hold.
 *
 * Deliberately narrower than api.md's own description ("translation coverage by surface, and
 * the agents whose publish is blocked by it"): `TranslationStrings` has no "surface" column
 * to break the count down by (checked the real schema before promising a dimension it cannot
 * answer), and joining to "which agents are blocked" is B13's own agent-publish-gate concern
 * in a different module, out of this wave's file scope. What is returned here — real,
 * accurate per-state counts for the requested locale — is the actual data B13's gate would
 * need to consult; wiring that cross-module join is left for whichever wave builds B13's own
 * publish check.
 */
export class GetLocaleCoverage {
  constructor(private readonly deps: { readonly locales: LocaleRepository }) {}

  async execute(localeCode: string): Promise<LocaleCoverageSummary> {
    const rows = await this.deps.locales.coverageFor(localeCode);
    const summary: LocaleCoverageSummary = {
      localeCode,
      missing: rows.filter((r) => r.state === "Missing").length,
      draft: rows.filter((r) => r.state === "Draft").length,
      translated: rows.filter((r) => r.state === "Translated").length,
      reviewed: rows.filter((r) => r.state === "Reviewed").length,
      total: rows.length,
    };
    return summary;
  }
}
