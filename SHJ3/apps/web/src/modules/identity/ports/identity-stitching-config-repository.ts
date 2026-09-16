/**
 * `IdentityStitchingConfigs` — the singleton row for B11 tab 5's on/off,
 * stitching key and conversation-memory *scope* (not lifetime — RISK-022,
 * `docs/data-model.md` §4.11: `memoryRetentionDays` was retired here by
 * product-owner decision, `PrivacyConfigs.transcriptRetention` is now the
 * single retention authority).
 *
 * `CK_IdentityStitchingConfigs_neverStitchCoherent` makes "stitch on, key =
 * never" a contradiction the database itself refuses, not merely a UI
 * validation.
 */

export const STITCHING_KEYS = ["VerifiedEmiratesIdHash", "MobileNumber", "NeverStitch"] as const;
export type StitchingKey = (typeof STITCHING_KEYS)[number];

export const CONVERSATION_MEMORY_SCOPES = [
  "PerVerifiedIdentity",
  "PerChannelSession",
  "NoMemory",
] as const;
export type ConversationMemoryScope = (typeof CONVERSATION_MEMORY_SCOPES)[number];

export interface IdentityStitchingConfigRow {
  readonly stitchAcrossChannels: boolean;
  readonly stitchingKey: StitchingKey;
  readonly conversationMemoryScope: ConversationMemoryScope;
}

export type SetStitchingConfigResult =
  | { readonly ok: true; readonly config: IdentityStitchingConfigRow }
  | { readonly ok: false; readonly reason: "identity.stitching_config_incoherent" };

export interface IdentityStitchingConfigRepository {
  get(): Promise<IdentityStitchingConfigRow>;
  set(input: {
    readonly stitchAcrossChannels: boolean;
    readonly stitchingKey: StitchingKey;
    readonly conversationMemoryScope: ConversationMemoryScope;
    readonly now: Date;
  }): Promise<SetStitchingConfigResult>;
}
