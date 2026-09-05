import { check, index, integer, jsonb, numeric, pgEnum, pgTable, smallint, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tenant } from "./tenancy.js";
import { agentDefinitionVersion } from "./agent-platform.js";
import { modelRouteVersion } from "./model-gateway.js";
import { approvalTierEnum, tool } from "./tool-registry.js";
import { toolCall } from "./approvals.js";

/**
 * **Module E — Multi-agent orchestration** (ADR-0012, LLD §14.7).
 *
 * Target Architecture Blueprint Phase 6 (BL-37) shipped `delegation_event` alone:
 * the delegation trace-tree's DATA MODEL plus its read-side query/rendering, so
 * that Phase 14 could write real rows into an already-proven schema/UI instead of
 * building both simultaneously.
 *
 * **Target Architecture Blueprint Phase 14 (BL-46, FR-ORC-01/03-11)** completes the
 * module: `team`/`team_version`/`team_member` (below) and the live delegation
 * executor (`packages/modules/teams/src/application/delegation-executor.ts`). Two
 * things Phase 6 explicitly deferred are closed here:
 *
 *  - **The three FK-less `delegation_event` columns are now real FKs.**
 *    `team_version_id`, `from_member_id` and `to_member_id` were FK-less purely
 *    because their target tables did not exist yet (the same "FK-less by design
 *    until the target module ships" relaxation `mcp_registry.artifact_mcp_pin`
 *    established). Migration `0076` adds the three constraints for real.
 *    `conversation_id`/`escalation_id` stay FK-less, unchanged — those are
 *    genuinely optional cross-cutting links, not this row's identity chain, matching
 *    `pii.guardrail_event`'s existing convention.
 *
 *  - **Partitioning stays deferred, deliberately and explicitly.** Phase 6 said to
 *    revisit "once Phase 14's executor makes this table's volume real". It is now
 *    real but small: a run writes at most `limits.maxDelegations` rows (single
 *    digits, DB-capped by the `depth 0..8` CHECK and by FR-ORC-07's ceilings), and
 *    no channel-to-team binding ships in this phase's specified API surface, so
 *    per-tenant volume stays well below `domain_event`'s — which this project's own
 *    precedent leaves unpartitioned. Adding monthly partitioning later still needs
 *    no application-code change.
 */

// ---------------------------------------------------------------------------
// Phase 14 (BL-46) enums
// ---------------------------------------------------------------------------

export const teamStatusEnum = pgEnum("team_status", ["Active", "Archived"]);

/** Identical ladder to `agent_version_status` (LLD §14.7.2's own wording) —
 * deliberately the same six states rather than a looser parallel one, so a team
 * version is promoted through exactly the gate an agent version is. Declared as its
 * own Postgres type (not a reuse of `agent_version_status`) because the two
 * artifacts' ladders are allowed to diverge later without an enum-value collision
 * across unrelated tables — the same reasoning `deploy_environment` already records. */
export const teamVersionStatusEnum = pgEnum("team_version_status", [
  "Draft",
  "EvalGated",
  "HumanReview",
  "Approved",
  "Production",
  "Deprecated",
]);

/** FR-ORC-03: `Escalate` is "the default and only currently specified mode"
 * ("never silently degrade"). A one-value enum is deliberate — a future mode is an
 * additive `ALTER TYPE ... ADD VALUE` plus its own executor branch, never a silent
 * reinterpretation of this one. */
export const teamFailureModeEnum = pgEnum("team_failure_mode", ["Escalate"]);

/** FR-ORC-10 — what happens when a member is unavailable. */
export const teamMemberFallbackActionEnum = pgEnum("team_member_fallback_action", ["Member", "Escalate"]);

// ---------------------------------------------------------------------------
// team / team_version / team_member (LLD §14.7.2)
// ---------------------------------------------------------------------------

/**
 * **team** — identity row. `current_version_id` intentionally carries NO Drizzle
 * `.references()` (the same pattern `skill.current_version_id` / `model_route.
 * current_version_id` already use) to avoid a circular table-definition reference
 * within this file; the real FK constraint is added by migration `0076` via a
 * standalone `ALTER TABLE ... ADD CONSTRAINT` once `team_version` exists.
 */
export const team = pgTable(
  "team",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id),
    name: text("name").notNull(),
    description: text("description"),
    status: teamStatusEnum("status").notNull().default("Active"),
    /** The latest `Production` version — `null` until one is promoted. */
    currentVersionId: uuid("current_version_id"),
    createdByUserId: uuid("created_by_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("team_tenant_name_key").on(t.tenantId, t.name), index("team_tenant_status_idx").on(t.tenantId, t.status)],
);

/**
 * **team_version** — immutable once created, via this project's established
 * three-layer enforcement (identical to `skill_version` / `agent_definition_version`
 * / `model_route_version`): (1) the repository exposes only `create` plus the
 * narrow status-transition methods, never a generic `update`; (2) migration `0076`
 * adds a `BEFORE UPDATE` trigger `team_version_immutable` raising
 * `TEAM_VERSION_IMMUTABLE` for any other column change, so even a raw-SQL path
 * cannot bypass (1); (3) `teams.immutability.int.test.ts` recomputes `yaml_hash` on
 * read and compares it to the stored value.
 */
export const teamVersion = pgTable(
  "team_version",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id),
    teamId: uuid("team_id")
      .notNull()
      .references(() => team.id),
    /** Monotonic per `(tenant, team)` — `support_team@3` is the reference form, the
     * same totally-ordered integer ordinal `skill_version.version` uses. */
    version: integer("version").notNull(),
    yaml: text("yaml").notNull(),
    yamlHash: text("yaml_hash").notNull(),
    supervisorDefinitionVersionId: uuid("supervisor_definition_version_id")
      .notNull()
      .references(() => agentDefinitionVersion.id),
    /**
     * FR-ORC-03 — validated AT SAVE to resolve to a router-class route
     * (`model_route.name = 'chat.router'` or `model_route.role = 'chat.router'`,
     * Model Gateway v2's own already-existing role metadata, never a second
     * router-classification concept). A frontier-class route produces
     * `TEAM_SUPERVISOR_ROUTE_EXPENSIVE`.
     */
    supervisorRouteVersionId: uuid("supervisor_route_version_id")
      .notNull()
      .references(() => modelRouteVersion.id),
    /** FR-ORC-07's run-level ceilings — `TeamLimitsSchema`
     * (`{maxDepth, maxFanOut, maxDelegations, runBudget:{usd,seconds},
     * thrashWindow:{repeats, similarityThreshold}}`). ALL fields required, no
     * partial: an omitted safety limit is refused at save, never guessed at. */
    limitsJson: jsonb("limits_json").notNull(),
    /**
     * FR-ORC-03's literal enforcement: **NOT NULL with NO DEFAULT**. A team version
     * inserted without a `failure_mode` is a constraint violation, not a row that
     * silently acquires `'Escalate'`.
     */
    failureMode: teamFailureModeEnum("failure_mode").notNull(),
    /** `ScopeDescriptorSchema` with `origin='TeamVersion'` (LLD §14.7.2) — handed
     * verbatim to `@nextbot/authz`'s `evaluateOrDeny` as a chain level. Its
     * `budget` sub-object is projected from `limits_json` at save time, which is
     * how FR-ORC-07's RUN-level ceilings become the evaluator's own step-2 check
     * rather than a second, independently-derived enforcement. */
    scopeJson: jsonb("scope_json").notNull(),
    status: teamVersionStatusEnum("status").notNull().default("Draft"),
    evalSuiteId: uuid("eval_suite_id"),
    lastEvalRunId: uuid("last_eval_run_id"),
    /**
     * FR-ORC-11 — **required before `Approved`**, and validated to be a run in
     * which `delegation_event` rows exist for EVERY `team_member`: a
     * supervisor-only run fails that check with
     * `TEAM_SANDBOX_TOPOLOGY_INCOMPLETE`. FK-less on purpose, mirroring
     * `delegation_event.agent_run_id`'s own convention in this same file.
     */
    sandboxRunId: uuid("sandbox_run_id"),
    createdByUserId: uuid("created_by_user_id").notNull(),
    /** Four-eyes: the approver may never be the author (DB CHECK below). */
    approvedByUserId: uuid("approved_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("team_version_tenant_team_version_key").on(t.tenantId, t.teamId, t.version),
    index("team_version_tenant_status_idx").on(t.tenantId, t.status),
    index("team_version_tenant_hash_idx").on(t.tenantId, t.yamlHash),
    check("team_version_approver_distinct", sql`${t.approvedByUserId} IS NULL OR ${t.approvedByUserId} <> ${t.createdByUserId}`),
  ],
);

/**
 * **team_member** — one scoped specialist inside a team version. Pinned by version
 * (`definition_version_id`), so promoting a member's underlying agent definition to
 * a new version never silently changes a production team's behavior (FR-ORC-03).
 *
 * `fallback_member_id` intentionally carries no Drizzle `.references()` — it is a
 * self-FK, added by migration `0076` as a standalone `ALTER TABLE` alongside its
 * `<> id` CHECK, the same convention every other self/mutual FK in this schema
 * package uses (`mcp_server_version.supersedes_version_id`, `eval_run.
 * baseline_run_id`). A *cycle* among fallbacks (A -> B -> A) is not expressible as
 * a CHECK and is rejected at save by a real cycle-detection walk
 * (`teams/domain/fallback-cycle.ts`, `TEAM_FALLBACK_CYCLE`).
 */
export const teamMember = pgTable(
  "team_member",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id),
    teamVersionId: uuid("team_version_id")
      .notNull()
      .references(() => teamVersion.id),
    definitionVersionId: uuid("definition_version_id")
      .notNull()
      .references(() => agentDefinitionVersion.id),
    /** The `AgentAsTool` `tool` row this member delegates through (FR-ORC-01) —
     * the whole reason delegation reuses the existing permission/approval path. */
    toolId: uuid("tool_id")
      .notNull()
      .references(() => tool.id),
    memberKey: text("member_key").notNull(),
    delegationTier: approvalTierEnum("delegation_tier").notNull(),
    /** FR-ORC-03's natural-language routing condition, handed to the supervisor's
     * router model as the member's selection criterion. */
    invokeWhen: text("invoke_when").notNull(),
    /** `ScopeDescriptorSchema` with `origin='TeamMember'` (LLD §14.7.2). */
    scopeJson: jsonb("scope_json").notNull(),
    fallbackMemberId: uuid("fallback_member_id"),
    fallbackAction: teamMemberFallbackActionEnum("fallback_action").notNull().default("Escalate"),
    ordinal: smallint("ordinal").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("team_member_tenant_version_key_key").on(t.tenantId, t.teamVersionId, t.memberKey),
    index("team_member_tenant_version_ordinal_idx").on(t.tenantId, t.teamVersionId, t.ordinal),
    index("team_member_tenant_definition_version_idx").on(t.tenantId, t.definitionVersionId),
    index("team_member_tenant_tool_idx").on(t.tenantId, t.toolId),
    check(
      "team_member_fallback_consistency",
      sql`(${t.fallbackAction} = 'Member') = (${t.fallbackMemberId} IS NOT NULL)`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// delegation_event (Phase 6 / BL-37; FKs completed by Phase 14 / BL-46)
// ---------------------------------------------------------------------------

export const delegationOutcomeEnum = pgEnum("delegation_outcome", [
  "Answered",
  "NotMine",
  "Escalated",
  "Failed",
  "Denied",
  "BudgetExceeded",
  "FallbackUsed",
  "Timeout",
  // Phase 14 (BL-46, FR-ORC-04, migration `0078`) — the delegation hop itself was
  // Tier-2/Tier-3 and suspended into the Approval Queue instead of completing. See
  // that migration's header for why none of the eight prior values could carry this
  // honestly.
  "AwaitingApproval",
]);

export const delegationEvent = pgTable(
  "delegation_event",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id),
    conversationId: uuid("conversation_id"),
    agentRunId: uuid("agent_run_id").notNull(),
    /** Phase 14 (BL-46) — a REAL FK now that `team_version` exists. */
    teamVersionId: uuid("team_version_id")
      .notNull()
      .references(() => teamVersion.id),
    parentDelegationEventId: uuid("parent_delegation_event_id"),
    parentSpanId: text("parent_span_id"),
    spanId: text("span_id").notNull(),
    depth: smallint("depth").notNull(),
    siblingOrdinal: smallint("sibling_ordinal").notNull().default(0),
    fromAgentVersionId: uuid("from_agent_version_id")
      .notNull()
      .references(() => agentDefinitionVersion.id),
    /** Phase 14 (BL-46) — a REAL FK now that `team_member` exists. NULL when the
     * delegating side is the supervisor itself (which has no member row). */
    fromMemberId: uuid("from_member_id").references(() => teamMember.id),
    toAgentVersionId: uuid("to_agent_version_id")
      .notNull()
      .references(() => agentDefinitionVersion.id),
    /** Phase 14 (BL-46) — a REAL FK now that `team_member` exists. */
    toMemberId: uuid("to_member_id")
      .notNull()
      .references(() => teamMember.id),
    toolCallId: uuid("tool_call_id").references(() => toolCall.id),
    /** The supervisor's stated routing rationale. Internal-only (spec §9.5 item 4)
     * — the widget/customer-facing DTO mappers live in `conversations`, which has
     * no allowed dependency on `teams` (LLD §14.7.4, enforced by the
     * `no-teams-inside-conversations` dependency-cruiser rule Phase 14 adds), so
     * this column is structurally unreachable from any customer-visible surface. */
    reason: text("reason").notNull(),
    /** The §14.2 `PermissionIntersectionResult.scopeHash` the specialist ran
     * under — joins back to the exact evaluator decision this hop made. */
    scopeHash: text("scope_hash").notNull(),
    outcome: delegationOutcomeEnum("outcome").notNull(),
    outcomeDetail: jsonb("outcome_detail"),
    fallbackOfEventId: uuid("fallback_of_event_id"),
    tokensIn: integer("tokens_in").notNull().default(0),
    tokensOut: integer("tokens_out").notNull().default(0),
    costUsd: numeric("cost_usd", { precision: 18, scale: 8 }).notNull().default("0"),
    latencyMs: integer("latency_ms"),
    escalationId: uuid("escalation_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("delegation_event_depth_range", sql`${t.depth} >= 0 AND ${t.depth} <= 8`),
    // "One indexed scan renders the whole tree" (LLD §14.7.2's own words).
    index("delegation_event_tenant_run_depth_idx").on(t.tenantId, t.agentRunId, t.depth, t.siblingOrdinal),
    index("delegation_event_tenant_conversation_idx").on(t.tenantId, t.conversationId, t.createdAt),
    index("delegation_event_tenant_parent_idx").on(t.tenantId, t.parentDelegationEventId),
    index("delegation_event_tenant_to_member_idx").on(t.tenantId, t.toMemberId, t.createdAt),
    index("delegation_event_tenant_escalation_idx").on(t.tenantId, t.escalationId),
  ],
);
