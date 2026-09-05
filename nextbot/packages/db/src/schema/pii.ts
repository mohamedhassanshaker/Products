import { boolean, index, integer, jsonb, pgEnum, pgTable, real, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { tenant } from "./tenancy.js";

/** Phase 17 (BL-10, FR-SEC-04) — the fixed PII entity vocabulary the masker
 * recognizes out of the box, plus `Custom` for tenant-authored regex rules. */
export const piiEntityTypeEnum = pgEnum("pii_entity_type", [
  "NationalId",
  "CreditCard",
  "IBAN",
  "Phone",
  "Email",
  "Passport",
  "DateOfBirth",
  "Custom",
]);

/** FR-SEC-04's masking-context matrix columns — every surface unmasked PII could
 * otherwise reach. `"Knowledge"` added Target Architecture Blueprint Phase 11
 * (BL-42, FR-KB-08) — `ALTER TYPE ... ADD VALUE` cannot run in the same transaction
 * as other DDL touching this enum, so it is added by its own standalone migration
 * (`0070_pii_context_knowledge.sql`), the same pattern Model Gateway v2's provider
 * type and the SSO `login_outcome` enum additions already established. */
export const piiContextEnum = pgEnum("pii_context", [
  "Transcript",
  "ToolCallPayload",
  "A2APayload",
  "Export",
  "HumanAgentView",
  "Knowledge",
]);

/** FR-SEC-04's four masking intensities, applied per `(entityType, context,
 * connectorTrustLevel)` combination. */
export const piiMaskActionEnum = pgEnum("pii_mask_action", ["Show", "PartialMask", "FullMask", "Redact"]);

/**
 * **pii_rule** — detection rules (built-in entity types are always enabled by
 * default; `Custom` rows carry a tenant-authored regex). `pattern` is NULL for
 * built-in types (the masker's built-in detectors are used instead); required for
 * `Custom`.
 */
export const piiRule = pgTable(
  "pii_rule",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id),
    entityType: piiEntityTypeEnum("entity_type").notNull(),
    label: text("label").notNull(),
    pattern: text("pattern"),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("pii_rule_tenant_idx").on(t.tenantId)],
);

/**
 * **pii_policy** — the masking-context matrix (FR-SEC-04): one row per
 * `(tenant, entityType, context, connectorTrustLevel)` combination, resolving to a
 * mask action. Absence of a row for a combination defaults to `FullMask` (fail
 * closed — an unconfigured combination must never default to `Show`).
 */
export const piiPolicy = pgTable(
  "pii_policy",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id),
    entityType: piiEntityTypeEnum("entity_type").notNull(),
    context: piiContextEnum("context").notNull(),
    trustLevel: text("trust_level").notNull(), // mirrors connectors' trust_level enum values; kept as text to avoid a cross-module enum FK (pii cannot import connectors, LLD §2.3)
    action: piiMaskActionEnum("action").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("pii_policy_tenant_matrix_key").on(t.tenantId, t.entityType, t.context, t.trustLevel),
  ],
);

/**
 * **guardrail_rule** — Phase 17's full authoring surface, superseding Phase 12's
 * in-memory `StubGuardrailRule` array (`orchestration/domain/guardrail-eval.ts`).
 * `conditions` is a small condition object (`{ toolName? }` today — mirrors the
 * stub's condition shape 1:1 so the evaluation function itself needed no change,
 * only its rule *source* moved from an array literal to this table).
 */
export const guardrailRule = pgTable(
  "guardrail_rule",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id),
    name: text("name").notNull(),
    ordinal: integer("ordinal").notNull(),
    conditions: jsonb("conditions").$type<{ toolName?: string }>().notNull(),
    effect: text("effect").notNull(), // "BlockToolCall" | "EscalateToHuman"
    reason: text("reason").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("guardrail_rule_tenant_ordinal_idx").on(t.tenantId, t.ordinal),
    uniqueIndex("guardrail_rule_tenant_ordinal_key").on(t.tenantId, t.ordinal),
  ],
);

/**
 * Phase 6 (BL-30, FR-SEC-09, ADR reconciliation LLD §14.9.1) — append-only audit trail
 * for every guardrail screening decision. Scoped narrowly to this phase's actual
 * mechanism (`PostToolResult` prompt-injection screening over tool-call results —
 * G-04, the platform's clearest injection-detection gap today) rather than the full
 * future `PreDelegation`/`PostResponse`/`OutputPolicy`/`Groundedness` surface LLD
 * §14.9.1 eventually adds once Modules B/E ship — `appliesAt`/`kind` are left as plain
 * `text` (not a pg enum) specifically so later phases can add new values without a
 * migration touching this column's type, mirroring `guardrail_rule.effect`'s existing
 * text-not-enum convention in this same file.
 */
export const guardrailEvent = pgTable(
  "guardrail_event",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id),
    conversationId: uuid("conversation_id"),
    toolCallId: uuid("tool_call_id"),
    kind: text("kind").notNull(), // "PromptInjection" today; OutputPolicy/Groundedness land with Phase 8's Modules
    appliesAt: text("applies_at").notNull(), // "PostToolResult" today; PreDelegation/PostResponse land with Phases 8/9
    action: text("action").notNull(), // "Blocked" | "Allowed" — this phase only ever writes "Blocked" (an Allowed row is never written, matching guardrail_rule's silent-pass convention)
    detector: text("detector").notNull(), // "heuristic:<name>" (LLD's own naming convention) — never a bare vendor/model name
    score: real("score"),
    matchedExcerptMasked: text("matched_excerpt_masked"), // truncated + PII-masked before storage — never the raw matched text
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("guardrail_event_tenant_created_idx").on(t.tenantId, t.createdAt),
    index("guardrail_event_tenant_kind_created_idx").on(t.tenantId, t.kind, t.createdAt),
  ],
);

/** Phase 17 (B.8.4, GDPR-style DSR tool) — `status` progresses
 * Pending -> InProgress -> Completed (or Failed). `resultSummary` holds a
 * non-sensitive pointer (row counts per data category), never the raw exported
 * payload itself (that is streamed directly to the requester, never persisted). */
export const dsrStatusEnum = pgEnum("dsr_status", ["Pending", "InProgress", "Completed", "Failed"]);
export const dsrTypeEnum = pgEnum("dsr_type", ["Search", "Export", "Delete"]);

export const dataSubjectRequest = pgTable(
  "data_subject_request",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id),
    requestType: dsrTypeEnum("request_type").notNull(),
    customerIdentifier: text("customer_identifier").notNull(),
    requestedByUserId: uuid("requested_by_user_id"),
    status: dsrStatusEnum("status").notNull().default("Pending"),
    resultSummary: jsonb("result_summary"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [index("data_subject_request_tenant_idx").on(t.tenantId, t.createdAt)],
);
