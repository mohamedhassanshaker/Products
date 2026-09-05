import {
  index,
  integer,
  jsonb,
  numeric,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  pgTable,
} from "drizzle-orm/pg-core";
import { tenant } from "./tenancy.js";
import { channel } from "./channels.js";
import {
  conversationStatusEnum,
  deliveryStatusEnum,
  messageContentTypeEnum,
  messageSenderEnum,
  resolutionTypeEnum,
} from "./enums.js";

/**
 * **conversation** (LLD §3.7, BL-04/06). `nextSequence` is a small addition beyond
 * the LLD's literal field list (a local/reversible decision, LLD §3 nexus-dev rule):
 * it is a per-conversation atomic counter (`UPDATE ... SET next_sequence =
 * next_sequence + 1 RETURNING next_sequence - 1`) that gives `message.sequence` its
 * gap-free, monotonic guarantee under concurrent writers without a retry-on-conflict
 * loop against the unique constraint — a row-level lock on one `UPDATE` statement is
 * simpler and strictly stronger than "insert, catch unique_violation, retry".
 */
export const conversation = pgTable(
  "conversation",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id),
    channelId: uuid("channel_id")
      .notNull()
      .references(() => channel.id),
    externalThreadId: text("external_thread_id"),
    customerIdentifier: text("customer_identifier"),
    // `text` (not a binary `bytea` column) storing a hex-encoded sha256 digest — same
    // convention as `credential.ciphertext` (LLD text says `bytea`, but this codebase
    // consistently stores encoded-binary data as `text` since drizzle-orm/pg-core has
    // no first-class `bytea` column helper; see `packages/db/src/schema/connectors.ts`).
    customerIdentifierHash: text("customer_identifier_hash"),
    status: conversationStatusEnum("status").notNull().default("Active"),
    recognizedGoal: text("recognized_goal"),
    resolutionType: resolutionTypeEnum("resolution_type"),
    language: text("language").notNull(),
    // Deferred: no FK to `agent_definition_version` yet (Phase 10, BL-07).
    agentDefinitionVersionId: uuid("agent_definition_version_id"),
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    totalCostUsd: numeric("total_cost_usd", { precision: 18, scale: 8 }).notNull().default("0"),
    totalTokensIn: integer("total_tokens_in").notNull().default(0),
    totalTokensOut: integer("total_tokens_out").notNull().default(0),
    // U6 fix (QA fix pass): `tags`/`archived`/`archivedAt` are additive fields for the
    // Conversation List's bulk actions — deliberately folded into the existing
    // untyped jsonb `metadata` blob rather than new dedicated columns. Postgres
    // enforces no shape on jsonb, so this is a TS-type widening only, not a schema
    // migration (a local/reversible decision; a dedicated `conversation_tag` table
    // would be the right long-term home if tagging grows richer query needs, e.g.
    // "list conversations with tag X" — out of scope for this fix pass).
    metadata: jsonb("metadata").$type<{
      pageUrl?: string;
      referrer?: string;
      userAgent?: string;
      tags?: string[];
      archived?: boolean;
      archivedAt?: string;
      /** BL-15 (FR-META-01, LLD §12.3): "Session-window state lives on
       * `conversation.metadata.lastInboundAt`" — the timestamp of the customer's
       * most recent inbound WhatsApp message, the anchor the 24h session-window
       * rule measures from. Only ever set for WhatsApp-channel conversations. */
      lastInboundAt?: string;
    } | null>(),
    /** See module doc — the atomic per-conversation sequence-number generator. */
    nextSequence: integer("next_sequence").notNull().default(1),
  },
  (t) => [
    uniqueIndex("conversation_tenant_channel_thread_key").on(t.tenantId, t.channelId, t.externalThreadId),
    index("conversation_tenant_status_activity_idx").on(t.tenantId, t.status, t.lastActivityAt),
    index("conversation_tenant_channel_started_idx").on(t.tenantId, t.channelId, t.startedAt),
    index("conversation_tenant_customer_hash_idx").on(t.tenantId, t.customerIdentifierHash),
  ],
);

/**
 * **message** (LLD §3.7, append-only). LLD describes this table as "partitioned
 * monthly" — true Postgres declarative partitioning is deferred (a local/reversible
 * decision, flagged): it adds real operational complexity (a parent table + a
 * per-month child + a scheduled job to create next month's partition ahead of time)
 * that isn't needed for this phase's correctness, only its longer-term storage/query
 * scale. The table is written so that adding partitioning later is a data-migration
 * concern, not a schema-shape change (the composite `(tenant_id, conversation_id,
 * sequence)` unique key and `created_at` column are already exactly what a
 * `PARTITION BY RANGE (created_at)` conversion would need).
 */
export const message = pgTable(
  "message",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversation.id),
    sequence: integer("sequence").notNull(),
    sender: messageSenderEnum("sender").notNull(),
    senderUserId: uuid("sender_user_id"),
    contentType: messageContentTypeEnum("content_type").notNull(),
    payload: jsonb("payload").notNull().$type<Record<string, unknown>>(),
    payloadMasked: jsonb("payload_masked").$type<Record<string, unknown> | null>(),
    confidenceScore: real("confidence_score"),
    agentRunId: uuid("agent_run_id"),
    inReplyToToolCallId: uuid("in_reply_to_tool_call_id"),
    deliveryStatus: deliveryStatusEnum("delivery_status").notNull().default("Sent"),
    /** LLD §5.3 `SendWidgetMessageRequest.clientMessageId` — dedups offline-queue
     * replay / duplicate-submit; unique per conversation, nullable (AI/System
     * messages this phase's stub responder generates have no client id). */
    clientMessageId: text("client_message_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("message_tenant_conversation_sequence_key").on(t.tenantId, t.conversationId, t.sequence),
    uniqueIndex("message_tenant_conversation_client_id_key").on(t.tenantId, t.conversationId, t.clientMessageId),
    index("message_tenant_conversation_idx").on(t.tenantId, t.conversationId),
  ],
);
