/**
 * Read-only access to `Channels`/`WidgetConfigs`/`WidgetAllowedDomains` — all
 * three owned (written) by the backoffice channels module running in
 * parallel this same wave; this module only ever reads them (per this
 * module's own brief: "read-only for you").
 */

export interface WidgetChannelRow {
  readonly channelId: string;
  /** `WebWidget` | `WhatsApp` | `MobileApp` | `KioskIvr`. */
  readonly key: string;
  /** `Live` | `Disabled`. */
  readonly state: string;
  readonly boundAgentId: string | null;
}

export interface WidgetConfigRow {
  readonly accentTokenKey: string;
  /** `BottomRight` | `BottomLeft`. */
  readonly launcherPosition: string;
  /** `Docked` | `Expanded`. */
  readonly defaultState: string;
  readonly disclaimerText: string;
  readonly greetingText: string;
  readonly composerPlaceholder: string;
  readonly showDisclaimerDismiss: boolean;
}

export interface WidgetChannelRepository {
  /** By channel *kind* (`"WebWidget"` | `"WhatsApp"`) within the already-bound tenant — null if the channel row does not exist for this tenant at all. */
  findChannelByKind(channelKind: string): Promise<WidgetChannelRow | null>;
  findWidgetConfig(channelId: string): Promise<WidgetConfigRow | null>;
  /** Raw `domain` values (may include `*.`-prefixed wildcard entries) — see `domain/origin-allowlist.ts` for how they're matched. */
  listAllowedDomains(channelId: string): Promise<readonly string[]>;
}
