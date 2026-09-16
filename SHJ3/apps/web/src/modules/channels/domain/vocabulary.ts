/**
 * Closed vocabularies for B10 (Channel configurations).
 *
 * Every literal union below is transcribed **verbatim** from the real, live
 * `CK_*` CHECK constraints in `prisma/sql/001_constraints.sql` — never guessed from
 * a column's English name or a similar-sounding convention elsewhere in this
 * codebase (`tasks/lessons.md`'s "a CHECK constraint's closed vocabulary is not
 * guessable from context" lesson, hit twice already in this project). If a
 * constraint's value list ever changes, this file and the SQL must be re-grepped
 * together — they are two independently-typed sources of the same truth and
 * nothing mechanically keeps them in sync.
 *
 * This module holds no vendor imports (architecture.md §4): pure string-union
 * types and small guard functions, testable without a database.
 */

/** `CK_Channels_key`. */
export const CHANNEL_KEYS = ["WebWidget", "WhatsApp", "MobileApp", "KioskIvr"] as const;
export type ChannelKey = (typeof CHANNEL_KEYS)[number];

/** `CK_Channels_state`. */
export const CHANNEL_STATES = ["Live", "Disabled"] as const;
export type ChannelState = (typeof CHANNEL_STATES)[number];

/** `CK_Channels_availability`. */
export const CHANNEL_AVAILABILITIES = ["TwentyFourSeven", "WorkingHours"] as const;
export type ChannelAvailability = (typeof CHANNEL_AVAILABILITIES)[number];

/** `CK_PublicHolidays_origin`. */
export const PUBLIC_HOLIDAY_ORIGINS = ["AutoSync", "Manual"] as const;
export type PublicHolidayOrigin = (typeof PUBLIC_HOLIDAY_ORIGINS)[number];

/** `CK_WidgetConfigs_launcherPosition`. */
export const LAUNCHER_POSITIONS = ["BottomRight", "BottomLeft"] as const;
export type LauncherPosition = (typeof LAUNCHER_POSITIONS)[number];

/** `CK_WidgetConfigs_launcherPosition` (the same constraint also pins `defaultState`). */
export const WIDGET_DEFAULT_STATES = ["Docked", "Expanded"] as const;
export type WidgetDefaultState = (typeof WIDGET_DEFAULT_STATES)[number];

/** `CK_WhatsAppConfigs_bspProvider`. Exactly one value today — the closed set still
 *  matters, because a second BSP arriving is a new adapter (api.md §9.11), not a
 *  freely-typed string here. */
export const BSP_PROVIDERS = ["MetaCloudApi"] as const;
export type BspProvider = (typeof BSP_PROVIDERS)[number];

/** `CK_MessageTemplates_approvalStatus`. */
export const TEMPLATE_APPROVAL_STATUSES = ["Draft", "Pending", "Approved", "Rejected"] as const;
export type TemplateApprovalStatus = (typeof TEMPLATE_APPROVAL_STATUSES)[number];

/** `CK_Campaigns_trigger`. */
export const CAMPAIGN_TRIGGERS = [
  "RelativeToDueDate",
  "OnBookingCreated",
  "OnPaymentSettled",
  "Manual",
] as const;
export type CampaignTrigger = (typeof CAMPAIGN_TRIGGERS)[number];

/** `CK_CampaignSends_state`. */
export const CAMPAIGN_SEND_STATES = [
  "Queued",
  "Sent",
  "Delivered",
  "Failed",
  "Suppressed",
] as const;
export type CampaignSendState = (typeof CAMPAIGN_SEND_STATES)[number];

/** `CK_CampaignSends_suppressionReason`. */
export const SUPPRESSION_REASONS = [
  "QuietHours",
  "NoOptIn",
  "TemplateNotApproved",
  "Duplicate",
  "ChannelDisabled",
] as const;
export type SuppressionReason = (typeof SUPPRESSION_REASONS)[number];

/** `CK_ConsentLedgerEntries_purpose`. */
export const CONSENT_PURPOSES = [
  "ProactiveMessaging",
  "TranscriptRetention",
  "IdentityStitching",
] as const;
export type ConsentPurpose = (typeof CONSENT_PURPOSES)[number];

/** `CK_ConsentLedgerEntries_action`. */
export const CONSENT_ACTIONS = ["OptIn", "OptOut"] as const;
export type ConsentAction = (typeof CONSENT_ACTIONS)[number];

/** `CK_ConsentStates_state`. */
export const CONSENT_STATES = ["OptedIn", "OptedOut"] as const;
export type ConsentState = (typeof CONSENT_STATES)[number];

/** `CK_TranslationStrings_state`. */
export const TRANSLATION_STRING_STATES = ["Missing", "Draft", "Translated", "Reviewed"] as const;
export type TranslationStringState = (typeof TRANSLATION_STRING_STATES)[number];

/** The three-state badge `CampaignStates` (the SQL view) derives — never stored (§4.10). */
export const CAMPAIGN_DISPLAY_STATES = ["Blocked", "On", "Off"] as const;
export type CampaignDisplayState = (typeof CAMPAIGN_DISPLAY_STATES)[number];

function isOneOf<T extends string>(values: readonly T[], value: string): value is T {
  return (values as readonly string[]).includes(value);
}

/** B10 tab 1's fixed four-row catalogue, display name per `ChannelKey` — the exact wireframe
 *  label every tenant's Channels tab shows for that surface, regardless of configuration
 *  state. Used by `ProvisionDefaultChannelsForTenant` (channels/application) to create
 *  whichever of the four rows a tenant is still missing; kept here, not inlined at that call
 *  site, so `seed-channels-demo-data.ts`'s hand-seeded demo data and real provisioning agree
 *  on the one true label per key rather than each spelling it independently. */
export const CHANNEL_DISPLAY_NAMES: Readonly<Record<ChannelKey, string>> = {
  WebWidget: "Web widget",
  WhatsApp: "WhatsApp",
  MobileApp: "Mobile app",
  KioskIvr: "Kiosk / IVR",
};

export const isChannelKey = (value: string): value is ChannelKey => isOneOf(CHANNEL_KEYS, value);
export const isChannelState = (value: string): value is ChannelState =>
  isOneOf(CHANNEL_STATES, value);
export const isCampaignTrigger = (value: string): value is CampaignTrigger =>
  isOneOf(CAMPAIGN_TRIGGERS, value);
export const isTemplateApprovalStatus = (value: string): value is TemplateApprovalStatus =>
  isOneOf(TEMPLATE_APPROVAL_STATUSES, value);
