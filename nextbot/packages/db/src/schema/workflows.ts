import { type AnyPgColumn, check, index, integer, jsonb, numeric, pgEnum, pgTable, smallint, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tenant } from "./tenancy.js";
import { conversation } from "./conversations.js";
import { toolCall } from "./approvals.js";

/**
 * Target Architecture Blueprint Phase 15 (BL-47a, FR-WF-01/02/04, LLD §14.6.1) —
 * Module: Workflow Designer, **authoring half only**. `workflow` (identity) +
 * `workflow_version` (immutable, the same triple-enforcement pattern
 * `agent_definition_version`/`skill_version`/`team_version` all use).
 *
 * **Target Architecture Blueprint Phase 16 (BL-47b, FR-WF-05/06/07, LLD §14.6.2)**
 * adds the DURABLE EXECUTION half to this same file: `workflow_run`,
 * `workflow_run_lease` and `workflow_run_step`, plus the five runtime enums Phase 15
 * deliberately did not create. Phase 15's original scope note read "this file does
 * NOT define `workflow_run`/`workflow_run_lease`/`workflow_run_step` … that is Phase
 * 16's schema, a separate, later dispatch" — this is that dispatch, and
 * `workflow_version.sandbox_run_id` (added FK-less then, because there was no target
 * table) gains its real FK in migration `0081`.
 *
 * Placement authority for the executor that writes these tables: **ADR-0013 §7**
 * (amendment, 2026-08-30) and LLD §14.6.2's dated CORRECTION block — the executor is
 * a module in `packages/modules/workflows` hosted in-process by `apps/worker`;
 * `apps/runtime` stays an empty Phase-0 scaffold. The tables themselves are unchanged
 * from the original LLD §14.6.2 text: only the executor's host and the timer
 * mechanism were corrected, which is precisely the property the store-and-lease design
 * exists to give ("no executor state lives in a process").
 */

export const workflowStatusEnum = pgEnum("workflow_status", ["Active", "Archived"]);

/** Same relaxed Git-PR-status vocabulary `agent_definition_version`/`skill_version`
 * use (LLD §3.10/§14.5.1), reused-in-spirit rather than sharing the exact same
 * Postgres enum (each versioned artifact declares its own, per that same
 * precedent — see `skillGitPrStatusEnum`'s own doc comment). Workflow versions may
 * optionally ride the tenant's Git connection. */
export const workflowGitPrStatusEnum = pgEnum("workflow_git_pr_status", ["None", "Open", "Merged", "Closed"]);

/** Identical ladder to `agent_definition_version`/`skill_version`/`team_version`
 * (LLD §14.6.1's own wording: "identical ladder"). */
export const workflowVersionStatusEnum = pgEnum("workflow_version_status", [
  "Draft",
  "EvalGated",
  "HumanReview",
  "Approved",
  "Production",
  "Deprecated",
]);

/** LLD §14.6.3's 12 node kinds. Declared as a real Postgres enum for
 * documentation/future use (e.g. a `GROUP BY kind` reporting query); the actual
 * per-node shape validation happens against `WorkflowGraphSchema`
 * (`@nextbot/contracts`), never against this column alone — no table column
 * actually stores a bare `workflow_node_kind` value this phase (nodes live inside
 * `workflow_version.graph_json`, not a separate row-per-node table), but the type
 * is declared here per this phase's own LLD quote so it exists in the database
 * for the day a reporting/analytics view wants to reference it directly.
 *
 * **Phase 16 update**: `workflow_run_step.node_kind` is now that column — the enum
 * declared "for the day a reporting view wants it" is what every executed step is
 * stamped with, so the FR-WF-07 trace can render a run's path over the authored
 * graph without re-parsing `graph_json` per step. */
export const workflowNodeKindEnum = pgEnum("workflow_node_kind", [
  "Trigger",
  "Agent",
  "Skill",
  "ToolCall",
  "Router",
  "HumanTask",
  "Parallel",
  "Join",
  "Loop",
  "SubWorkflow",
  "Wait",
  "End",
]);

/** **workflow** — identity row. `current_version_id` intentionally carries NO
 * Drizzle `.references()` (the same pattern `team.current_version_id`/
 * `skill.current_version_id` already use) to avoid a circular table-definition
 * reference within this file; the real FK constraint is added by the migration
 * itself via a standalone `ALTER TABLE ... ADD CONSTRAINT` once `workflow_version`
 * exists. */
export const workflow = pgTable(
  "workflow",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id),
    name: text("name").notNull(),
    description: text("description"),
    status: workflowStatusEnum("status").notNull().default("Active"),
    /** The latest `Production` version — `null` until one is promoted. */
    currentVersionId: uuid("current_version_id"),
    createdByUserId: uuid("created_by_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("workflow_tenant_name_key").on(t.tenantId, t.name), index("workflow_tenant_status_idx").on(t.tenantId, t.status)],
);

/**
 * **workflow_version** — immutable once created, via this project's established
 * three-layer enforcement (identical to `agent_definition_version`/`skill_version`/
 * `team_version`): (1) the repository exposes only `create` plus the narrow
 * promotion-ladder bookkeeping setters, never a generic `update`; (2) the migration
 * adds a `BEFORE UPDATE` trigger `workflow_version_immutable` raising
 * `WORKFLOW_VERSION_IMMUTABLE` for any other column change; (3)
 * `workflows.immutability.int.test.ts` recomputes `yaml_hash` on read and compares
 * it to the stored value.
 */
export const workflowVersion = pgTable(
  "workflow_version",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id),
    workflowId: uuid("workflow_id")
      .notNull()
      .references(() => workflow.id),
    /** Monotonic per `(tenant, workflow)` — the same totally-ordered integer
     * ordinal `skill_version.version`/`team_version.version` use. */
    version: integer("version").notNull(),
    yaml: text("yaml").notNull(),
    yamlHash: text("yaml_hash").notNull(),
    /** `WorkflowGraphSchema`'s parsed projection (`@nextbot/contracts`). Canvas
     * layout hints live under `graph_json.spec.layout` and are EXCLUDED from
     * `yaml_hash` — moving a box on the canvas is never a new version (see
     * `domain/workflow-artifact.ts`'s hashing function). */
    graphJson: jsonb("graph_json").notNull(),
    /** `ScopeDescriptorSchema` with `origin='WorkflowVersion'` (LLD §14.6.1) —
     * composed server-side from the artifact's authorable `spec.scope`
     * (`domain/workflow-scope.ts`), never authored directly (origin/originId are
     * never author-supplied — see `@nextbot/contracts`'s `workflows.ts` module
     * doc). */
    scopeJson: jsonb("scope_json").notNull(),
    /** `WorkflowRunLimitsSchema` — `{maxSteps, maxCostUsd, maxWallClockSeconds,
     * maxLoopIterations, maxParallelBranches, maxSubWorkflowDepth}`; ALL required,
     * no schema-level defaults. */
    runLimits: jsonb("run_limits").notNull(),
    status: workflowVersionStatusEnum("status").notNull().default("Draft"),
    evalSuiteId: uuid("eval_suite_id"),
    lastEvalRunId: uuid("last_eval_run_id"),
    /**
     * Required non-null before `Approved` (`domain/promotion-policy.ts`).
     * **Disclosed, deliberate scope boundary**: `workflow_run` does not exist until
     * Phase 16, so this column is FK-less (no target table to reference yet — the
     * same relaxation `team_version.sandbox_run_id` used before `delegation_event`
     * existed) and this phase's own promotion gate only checks non-null, never "of
     * this exact `yaml_hash`, `state='Succeeded'`" (that deeper check is added by
     * Phase 16 once `workflow_run` exists to check against). A workflow version
     * therefore CANNOT actually reach `Approved`/`Production` until Phase 16 ships
     * — this is the correct, intended behavior of this phase's own scope boundary,
     * not a defect.
     */
    sandboxRunId: uuid("sandbox_run_id"),
    gitCommitSha: text("git_commit_sha"),
    gitPrNumber: integer("git_pr_number"),
    gitPrStatus: workflowGitPrStatusEnum("git_pr_status").notNull().default("None"),
    createdByUserId: uuid("created_by_user_id").notNull(),
    /** Four-eyes: the approver may never be the author (DB CHECK below). */
    approvedByUserId: uuid("approved_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("workflow_version_tenant_workflow_version_key").on(t.tenantId, t.workflowId, t.version),
    index("workflow_version_tenant_status_idx").on(t.tenantId, t.status),
    index("workflow_version_tenant_hash_idx").on(t.tenantId, t.yamlHash),
    check("workflow_version_approver_distinct", sql`${t.approvedByUserId} IS NULL OR ${t.approvedByUserId} <> ${t.createdByUserId}`),
  ],
);

// ---------------------------------------------------------------------------
// Durable execution (Target Architecture Blueprint Phase 16, BL-47b, LLD §14.6.2)
// ---------------------------------------------------------------------------

/** The run state machine. `Compensating` is the FR-WF-04 unwind pass: a run that
 * failed with a non-empty compensation stack enters it before reaching a terminal
 * state, so a distributed transaction with no rollback path never simply stops
 * half-applied. */
export const workflowRunStateEnum = pgEnum("workflow_run_state", [
  "Pending",
  "Running",
  "Suspended",
  "Compensating",
  "Succeeded",
  "Failed",
  "TimedOut",
  "Cancelled",
]);

/** Deliberately WIDER than `@nextbot/contracts`' `WorkflowRunOutcome`, which is the
 * 4-value AUTHORABLE union an `End` node's `outcome` / a `Wait`/`HumanTask` node's
 * `onTimeout` may declare. `BudgetExceeded`/`Timeout`/`Cancelled` are outcomes only
 * the runtime can produce — no author can express them, so no authored node can be
 * mislabelled as one, and FR-WF-06's "logged distinctly from a node-level `Failed`"
 * is a type-level distinction rather than a convention. */
export const workflowRunOutcomeEnum = pgEnum("workflow_run_outcome", [
  "Resolved",
  "Escalated",
  "Transferred",
  "Failed",
  "BudgetExceeded",
  "Timeout",
  "Cancelled",
]);

export const workflowTriggerKindEnum = pgEnum("workflow_trigger_kind", ["ChannelEvent", "Webhook", "Schedule", "Manual", "Sandbox", "SubWorkflow"]);

export const workflowStepStatusEnum = pgEnum("workflow_step_status", [
  "Pending",
  "Running",
  "Suspended",
  "Succeeded",
  "Failed",
  "Skipped",
  "Compensated",
  "Cancelled",
]);

/** What a `Suspended` run is waiting on. `Approval` is a Tier-2/3 tool call that
 * stopped at the EXISTING Approval Queue (ADR-0013 §2.3's "there is no third queue");
 * `HumanTask` is a `HumanTask` node routed to the EXISTING Escalation Queue. */
export const suspensionKindEnum = pgEnum("suspension_kind", ["HumanTask", "Wait", "SubWorkflow", "Approval"]);

/** What kind of pinned artifact a step invoked — snapshotted alongside `ref_label` so
 * a trace stays readable after the artifact is deleted (NFR-10). */
export const workflowStepRefKindEnum = pgEnum("workflow_step_ref_kind", ["AgentVersion", "SkillVersion", "Tool", "WorkflowVersion", "None"]);

/**
 * **workflow_run** — one durable execution of a `workflow_version`.
 *
 * The design goal (LLD §14 preamble, restated in §14.6.2) is that **no executor state
 * lives in a process**: everything needed to resume is in `checkpoint_json` +
 * `current_node_ids` + the counters below, so a run is resumable by any `apps/worker`
 * replica after any restart, and the executor's host is a deployment fact rather than
 * a schema fact.
 */
export const workflowRun = pgTable(
  "workflow_run",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id),
    workflowVersionId: uuid("workflow_version_id")
      .notNull()
      .references(() => workflowVersion.id),
    /** NULL for schedule/webhook-triggered runs. A run with no conversation genuinely
     * cannot suspend into the Approval Queue (`tool_call.conversation_id` is a NOT
     * NULL FK) — the executor surfaces that as a node failure through the node's own
     * `onError`, never as a silent bypass of tiering. */
    conversationId: uuid("conversation_id").references(() => conversation.id),
    /** FK-less, matching `tool_call.agent_run_id`/`delegation_event.agent_run_id`'s
     * established convention for a loosely-associated run id. */
    agentRunId: uuid("agent_run_id"),
    triggerKind: workflowTriggerKindEnum("trigger_kind").notNull(),
    /** Set iff `trigger_kind = 'SubWorkflow'` (DB CHECK) — a child run created by a
     * `SubWorkflow` node. */
    parentRunId: uuid("parent_run_id").references((): AnyPgColumn => workflowRun.id),
    depth: smallint("depth").notNull().default(0),
    state: workflowRunStateEnum("state").notNull().default("Pending"),
    outcome: workflowRunOutcomeEnum("outcome"),
    outcomeDetail: jsonb("outcome_detail").$type<Record<string, unknown> | null>(),
    /** The frontier — more than one entry while a `Parallel` branch is open.
     * Denormalized alongside `checkpoint_json.frontier` so the pump can scan it
     * without parsing JSON. */
    currentNodeIds: text("current_node_ids").array().notNull().default(sql`'{}'`),
    /** `WorkflowCheckpointSchema` (`@nextbot/contracts`) — the WHOLE resumable state:
     * variables, frontier, join barriers, loop counters, the compensation stack, and
     * the consumed-budget accumulator. */
    checkpointJson: jsonb("checkpoint_json").notNull().default({}),
    /** Bumped on every persist. The optimistic-concurrency guard that makes a stale
     * lease-holder's write fail loudly instead of clobbering a newer checkpoint. */
    checkpointSeq: integer("checkpoint_seq").notNull().default(0),
    suspensionKind: suspensionKindEnum("suspension_kind"),
    /** `approval_request:<uuid>` | `escalation:<uuid>` | `timer:<iso>` |
     * `workflow_run:<uuid>` | `event:<key>`. */
    suspensionRef: text("suspension_ref"),
    suspensionExpiresAt: timestamp("suspension_expires_at", { withTimezone: true }),
    suspensionExpiryOutcome: workflowRunOutcomeEnum("suspension_expiry_outcome"),
    stepsExecuted: integer("steps_executed").notNull().default(0),
    /** `Record<nodeId, count>` — FR-WF-06's per-Loop iteration ceilings. */
    loopIterations: jsonb("loop_iterations").notNull().default({}).$type<Record<string, number>>(),
    costUsd: numeric("cost_usd", { precision: 18, scale: 8 }).notNull().default("0"),
    scopeHash: text("scope_hash").notNull(),
    otelTraceId: text("otel_trace_id").notNull(),
    /** Trigger-supplied. A redelivered webhook resumes the existing run rather than
     * starting a second one — the UNIQUE below is the whole mechanism. */
    idempotencyKey: text("idempotency_key").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("workflow_run_tenant_idempotency_key_key").on(t.tenantId, t.idempotencyKey),
    index("workflow_run_tenant_version_started_idx").on(t.tenantId, t.workflowVersionId, t.startedAt.desc()),
    index("workflow_run_tenant_conversation_idx").on(t.tenantId, t.conversationId),
    index("workflow_run_tenant_parent_idx").on(t.tenantId, t.parentRunId),
    check("workflow_run_depth_bounded", sql`${t.depth} >= 0 AND ${t.depth} <= 8`),
    // FR-WF-05: "no suspension is indefinite". Written as one biconditional so neither
    // direction can drift — a Suspended run cannot lack the four fields, and a
    // non-Suspended run cannot retain a suspension kind.
    check(
      "workflow_run_suspension_consistent",
      sql`(${t.state} = 'Suspended') = (${t.suspensionKind} IS NOT NULL)
          AND (${t.state} <> 'Suspended' OR (${t.suspensionRef} IS NOT NULL
                                             AND ${t.suspensionExpiresAt} IS NOT NULL
                                             AND ${t.suspensionExpiryOutcome} IS NOT NULL))`,
    ),
    check("workflow_run_outcome_terminal_only", sql`${t.outcome} IS NULL OR ${t.state} IN ('Succeeded','Failed','TimedOut','Cancelled')`),
    check("workflow_run_ended_at_terminal_only", sql`${t.endedAt} IS NULL OR ${t.state} IN ('Succeeded','Failed','TimedOut','Cancelled')`),
    check("workflow_run_parent_implies_subworkflow", sql`(${t.parentRunId} IS NULL) = (${t.triggerKind} <> 'SubWorkflow')`),
  ],
);

/**
 * **workflow_run_lease** — the exactly-one-advancer primitive (LLD §14.6.2,
 * ADR-0013 §7.2 constraint 3).
 *
 * `apps/worker`'s scheduler has no distributed lock, by design: every job that
 * predates this one is idempotent and therefore race-tolerant, and its own doc comment
 * says so. The workflow executor is the **first** job in that process for which
 * redundant concurrent execution would not be harmless — it advances a state machine
 * with real side effects. So this table is load-bearing rather than optional. The claim
 * is a single statement:
 *
 * ```sql
 * INSERT INTO workflow_run_lease (...) VALUES (...)
 *   ON CONFLICT (run_id) DO UPDATE SET owner = EXCLUDED.owner, ...
 *   WHERE workflow_run_lease.expires_at < now()
 * ```
 *
 * — so exactly one executor advances a run at a time, and a crashed executor's run
 * becomes reclaimable once its lease TTL passes (60s, renewed every 20s while a step
 * is in flight). `ON DELETE CASCADE` on `run_id` means a deleted run never strands an
 * orphan lease.
 */
export const workflowRunLease = pgTable(
  "workflow_run_lease",
  {
    runId: uuid("run_id")
      .primaryKey()
      .references(() => workflowRun.id, { onDelete: "cascade" }),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id),
    /** The worker instance id — process-scoped, regenerated on every boot, so a
     * restarted replica never mistakes its predecessor's lease for its own. */
    owner: text("owner").notNull(),
    acquiredAt: timestamp("acquired_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    /** The run's `checkpoint_seq` at acquisition — lets a holder detect that the run
     * advanced under a different owner while it was away. */
    checkpointSeqAtAcquire: integer("checkpoint_seq_at_acquire").notNull(),
  },
  (t) => [index("workflow_run_lease_tenant_expiry_idx").on(t.tenantId, t.expiresAt)],
);

/**
 * **workflow_run_step** — append-only, one row per node ATTEMPT (LLD §14.6.2).
 *
 * A retry is a new row with `attempt + 1`; a compensating action is a new row with
 * `compensation_of_step_id` pointing at the step it undoes. Nothing here is ever
 * edited in place, which is what keeps FR-WF-07's graph trace an honest record of what
 * the run actually did rather than a summary of where it ended up (NFR-10).
 */
export const workflowRunStep = pgTable(
  "workflow_run_step",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id),
    runId: uuid("run_id")
      .notNull()
      .references(() => workflowRun.id, { onDelete: "cascade" }),
    /** The AUTHORED node id from `graph_json` (e.g. `issue_refund`), never a row id —
     * that is what lets the trace viewer overlay steps onto the authored graph. */
    nodeId: text("node_id").notNull(),
    nodeKind: workflowNodeKindEnum("node_kind").notNull(),
    attempt: smallint("attempt").notNull().default(1),
    /** Loop iteration index; 0 outside a loop. **-1 is the reserved COMPENSATION
     * sentinel** (FR-WF-04): a compensating step is a new row, never an edit of the step
     * it undoes (NFR-10), and the out-of-band iteration is what structurally keeps it
     * from colliding with a retry of the same forward node in
     * `workflow_run_step_attempt_key`. No forward execution can produce -1 — a Loop's
     * index starts at 0 and only increases. */
    iteration: integer("iteration").notNull().default(0),
    /** Parallel branch discriminator; NULL outside a parallel region. */
    branchKey: text("branch_key"),
    refKind: workflowStepRefKindEnum("ref_kind").notNull(),
    refVersionId: uuid("ref_version_id"),
    /** Snapshot label — survives deletion of the referenced artifact (NFR-10). */
    refLabel: text("ref_label"),
    status: workflowStepStatusEnum("status").notNull(),
    /** PII-masked before persistence, through `@nextbot/pii`'s EXISTING masker — never
     * a second masking path (LLD §14.6.2's own instruction). */
    input: jsonb("input").$type<unknown>(),
    output: jsonb("output").$type<unknown>(),
    error: jsonb("error").$type<{ code: string; message: string; retriable: boolean } | null>(),
    /** The Tier-2/Tier-3 stop point when the node's tool required approval. */
    toolCallId: uuid("tool_call_id").references(() => toolCall.id),
    approvalRequestId: uuid("approval_request_id"),
    escalationId: uuid("escalation_id"),
    /** The `workflow_run` a `SubWorkflow` node spawned. */
    childRunId: uuid("child_run_id"),
    compensationOfStepId: uuid("compensation_of_step_id").references((): AnyPgColumn => workflowRunStep.id),
    costUsd: numeric("cost_usd", { precision: 18, scale: 8 }).notNull().default("0"),
    /** Joins to the ClickHouse `agent_run_span` table. */
    traceSpanId: text("trace_span_id"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("workflow_run_step_attempt_key").on(t.tenantId, t.runId, t.nodeId, t.iteration, t.attempt),
    index("workflow_run_step_tenant_run_started_idx").on(t.tenantId, t.runId, t.startedAt),
    index("workflow_run_step_tenant_node_status_idx").on(t.tenantId, t.nodeId, t.status),
    index("workflow_run_step_tenant_tool_call_idx").on(t.tenantId, t.toolCallId),
    check("workflow_run_step_attempt_positive", sql`${t.attempt} >= 1`),
    check("workflow_run_step_iteration_bounded", sql`${t.iteration} >= -1`),
  ],
);
