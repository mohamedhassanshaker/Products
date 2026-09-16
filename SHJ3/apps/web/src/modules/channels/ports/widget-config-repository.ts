import type { LauncherPosition, WidgetDefaultState } from "../domain/vocabulary.js";

export interface WidgetConfigRow {
  readonly id: string;
  readonly channelId: string;
  /** A design-token key (`--chart-1`), never a colour literal — `CK_WidgetConfigs_accentIsToken`. */
  readonly accentTokenKey: string;
  readonly launcherPosition: LauncherPosition;
  readonly defaultState: WidgetDefaultState;
  readonly disclaimerText: string;
  readonly greetingText: string;
  readonly composerPlaceholder: string;
  readonly showDisclaimerDismiss: boolean;
  readonly embedSnippetVersion: number;
}

export interface UpdateWidgetConfigInput {
  readonly channelId: string;
  readonly accentTokenKey: string;
  readonly launcherPosition: LauncherPosition;
  readonly defaultState: WidgetDefaultState;
  readonly disclaimerText: string;
  readonly greetingText: string;
  readonly composerPlaceholder: string;
  readonly showDisclaimerDismiss: boolean;
  readonly now: Date;
}

export interface WidgetAllowedDomainRow {
  readonly id: string;
  readonly domain: string;
  readonly addedByStaffUserId: string;
  readonly addedAt: Date;
}

export interface CreateDefaultWidgetConfigInput {
  readonly channelId: string;
  readonly now: Date;
}

export interface WidgetConfigRepository {
  findByChannelId(channelId: string): Promise<WidgetConfigRow | null>;
  /** Bumps `embedSnippetVersion` so a `PUT` "returns the recomputed embed snippet" and the
   *  live preview and the snippet can never disagree (api.md §6.9). */
  update(input: UpdateWidgetConfigInput): Promise<WidgetConfigRow>;
  /**
   * Insert B10 tab 2's own defaults (`accentTokenKey` default `--chart-1` — the design token
   * behind the wireframe's `#1F6F5C` swatch, never the hex literal itself,
   * `CK_WidgetConfigs_accentIsToken` — Bottom right, Docked, the wireframe's own literal
   * `Ask SHJ3 Assistant` composer placeholder, a generic disclaimer/greeting tied to no
   * tenant) for a `WebWidget` channel that has none yet.
   *
   * `update()` is a strict update (Prisma's own semantics, `WHERE channelId = …`), not an
   * upsert — before this method existed there was no path at all to create the *first*
   * `WidgetConfig` row for a channel, which is exactly why a freshly-provisioned tenant's
   * widget studio showed "not provisioned" with no way to fix it (`WidgetStudioTab` only
   * ever mounts once a row already exists). Called by
   * `ProvisionDefaultChannelsForTenant` right after the `WebWidget` channel itself is
   * created — never for `WhatsApp`, which has no safe default (a real phone number/BSP
   * account cannot be fabricated) and is intentionally left "not provisioned" until an
   * operator supplies real credentials.
   */
  createDefault(input: CreateDefaultWidgetConfigInput): Promise<void>;
  listAllowedDomains(channelId: string): Promise<readonly WidgetAllowedDomainRow[]>;
  addAllowedDomain(input: {
    readonly channelId: string;
    readonly domain: string;
    readonly addedByStaffUserId: string;
    readonly now: Date;
  }): Promise<WidgetAllowedDomainRow>;
  removeAllowedDomain(channelId: string, domain: string): Promise<void>;
}
