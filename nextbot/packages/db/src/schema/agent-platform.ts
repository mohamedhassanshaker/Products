import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tenant } from "./tenancy.js";
import { credential } from "./connectors.js";
import { modelRouteVersion } from "./model-gateway.js";
import { skill, skillVersion } from "./skills.js";

/**
 * Phase 10 (BL-07) — Agent Platform schema: agent definitions/versions, the tenant-
 * owned Git remote (LLD §3.10a / ADR-0009), the eval-suite promotion gate (LLD §3.10),
 * the Model Gateway's routing/budget/cache/call-log tables (LLD §7.1 / ADR-0006), and
 * `agent_run` (FR-AGT-09).
 *
 * **Deviation from LLD §3.10, recorded deliberately.** The LLD models `agent_definition`,
 * `eval_suite`/`eval_case`, and `model_route` with a nullable `tenant_id` ("NULL =
 * platform-shared" / "NULL = platform default"), intended to let NextBot ship
 * platform-wide template agent definitions, golden eval suites, and default model
 * routes visible to every tenant. Doing that correctly under this codebase's RLS model
 * (LLD §3.2 rule 1: `USING (tenant_id = current_setting(...))`) requires a policy that
 * treats a NULL tenant_id as "visible to all, writable only by a platform-level actor" —
 * a genuinely different (and easy to get subtly wrong) RLS shape than every other
 * tenant-scoped table in this codebase uses, and nothing in this phase's actual scope
 * (BL-07's agent-definition registry / eval gate / Model Gateway) requires a shipped
 * platform-wide template library, golden eval suite, or DB-row model-route default —
 * `AI_PROVIDER`/`AI_MODEL_*`/`AI_BASE_URL` env config already serves as the "platform
 * default" tier of LLD §7.1's three-tier resolution (tenant → platform → env default),
 * so nothing is actually missing end-to-end. `tenant_id` is therefore **NOT NULL** on
 * every table below; if/when a real platform-template-library feature is scoped, the
 * column can be relaxed to nullable with its own dedicated RLS policy at that time
 * rather than carrying unused complexity now.
 *
 * **Target Architecture Blueprint Phase 1 (BL-32, ADR-0011, LLD §14.8/§14.9.6):**
 * `model_provider` (previously defined here, platform-level, no `tenant_id`) moved to
 * `packages/db/src/schema/model-gateway.ts` and was extended in place (a real
 * ALTER-in-place migration — see that file's module doc).
 *
 * **Target Architecture Blueprint Phase 2 (BL-33, ADR-0011, LLD §14.8/§14.9.6):**
 * `model_route` / `model_budget` / `model_call_log` (renamed `model_usage_event`) /
 * `model_cache_entry` have now ALSO moved to `model-gateway.ts` (LLD §14.8.6 M4-M6),
 * completing the "extract Module F" end state — see that file's Phase 2 section for
 * the full shape. `agent_definition_version.model_route_key` (below) is retained as a
 * **non-authoritative display snapshot** only; `model_route_version_id` is the real,
 * immutable pin (FR-AGT-22 — "an agent version pins `route@version`").
 */

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const gitProviderEnum = pgEnum("git_provider", ["GitHub", "GitLab"]);
export const gitConnectionStatusEnum = pgEnum("git_connection_status", [
  "Connected",
  "Unreachable",
  "Disconnected",
]);
export const gitPrStatusEnum = pgEnum("git_pr_status", ["None", "Open", "Merged", "Closed"]);

/** NFR-12 pluggability seam (ADR-0003) — only `ADK` is executable in MVP. */
export const graphTypeEnum = pgEnum("graph_type", ["ADK", "LangGraph", "PydanticAI", "CustomFSM"]);

export const agentVersionStatusEnum = pgEnum("agent_version_status", [
  "Draft",
  "EvalGated",
  "HumanReview",
  "Approved",
  "Production",
  "Deprecated",
]);

export const evalRunStatusEnum = pgEnum("eval_run_status", ["Queued", "Running", "Passed", "Failed", "Error"]);
export const evalTriggeredByEnum = pgEnum("eval_triggered_by", ["VersionSubmitted", "Manual", "Scheduled"]);

// Target Architecture Blueprint Phase 12 (BL-44, FR-AGT-16/17/18, LLD §14.9.3) —
// eval harvesting from production, continuous runs, and rubric/regression-baseline
// gating extend the pre-existing eval_suite/eval_case/eval_run/eval_case_result
// tables in place (additive columns only — every pre-existing row keeps its exact
// prior meaning under each new column's default).
export const evalCaseSourceEnum = pgEnum("eval_case_source", [
  "Authored",
  "HarvestedConversation",
  "HarvestedEscalation",
  "HarvestedApprovalDenial",
  "SkillDerived",
]);
export const evalGateModeEnum = pgEnum("eval_gate_mode", ["AbsoluteThreshold", "RegressionBaseline", "Both"]);
export const evalRunKindEnum = pgEnum("eval_run_kind", ["PrePromotion", "Continuous", "Manual"]);

/** Distinct from `environment` (connector/channel vocabulary) per LLD's own callout in
 * `tenant-context.ts`; identical values today, kept as a separate Postgres type so the
 * two vocabularies can diverge later (e.g. a `Canary` deploy environment) without an
 * enum-value collision across unrelated tables. */
export const deployEnvironmentEnum = pgEnum("deploy_environment", ["Sandbox", "Staging", "Production"]);
// Phase 6 (BL-27, ADR-0017) — `EmergencyRollback` is a distinct action from
// `Rollback` so the deployment-history timeline can label it distinctly (ADR-0017
// §2.5's "visibility as the compensating control" — an emergency rollback must never
// be indistinguishable from an ordinary one).
// Phase 17 (BL-48/BL-13) note: `SplitChange` and `PromoteCanary` have existed here,
// UNWRITTEN, since migration `0014`. Phase 17's `setTrafficSplit`/`promoteCanary`
// (deployment-repository.ts) are the first code in this codebase's history to ever write
// either value — no enum change was needed, only a writer.
export const deploymentActionEnum = pgEnum("deployment_action", ["Deploy", "SplitChange", "PromoteCanary", "Rollback", "EmergencyRollback"]);

// Target Architecture Blueprint Phase 17 (BL-48, ADR-0019 §2.5, LLD §15.2) — shadow
// evaluation's own lifecycle enums.
export const shadowEvaluationStatusEnum = pgEnum("shadow_evaluation_status", ["Active", "Stopped", "Completed", "AutoStopped"]);
export const shadowRunStatusEnum = pgEnum("shadow_run_status", ["Pending", "Claimed", "Completed", "Failed", "Skipped"]);
export const shadowSkipReasonEnum = pgEnum("shadow_skip_reason", ["SourceGone", "QuotaDeferredTooLong", "EvaluationStopped"]);

// Phase 2 (BL-33, LLD §14.9.6) — `routing_strategy`/`cache_mode`/`model_budget_*`/
// `degraded_mode`/`model_call_status`/`cache_kind` enums moved to `model-gateway.ts`
// alongside the tables that use them (`model_route_version.policy_json` now carries
// strategy/cache-mode as plain string literals inside the versioned JSON rather than
// a standalone `routing_strategy`/`cache_mode` Postgres enum column — see LLD
// §14.8.2's `ModelRoutePolicySchema` — so `routing_strategy`/`cache_mode` themselves
// are dropped outright by migration `0044`, not merely relocated).

export const runTriggerEnum = pgEnum("run_trigger", [
  "CustomerMessage",
  "A2ATask",
  "HumanAgentAction",
  "EvalCase",
  "SandboxTest",
  "ResumeAfterHitl",
  // Target Architecture Blueprint Phase 17 (BL-48, ADR-0019 §2.5, migration `0083`) —
  // a run produced by shadow evaluation's asynchronous replay of a candidate version
  // against real live traffic. The run is real (real model calls, real spend, real
  // spans) but NO CUSTOMER EVER SAW IT, so every aggregate over `agent_run` must
  // exclude it. See `agent-run-repository.ts`'s `SHADOW_TRIGGER`/`excludeShadowRuns`
  // and the enumerated reader audit in
  // `docs/plans/progressive-rollout-shadow-evaluation-plan.md`.
  "ShadowEvaluation",
]);
export const runStatusEnum = pgEnum("run_status", [
  "Running",
  "Succeeded",
  "Failed",
  "PausedForApproval",
  "Cancelled",
  "TimedOut",
]);

// ---------------------------------------------------------------------------
// Git remote integration (LLD §3.10a, ADR-0009)
// ---------------------------------------------------------------------------

/** **git_connection** — one per tenant in MVP (ADR-0009 §4). `credential_id` /
 * `webhook_secret_credential_id` point at `credential` rows (reusing the Phase 4
 * envelope-encryption vault — never a new secret-storage mechanism). */
export const gitConnection = pgTable("git_connection", {
  tenantId: uuid("tenant_id")
    .primaryKey()
    .references(() => tenant.id),
  provider: gitProviderEnum("provider").notNull(),
  baseUrl: text("base_url"),
  repoOwner: text("repo_owner").notNull(),
  repoName: text("repo_name").notNull(),
  defaultBranch: text("default_branch").notNull().default("main"),
  credentialId: uuid("credential_id")
    .notNull()
    .references(() => credential.id),
  webhookSecretCredentialId: uuid("webhook_secret_credential_id").references(() => credential.id),
  status: gitConnectionStatusEnum("status").notNull().default("Disconnected"),
  lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
  createdByUserId: uuid("created_by_user_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Agent definitions (LLD §3.10)
// ---------------------------------------------------------------------------

/** **agent_definition** — identity of an agent family (see module doc: `tenant_id` is
 * NOT NULL in this implementation, deviating from LLD's nullable-for-platform-shared
 * column). */
export const agentDefinition = pgTable(
  "agent_definition",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id),
    name: text("name").notNull(),
    description: text("description"),
    repoPath: text("repo_path"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("agent_definition_tenant_name_key").on(t.tenantId, t.name), index("agent_definition_tenant_idx").on(t.tenantId)],
);

/**
 * Target Architecture Blueprint Phase 10 (BL-41, FR-KB-05/06, LLD §14.4.4) — the
 * RESOLVED shape of `spec.knowledge` persisted on `agent_definition_version.
 * knowledge_config`. `collectionIds` are real, save-time-verified `knowledge_
 * collection.id`s (never trusted names at read time); `strategy` is the internal
 * `RetrievalStrategy` enum + `'auto'` (mapped from the author-facing lowercase
 * vocabulary `AgentKnowledgeConfigInput.strategy` uses, `@nextbot/contracts`).
 */
export interface ResolvedAgentKnowledgeConfig {
  collectionIds: string[];
  strategy: "Vector" | "GraphLocal" | "GraphGlobal" | "Hybrid" | "auto";
  maxHops: number;
  maxExpansions: number;
  minCitations: number;
  refuseWhenUngrounded: boolean;
  budget: { usdPerTurn: number; seconds: number };
  /**
   * Target Architecture Blueprint Phase 11 (BL-42, FR-KB-08) — this agent version's
   * REAL, save-time-resolved per-caller ACL scope: the opaque `sha256(...)` tag hashes
   * (`@nextbot/knowledge`'s `deriveAclTags`, the SAME derivation `knowledge_source`'s
   * own `acl_tags` column uses) this agent version is entitled to retrieve against.
   * Always includes the tenant's own "Tenant"-visibility hash (every knowledge-scoped
   * agent sees at least a tenant's broadly-visible content, matching a human tenant
   * member's own default reach) plus whichever role/capabilityGroup/tag hashes
   * `spec.knowledge.aclScope` explicitly declared. Computed once at save time
   * (immutable, mirroring every other pin on this row) — never recomputed at read
   * time, so a later change to the tenant's role/group vocabulary does not silently
   * change what an already-published agent version can retrieve.
   *
   * Optional (not `undefined`-checked away entirely) so a `knowledge_config` JSON
   * persisted before this phase shipped — which genuinely has no such field — stays a
   * structurally valid `ResolvedAgentKnowledgeConfig` rather than needing a backfill
   * migration of a JSONB column; `retrieval-executor.ts`'s own read path substitutes a
   * safe, strictly NARROWER default (Tenant-visibility content only) when absent.
   */
  aclTags?: string[];
  /**
   * Target Architecture Blueprint Phase 11 (BL-42, FR-KB-08) — this agent version's
   * own trust level for PII read-time re-evaluation of retrieved chunk citations
   * (`spec.knowledge.callerTrustLevel`). Optional for the same legacy-JSON reason
   * `aclTags` is — `retrieval-executor.ts` substitutes `"SemiTrusted"` (the same
   * default `knowledge_collection.trust_level` itself uses) when absent.
   */
  callerTrustLevel?: "Trusted" | "SemiTrusted" | "Untrusted";
}

/** **agent_definition_version** — the versioned artifact (LLD §3.10). Promotion gate
 * (`promotion-policy.ts`) is enforced in the application service transaction, not just
 * client-side. */
export const agentDefinitionVersion = pgTable(
  "agent_definition_version",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id),
    agentDefinitionId: uuid("agent_definition_id")
      .notNull()
      .references(() => agentDefinition.id),
    version: text("version").notNull(),
    graphType: graphTypeEnum("graph_type").notNull().default("ADK"),
    status: agentVersionStatusEnum("status").notNull().default("Draft"),
    definitionYaml: text("definition_yaml").notNull(),
    definitionHash: text("definition_hash").notNull(),
    gitCommitSha: text("git_commit_sha"),
    gitPrNumber: integer("git_pr_number"),
    gitPrStatus: gitPrStatusEnum("git_pr_status").notNull().default("None"),
    evalSuiteId: uuid("eval_suite_id"),
    lastEvalRunId: uuid("last_eval_run_id"),
    // Phase 2 (BL-33, LLD §14.8.6 M5, FR-AGT-22) — retained as a NON-AUTHORITATIVE
    // display snapshot only (the route "name" at creation time); `modelRouteVersionId`
    // below is the real, immutable `route@version` pin. Kept NOT NULL (unchanged) so
    // every pre-existing reader (`eval-service.ts`, the console) keeps working
    // unmodified through the migration.
    modelRouteKey: text("model_route_key").notNull(),
    // Nullable at the schema level only because Drizzle has no single-migration
    // "add NOT NULL with a backfill" shape; migration `0045_agent_version_route_pin.sql`
    // backfills every existing row (creating a synthesized route+version for the rare
    // env-default-fallthrough case with no matching `model_route` row at all) and then
    // issues `ALTER COLUMN ... SET NOT NULL` in the same migration — by the time this
    // migration has run, the column is NOT NULL in the real database; the TypeScript
    // type stays optional only to avoid every in-flight insert call site needing to
    // supply it before the repository layer resolves it (see
    // `agent-definition-repository.ts`'s `insertAgentDefinitionVersion`).
    modelRouteVersionId: uuid("model_route_version_id").references(() => modelRouteVersion.id),
    createdByUserId: uuid("created_by_user_id"),
    approvedByUserId: uuid("approved_by_user_id"),
    // Phase 7 (client-feedback-batch item 6) — set at most once, the first time a
    // real sandbox conversation turn completes against this exact version (see
    // `recordSandboxTest` in agent-definition-service.ts). Gates `Approved ->
    // Production` (promotion-policy.ts) — never mutated back to null, since versions
    // are immutable once created and this column only ever records "has this
    // happened at least once," not a history of every sandbox run.
    lastSandboxTestAt: timestamp("last_sandbox_test_at", { withTimezone: true }),
    // Target Architecture Blueprint Phase 5 (BL-35, ADR-0015 §2.4, LLD §14.5.4) —
    // the "upgrade consumers" action's own bookkeeping. Both NULL on every
    // ordinarily-authored version; populated only on a Draft this action itself
    // generated. `upgradeSourceVersionId` is the consumer version this draft was
    // regenerated from (never mutated — that source version stays byte-for-byte
    // untouched); `upgradedSkillVersionId` is the target skill version the pin was
    // bumped to. Together with the partial unique index below (migration `0056`),
    // this is the database-level expression of ADR-0015's idempotency rule: two
    // concurrent "Upgrade consumers" runs against the same skill version cannot both
    // create a Draft for the same consumer.
    upgradeSourceVersionId: uuid("upgrade_source_version_id"),
    upgradedSkillVersionId: uuid("upgraded_skill_version_id").references(() => skillVersion.id),
    // Target Architecture Blueprint Phase 10 (BL-41, FR-KB-05/06, Blueprint §7.5) —
    // resolved once at save time from `spec.plannerRoute` (default "chat.router"),
    // the SAME "route KEY -> immutable route@version pin" resolution
    // `modelRouteVersionId` above already established for `spec.modelRoute`. NULL for
    // every version with no `spec.knowledge` configured (the overwhelming majority) —
    // a non-knowledge-scoped version never resolves/pays for a planner route it will
    // never call.
    plannerRouteVersionId: uuid("planner_route_version_id").references(() => modelRouteVersion.id),
    // The RESOLVED `spec.knowledge` block (see `ResolvedAgentKnowledgeConfig` below):
    // authored collection NAMES turned into real `knowledge_collection.id`s at save
    // time (fails the save if a name doesn't resolve, mirroring `agent_version_skill`'s
    // pin-resolution discipline), everything else copied through unchanged. NULL for
    // every non-knowledge-scoped version.
    knowledgeConfig: jsonb("knowledge_config").$type<ResolvedAgentKnowledgeConfig>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("agent_definition_version_def_version_key").on(t.agentDefinitionId, t.version),
    index("agent_definition_version_tenant_idx").on(t.tenantId),
    index("agent_definition_version_status_idx").on(t.tenantId, t.agentDefinitionId, t.status),
    // NFR-12: only the ADK graph type is executable in MVP; any other value is
    // rejected at promotion time (application layer, GRAPH_TYPE_NOT_INSTALLED) but
    // the column itself stays open per the pluggability seam LLD §3.10 specifies.
  ],
);

/**
 * **agent_version_skill** (LLD §14.5.3 — "composition bridge, owned by
 * agent-platform"). Written transactionally with an agent version's save
 * (`createAgentDefinitionVersion`) whenever its artifact's `spec.skills` names a
 * skill pin (`"refund_request@3"`). This is the exact index the Skills Library's
 * "where-used" panel reads (never a scan of stored YAML) and the input the
 * "upgrade consumers" action (`skill-upgrade-service.ts`) walks. One version of a
 * given skill per agent version (PK) — composing the same skill twice at two
 * different pinned versions in one agent version is nonsensical and rejected at the
 * application layer before this table is ever touched.
 */
export const agentVersionSkill = pgTable(
  "agent_version_skill",
  {
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id),
    agentDefinitionVersionId: uuid("agent_definition_version_id")
      .notNull()
      .references(() => agentDefinitionVersion.id),
    skillId: uuid("skill_id")
      .notNull()
      .references(() => skill.id),
    skillVersionId: uuid("skill_version_id")
      .notNull()
      .references(() => skillVersion.id),
    ordinal: smallint("ordinal").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.agentDefinitionVersionId, t.skillId] }),
    index("agent_version_skill_tenant_skill_version_idx").on(t.tenantId, t.skillVersionId),
    index("agent_version_skill_tenant_skill_idx").on(t.tenantId, t.skillId),
  ],
);

/**
 * Target Architecture Blueprint Phase 12 (BL-43, FR-AGT-13, LLD §14.5.5) —
 * **studio_draft**, the Agent Design Studio's own scratch row. "Same shape and
 * sweep as `mcp_enrolment_draft`" (`packages/db/src/schema/mcp-registry.ts`):
 * `payload` is a partial of every one of the Studio's nine steps' own staged
 * input, keyed by step name; this table has NO other persistence of its own —
 * the Studio is purely a client of the existing agent-version write path
 * (`agent_definition_version`, `agent_version_skill`), never a second source of
 * truth for an agent version's real content. Deleted once the Review step
 * successfully submits (mirroring `mcp_enrolment_draft`'s own "consumed" delete).
 * `expiresAt` mirrors the MCP draft's 7-day TTL column+index (a stale, abandoned
 * draft is otherwise foreverliving jsonb — no sweep job consumes it yet, same
 * disclosed gap `mcp_enrolment_draft` itself already has: this phase does not
 * add one for either table).
 */
export const studioDraft = pgTable(
  "studio_draft",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id),
    agentDefinitionId: uuid("agent_definition_id")
      .notNull()
      .references(() => agentDefinition.id),
    step: integer("step").notNull().default(1),
    payload: jsonb("payload").notNull().default(sql`'{}'::jsonb`),
    createdByUserId: uuid("created_by_user_id").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull().default(sql`now() + interval '7 days'`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("studio_draft_tenant_definition_idx").on(t.tenantId, t.agentDefinitionId),
    index("studio_draft_tenant_expires_idx").on(t.tenantId, t.expiresAt),
  ],
);

/**
 * Target Architecture Blueprint Phase 12 (BL-43, FR-AGT-15, LLD §14 boundary-with-
 * HLD note) — **agent_blueprint**, the Blueprints Gallery's tenant-local starter
 * templates. `tenant_id` is NOT NULL (no platform-shared library, matching
 * `skill.tenant_id`'s own NOT NULL precedent this table's own descoping note
 * cites) — a tenant's own admin composes and saves a working Studio draft's
 * artifact as a blueprint, reusable only within that same tenant; selecting one
 * pre-populates a fresh Studio draft at the Review step, editable before save.
 * `artifactYaml` is stored exactly like `agent_definition_version.definition_yaml`
 * (the same single source of truth, never a second parallel representation).
 */
export const agentBlueprint = pgTable(
  "agent_blueprint",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id),
    name: text("name").notNull(),
    description: text("description"),
    artifactYaml: text("artifact_yaml").notNull(),
    createdByUserId: uuid("created_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("agent_blueprint_tenant_name_key").on(t.tenantId, t.name), index("agent_blueprint_tenant_idx").on(t.tenantId)],
);

// ---------------------------------------------------------------------------
// Eval suites (LLD §3.10, FR-AGT-06 promotion gate)
// ---------------------------------------------------------------------------

export const evalSuite = pgTable(
  "eval_suite",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id),
    name: text("name").notNull(),
    description: text("description"),
    costBudgetUsd: numeric("cost_budget_usd", { precision: 18, scale: 4 }),
    latencyBudgetMs: integer("latency_budget_ms"),
    passThresholdPct: numeric("pass_threshold_pct", { precision: 5, scale: 2 }).notNull().default("100"),
    // Target Architecture Blueprint Phase 12 (BL-44, FR-AGT-18) — `AbsoluteThreshold`
    // (the default) is every pre-existing suite's exact current behavior, unchanged.
    // `regressionBaselineVersionId` is FK-less-in-spirit-but-real (references the
    // SAME `agent_definition_version` every other pin on this schema already FKs) —
    // NULL means "no explicit baseline pinned", in which case a `RegressionBaseline`/
    // `Both`-gated run instead compares against the most recent prior `Continuous`
    // run for the same version (see `eval-service.ts`'s own doc comment).
    gateMode: evalGateModeEnum("gate_mode").notNull().default("AbsoluteThreshold"),
    regressionBaselineVersionId: uuid("regression_baseline_version_id").references(() => agentDefinitionVersion.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("eval_suite_tenant_name_key").on(t.tenantId, t.name), index("eval_suite_tenant_idx").on(t.tenantId)],
);

export const evalCase = pgTable(
  "eval_case",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id),
    evalSuiteId: uuid("eval_suite_id")
      .notNull()
      .references(() => evalSuite.id),
    name: text("name").notNull(),
    inputTranscript: jsonb("input_transcript").notNull().$type<Array<{ sender: string; text: string }>>(),
    expectedToolCalls: jsonb("expected_tool_calls").$type<Array<{ toolName: string; argMatchers?: Record<string, unknown> }>>(),
    expectedResponsePattern: text("expected_response_pattern"),
    weight: smallint("weight").notNull().default(1),
    // Target Architecture Blueprint Phase 12 (BL-44, FR-AGT-18) — a rubric graded
    // by a judge model, in addition to (or instead of) `expectedResponsePattern`.
    // `{criteria: [{id, description, weight}]}` (`EvalRubric`, `@nextbot/contracts`).
    rubric: jsonb("rubric").$type<{ criteria: Array<{ id: string; description: string; weight: number }> }>(),
    judgeRouteVersionId: uuid("judge_route_version_id").references(() => modelRouteVersion.id),
    // Target Architecture Blueprint Phase 12 (BL-44, FR-AGT-16) — provenance. Every
    // pre-existing case defaults `Authored` (unchanged meaning).
    source: evalCaseSourceEnum("source").notNull().default("Authored"),
    sourceRef: text("source_ref"),
    skillVersionId: uuid("skill_version_id").references(() => skillVersion.id),
  },
  (t) => [index("eval_case_tenant_suite_idx").on(t.tenantId, t.evalSuiteId)],
);

export const evalRun = pgTable(
  "eval_run",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id),
    evalSuiteId: uuid("eval_suite_id")
      .notNull()
      .references(() => evalSuite.id),
    agentDefinitionVersionId: uuid("agent_definition_version_id")
      .notNull()
      .references(() => agentDefinitionVersion.id),
    definitionHash: text("definition_hash").notNull(),
    status: evalRunStatusEnum("status").notNull().default("Queued"),
    passRatePct: numeric("pass_rate_pct", { precision: 5, scale: 2 }),
    totalCostUsd: numeric("total_cost_usd", { precision: 18, scale: 4 }),
    p95LatencyMs: integer("p95_latency_ms"),
    triggeredBy: evalTriggeredByEnum("triggered_by").notNull(),
    // Target Architecture Blueprint Phase 12 (BL-44, FR-AGT-17) — `PrePromotion`
    // (the default) is every pre-existing run's exact current meaning.
    // `Continuous` runs execute against the currently-deployed Production version
    // on a schedule (`apps/worker`'s `eval.continuous-run` job), independent of the
    // pre-promotion gate. `baselineRunId` (self-FK) is the prior run this run's
    // `regressed` verdict was compared against — NULL for the first-ever run of a
    // given (suite, version) pair, which can never regress by definition.
    runKind: evalRunKindEnum("run_kind").notNull().default("PrePromotion"),
    baselineRunId: uuid("baseline_run_id"),
    regressed: boolean("regressed").notNull().default(false),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("eval_run_tenant_version_idx").on(t.tenantId, t.agentDefinitionVersionId),
    index("eval_run_tenant_status_idx").on(t.tenantId, t.status),
    // Continuous-run regression comparison (`eval-service.ts#findPriorContinuousRun`)
    // — the most recent prior Continuous run for a (suite, version) pair.
    index("eval_run_tenant_suite_version_kind_idx").on(t.tenantId, t.evalSuiteId, t.agentDefinitionVersionId, t.runKind),
  ],
);

export const evalCaseResult = pgTable(
  "eval_case_result",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id),
    evalRunId: uuid("eval_run_id")
      .notNull()
      .references(() => evalRun.id),
    evalCaseId: uuid("eval_case_id")
      .notNull()
      .references(() => evalCase.id),
    passed: boolean("passed").notNull(),
    actualToolCalls: jsonb("actual_tool_calls"),
    actualResponse: text("actual_response"),
    diff: jsonb("diff"),
    costUsd: numeric("cost_usd", { precision: 18, scale: 4 }),
    latencyMs: integer("latency_ms"),
    failureReason: text("failure_reason"),
    // Target Architecture Blueprint Phase 12 (BL-44, FR-AGT-18) — per-criterion
    // judge scores (`{[criterionId]: {score, rationale}}`), and, for retrieval-scoped
    // agents (FR-KB-06), groundedness/citation-precision — both derived from the
    // SAME real `runBoundedRetrieval` citations/outcome (`@nextbot/knowledge`) this
    // codebase already produces, never a second independently-invented grounding
    // check (`eval-service.ts#gradeRetrievalScopedCase`).
    rubricScores: jsonb("rubric_scores").$type<Record<string, { score: number; rationale: string }>>(),
    groundednessScore: real("groundedness_score"),
    citationPrecision: real("citation_precision"),
  },
  (t) => [index("eval_case_result_tenant_run_idx").on(t.tenantId, t.evalRunId)],
);

// ---------------------------------------------------------------------------
// Deployment (minimal — full canary/traffic-split editor is BL-13; this phase only
// needs enough of the table to satisfy the Approved->Production promotion gate's
// "an active Deployment row created atomically" requirement, LLD §3.10).
// ---------------------------------------------------------------------------

export const deployment = pgTable(
  "deployment",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id),
    agentDefinitionId: uuid("agent_definition_id")
      .notNull()
      .references(() => agentDefinition.id),
    agentDefinitionVersionId: uuid("agent_definition_version_id")
      .notNull()
      .references(() => agentDefinitionVersion.id),
    environment: deployEnvironmentEnum("environment").notNull(),
    trafficSplitPct: smallint("traffic_split_pct").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    activatedAt: timestamp("activated_at", { withTimezone: true }).notNull().defaultNow(),
    deactivatedAt: timestamp("deactivated_at", { withTimezone: true }),
  },
  (t) => [
    index("deployment_tenant_agent_env_idx").on(t.tenantId, t.agentDefinitionId, t.environment),
    check("deployment_traffic_split_range", sql`${t.trafficSplitPct} >= 0 AND ${t.trafficSplitPct} <= 100`),
  ],
);

export const deploymentHistory = pgTable(
  "deployment_history",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id),
    agentDefinitionId: uuid("agent_definition_id")
      .notNull()
      .references(() => agentDefinition.id),
    environment: deployEnvironmentEnum("environment").notNull(),
    action: deploymentActionEnum("action").notNull(),
    fromState: jsonb("from_state"),
    toState: jsonb("to_state"),
    reason: text("reason").notNull(),
    actorUserId: uuid("actor_user_id"),
    durationMs: integer("duration_ms"),
    /** Phase 6 (BL-27, ADR-0017 §5) — the `agent_definition_version` this history row
     * actually repoints to/from. Nullable because most existing history rows (plain
     * `Deploy`/`PromoteCanary`) never needed this column; it's required in practice
     * for every future `EmergencyRollback` row since the eligibility query
     * (`hasEverBeenProductionInHistory`) filters directly on it. */
    agentDefinitionVersionId: uuid("agent_definition_version_id").references(() => agentDefinitionVersion.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("deployment_history_tenant_agent_idx").on(t.tenantId, t.agentDefinitionId),
    // ADR-0017 §5's "eligibility query and its index" — backs
    // `hasEverBeenProductionInHistory`'s `WHERE agent_definition_version_id = $1 AND
    // environment = 'Production'` lookup.
    index("deployment_history_tenant_version_env_idx").on(t.tenantId, t.agentDefinitionVersionId, t.environment),
  ],
);

// ---------------------------------------------------------------------------
// Progressive rollout (Target Architecture Blueprint Phase 17, BL-48/BL-13,
// ADR-0019, LLD §15.2)
// ---------------------------------------------------------------------------

/**
 * **deployment_traffic_assignment** — the sticky binding of one conversation to one
 * `deployment` (and therefore one version), so a conversation does not flip versions
 * mid-thread when the split changes underneath it.
 *
 * **The load-bearing rule, and the most consequential decision in ADR-0019:** stickiness
 * is bounded by the ASSIGNED DEPLOYMENT'S OWN `is_active` LIFETIME. `resolveTurnAgentVersion`
 * joins `deployment` and requires `is_active`; a stale assignment pointing at a
 * deactivated deployment is DISCARDED and re-resolved, never honored. Promotion, split
 * change, rollback and emergency rollback all deactivate rows, so every one of them takes
 * effect on the *next turn* of every in-flight conversation, inside NFR-2's <5s bound.
 * A stickiness that survived deactivation would make emergency rollback (ADR-0017)
 * silently ineffective for exactly the conversations being harmed by the bad version.
 *
 * `conversationId` is **FK-less by design**: `agent-platform` owns this table and may not
 * depend on `conversations` (LLD §14.1's allow-list) — the same precedent
 * `agent_run.conversation_id` already sets.
 */
export const deploymentTrafficAssignment = pgTable(
  "deployment_traffic_assignment",
  {
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id),
    conversationId: uuid("conversation_id").notNull(),
    agentDefinitionId: uuid("agent_definition_id")
      .notNull()
      .references(() => agentDefinition.id),
    deploymentId: uuid("deployment_id")
      .notNull()
      .references(() => deployment.id),
    /** Denormalized so the hot per-turn read answers from one row without a second join
     * for the answer itself (the `deployment.is_active` join that IS required is the
     * lifetime check above, not a lookup of which version was chosen). */
    agentDefinitionVersionId: uuid("agent_definition_version_id")
      .notNull()
      .references(() => agentDefinitionVersion.id),
    assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.conversationId, t.agentDefinitionId] }),
    index("deployment_traffic_assignment_deployment_idx").on(t.tenantId, t.deploymentId),
  ],
);

/**
 * **shadow_evaluation** (ADR-0019 §2.5) — one running experiment per
 * `(tenant, agent_definition, environment)`: replay a candidate version against real live
 * traffic, capture what it *would* have done, and never let it answer a customer or cause
 * a real side effect.
 *
 * Off by default (a row exists only once an admin explicitly starts one), RBAC-gated at
 * the same `agent_platform=Write` level as promotion (no new privilege ladder, ADR-0019
 * §2.6), and hard-capped: `samplePct` / `maxRuns` / `maxCostUsd` are enforced for real by
 * the enqueue-side sampling roll and the pump's ceiling check, because shadow inference is
 * genuine spend through the real Model Gateway under unchanged residency governance.
 *
 * **Shadow results are evidence, never a gate**: nothing here can promote anything,
 * satisfy the sandbox-test-before-promote gate, or shorten `canPromote`.
 */
export const shadowEvaluation = pgTable(
  "shadow_evaluation",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id),
    agentDefinitionId: uuid("agent_definition_id")
      .notNull()
      .references(() => agentDefinition.id),
    environment: deployEnvironmentEnum("environment").notNull(),
    candidateVersionId: uuid("candidate_version_id")
      .notNull()
      .references(() => agentDefinitionVersion.id),
    status: shadowEvaluationStatusEnum("status").notNull().default("Active"),
    samplePct: smallint("sample_pct").notNull(),
    maxRuns: integer("max_runs").notNull(),
    maxCostUsd: numeric("max_cost_usd", { precision: 18, scale: 4 }).notNull(),
    runsEnqueued: integer("runs_enqueued").notNull().default(0),
    runsCompleted: integer("runs_completed").notNull().default(0),
    spendUsd: numeric("spend_usd", { precision: 18, scale: 8 }).notNull().default("0"),
    stopReason: text("stop_reason"),
    createdByUserId: uuid("created_by_user_id"),
    stoppedByUserId: uuid("stopped_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    stoppedAt: timestamp("stopped_at", { withTimezone: true }),
  },
  (t) => [
    // Partial unique — at most one `Active` experiment per triple. Declared in migration
    // `0084` (Drizzle's `uniqueIndex(...).where(...)` is not used here because this
    // schema file is documentation-of-record for the physical shape, and the partial
    // predicate is what makes it correct).
    uniqueIndex("shadow_evaluation_one_active_key").on(t.tenantId, t.agentDefinitionId, t.environment).where(sql`status = 'Active'`),
    index("shadow_evaluation_tenant_definition_idx").on(t.tenantId, t.agentDefinitionId),
  ],
);

/** One would-have-been tool call recorded on a shadow run (never executed, never
 *  persisted as a real `tool_call` row). `argsMasked` goes through the SAME
 *  `maskArgsForLogging` every other audit path uses — never a second masking mechanism. */
export interface ShadowToolCallRecord {
  toolName: string;
  toolId: string;
  argsMasked: Record<string, unknown>;
  tier: string | null;
  outcome: "Executed(shadow-noop)" | "ShadowSuppressed" | "PolicyDenied";
}

/**
 * **shadow_run** (ADR-0019 §2.5) — one replay, drained by `apps/worker`'s
 * `deployment.shadow-run-pump` using the `knowledge_ingestion_job` claim/lease/reclaim
 * idiom verbatim (`FOR UPDATE SKIP LOCKED`, `leaseOwner` + `leaseExpiresAt`, `attempts`).
 *
 * **Stores POINTERS, never a transcript copy.** Duplicating customer text into a new
 * table would create a new PII sink requiring its own retention-purge and DSR-cascade
 * rules; pointers create none. The consequence is handled honestly rather than ignored:
 * a source conversation purged (retention/DSR) between enqueue and replay terminates the
 * row as `Skipped(SourceGone)` — never an error, never a resurrection of purged content.
 *
 * `shadowAgentRunId` is deliberately the ONLY way a shadow trace stays reachable: every
 * ordinary `agent_run` reader excludes `trigger = 'ShadowEvaluation'`, so the shadow
 * report screen reaches it by following this pointer and nothing else does.
 */
export const shadowRun = pgTable(
  "shadow_run",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id),
    shadowEvaluationId: uuid("shadow_evaluation_id")
      .notNull()
      .references(() => shadowEvaluation.id),
    /** FK-less, same allow-list rationale as `deploymentTrafficAssignment.conversationId`. */
    conversationId: uuid("conversation_id").notNull(),
    liveAgentRunId: uuid("live_agent_run_id")
      .notNull()
      .references(() => agentRun.id),
    /** FK-less: `message` is `conversations`-owned. The replay reads the conversation's
     *  messages up to this one's sequence. */
    liveMessageId: uuid("live_message_id").notNull(),
    candidateVersionId: uuid("candidate_version_id")
      .notNull()
      .references(() => agentDefinitionVersion.id),
    shadowAgentRunId: uuid("shadow_agent_run_id").references(() => agentRun.id),
    status: shadowRunStatusEnum("status").notNull().default("Pending"),
    skipReason: shadowSkipReasonEnum("skip_reason"),
    leaseOwner: text("lease_owner"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    attempts: smallint("attempts").notNull().default(0),
    durationMs: integer("duration_ms"),
    costUsd: numeric("cost_usd", { precision: 18, scale: 8 }),
    tokensIn: integer("tokens_in"),
    tokensOut: integer("tokens_out"),
    replyText: text("reply_text"),
    /** The candidate's own reply, hashed. */
    replyPayloadHash: text("reply_payload_hash"),
    /**
     * The **live** turn's reply hash and tool-call count, captured by the pump at replay
     * time (it re-reads the conversation anyway, so both sides are cheap there).
     *
     * LLD §15.2 gives `replyPayloadHash` the purpose "cheap divergence counting"; a single
     * hash cannot count divergence without the other side, so these two are the honest
     * realization of that stated intent rather than an expansion of it. Captured once at
     * replay rather than recomputed at report time, so the comparison still reflects what
     * the live turn actually did even after the conversation is purged — and neither field
     * stores customer text, so ADR-0019 §2.5's "no new PII sink" property holds.
     */
    liveReplyPayloadHash: text("live_reply_payload_hash"),
    liveToolCallCount: smallint("live_tool_call_count"),
    wouldHaveToolCalls: jsonb("would_have_tool_calls").$type<ShadowToolCallRecord[]>(),
    /** Captured as DATA and never acted on — the worker never calls `triggerEscalation`. */
    escalationSignal: jsonb("escalation_signal"),
    /** Captured INSTEAD of writing `guardrail_event` rows, so the Guardrail analytics
     *  screen is never polluted by traffic no customer ever saw. */
    guardrailOutcome: jsonb("guardrail_outcome"),
    error: jsonb("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    index("shadow_run_tenant_status_created_idx").on(t.tenantId, t.status, t.createdAt),
    index("shadow_run_tenant_evaluation_idx").on(t.tenantId, t.shadowEvaluationId),
  ],
);

// ---------------------------------------------------------------------------
// Model Gateway (LLD §7.1, ADR-0006) — Phase 2 (BL-33) moved `model_route`/
// `model_budget`/`model_call_log`/`model_cache_entry` to `model-gateway.ts` (LLD
// §14.9.6). Nothing Model-Gateway-shaped remains defined in this file.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// agent_run (FR-AGT-09)
// ---------------------------------------------------------------------------

export const agentRun = pgTable(
  "agent_run",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id),
    agentDefinitionVersionId: uuid("agent_definition_version_id")
      .notNull()
      .references(() => agentDefinitionVersion.id),
    conversationId: uuid("conversation_id"),
    trigger: runTriggerEnum("trigger").notNull(),
    status: runStatusEnum("status").notNull().default("Running"),
    pausedToolCallId: uuid("paused_tool_call_id"),
    resumeToken: text("resume_token"),
    checkpoint: jsonb("checkpoint"),
    otelTraceId: text("otel_trace_id").notNull(),
    tokensIn: integer("tokens_in"),
    tokensOut: integer("tokens_out"),
    costUsd: numeric("cost_usd", { precision: 18, scale: 8 }),
    durationMs: integer("duration_ms"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
  },
  (t) => [
    index("agent_run_tenant_version_idx").on(t.tenantId, t.agentDefinitionVersionId),
    index("agent_run_tenant_conversation_idx").on(t.tenantId, t.conversationId),
  ],
);
