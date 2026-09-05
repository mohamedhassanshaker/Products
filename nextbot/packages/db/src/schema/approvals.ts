import { boolean, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { tenant } from "./tenancy.js";
import { conversation } from "./conversations.js";
import { approvalTierEnum } from "./tool-registry.js";

/** LLD §6.1 — the 9-state approval-tier FSM. */
export const toolCallStatusEnum = pgEnum("tool_call_status", [
  "Created",
  "PolicyDenied",
  "AwaitingCustomerConfirmation",
  "AwaitingHumanApproval",
  "Executing",
  "Succeeded",
  "Failed",
  "Cancelled",
  "Expired",
]);
export const approvalDecisionEnum = pgEnum("approval_decision", ["Approved", "Rejected", "MoreInfoRequested"]);

/**
 * **tool_call** (LLD §6, Phase 14/BL-08). Persisted only for Tier-2/3 calls this
 * phase — see the migration's module doc for why Tier-1 stays synchronous/unpersisted.
 */
export const toolCall = pgTable(
  "tool_call",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull().references(() => tenant.id),
    conversationId: uuid("conversation_id").notNull().references(() => conversation.id),
    toolId: uuid("tool_id").notNull(),
    toolName: text("tool_name").notNull(),
    connectorId: uuid("connector_id"),
    /**
     * Target Architecture Blueprint Phase 14 (BL-46, FR-ORC-04, LLD §14.7.3) — the
     * `agent_run` this tool call was made inside, so a Tier-3 call made by a team
     * member at any delegation depth can be joined back to the run's own
     * `delegation_event` rows (and hence to the delegation tree the Approval Queue
     * links out to). Additive and nullable: every pre-existing row, and every
     * non-delegated call, keeps `NULL` and behaves exactly as before. FK-less by
     * design, mirroring `delegation_event.agent_run_id`'s own established
     * convention in this codebase for a loosely-associated run id.
     *
     * The Approval Queue's rendered chain itself lives in
     * `approval_request.risk_summary.delegationChain`, snapshotted at creation
     * (the chain that produced the request is known in full at that moment; the
     * terminal hop's own `delegation_event` row is not written until the hop
     * completes, so a read-time join alone would be missing exactly the hop the
     * approver most needs).
     */
    agentRunId: uuid("agent_run_id"),
    approvalTier: approvalTierEnum("approval_tier").notNull(),
    status: toolCallStatusEnum("status").notNull().default("Created"),
    inputArgs: jsonb("input_args").notNull().$type<Record<string, unknown>>(),
    inputArgsMasked: jsonb("input_args_masked").$type<Record<string, unknown> | null>(),
    idempotencyKey: uuid("idempotency_key").notNull(),
    attemptCount: integer("attempt_count").notNull().default(0),
    output: jsonb("output").$type<unknown>(),
    errorMessage: text("error_message"),
    decisionNote: text("decision_note"),
    decidedByUserId: uuid("decided_by_user_id"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("tool_call_tenant_conversation_idx").on(t.tenantId, t.conversationId),
    index("tool_call_tenant_status_idx").on(t.tenantId, t.status),
    uniqueIndex("tool_call_tenant_idempotency_key_key").on(t.tenantId, t.idempotencyKey),
  ],
);

/** **approval_request** (LLD §6.5, Tier-3 queue row). */
export const approvalRequest = pgTable(
  "approval_request",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull().references(() => tenant.id),
    toolCallId: uuid("tool_call_id").notNull().references(() => toolCall.id),
    conversationId: uuid("conversation_id").notNull().references(() => conversation.id),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    status: toolCallStatusEnum("status").notNull().default("AwaitingHumanApproval"),
    riskSummary: jsonb("risk_summary").notNull().default({}).$type<Record<string, unknown>>(),
    moreInfoQuestion: text("more_info_question"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("approval_request_tenant_status_idx").on(t.tenantId, t.status),
    uniqueIndex("approval_request_tenant_tool_call_key").on(t.tenantId, t.toolCallId),
  ],
);

/** **tool_call_event** — append-only transition log (LLD §6.3). */
export const toolCallEvent = pgTable(
  "tool_call_event",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull().references(() => tenant.id),
    toolCallId: uuid("tool_call_id").notNull().references(() => toolCall.id),
    fromStatus: toolCallStatusEnum("from_status"),
    toStatus: toolCallStatusEnum("to_status").notNull(),
    actorType: text("actor_type").notNull().$type<"Customer" | "HumanAgent" | "System">(),
    actorUserId: uuid("actor_user_id"),
    note: text("note"),
    accepted: boolean("accepted").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("tool_call_event_tenant_tool_call_idx").on(t.tenantId, t.toolCallId)],
);
