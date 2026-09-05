import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { tenant } from "./tenancy.js";
import { credential } from "./connectors.js";
import { agentDefinition } from "./agent-platform.js";
import { channelStatusEnum, channelTypeEnum, environmentEnum, formStrategyEnum, listStrategyEnum } from "./enums.js";

/**
 * **channel** (LLD §3.4, BL-04). `config` is a discriminated-by-`type` jsonb blob;
 * this phase only implements/validates the `WebWidget` variant
 * (`WebWidgetConfigSchema` in `packages/contracts/src/channels.ts`) — the other 8
 * channel types' config shapes are added in the backlog phases that implement them
 * (BL-14/BL-15), matching how `channel_capability` below seeds reference data for all
 * 9 types today without every type being a working channel yet.
 */
export const channel = pgTable(
  "channel",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id),
    type: channelTypeEnum("type").notNull(),
    name: text("name").notNull(),
    status: channelStatusEnum("status").notNull().default("Inactive"),
    environment: environmentEnum("environment").notNull(),
    config: jsonb("config").notNull().$type<Record<string, unknown>>(),
    credentialId: uuid("credential_id").references(() => credential.id),
    /**
     * Target Architecture Blueprint Phase 17 (BL-48, ADR-0019 §2.2, LLD §15.2) — **which
     * bot answers on this channel**. Replaces the vestigial `agent_definition_version_id`
     * column, which migration `0084` drops: it was reserved back in `0010` for a Phase-10
     * FK that never landed, and was read and written by nothing (zero references anywhere
     * outside this declaration, re-verified by repo-wide grep at Phase 17 dispatch).
     *
     * The binding is deliberately to the DEFINITION, not to a version: which *build* of
     * this bot serves a given conversation is the `deployment` traffic split's job
     * (`resolveTurnAgentVersion`), where the shipped `SUM(traffic_split_pct)=100` trigger
     * and emergency rollback's advisory-lock key already live. Binding a canary to a
     * channel would make that shipped invariant meaningless and desynchronize the lock
     * key emergency rollback depends on (ADR-0019 §2.1).
     *
     * **NULL is a supported state, not an error.** A channel with no binding falls back
     * to `findActiveAgentDefinitionVersionTenantWideFallback` — exactly the pre-Phase-17
     * behavior — so no existing tenant, fixture or test regresses. Migration `0084`
     * backfills every channel of a tenant that owns exactly one `agent_definition`;
     * ambiguous tenants are left NULL on purpose.
     */
    agentDefinitionId: uuid("agent_definition_id").references(() => agentDefinition.id),
    publicKey: text("public_key").notNull(),
    lastError: jsonb("last_error").$type<{ code: string; message: string; occurredAt: string } | null>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("channel_tenant_env_name_key").on(t.tenantId, t.environment, t.name),
    uniqueIndex("channel_public_key_key").on(t.publicKey),
    // Phase 17 (BL-48) — backs the per-turn `channelId -> agentDefinitionId` lookup the
    // composition root does before the traffic-split resolver runs.
    index("channel_tenant_agent_definition_idx").on(t.tenantId, t.agentDefinitionId),
  ],
);

/**
 * **channel_capability** (LLD §3.4) — static reference data, seeded per `ChannelType`
 * at migration time (`0011_channels_rls.sql`'s seed INSERTs), driving FR-OC-06's
 * automatic rendering fallback. Not tenant-scoped (no `tenant_id`, no RLS) — every
 * tenant reads the same capability row for a given channel type.
 */
export const channelCapability = pgTable("channel_capability", {
  channelType: channelTypeEnum("channel_type").primaryKey(),
  supportsRichCards: boolean("supports_rich_cards").notNull(),
  supportsQuickReplies: boolean("supports_quick_replies").notNull(),
  supportsLists: boolean("supports_lists").notNull(),
  supportsForms: boolean("supports_forms").notNull(),
  supportsFileUpload: boolean("supports_file_upload").notNull(),
  supportsMarkdown: boolean("supports_markdown").notNull(),
  supportsTypingIndicator: boolean("supports_typing_indicator").notNull(),
  maxQuickReplies: integer("max_quick_replies"),
  maxButtonLabelChars: integer("max_button_label_chars"),
  maxTextChars: integer("max_text_chars"),
  formStrategy: formStrategyEnum("form_strategy").notNull(),
  listStrategy: listStrategyEnum("list_strategy").notNull(),
});
