import { boolean, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { tenant } from "./tenancy.js";
import { channel } from "./channels.js";
import { credential } from "./connectors.js";

/**
 * WhatsApp/Meta-family schema (LLD §12.3, BL-15, FR-META-01 through META-13). Mirrors
 * the table names/fields the LLD names verbatim (`meta_business_account`,
 * `whatsapp_template`, `consent_record`, `consent_import_log`) plus a
 * `whatsapp_number` table — a locally reversible addition beyond the LLD's minimal
 * outline (LLD §12.3 explicitly defers "full field detail... to the item's dev
 * phase"), needed because FR-META-01/screen-inventory B.2.3 require a per-number
 * verification-status + messaging-tier list, not just a single WABA identifier.
 */

/** Same "webhook-primary, honest disconnected state" status vocabulary already used
 * by `git_connection_status` (ADR-0009) — never left permanently defaulted, always
 * driven by a real OAuth-linking / health-check outcome (Final Review B1 discipline). */
export const metaBusinessAccountStatusEnum = pgEnum("meta_business_account_status", [
  "Disconnected",
  "Connected",
  "Unreachable",
]);

export const whatsappPhoneVerificationStatusEnum = pgEnum("whatsapp_phone_verification_status", [
  "Verified",
  "Pending",
  "Unverified",
]);

/** Meta's four-tier messaging-limit ladder (FR-META business messaging tiers). */
export const whatsappMessagingTierEnum = pgEnum("whatsapp_messaging_tier", ["Tier1", "Tier2", "Tier3", "Tier4"]);

export const whatsappTemplateStatusEnum = pgEnum("whatsapp_template_status", ["Approved", "Pending", "Rejected"]);

export const consentStateEnum = pgEnum("consent_state", ["OptedIn", "OptedOut"]);

/** QA D1 fix (BL-15 retry 1): the Webhook tab's verification-status badge
 * (screen inventory B.2.3). `Pending` until the real `hub.challenge` handshake
 * (or an admin-triggered re-verify) has succeeded at least once; `Failed` if the
 * most recent attempt didn't. */
export const whatsappWebhookVerificationStatusEnum = pgEnum("whatsapp_webhook_verification_status", [
  "Pending",
  "Verified",
  "Failed",
]);

/**
 * **meta_business_account** (LLD §12.3). One row per WhatsApp channel's linked Meta
 * Business Manager account — `channel_id` is the FK back to the `channel` row created
 * by the Channels "Add Channel" wizard (`type = 'WhatsApp'`). Credentials referenced
 * here are vaulted `credential` rows (ADR-0007) — never a plaintext column.
 */
export const metaBusinessAccount = pgTable(
  "meta_business_account",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id),
    channelId: uuid("channel_id")
      .notNull()
      .references(() => channel.id),
    businessId: text("business_id").notNull(),
    businessName: text("business_name").notNull(),
    wabaId: text("waba_id"),
    status: metaBusinessAccountStatusEnum("status").notNull().default("Disconnected"),
    /** System User access token (`credential.type = 'SystemUserToken'`). */
    systemUserTokenCredentialId: uuid("system_user_token_credential_id").references(() => credential.id),
    appId: text("app_id"),
    /** `credential.type = 'MetaAppSecret'` — verifies `X-Hub-Signature-256`. */
    appSecretCredentialId: uuid("app_secret_credential_id").references(() => credential.id),
    /** `credential.type = 'MetaWebhookVerifyToken'` — echoed back on the
     * `hub.challenge` GET handshake Meta requires before it will deliver webhooks. */
    webhookVerifyTokenCredentialId: uuid("webhook_verify_token_credential_id").references(() => credential.id),
    /** FR-META-01: the 24h customer-session-window enforcement is always active per
     * the spec ("never silently dropped or downgraded") — this toggle governs
     * whether the platform proactively *warns* admins/agents in the composer UI
     * before they attempt an outside-window send, not whether the rule itself is
     * enforced (that is never optional). */
    sessionWindowWarningEnabled: boolean("session_window_warning_enabled").notNull().default(true),
    /** QA D1 fix: real state backing the Webhook tab's verification badge —
     * flipped to `Verified`/`Failed` by the real `hub.challenge` GET handshake
     * (or an admin-triggered "Re-verify Challenge") never fabricated client-side. */
    webhookVerificationStatus: whatsappWebhookVerificationStatusEnum("webhook_verification_status").notNull().default("Pending"),
    webhookVerifiedAt: timestamp("webhook_verified_at", { withTimezone: true }),
    /** Timestamp of the most recent inbound webhook POST this tenant/channel
     * actually received (any event kind) — the Webhook tab's "last event
     * received" field. */
    lastEventReceivedAt: timestamp("last_event_received_at", { withTimezone: true }),
    linkedAt: timestamp("linked_at", { withTimezone: true }),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("meta_business_account_tenant_channel_key").on(t.tenantId, t.channelId)],
);

/**
 * **whatsapp_number** (BL-15 addition, screen inventory B.2.3). One row per phone
 * number registered under the tenant's WABA; `messaging_tier` drives the tier gauge.
 */
export const whatsappNumber = pgTable(
  "whatsapp_number",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id),
    metaBusinessAccountId: uuid("meta_business_account_id")
      .notNull()
      .references(() => metaBusinessAccount.id),
    phoneNumberId: text("phone_number_id").notNull(), // Meta's own numeric phone-number-id (send-API path param)
    e164: text("e164").notNull(),
    displayName: text("display_name"),
    verificationStatus: whatsappPhoneVerificationStatusEnum("verification_status").notNull().default("Unverified"),
    messagingTier: whatsappMessagingTierEnum("messaging_tier").notNull().default("Tier1"),
    qualityRating: text("quality_rating"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("whatsapp_number_tenant_phone_number_id_key").on(t.tenantId, t.phoneNumberId)],
);

/**
 * **whatsapp_template** (LLD §12.3 verbatim). Synced from Meta's
 * `GET /{waba-id}/message_templates`; never authored directly in this system (Meta's
 * own approval workflow is the source of truth for `status`).
 */
export const whatsappTemplate = pgTable(
  "whatsapp_template",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id),
    channelId: uuid("channel_id")
      .notNull()
      .references(() => channel.id),
    externalTemplateId: text("external_template_id"),
    name: text("name").notNull(),
    language: text("language").notNull(),
    category: text("category"),
    status: whatsappTemplateStatusEnum("status").notNull(),
    body: text("body").notNull(),
    variables: jsonb("variables").notNull().$type<string[]>(),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("whatsapp_template_tenant_channel_name_lang_key").on(t.tenantId, t.channelId, t.name, t.language)],
);

/**
 * **consent_record** (LLD §12.3 verbatim). `channel_type` is included per the LLD's
 * field list even though this dispatch only ever writes `'WhatsApp'` rows — the
 * table is deliberately Meta-family-generic so Messenger/Instagram (a later
 * dispatch) reuse it rather than each growing a parallel consent table.
 */
export const consentRecord = pgTable(
  "consent_record",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id),
    channelId: uuid("channel_id")
      .notNull()
      .references(() => channel.id),
    customerIdentifier: text("customer_identifier").notNull(), // E.164 phone for WhatsApp
    channelType: text("channel_type").notNull().default("WhatsApp"),
    state: consentStateEnum("state").notNull(),
    source: text("source").notNull(), // e.g. "CustomerInitiatedMessage", "BulkImport", "AdminManualEntry"
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("consent_record_tenant_channel_customer_key").on(t.tenantId, t.channelId, t.customerIdentifier)],
);

/**
 * **consent_import_log** (LLD §12.3). One row per bulk-import job (FR-META's
 * "bulk import/export log"); FR-KB-01's "one failed item never blocks the rest"
 * pattern applies here too — `errors` carries the per-row failure detail, the import
 * itself always completes the rows that did validate.
 */
export const consentImportLog = pgTable("consent_import_log", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenant.id),
  channelId: uuid("channel_id")
    .notNull()
    .references(() => channel.id),
  filename: text("filename"),
  totalRows: integer("total_rows").notNull(),
  succeededRows: integer("succeeded_rows").notNull(),
  failedRows: integer("failed_rows").notNull(),
  errors: jsonb("errors").notNull().$type<{ row: number; reason: string }[]>(),
  importedByUserId: uuid("imported_by_user_id"),
  importedAt: timestamp("imported_at", { withTimezone: true }).notNull().defaultNow(),
});
