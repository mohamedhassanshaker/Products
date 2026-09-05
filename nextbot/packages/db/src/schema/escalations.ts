import { boolean, index, integer, jsonb, pgTable, smallint, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { tenant } from "./tenancy.js";
import { conversation } from "./conversations.js";
import { appUser } from "./iam.js";
import {
  agentPresenceStateEnum,
  escalationAssignmentActionEnum,
  escalationReasonEnum,
  escalationStatusEnum,
} from "./enums.js";

/**
 * **agent_queue** (LLD §3.9, Phase 16/BL-09). Backend-queue mapping destinations
 * (e.g. "Billing Support", mapped 1:1 in this MVP's scope to a name only — mapping to
 * an actual external Zendesk group/Jira SM queue id is `queueExternalRef`, a free-text
 * pass-through field since no external-ticketing connector integration is in this
 * phase's scope; B.5.3's "backend queue mapping" UI captures it as configuration only).
 * Exactly one row per tenant has `isDefault = true` (partial unique index below) — the
 * required fallback destination FR-ESC-03 mandates so an escalation is never
 * unassigned.
 */
export const agentQueue = pgTable(
  "agent_queue",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull().references(() => tenant.id),
    name: text("name").notNull(),
    isDefault: boolean("is_default").notNull().default(false),
    /** Free-text pass-through to a backend system's own queue/group identifier
     * (e.g. a Zendesk group id, a Jira Service Management queue key) — B.5.3's
     * "backend queue mapping" element. No live connector call validates this value
     * this phase (disclosed: FR-TCK integration is a separate backlog item). */
    queueExternalRef: text("queue_external_ref"),
    businessHours: jsonb("business_hours").$type<Record<string, unknown> | null>(),
    /** Target Architecture Blueprint Phase 13 (BL-45, FR-ESC-05, LLD §14.9.2) — an
     * optional per-queue SLA target in seconds. `NULL` means the queue has no
     * configured SLA at all (an escalation routed here never gets a `sla_due_at`,
     * never gets swept for breach) — an explicit, honest default, not a silently
     * invented tenant-wide inheritance (same convention `knowledge_collection.
     * retention_days`'s `NULL` already established). */
    slaSeconds: integer("sla_seconds"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("agent_queue_tenant_name_key").on(t.tenantId, t.name),
    // NOTE: the "exactly one default queue per tenant" partial unique index (`WHERE
    // is_default`) is hand-authored in the migration SQL only — see the same note on
    // `escalation`'s table definition below for why (no partial-index predicate
    // support in drizzle-orm's `uniqueIndex(...).on(...)` builder).
  ],
);

/**
 * **escalation** (LLD §3.9, FR-ESC-01/02). A conversation may have many escalation
 * rows over its lifetime (Escalated -> ReturnedToBot -> Escalated again), but at most
 * one **non-terminal** (`Waiting`/`InProgress`) row at a time — enforced by the
 * partial unique index below, not just application-level check-then-act (this
 * project's own "never check-then-act on a concurrent-write path" rule).
 */
export const escalation = pgTable(
  "escalation",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull().references(() => tenant.id),
    conversationId: uuid("conversation_id").notNull().references(() => conversation.id),
    reason: escalationReasonEnum("reason").notNull(),
    reasonDetail: jsonb("reason_detail").$type<Record<string, unknown> | null>(),
    queueId: uuid("queue_id").notNull().references(() => agentQueue.id),
    matchedRoutingRuleId: uuid("matched_routing_rule_id"),
    assignedAgentId: uuid("assigned_agent_id").references(() => appUser.id),
    status: escalationStatusEnum("status").notNull().default("Waiting"),
    waitingSince: timestamp("waiting_since", { withTimezone: true }).notNull().defaultNow(),
    pickedUpAt: timestamp("picked_up_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    waitSeconds: integer("wait_seconds"),
    /** FR-ESC-02 — `{ recognizedGoal, confidence, toolCallIds[], transcriptCursor }`,
     * snapshotted at escalation-creation time so the takeover panel's "what did the
     * AI already try" view is stable even if later turns mutate live state. */
    aiContextSnapshot: jsonb("ai_context_snapshot").notNull().$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    // --- Target Architecture Blueprint Phase 13 (BL-45, FR-ESC-05, LLD §14.9.2) ---
    /** Set once, on the `Waiting -> InProgress` claim (mirrors `pickedUpAt` — kept as
     * its own column per LLD's exact naming rather than reusing `pickedUpAt`, since a
     * future reassignment-to-a-new-agent should not appear to "re-claim" the original
     * pick-up time). */
    assignedAt: timestamp("assigned_at", { withTimezone: true }),
    /** Computed at creation from the routed queue's `agent_queue.sla_seconds`; `NULL`
     * when the queue has no configured SLA (see `agentQueue.slaSeconds`'s doc). */
    slaDueAt: timestamp("sla_due_at", { withTimezone: true }),
    /** Flipped by the `escalation.sla-sweep` worker job once `sla_due_at` passes while
     * still `Waiting`/`InProgress` — never by application code on the request path. */
    slaBreached: boolean("sla_breached").notNull().default(false),
    /** LLD §14.7.3 (Phase 14 scope, BL-46) — reserved, deliberately unconstrained
     * (no FK: `delegation_run` doesn't exist yet) and unused by this phase. */
    delegationRunId: uuid("delegation_run_id"),
    /** FR-ESC-05 CSAT capture — `NULL` until a human agent supplies a score at (or
     * after) a takeover's close; the DB `CHECK (csat_score BETWEEN 1 AND 5)` is
     * hand-authored in the migration only (see this file's own existing note on why
     * CHECK constraints live in the raw SQL migration, not the drizzle-orm builder). */
    csatScore: smallint("csat_score"),
    csatComment: text("csat_comment"),
    csatCapturedAt: timestamp("csat_captured_at", { withTimezone: true }),
  },
  (t) => [
    index("escalation_tenant_conversation_idx").on(t.tenantId, t.conversationId),
    index("escalation_tenant_status_queue_idx").on(t.tenantId, t.status, t.queueId),
    // Phase 13 — the SLA sweep's own query shape (find non-terminal, not-yet-breached
    // rows whose sla_due_at has passed).
    index("escalation_tenant_sla_due_idx").on(t.tenantId, t.status, t.slaDueAt),
    // NOTE: the "at most one non-terminal (Waiting/InProgress) escalation per
    // conversation" invariant (LLD §3.9) is a *partial* unique index
    // (`WHERE status IN ('Waiting','InProgress')`) — not expressible via drizzle-orm's
    // `uniqueIndex(...).on(...)` builder (no partial-index predicate support), so it is
    // hand-authored directly in the migration SQL only, per this codebase's existing
    // "SQL migrations are the source of truth for what's actually applied" convention
    // (see packages/db/migrations/README.md). Enforced and proven by a real-concurrency
    // integration test, not just documented here.
  ],
);

/**
 * **escalation_routing_rule** (LLD §3.9, FR-ESC-03). `ordinal` is the first-match-wins
 * evaluation order (mirrors `tool_permission_rule`/`resolvePermission`'s convention).
 * `conditions` — `{ recognizedGoal?, channelTypes?, reasons?, language? }` — every
 * present key must match for the rule to apply (AND semantics, per the spec's `IF
 * recognized_goal = X AND channel = Y` wording); an absent key is a wildcard.
 */
export const escalationRoutingRule = pgTable(
  "escalation_routing_rule",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull().references(() => tenant.id),
    ordinal: integer("ordinal").notNull(),
    conditions: jsonb("conditions").notNull().$type<{
      recognizedGoal?: string;
      channelTypes?: string[];
      reasons?: string[];
      language?: string;
    }>(),
    queueId: uuid("queue_id").notNull().references(() => agentQueue.id),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("escalation_routing_rule_tenant_ordinal_idx").on(t.tenantId, t.ordinal),
    uniqueIndex("escalation_routing_rule_tenant_ordinal_key").on(t.tenantId, t.ordinal),
  ],
);

/**
 * **agent_presence** (Target Architecture Blueprint Phase 13, BL-45, FR-ESC-05, LLD
 * §14.9.2). One row per (tenant, user) — composite PK, hand-authored in the migration
 * (drizzle-orm's `pgTable` builder expresses a composite PK via `primaryKey({...})`
 * below). `currentLoad`/`maxConcurrent` are the enforced concurrency-ceiling mechanic
 * (`claim-escalation.ts`'s atomic conditional UPDATE); `state` is informational/
 * self-service only this phase (does not gate claiming — see `agent-presence-
 * service.ts`'s doc comment). A row is auto-provisioned (`Offline`/3) the first time
 * any code references a user's presence — there is no separate provisioning step.
 */
export const agentPresence = pgTable(
  "agent_presence",
  {
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => appUser.id),
    state: agentPresenceStateEnum("state").notNull().default("Offline"),
    maxConcurrent: smallint("max_concurrent").notNull().default(3),
    currentLoad: smallint("current_load").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Composite PK is hand-authored in the migration SQL (drizzle-orm's `pgTable`
    // builder has no first-class multi-column `primaryKey()` re-export wired into this
    // project's existing schema files — every other table in this codebase uses a
    // single `uuid("id").primaryKey()` — so, matching this file's own established
    // "partial/composite constraints are SQL-migration-only" convention above, the
    // `PRIMARY KEY (tenant_id, user_id)` constraint lives in the migration, not here).
    index("agent_presence_tenant_idx").on(t.tenantId),
  ],
);

/**
 * **escalation_assignment_log** (Target Architecture Blueprint Phase 13, BL-45,
 * FR-ESC-05, LLD §14.9.2). Append-only audit trail of every load-affecting
 * assignment transition — never updated in place (mirrors `escalation_event`/
 * `guardrail_event`'s own append-only convention). `userId` is the agent the action
 * concerns (whose `current_load` changed); `actorUserId` is who performed it — `NULL`
 * for a system-driven `AutoAssigned` action, since there is no human actor.
 */
export const escalationAssignmentLog = pgTable(
  "escalation_assignment_log",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id),
    escalationId: uuid("escalation_id")
      .notNull()
      .references(() => escalation.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => appUser.id),
    action: escalationAssignmentActionEnum("action").notNull(),
    actorUserId: uuid("actor_user_id").references(() => appUser.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("escalation_assignment_log_tenant_escalation_idx").on(t.tenantId, t.escalationId),
    index("escalation_assignment_log_tenant_user_idx").on(t.tenantId, t.userId),
  ],
);
