import { Type, type Static } from "@sinclair/typebox";
import { DomainError } from "./errors.js";

/**
 * WhatsApp/Meta-family contracts (BL-15, FR-META-01 through META-13). Kept in its
 * own file (mirroring `channels.ts`/`escalations.ts`'s one-file-per-feature
 * convention) rather than folded into `channels.ts`, since this is a large enough
 * surface (connect, config, templates, consent) to warrant its own module.
 */

// ---------------------------------------------------------------------------
// Connect flow (ADR-0009's OAuth pattern, applied to Meta Business Manager)
// ---------------------------------------------------------------------------

/**
 * The browser already completed Meta's OAuth redirect (Facebook Login for
 * Business); this request persists the resulting link. `sandboxManualEntry` is the
 * disclosed-limitation escape hatch documented in this dispatch's report: no real
 * Meta App exists in this sandbox, so an admin can alternatively paste a System
 * User token issued directly from Meta Business Manager's own UI (a real, supported
 * Meta workflow — "System Users" — that does not require a registered OAuth app) —
 * never a fabricated/simulated "connected" state either way.
 */
export const ConnectMetaBusinessAccountRequestSchema = Type.Object({
  channelId: Type.String({ format: "uuid" }),
  businessId: Type.String({ minLength: 1 }),
  businessName: Type.String({ minLength: 1 }),
  systemUserToken: Type.String({ minLength: 1 }),
  appId: Type.String({ minLength: 1 }),
  appSecret: Type.String({ minLength: 1 }),
});
export type ConnectMetaBusinessAccountRequest = Static<typeof ConnectMetaBusinessAccountRequestSchema>;

export const MetaBusinessAccountStatusSchema = Type.Union([
  Type.Literal("Disconnected"),
  Type.Literal("Connected"),
  Type.Literal("Unreachable"),
]);
export type MetaBusinessAccountStatusValue = Static<typeof MetaBusinessAccountStatusSchema>;

export const MetaBusinessAccountDtoSchema = Type.Object({
  id: Type.String({ format: "uuid" }),
  channelId: Type.String({ format: "uuid" }),
  businessId: Type.String(),
  businessName: Type.String(),
  wabaId: Type.Union([Type.String(), Type.Null()]),
  status: MetaBusinessAccountStatusSchema,
  appId: Type.Union([Type.String(), Type.Null()]),
  systemUserTokenMaskedHint: Type.Union([Type.String(), Type.Null()]),
  appSecretMaskedHint: Type.Union([Type.String(), Type.Null()]),
  sessionWindowWarningEnabled: Type.Boolean(),
  linkedAt: Type.Union([Type.String(), Type.Null()]),
  lastCheckedAt: Type.Union([Type.String(), Type.Null()]),
});
export type MetaBusinessAccountDto = Static<typeof MetaBusinessAccountDtoSchema>;

// ---------------------------------------------------------------------------
// Webhook (QA D1 fix, screen inventory B.2.3's missing "Webhook" tab)
// ---------------------------------------------------------------------------

export const WhatsAppWebhookVerificationStatusSchema = Type.Union([
  Type.Literal("Pending"),
  Type.Literal("Verified"),
  Type.Literal("Failed"),
]);
export type WhatsAppWebhookVerificationStatusValue = Static<typeof WhatsAppWebhookVerificationStatusSchema>;

/** One row per event kind this integration's webhook handler actually processes
 * (`whatsAppAdapter.parseInbound`'s `"Message"`/`"StatusUpdate"` kinds, mapped to
 * Meta's own `messages`/`statuses` webhook value fields) — a disclosed, honest
 * simplification: this sandbox has no live Meta App, so there is no per-field
 * subscription toggle to query from Meta's own `/{app-id}/subscriptions` endpoint;
 * `subscribed` instead reflects whether this webhook is set up to receive that
 * field at all (true once the account is `Connected` and the webhook has been
 * verified at least once), not a live per-field Meta API read. */
export const WhatsAppWebhookEventSubscriptionDtoSchema = Type.Object({
  eventType: Type.String(),
  label: Type.String(),
  subscribed: Type.Boolean(),
});
export type WhatsAppWebhookEventSubscriptionDto = Static<typeof WhatsAppWebhookEventSubscriptionDtoSchema>;

export const WhatsAppWebhookStatusDtoSchema = Type.Object({
  /** The real, deployment-specific inbound webhook URL for this tenant/channel
   * (never a hardcoded placeholder) — derived from this deployment's Gateway
   * Plane base URL + the actual route path. */
  webhookUrl: Type.String(),
  verificationStatus: WhatsAppWebhookVerificationStatusSchema,
  verifiedAt: Type.Union([Type.String(), Type.Null()]),
  lastEventReceivedAt: Type.Union([Type.String(), Type.Null()]),
  eventSubscriptions: Type.Array(WhatsAppWebhookEventSubscriptionDtoSchema),
});
export type WhatsAppWebhookStatusDto = Static<typeof WhatsAppWebhookStatusDtoSchema>;

export const SetWabaConfigRequestSchema = Type.Object({
  wabaId: Type.String({ minLength: 1 }),
  sessionWindowWarningEnabled: Type.Optional(Type.Boolean()),
});
export type SetWabaConfigRequest = Static<typeof SetWabaConfigRequestSchema>;

// ---------------------------------------------------------------------------
// Phone numbers
// ---------------------------------------------------------------------------

export const WhatsAppPhoneVerificationStatusSchema = Type.Union([
  Type.Literal("Verified"),
  Type.Literal("Pending"),
  Type.Literal("Unverified"),
]);
export type WhatsAppPhoneVerificationStatusValue = Static<typeof WhatsAppPhoneVerificationStatusSchema>;

export const WhatsAppMessagingTierSchema = Type.Union([
  Type.Literal("Tier1"),
  Type.Literal("Tier2"),
  Type.Literal("Tier3"),
  Type.Literal("Tier4"),
]);
export type WhatsAppMessagingTierValue = Static<typeof WhatsAppMessagingTierSchema>;

/** FR-OC-05 reuses this exact E.164 pattern/copy for Voice; the WhatsApp number
 * wizard reuses it verbatim for consistency across the two phone-entry surfaces. */
export const E164_PATTERN = "^\\+[1-9]\\d{6,14}$";
export const INVALID_PHONE_NUMBER_MESSAGE = "Enter a valid phone number in international format (e.g., +15551234567).";

export const AddWhatsAppNumberRequestSchema = Type.Object({
  e164: Type.String({ pattern: E164_PATTERN }),
  phoneNumberId: Type.String({ minLength: 1 }),
  displayName: Type.Optional(Type.String()),
});
export type AddWhatsAppNumberRequest = Static<typeof AddWhatsAppNumberRequestSchema>;

export const WhatsAppNumberDtoSchema = Type.Object({
  id: Type.String({ format: "uuid" }),
  phoneNumberId: Type.String(),
  e164: Type.String(),
  displayName: Type.Union([Type.String(), Type.Null()]),
  verificationStatus: WhatsAppPhoneVerificationStatusSchema,
  messagingTier: WhatsAppMessagingTierSchema,
  qualityRating: Type.Union([Type.String(), Type.Null()]),
});
export type WhatsAppNumberDto = Static<typeof WhatsAppNumberDtoSchema>;

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

export const WhatsAppTemplateStatusSchema = Type.Union([
  Type.Literal("Approved"),
  Type.Literal("Pending"),
  Type.Literal("Rejected"),
]);
export type WhatsAppTemplateStatusValue = Static<typeof WhatsAppTemplateStatusSchema>;

export const WhatsAppTemplateDtoSchema = Type.Object({
  id: Type.String({ format: "uuid" }),
  externalTemplateId: Type.Union([Type.String(), Type.Null()]),
  name: Type.String(),
  language: Type.String(),
  category: Type.Union([Type.String(), Type.Null()]),
  status: WhatsAppTemplateStatusSchema,
  body: Type.String(),
  variables: Type.Array(Type.String()),
  syncedAt: Type.String(),
});
export type WhatsAppTemplateDto = Static<typeof WhatsAppTemplateDtoSchema>;

export const SyncTemplatesResultSchema = Type.Object({
  synced: Type.Integer(),
  templates: Type.Array(WhatsAppTemplateDtoSchema),
});
export type SyncTemplatesResult = Static<typeof SyncTemplatesResultSchema>;

// ---------------------------------------------------------------------------
// Opt-in / consent tracking
// ---------------------------------------------------------------------------

export const ConsentStateSchema = Type.Union([Type.Literal("OptedIn"), Type.Literal("OptedOut")]);
export type ConsentStateValue = Static<typeof ConsentStateSchema>;

export const ConsentRecordDtoSchema = Type.Object({
  id: Type.String({ format: "uuid" }),
  /** Masked at the API boundary (FR-SEC-04-style PII masking) — last 4 digits
   * visible, the rest replaced with `*`, matching this codebase's existing
   * masked-phone convention. */
  customerIdentifierMasked: Type.String(),
  state: ConsentStateSchema,
  source: Type.String(),
  recordedAt: Type.String(),
});
export type ConsentRecordDto = Static<typeof ConsentRecordDtoSchema>;

export const RecordConsentRequestSchema = Type.Object({
  customerIdentifier: Type.String({ pattern: E164_PATTERN }),
  state: ConsentStateSchema,
  source: Type.String({ minLength: 1 }),
});
export type RecordConsentRequest = Static<typeof RecordConsentRequestSchema>;

export const BulkImportConsentRowSchema = Type.Object({
  customerIdentifier: Type.String(),
  state: ConsentStateSchema,
  source: Type.Optional(Type.String()),
});
export const BulkImportConsentRequestSchema = Type.Object({
  filename: Type.Optional(Type.String()),
  rows: Type.Array(BulkImportConsentRowSchema, { minItems: 1, maxItems: 5000 }),
});
export type BulkImportConsentRequest = Static<typeof BulkImportConsentRequestSchema>;

export const ConsentImportResultSchema = Type.Object({
  id: Type.String({ format: "uuid" }),
  totalRows: Type.Integer(),
  succeededRows: Type.Integer(),
  failedRows: Type.Integer(),
  errors: Type.Array(Type.Object({ row: Type.Integer(), reason: Type.String() })),
});
export type ConsentImportResult = Static<typeof ConsentImportResultSchema>;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class MetaBusinessAccountNotFoundError extends DomainError {
  readonly code = "META_BUSINESS_ACCOUNT_NOT_FOUND";
  readonly httpStatus = 404;
  constructor() {
    super("No Meta Business Manager account is linked to this channel yet.");
  }
}

export class WhatsAppNumberDuplicateError extends DomainError {
  readonly code = "WHATSAPP_NUMBER_DUPLICATE";
  readonly httpStatus = 409;
  constructor() {
    super("This phone number is already registered on this WhatsApp channel.");
  }
}

/**
 * FR-META-01's exact required copy — sending outside the 24h customer-initiated
 * session window without an approved template is REJECTED BEFORE SEND, never
 * silently dropped or downgraded to another channel. The message text is a
 * constant (not reconstructed inline at each call site) so it can never drift from
 * the spec's verbatim wording.
 */
export const WHATSAPP_TEMPLATE_REQUIRED_MESSAGE =
  "This message requires an approved WhatsApp template outside the 24-hour session window";

export class WhatsAppTemplateRequiredError extends DomainError {
  readonly code = "WHATSAPP_TEMPLATE_REQUIRED";
  readonly httpStatus = 422;
  constructor() {
    super(WHATSAPP_TEMPLATE_REQUIRED_MESSAGE);
  }
}

export class WhatsAppWebhookVerificationFailedError extends DomainError {
  readonly code = "WHATSAPP_WEBHOOK_VERIFICATION_FAILED";
  readonly httpStatus = 401;
  constructor() {
    super("WhatsApp webhook signature verification failed.");
  }
}

/**
 * QA D2 fix: raised when the Business ID + System User token pair supplied on
 * "Connect Meta Business Manager" fails a real, lightweight verification call
 * against Meta's Graph API (`GET /{business-id}`) — never silently accepted as
 * "Connected" only to flip to `Unreachable` on the first real send/sync later.
 * Nothing is vaulted or persisted when this is thrown (fail before any write).
 */
export class WhatsAppMetaVerificationFailedError extends DomainError {
  readonly code = "WHATSAPP_META_VERIFICATION_FAILED";
  readonly httpStatus = 422;
  constructor(detail?: string) {
    super(
      `Could not verify this Meta Business Manager account. Check the Business ID and System User token and try again.${detail ? ` (${detail})` : ""}`,
    );
  }
}
