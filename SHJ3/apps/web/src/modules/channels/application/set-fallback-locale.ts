import type { LocaleRepository } from "../ports/locale-repository.js";

/** `POST /channels/locales/{code}/fallback` (B10 tab 5 `Set as fallback`). "Setting a new
 *  one clears the old in the same transaction" — the repository does both writes together;
 *  this use case adds nothing beyond passing the call through, since there is no further
 *  business rule at this layer (the "must be enabled" guard lives in the repository, right
 *  where it can lean on the real filtered unique index rather than duplicate the check). */
export class SetFallbackLocale {
  constructor(private readonly deps: { readonly locales: LocaleRepository }) {}

  async execute(input: { readonly localeCode: string; readonly now: Date }): Promise<void> {
    await this.deps.locales.setFallback(input.localeCode, input.now);
  }
}
