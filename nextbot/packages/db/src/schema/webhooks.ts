import { boolean, index, integer, jsonb, pgEnum, pgTable, smallint, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { tenant } from "./tenancy.js";
import { credential } from "./connectors.js";

/**
 * Target Architecture Blueprint Phase 18 (BL-49, FR-API-02) — outbound webhooks.
 *
 * Deliberately built as a SECOND, independent consumer of the existing `domain_event`
 * outbox (`packages/db/src/schema/domain-event.ts`), never a second event-producing
 * mechanism. Investigation before this phase confirmed `domain_event.processed`/
 * `processed_at` are `@nextbot/audit`'s own private cursor
 * (`sync-audit-from-events.ts`) — this module must never read or write those columns.
 * Per-subscription delivery progress is tracked entirely by `webhook_delivery`'s own
 * `(subscription_id, domain_event_id)` uniqueness, so this consumer's progress can
 * never interfere with (or be interfered with by) audit-sync's.
 */

/** The tenant-facing event vocabulary FR-API-02 names verbatim — never an internal
 * `domain_event.type` string, which can and does change shape across phases (see
 * `packages/modules/webhooks/src/domain/event-category.ts`'s mapping table). */
export const webhookEventCategoryEnum = pgEnum("webhook_event_category", [
  "EscalationCreated",
  "ApprovalPending",
  "GuardrailTripped",
  "DeploymentChanged",
  "DriftDetected",
]);

export const webhookDeliveryStatusEnum = pgEnum("webhook_delivery_status", ["Pending", "Success", "Failed", "Exhausted"]);

/**
 * One tenant-configured subscription: a target URL plus the subset of FR-API-02's five
 * categories the tenant wants delivered there. `signing_secret_credential_id` follows
 * the EXACT same envelope-encryption vaulting convention `git_connection.
 * webhook_secret_credential_id` already established (Phase 10, ADR-0007) — reused here
 * rather than a bespoke storage path, since this is the identical kind of secret (an
 * HMAC key shared between this system and a receiving endpoint), just used for the
 * opposite direction (outbound signing here, vs. inbound verification there).
 */
export const webhookSubscription = pgTable(
  "webhook_subscription",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id),
    targetUrl: text("target_url").notNull(),
    eventCategories: jsonb("event_categories").notNull().$type<string[]>(),
    signingSecretCredentialId: uuid("signing_secret_credential_id")
      .notNull()
      .references(() => credential.id),
    enabled: boolean("enabled").notNull().default(true),
    createdByUserId: uuid("created_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("webhook_subscription_tenant_enabled_idx").on(t.tenantId, t.enabled)],
);

/**
 * One delivery attempt-history row per (subscription, domain_event) pair — the
 * dispatcher's own idempotent-progress marker (`NOT EXISTS` against this table is how
 * it decides what's left to deliver) AND FR-API-02's own required "per-tenant
 * delivery-log for debugging failed deliveries." `attempt_count`/`next_attempt_at`
 * drive the retry/backoff schedule (`domain/backoff.ts`); a row reaching
 * `Exhausted` stops being retried but remains in the log for inspection.
 */
export const webhookDelivery = pgTable(
  "webhook_delivery",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id),
    subscriptionId: uuid("subscription_id")
      .notNull()
      .references(() => webhookSubscription.id),
    domainEventId: uuid("domain_event_id").notNull(),
    eventCategory: webhookEventCategoryEnum("event_category").notNull(),
    status: webhookDeliveryStatusEnum("status").notNull().default("Pending"),
    attemptCount: smallint("attempt_count").notNull().default(0),
    lastResponseCode: integer("last_response_code"),
    lastErrorMessage: text("last_error_message"),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // The dispatcher's own "what's left for this subscription" claim query.
    index("webhook_delivery_subscription_status_idx").on(t.subscriptionId, t.status, t.nextAttemptAt),
    // The delivery-log screen's per-tenant listing.
    index("webhook_delivery_tenant_created_idx").on(t.tenantId, t.createdAt),
    // SQL-level enforcement (not merely application-level) that at most one delivery
    // row ever exists per (subscription, domain_event) pair — the same
    // "idempotency-at-the-database" discipline `mcp_drift_event`'s own dedupe index
    // uses. This is what makes the dispatcher's enqueue step safe under a
    // concurrently-ticking worker replica: a duplicate INSERT loses the race and is
    // caught/ignored (`ON CONFLICT DO NOTHING`), never double-enqueued.
    uniqueIndex("webhook_delivery_subscription_event_key").on(t.subscriptionId, t.domainEventId),
  ],
);
