import { boolean, index, integer, jsonb, numeric, pgEnum, pgTable, smallint, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tenant } from "./tenancy.js";
import { credential } from "./connectors.js";
import { regionEnum, channelTypeEnum, planTierEnum } from "./enums.js";

/**
 * Phase 1 of the Target Architecture Blueprint (BL-32, ADR-0011, LLD §14.8) — Module F,
 * "Model Gateway v2", **provider registry + model catalog only**. Phase 2 (BL-33, this
 * file's second half below) adds Route v2 (`model_route`/`model_route_version`),
 * `model_usage_event` (renamed from `model_call_log`), and moves `model_budget`/
 * `model_cache_entry` here unchanged — completing LLD §14.9.6's "extract Module F" —
 * see `docs/plans/target-architecture-blueprint-plan.md`'s Phase 1/Phase 2 entries.
 *
 * **Collision inventory (LLD §14.8.1):** `model_provider` already existed (platform-only,
 * no `tenant_id`, 5-value `model_provider_key` enum, `key`/`label`/`regions` columns —
 * see the migration file for the exact rename/extend). This is a real ALTER-in-place
 * migration (`packages/db/migrations/0039_model_gateway_provider_enum.sql/0040_model_gateway_provider_table.sql` +
 * `..._provider_rls.sql` + `..._model_catalog_entry.sql`), never a silent rename or a
 * second colliding table (LLD §14.8.6 rule 2). `model_route`/`model_budget`/
 * `model_call_log`/`model_cache_entry` previously lived in `agent-platform.ts` — Phase 2
 * moves them here via `packages/db/migrations/0043`-`0048` (see each table's own doc
 * comment below for the exact migration mapping).
 */

// ---------------------------------------------------------------------------
// Enums (LLD §14.8.2)
// ---------------------------------------------------------------------------

/**
 * ADR-0011 §2.1's nine forward-facing provider types, **plus `"gemini"`** — the
 * original (pre-ADR-0011) `model_provider_key` enum's fifth value. Postgres enums
 * cannot drop a value in place (`ALTER TYPE ... ADD VALUE` is additive-only, LLD
 * §14.8.6 M1), and pre-existing rows/tests (`model-gateway-repository.int.test.ts`,
 * `scripts/seed.ts`) use `"gemini"` — dropping it here would either orphan those rows
 * or force a data rewrite this phase doesn't need to do. New provider registrations
 * should prefer `"google-vertex"`; `"gemini"` is kept for backward compatibility only.
 */
export const modelProviderTypeEnum = pgEnum("model_provider_type", [
  "openai",
  "anthropic",
  "gemini",
  "azure-openai",
  "openai-compatible",
  "google-vertex",
  "bedrock",
  "openrouter",
  "ollama",
  "cohere",
  "mistral",
  "custom",
]);

export const modelProviderStatusEnum = pgEnum("model_provider_status", [
  "Active",
  "Unreachable",
  "Disabled",
  "CredentialInvalid",
]);

/** Distinct from `connector_auth_method` (LLD §3.5's vocabulary is connector-shaped;
 * this one adds `EntraId`/`ServiceAccount`/`IamRole`/`Mtls` per ADR-0011 §2.1's
 * provider-type -> auth-method table). */
export const modelAuthMethodEnum = pgEnum("model_auth_method", [
  "ApiKey",
  "EntraId",
  "ServiceAccount",
  "IamRole",
  "Mtls",
  "None",
]);

export const modelModalityEnum = pgEnum("model_modality", [
  "Text",
  "Vision",
  "Audio",
  "Embedding",
  "Rerank",
  "Multimodal",
]);

export const modelCatalogStatusEnum = pgEnum("model_catalog_status", [
  "Available",
  "Preview",
  "Deprecating",
  "Retired",
]);

export const modelCatalogSourceEnum = pgEnum("model_catalog_source", ["Synced", "Manual"]);

// ---------------------------------------------------------------------------
// model_provider (LLD §14.8.2 — the one table with `tenant_id` NULLABLE, §14.8.7)
// ---------------------------------------------------------------------------

/**
 * **model_provider** — extended in place from the pre-existing platform-only table
 * (LLD §14.8.6 M1). `tenant_id` **NULL** = platform-registered, visible to every
 * tenant (the pre-migration rows all stay this way); **NOT NULL** = a tenant's own
 * BYO/self-hosted provider registration (new, this phase). See §14.8.7 for the exact
 * two-clause RLS policy this nullable `tenant_id` requires (this table is the
 * `PLATFORM_SHARED_TENANT_TABLES` manifest's first entry, not `TENANT_SCOPED_TABLES`).
 *
 * All new writes from this phase's application code are tenant-scoped (a BYO
 * provider owned by the calling tenant) — writing a `tenant_id IS NULL` platform row
 * requires `withPlatform()`, callable only from tenancy provisioning /
 * `/api/internal/ops/**` (LLD §3.2 rule 4); no such ops endpoint is in this phase's
 * scope, so registering a *new* platform-shared provider is deferred (flagged, not a
 * silent gap) — the pre-existing seeded platform row keeps working unchanged.
 */
export const modelProvider = pgTable(
  "model_provider",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").references(() => tenant.id),
    type: modelProviderTypeEnum("type").notNull(),
    name: text("name").notNull(),
    baseUrl: text("base_url"),
    // NOT NULL per LLD §14.8.2; defaulted to a plausible region at write time by the
    // application layer (never left to a DB default) — see
    // `application/provider-service.ts`'s doc comment for the exact precedence.
    region: regionEnum("region").notNull(),
    regionsServed: text("regions_served").array().notNull().default(sql`'{}'::text[]`),
    authMethod: modelAuthMethodEnum("auth_method").notNull(),
    credentialId: uuid("credential_id").references(() => credential.id),
    orgOrProjectId: text("org_or_project_id"),
    retainsPrompts: boolean("retains_prompts").notNull().default(false),
    trainsOnData: boolean("trains_on_data").notNull().default(false),
    rateLimitJson: jsonb("rate_limit_json").$type<{
      requestsPerMinute?: number;
      tokensPerMinute?: number;
      maxConcurrent?: number;
    } | null>(),
    // Computed by the health probe only (`model-gateway.provider-probe`) — no CRUD
    // path sets this directly (LLD §14.8.2's own callout).
    status: modelProviderStatusEnum("status").notNull().default("Active"),
    healthIntervalSeconds: integer("health_interval_seconds").notNull().default(300),
    lastProbeAt: timestamp("last_probe_at", { withTimezone: true }),
    lastProbeError: jsonb("last_probe_error").$type<{ code: string; message: string } | null>(),
    catalogSyncedAt: timestamp("catalog_synced_at", { withTimezone: true }),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("model_provider_tenant_idx").on(t.tenantId),
    index("model_provider_type_idx").on(t.type),
    // The real UNIQUE constraint (`COALESCE(tenant_id, '00000000-...')`, `name`) is a
    // partial-index pair authored directly in the migration SQL (Postgres has no
    // portable `COALESCE`-in-a-Drizzle-index-builder shape) — see
    // `0039_model_gateway_provider_enum.sql/0040_model_gateway_provider_table.sql`.
  ],
);

// ---------------------------------------------------------------------------
// model_catalog_entry (LLD §14.8.2, FR-AGT-21) — platform-shared when its provider is
// ---------------------------------------------------------------------------

/** The capability flags a catalog entry declares — every boolean is REQUIRED, so an
 * unknown/unset capability is explicitly `false`, never absent (LLD §14.8.2). Also
 * exported from `@nextbot/contracts` as the TypeBox source of truth
 * (`ModelCapabilitiesSchema`) this type mirrors. */
export interface ModelCapabilities {
  toolCalling: boolean;
  vision: boolean;
  streaming: boolean;
  structuredOutput: boolean;
  extendedThinking: boolean;
  promptCaching: boolean;
  jsonMode: boolean;
}

/**
 * **model_catalog_entry** — one concrete servable model (FR-AGT-21). `tenant_id`
 * mirrors its provider's (NULL for a platform provider's catalog, the owning tenant's
 * id for a BYO provider's) — enforced by a DB trigger (`0041_model_catalog_entry.sql`),
 * never set independently by application code.
 */
export const modelCatalogEntry = pgTable(
  "model_catalog_entry",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").references(() => tenant.id),
    providerId: uuid("provider_id")
      .notNull()
      .references(() => modelProvider.id),
    modelId: text("model_id").notNull(),
    displayName: text("display_name").notNull(),
    modality: modelModalityEnum("modality").notNull(),
    contextWindow: integer("context_window").notNull(),
    maxOutput: integer("max_output").notNull(),
    /** Embedding models only (FR-KB-03's future FK target). */
    dimension: smallint("dimension"),
    capabilitiesJson: jsonb("capabilities_json").$type<ModelCapabilities>().notNull(),
    tokenizer: text("tokenizer").notNull(),
    priceIn: numeric("price_in", { precision: 18, scale: 8 }).notNull().default("0"),
    priceOut: numeric("price_out", { precision: 18, scale: 8 }).notNull().default("0"),
    priceCached: numeric("price_cached", { precision: 18, scale: 8 }).notNull().default("0"),
    latencyProfile: jsonb("latency_profile").$type<{ p50Ms: number; p95Ms: number; sampledAt: string } | null>(),
    status: modelCatalogStatusEnum("status").notNull().default("Available"),
    deprecatesAt: timestamp("deprecates_at", { withTimezone: true }),
    source: modelCatalogSourceEnum("source").notNull(),
    syncedAt: timestamp("synced_at", { withTimezone: true }),
    /** Transient — set `true` only for rows the M3 migration's backfill synthesized
     * from a pre-existing `model_route.chain` entry (conservative, all-`false`
     * capabilities except `streaming`). Surfaces a one-time console review banner;
     * dropped once Phase 2's route-version migration (M6-equivalent) lands, per LLD
     * §14.8.6 M3's note. Manually-declared and synced entries are always `false`. */
    needsReview: boolean("needs_review").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("model_catalog_entry_provider_status_idx").on(t.providerId, t.status),
    index("model_catalog_entry_tenant_modality_idx").on(t.tenantId, t.modality),
    // UNIQUE (provider_id, model_id) and the partial `WHERE status='Deprecating'`
    // index are authored directly in the migration SQL alongside the trigger.
  ],
);

// ---------------------------------------------------------------------------
// Phase 2 (BL-33, LLD §14.8.2/§14.8.6 M4-M6) — Route v2, usage events, budget/cache,
// plan-tier governance. Moved here (unchanged in shape, where noted) from
// `agent-platform.ts` per LLD §14.9.6's "extract Module F" end state.
// ---------------------------------------------------------------------------

export const modelRouteVersionStatusEnum = pgEnum("model_route_version_status", ["Draft", "Published", "Deprecated"]);

/** FR-AGT-23's recommended per-role standard route names — a *recommendation*, not a
 * constraint (any `model_route.name` is legal; `role` is metadata driving the
 * "standard routes" checklist, §14.8.5's `GET .../standard-routes`). */
export const modelRouteRoleEnum = pgEnum("model_route_role", [
  "chat.primary",
  "chat.router",
  "embed.default",
  "rerank.default",
  "vision.default",
  "custom",
]);

export const modelRouteStatusEnum = pgEnum("model_route_status", ["Active", "Archived"]);

/** Retained from `agent-platform.ts` (LLD §14.8.6 rule 3: "no column change" on
 * move) — still used by `model_budget`/`model_cache_entry`'s pre-existing shape. */
export const modelBudgetScopeEnum = pgEnum("model_budget_scope", ["Tenant", "Agent"]);
export const modelBudgetPeriodEnum = pgEnum("model_budget_period", ["Day", "Month"]);
export const modelBudgetOnExceedEnum = pgEnum("model_budget_on_exceed", ["Throttle", "HardStop", "AlertOnly"]);
export const degradedModeEnum = pgEnum("degraded_mode", ["KnowledgeBaseOnly", "ImmediateEscalation", "StaticMessage"]);
export const cacheKindEnum = pgEnum("cache_kind", ["None", "Exact", "Semantic"]);

/** Renamed in place from `model_call_status` (LLD §14.8.6 M6) — `CacheHit`/
 * `BudgetStopped` are genuinely new outcomes Route v2 can now record (a cache hit
 * never actually calls a provider; a budget-stopped call was blocked before it could
 * even attempt one), neither of which the v1 `model_call_log` had a way to express. */
export const modelUsageOutcomeEnum = pgEnum("model_usage_outcome", [
  "Success",
  "ProviderError",
  "Timeout",
  "RateLimited",
  "Filtered",
  "CacheHit",
  "BudgetStopped",
]);

/** A single hop in a route version's chain (LLD §14.8.2's `ModelRouteHopSchema`) — the
 * exact shape persisted in `model_route_version.chain_json`. `catalogEntryId` is the
 * whole point of Route v2 (FR-AGT-21): a hop references a real, priced,
 * capability-described `model_catalog_entry`, **never** a free-text model string. */
export interface ModelRouteHop {
  ordinal: number;
  providerId: string;
  catalogEntryId: string;
  params: {
    temperature?: number;
    maxTokens?: number;
    topP?: number;
    reasoningEffort?: string;
  };
  weight?: number;
  timeoutMs: number;
}

export type ModelRouteChain = ModelRouteHop[];

export type FailoverCondition = "429" | "5xx" | "timeout" | "content_filter" | "context_overflow";

/** `model_route_version.policy_json` (LLD §14.8.2's `ModelRoutePolicySchema`). */
export interface ModelRoutePolicy {
  strategy: "FixedPriority" | "CostBased" | "LatencyBased" | "Weighted";
  failoverOn: FailoverCondition[];
  retry: { maxPerHop: number; backoff: "none" | "exponential" };
  totalTimeoutMs: number;
  cacheMode: "Off" | "ExactMatch" | "Semantic";
  semanticThreshold?: number;
  costCeilingUsdPerTurn?: number;
  onBudgetBreach: "DegradeToCheapestHop" | "Fail";
  /** FR-AGT-22/25 — default `false`; a route author cannot loosen this past the
   * tenant's own `allowOutOfRegionInference` opt-in (both must be true). */
  allowOutOfRegionFailover: boolean;
}

export interface ModelCapabilitiesFlags {
  toolCalling: boolean;
  vision: boolean;
  streaming: boolean;
  structuredOutput: boolean;
  extendedThinking: boolean;
  promptCaching: boolean;
  jsonMode: boolean;
}

/**
 * **model_route** (LLD §14.8.2 — identity only; every behavioural field lives on
 * `model_route_version`). Moved + reshaped from `agent-platform.ts`'s v1 `model_route`
 * (LLD §14.8.6 M4): `route_key` -> `name`, `strategy`/`chain`/`total_timeout_ms`/
 * `cache_mode`/`semantic_threshold` dropped (moved into the version row), `role`/
 * `current_version_id`/`status`/`description` added. The migration backfills a real
 * `model_route_version` (version 1) from every pre-existing row before dropping the
 * old columns — see `0044_model_route_version.sql`.
 */
export const modelRoute = pgTable(
  "model_route",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id),
    name: text("name").notNull(),
    description: text("description"),
    role: modelRouteRoleEnum("role").notNull().default("custom"),
    currentVersionId: uuid("current_version_id"),
    status: modelRouteStatusEnum("status").notNull().default("Active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("model_route_tenant_name_key").on(t.tenantId, t.name), index("model_route_tenant_idx").on(t.tenantId)],
);

/**
 * **model_route_version** (LLD §14.8.2 — immutable, same triple-enforcement pattern as
 * `agent_definition_version`/`skill_version`: never UPDATEd once created, a new edit
 * mints a new row). `advertised_capabilities` is the INTERSECTION across every hop —
 * "the weakest hop wins" (FR-AGT-22) — computed once by
 * `@nextbot/model-gateway`'s `validateRouteCapabilities` at save time and frozen here,
 * never recomputed at runtime, so a version already bound to this route version stays
 * valid even if a hop's catalog entry is edited later.
 */
export const modelRouteVersion = pgTable(
  "model_route_version",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id),
    routeId: uuid("route_id")
      .notNull()
      .references(() => modelRoute.id),
    version: integer("version").notNull(),
    chainJson: jsonb("chain_json").notNull().$type<ModelRouteChain>(),
    policyJson: jsonb("policy_json").notNull().$type<ModelRoutePolicy>(),
    advertisedCapabilities: jsonb("advertised_capabilities").notNull().$type<ModelCapabilitiesFlags>(),
    strictestDataHandling: jsonb("strictest_data_handling").notNull().$type<{ retainsPrompts: boolean; trainsOnData: boolean }>(),
    maxRegionSet: text("max_region_set").array().notNull().default(sql`'{}'::text[]`),
    status: modelRouteVersionStatusEnum("status").notNull().default("Draft"),
    // Nullable (a deliberate, disclosed deviation from a literal reading of LLD
    // §14.8.2's "NOT NULL") — mirrors `agent_definition_version.created_by_user_id`'s
    // own existing nullable convention in this codebase: migration `0044` backfills a
    // real `model_route_version` row for every pre-existing `model_route` with no
    // human actor to attribute it to (it is a schema migration, not a console save),
    // exactly the same situation `agent_definition_version` already had to handle.
    createdByUserId: uuid("created_by_user_id"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("model_route_version_tenant_route_version_key").on(t.tenantId, t.routeId, t.version),
    index("model_route_version_tenant_route_idx").on(t.tenantId, t.routeId),
  ],
);

/** Moved unchanged from `agent-platform.ts` (LLD §14.8.6 rule 3 — no column change on
 * move) except `routeId` (new, backfilled from the pre-existing `route_key` text
 * column, which is retained one release per that same rule). */
export const modelBudget = pgTable(
  "model_budget",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id),
    scope: modelBudgetScopeEnum("scope").notNull(),
    agentDefinitionId: uuid("agent_definition_id"),
    routeId: uuid("route_id").references(() => modelRoute.id),
    period: modelBudgetPeriodEnum("period").notNull(),
    capUsd: numeric("cap_usd", { precision: 18, scale: 4 }).notNull(),
    alertPcts: smallint("alert_pcts").array().notNull().default(sql`'{80,90,100}'::smallint[]`),
    onExceed: modelBudgetOnExceedEnum("on_exceed").notNull().default("AlertOnly"),
    degradedMode: degradedModeEnum("degraded_mode"),
    degradedMessage: text("degraded_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("model_budget_tenant_idx").on(t.tenantId)],
);

/** Renamed in place from `model_call_log` (LLD §14.8.6 M6) — the sole source for
 * FR-AI-12/FR-RP-07, now also carrying route-version/catalog-entry/agent-version/
 * conversation/workflow/delegation/knowledge-generation attribution (FR-AGT-24). Every
 * new column is nullable with no historical backfill (LLD's own instruction) —
 * `route_key`/`provider_key`/`model` stay populated so every existing FR-AI-12/
 * FR-RP-07 query keeps returning the same numbers across the rename. */
export const modelUsageEvent = pgTable(
  "model_usage_event",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id),
    agentRunId: uuid("agent_run_id"),
    routeVersionId: uuid("route_version_id").references(() => modelRouteVersion.id),
    catalogEntryId: uuid("catalog_entry_id").references(() => modelCatalogEntry.id),
    providerId: uuid("provider_id").references(() => modelProvider.id),
    routeKey: text("route_key").notNull(),
    providerKey: text("provider_key").notNull(),
    model: text("model").notNull(),
    agentDefinitionVersionId: uuid("agent_definition_version_id"),
    conversationId: uuid("conversation_id"),
    workflowRunStepId: uuid("workflow_run_step_id"),
    delegationEventId: uuid("delegation_event_id"),
    knowledgeGenerationId: uuid("knowledge_generation_id"),
    hopIndex: smallint("hop_index").notNull().default(0),
    attempt: smallint("attempt").notNull().default(1),
    cached: boolean("cached").notNull().default(false),
    cacheKind: cacheKindEnum("cache_kind").notNull().default("None"),
    tokensIn: integer("tokens_in"),
    tokensOut: integer("tokens_out"),
    cachedTokens: integer("cached_tokens").notNull().default(0),
    costUsd: numeric("cost_usd", { precision: 18, scale: 8 }),
    latencyMs: integer("latency_ms"),
    outcome: modelUsageOutcomeEnum("outcome").notNull(),
    errorCode: text("error_code"),
    channelType: channelTypeEnum("channel_type"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("model_usage_event_tenant_created_idx").on(t.tenantId, t.createdAt),
    index("model_usage_event_tenant_route_version_idx").on(t.tenantId, t.routeVersionId, t.createdAt),
    index("model_usage_event_tenant_catalog_entry_idx").on(t.tenantId, t.catalogEntryId, t.createdAt),
    index("model_usage_event_tenant_conversation_idx").on(t.tenantId, t.conversationId),
    index("model_usage_event_tenant_agent_version_idx").on(t.tenantId, t.agentDefinitionVersionId, t.createdAt),
  ],
);

/** Moved unchanged from `agent-platform.ts` (LLD §14.8.6 rule 3) except `routeId`
 * (new, backfilled from `route_key`, which is retained one release). Semantic
 * (pgvector `embedding`) caching remains deferred (unchanged scope note). */
export const modelCacheEntry = pgTable(
  "model_cache_entry",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id),
    routeKey: text("route_key").notNull(),
    routeId: uuid("route_id").references(() => modelRoute.id),
    promptHash: text("prompt_hash").notNull(),
    response: jsonb("response").notNull(),
    tokensSaved: integer("tokens_saved").notNull().default(0),
    hits: integer("hits").notNull().default(0),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("model_cache_entry_tenant_route_hash_key").on(t.tenantId, t.routeKey, t.promptHash),
    index("model_cache_entry_tenant_idx").on(t.tenantId),
  ],
);

/**
 * **platform_provider_type_policy** (FR-AGT-26 — the *mechanism*; the policy itself
 * ships empty-permissive, spec §9.5 item 6 leaves the actual restriction decision
 * open). No `tenant_id` at all (same category as `channel_capability`/
 * `platform_audit_log_entry`) — platform-level reference data, excluded from RLS
 * entirely, written only via `withPlatform()` from `/api/internal/ops/**`
 * (LLD §3.2 rule 4).
 */
export const platformProviderTypePolicy = pgTable("platform_provider_type_policy", {
  planTier: planTierEnum("plan_tier").primaryKey(),
  // A `text[]` (not a native enum array) storing `ModelProviderTypeValue` strings —
  // mirrors `model_provider.regions_served`'s existing text[]-over-enum convention in
  // this same file; this codebase has no prior use of a native Postgres enum array
  // column, so this avoids being the first without a proven pattern to follow.
  allowedProviderTypes: text("allowed_provider_types").array().notNull().$type<string[]>(),
  updatedByOperatorId: uuid("updated_by_operator_id"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
