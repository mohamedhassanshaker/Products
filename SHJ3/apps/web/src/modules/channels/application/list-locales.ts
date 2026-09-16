import type { LocaleRepository, LocaleRow } from "../ports/locale-repository.js";

/** `GET /channels/locales` (B10 tab 5). */
export class ListLocales {
  constructor(private readonly deps: { readonly locales: LocaleRepository }) {}

  async execute(): Promise<{ readonly rows: readonly LocaleRow[] }> {
    return { rows: await this.deps.locales.list() };
  }
}
