import type { ChannelAvailability, ChannelKey, ChannelState } from "../domain/vocabulary.js";

/** B10 tab 1's one row per surface. */
export interface ChannelRow {
  readonly id: string;
  readonly key: ChannelKey;
  readonly displayName: string;
  readonly boundAgentId: string | null;
  readonly boundAgentName: string | null;
  readonly state: ChannelState;
  readonly availability: ChannelAvailability;
  readonly workingHoursProfileId: string | null;
}

export interface UpdateChannelInput {
  readonly id: string;
  readonly state: ChannelState;
  readonly boundAgentId: string | null;
  readonly now: Date;
}

export interface CreateDefaultChannelInput {
  readonly key: ChannelKey;
  readonly displayName: string;
  readonly now: Date;
}

export interface ChannelRepository {
  list(): Promise<readonly ChannelRow[]>;
  findById(id: string): Promise<ChannelRow | null>;
  /** Throws if the update would violate `CK_Channels_liveNeedsAgent` — callers pre-check
   *  via `boundAgentId` before calling, but the database is the real backstop. */
  update(input: UpdateChannelInput): Promise<void>;
  /** Count of still-open (`outcome = 'Active'`) conversations on this channel — the
   *  `meta.openConversations` api.md's `PATCH /channels/{id}` returns when disabling. */
  countOpenConversations(channelKey: ChannelKey): Promise<number>;
  /**
   * Insert one of B10 tab 1's fixed four rows (`CHANNEL_KEYS` — a closed enum, not a
   * user-defined catalogue: there is no "add channel" affordance anywhere in this product,
   * confirmed against `channels-tab.tsx`), always `Disabled`, with no bound agent and no
   * channel-specific config — the same shape `seed-channels-demo-data.ts` hand-seeds for the
   * `sewa` demo tenant, now real tenant-provisioning logic
   * (`ProvisionDefaultChannelsForTenant`). Callers are responsible for checking `list()`
   * first and only calling this for a key not already present — this method does not
   * re-check, mirroring every other `create`-shaped method on a sibling port in this module
   * (e.g. `CampaignRepository.create`). Returns the created row (its `id` is what
   * `ProvisionDefaultChannelsForTenant` needs to also provision `WebWidget`'s default
   * `WidgetConfig` in the same pass) rather than `void`, again matching `CampaignRepository
   * .create`'s own convention.
   */
  createDefault(input: CreateDefaultChannelInput): Promise<ChannelRow>;
}
