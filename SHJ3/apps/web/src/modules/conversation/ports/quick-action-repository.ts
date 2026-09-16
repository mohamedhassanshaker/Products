/** Read-only access to `QuickActions` — the five config-driven suggestion chips (FR-CONV-03), owned by B7's flow/config screens elsewhere; this module only reads them. */

export interface QuickActionRow {
  readonly id: string;
  readonly label: string;
  readonly payloadIntentKey: string;
  readonly ordinal: number;
}

export interface QuickActionRepository {
  /** `channelScope IN ('All', channelKind)`, matching `localeCode`, `isEnabled = true`, ordered by `ordinal` (api.md §4.2's own wording). */
  listForChannel(channelKind: string, localeCode: string): Promise<readonly QuickActionRow[]>;
}
