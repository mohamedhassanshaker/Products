import {
  boolean,
  check,
  index,
  jsonb,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tenant } from "./tenancy.js";
import { backendTypeEnum, circuitStateEnum, connector } from "./connectors.js";
import { agentDefinitionVersion } from "./agent-platform.js";

// LLD §3.6 enums
export const rwClassEnum = pgEnum("rw_class", ["Read", "Write"]);
export const classSourceEnum = pgEnum("class_source", ["AutoHeuristic", "AdminOverride"]);
export const approvalTierEnum = pgEnum("approval_tier", ["Tier1", "Tier2", "Tier3"]);
export const tierSourceEnum = pgEnum("tier_source", ["BackendTypeDefault", "AdminOverride"]);
export const toolStatusEnum = pgEnum("tool_status", ["Active", "Disabled", "Error", "Removed"]);
export const ruleScopeEnum = pgEnum("rule_scope", ["Tool", "Connector", "BackendType"]);
export const permissionEffectEnum = pgEnum("permission_effect", ["Allow", "Deny", "RequireApproval"]);

export interface RateLimitConfig {
  perMinute?: number;
  perConversation?: number;
  perCustomerPerDay?: number;
}

export interface PermissionCondition {
  channelTypes?: string[];
  roleIds?: string[];
  recognizedTasks?: string[];
  customerSegments?: string[];
  environments?: string[];
  expression?: string;
}

/** **capability_group** (LLD §3.6). */
export const capabilityGroup = pgTable(
  "capability_group",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id),
    name: text("name").notNull(),
    guidanceText: text("guidance_text"),
    priorityWeight: smallint("priority_weight").notNull().default(50),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("capability_group_tenant_name_key").on(t.tenantId, t.name)],
);

/**
 * Target Architecture Blueprint Phase 14 (BL-46, FR-ORC-01, LLD §14.7.1) — a
 * specialist agent version registered for delegation is an entry in THIS catalog,
 * with its own read/write classification and approval tier, exactly like an MCP
 * tool. There is deliberately no parallel `agent_tool` table: delegation reuses
 * `tool_permission_rule`, the resolver, the simulate preview, `visible_to_agent`/
 * `priority_weight`/`capability_group_id`, `tool_call`/`tool_call_event` and the
 * Approval Queue verbatim.
 */
export const toolKindEnum = pgEnum("tool_kind", ["McpTool", "AgentAsTool"]);

/** **tool** (LLD §3.6, BL-03). `circuit_state` is computed by BL-11's circuit-breaker
 * subsystem (a later phase) — this phase seeds it `Closed` and never flips it via an
 * admin API path; `rule 2` of the permission resolver reads it defensively regardless. */
export const tool = pgTable(
  "tool",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id),
    /**
     * Phase 14 (BL-46, LLD §14.7.1) — relaxed from NOT NULL to NULL. This is the
     * ONLY relaxation of an existing NOT NULL in this area, and it is not a data
     * change: every pre-existing row keeps its value, and the paired CHECK
     * `tool_kind_connector_consistency` makes "an `McpTool` always has a connector"
     * a database-enforced invariant rather than a column-level one. An
     * `AgentAsTool` has no connector by construction (there is no MCP server behind
     * a specialist agent), which is precisely why the column had to become
     * conditional rather than unconditional.
     */
    connectorId: uuid("connector_id").references(() => connector.id),
    /** Phase 14 (BL-46, LLD §14.7.1). Defaults `'McpTool'`, so every pre-existing
     * row is backfilled trivially and keeps its exact prior meaning. */
    kind: toolKindEnum("kind").notNull().default("McpTool"),
    /** Phase 14 (BL-46, LLD §14.7.1) — the PINNED specialist version this tool
     * delegates to. NULL iff `kind = 'McpTool'` (CHECK
     * `tool_kind_agent_version_consistency`). */
    agentDefinitionVersionId: uuid("agent_definition_version_id").references(() => agentDefinitionVersion.id),
    name: text("name").notNull(),
    displayName: text("display_name"),
    descriptionSource: text("description_source").notNull(),
    descriptionOverride: text("description_override"),
    currentSchemaVersionId: uuid("current_schema_version_id"),
    rwClass: rwClassEnum("rw_class").notNull(),
    rwClassSource: classSourceEnum("rw_class_source").notNull(),
    approvalTier: approvalTierEnum("approval_tier").notNull(),
    approvalTierSource: tierSourceEnum("approval_tier_source").notNull(),
    supportsIdempotencyKey: boolean("supports_idempotency_key").notNull().default(false),
    allowAutoRetry: boolean("allow_auto_retry").notNull().default(false),
    visibleToAgent: boolean("visible_to_agent").notNull().default(true),
    priorityWeight: smallint("priority_weight").notNull().default(50),
    // Phase 6 (BL-28, LLD §14.3.3) — `ON DELETE SET NULL` so "delete a capability
    // group -> its tools become Ungrouped" is engine-enforced as a backstop, even
    // though the application path (`deleteCapabilityGroup`) already performs this
    // reassignment explicitly and never hard-deletes a group row itself.
    capabilityGroupId: uuid("capability_group_id").references(() => capabilityGroup.id, { onDelete: "set null" }),
    status: toolStatusEnum("status").notNull().default("Active"),
    circuitState: circuitStateEnum("circuit_state").notNull().default("Closed"),
    circuitOpenedAt: timestamp("circuit_opened_at", { withTimezone: true }),
    circuitTripReason: text("circuit_trip_reason"),
    channelRestrictions: jsonb("channel_restrictions").$type<string[]>(),
    rateLimit: jsonb("rate_limit").$type<RateLimitConfig>(),
    lastCalledAt: timestamp("last_called_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // NOTE: `tool_tenant_connector_name_key` is retained verbatim. Postgres treats
    // NULLs as distinct in a UNIQUE index, so it no longer constrains `AgentAsTool`
    // rows at all — their own uniqueness ("one tool row per pinned specialist
    // version per tenant") is a separate partial unique index authored in migration
    // `0076` (`tool_tenant_agent_version_key`), since drizzle-orm's builder has no
    // partial-index predicate support (the same note `escalation`/`agent_queue`
    // already carry).
    uniqueIndex("tool_tenant_connector_name_key").on(t.tenantId, t.connectorId, t.name),
    index("tool_tenant_connector_idx").on(t.tenantId, t.connectorId),
    index("tool_tenant_visible_status_idx").on(t.tenantId, t.visibleToAgent, t.status),
    index("tool_tenant_capability_group_idx").on(t.tenantId, t.capabilityGroupId),
    index("tool_tenant_approval_tier_idx").on(t.tenantId, t.approvalTier),
    // Phase 14 (BL-46) — the agent-tool registrar's own lookup ("is there already a
    // tool row for this pinned specialist version?").
    index("tool_tenant_kind_agent_version_idx").on(t.tenantId, t.kind, t.agentDefinitionVersionId),
    check("tool_priority_weight_range", sql`${t.priorityWeight} BETWEEN 1 AND 100`),
    // LLD §14.7.1's two biconditional CHECKs — each kind's shape is enforced by the
    // database, not merely by the writing service.
    check("tool_kind_agent_version_consistency", sql`(${t.kind} = 'AgentAsTool') = (${t.agentDefinitionVersionId} IS NOT NULL)`),
    check("tool_kind_connector_consistency", sql`(${t.kind} = 'McpTool') = (${t.connectorId} IS NOT NULL)`),
  ],
);

/** **tool_schema_version** (LLD §3.6, append-only). */
export const toolSchemaVersion = pgTable(
  "tool_schema_version",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id),
    toolId: uuid("tool_id")
      .notNull()
      .references(() => tool.id),
    versionOrdinal: smallint("version_ordinal").notNull(),
    inputSchema: jsonb("input_schema").notNull(),
    outputSchema: jsonb("output_schema").notNull(),
    schemaHash: text("schema_hash").notNull(),
    breakingChange: boolean("breaking_change").notNull(),
    changeSummary: jsonb("change_summary").$type<{ added: string[]; removed: string[]; modified: string[] } | null>(),
    discoveredAt: timestamp("discovered_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("tool_schema_version_tenant_tool_ordinal_key").on(t.tenantId, t.toolId, t.versionOrdinal),
    index("tool_schema_version_tenant_tool_idx").on(t.tenantId, t.toolId),
  ],
);

/** **tool_permission_rule** (LLD §3.6, FR-MCP-04). Exactly one of
 * `toolId`/`connectorId`/`backendType` is populated, matching `scope`. */
export const toolPermissionRule = pgTable(
  "tool_permission_rule",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id),
    scope: ruleScopeEnum("scope").notNull(),
    toolId: uuid("tool_id").references(() => tool.id),
    connectorId: uuid("connector_id").references(() => connector.id),
    backendType: backendTypeEnum("backend_type"),
    ordinal: smallint("ordinal").notNull(),
    conditions: jsonb("conditions").notNull().$type<PermissionCondition>(),
    effect: permissionEffectEnum("effect").notNull(),
    requiredTier: approvalTierEnum("required_tier"),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("tool_permission_rule_tenant_scope_idx").on(t.tenantId, t.scope, t.ordinal),
    index("tool_permission_rule_tenant_tool_idx").on(t.tenantId, t.toolId),
    index("tool_permission_rule_tenant_connector_idx").on(t.tenantId, t.connectorId),
    check(
      "tool_permission_rule_scope_target_consistency",
      sql`(${t.scope} = 'Tool' AND ${t.toolId} IS NOT NULL AND ${t.connectorId} IS NULL AND ${t.backendType} IS NULL)
       OR (${t.scope} = 'Connector' AND ${t.connectorId} IS NOT NULL AND ${t.toolId} IS NULL AND ${t.backendType} IS NULL)
       OR (${t.scope} = 'BackendType' AND ${t.backendType} IS NOT NULL AND ${t.toolId} IS NULL AND ${t.connectorId} IS NULL)`,
    ),
    check(
      "tool_permission_rule_required_tier_only_when_require_approval",
      sql`(${t.effect} = 'RequireApproval' AND ${t.requiredTier} IS NOT NULL) OR (${t.effect} != 'RequireApproval' AND ${t.requiredTier} IS NULL)`,
    ),
  ],
);
