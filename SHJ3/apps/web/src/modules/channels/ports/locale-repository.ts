/**
 * B10 tab 5. `LocaleSetting` (tenant-scoped: enabled, voice, coverage, fallback) joined with
 * `platform.Locale` (platform-scoped: english/native name, **direction**) — two separate
 * generated Prisma clients (ADR-0011), joined in the adapter rather than the database.
 *
 * Direction is deliberately absent from `UpdateLocaleInput`: `platform.Locale.direction` is
 * that model's own concern (`LocaleSetting`'s own doc comment on the cross-schema FK), a
 * platform-wide fact about the locale itself rather than a per-tenant setting — a tenant
 * screen edits voice and fallback, and reads direction, never writes it.
 */
export interface LocaleRow {
  readonly localeCode: string;
  readonly englishName: string;
  readonly nativeName: string;
  readonly direction: "LTR" | "RTL";
  readonly isEnabled: boolean;
  readonly voiceName: string | null;
  /** Computed persisted column (`LocaleSettings.translatedPercent`) — never written. */
  readonly translatedPercent: number;
  readonly translatedStringCount: number;
  readonly totalStringCount: number;
  readonly isFallback: boolean;
}

export interface UpdateLocaleInput {
  readonly localeCode: string;
  readonly voiceName: string | null;
  readonly isEnabled: boolean;
  readonly now: Date;
}

export interface LocaleCoverageRow {
  readonly stringKey: string;
  readonly state: "Missing" | "Draft" | "Translated" | "Reviewed";
}

export interface LocaleRepository {
  list(): Promise<readonly LocaleRow[]>;
  update(input: UpdateLocaleInput): Promise<void>;
  /** Sets `localeCode` as the sole fallback, clearing any previous one, in one transaction —
   *  matching api.md's "setting a new one clears the old in the same transaction." Throws
   *  `ChannelsError("channels.fallback_locale_required")` if `localeCode` is not `isEnabled`,
   *  since `CK_LocaleSettings_fallbackMustBeEnabled` would refuse it at the database anyway. */
  setFallback(localeCode: string, now: Date): Promise<void>;
  coverageFor(localeCode: string): Promise<readonly LocaleCoverageRow[]>;
}
