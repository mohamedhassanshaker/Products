import type { ChannelsReason } from "../domain/errors.js";
import type { LocaleRepository } from "../ports/locale-repository.js";

export interface UpdateLocaleInput {
  readonly localeCode: string;
  readonly voiceName: string | null;
  readonly isEnabled: boolean;
  readonly now: Date;
}

export type UpdateLocaleResult =
  { readonly ok: true } | { readonly ok: false; readonly reason: ChannelsReason };

/**
 * `PATCH /channels/locales/{code}` (B10 tab 5: "Set voice or direction"). Direction itself
 * is NOT written here — `platform.Locale.direction` is that model's own concern
 * (`LocaleSetting`'s doc comment on the cross-schema FK), a platform-wide fact about the
 * locale rather than a per-tenant setting, so this screen reads it (`ListLocales`) but never
 * edits it. What this action actually edits is voice and enabled state.
 *
 * "Clearing the only fallback → `422 channels.fallback_locale_required`" (api.md §6.9):
 * disabling the locale that currently holds the sole fallback designation would leave the
 * tenant with zero fallback locales the instant `CK_LocaleSettings_fallbackMustBeEnabled`
 * forces `isFallback` back to `0` — refused here, before the write, rather than after.
 */
export class UpdateLocale {
  constructor(private readonly deps: { readonly locales: LocaleRepository }) {}

  async execute(input: UpdateLocaleInput): Promise<UpdateLocaleResult> {
    if (!input.isEnabled) {
      const current = (await this.deps.locales.list()).find(
        (l) => l.localeCode === input.localeCode,
      );
      if (current?.isFallback) {
        return { ok: false, reason: "channels.fallback_locale_required" };
      }
    }

    await this.deps.locales.update({
      localeCode: input.localeCode,
      voiceName: input.voiceName,
      isEnabled: input.isEnabled,
      now: input.now,
    });
    return { ok: true };
  }
}
