import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { planTierEnum, regionEnum, tenantStatusEnum } from "./enums.js";

/**
 * Shape of `tenant.branding_config` (FR-ADM-07). Mirrored 1:1 by
 * `packages/contracts/src/tenancy.ts`'s `TenantBrandingSchema` (TypeBox) — that
 * schema is what actually validates writes (LLD §3.1: "no unvalidated jsonb
 * writes"); this interface only gives the Drizzle column a shape for type inference
 * and is intentionally duplicated rather than imported to avoid a runtime dependency
 * from `@nextbot/db` on `@nextbot/contracts`.
 */
export interface TenantBrandingConfig {
  primaryColor: string;
  secondaryColor: string;
  logoLightUrl: string | null;
  logoDarkUrl: string | null;
  faviconUrl: string | null;
  fontFamily: string | null;
}

/**
 * **tenant** (LLD §3.3, BL-01). The row every tenant-scoped table's `tenant_id`
 * ultimately references. Not itself RLS-protected in the usual sense (there is no
 * "tenant_id of a tenant row" predicate) — the platform role manages this table via
 * `withPlatform` during provisioning, and tenant-scoped reads of a tenant's own row
 * happen through a narrow read path validated against `withTenant`'s ctx.tenantId.
 */
export const tenant = pgTable(
  "tenant",
  {
    id: uuid("id").primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    region: regionEnum("region").notNull(),
    status: tenantStatusEnum("status").notNull().default("Trial"),
    planTier: planTierEnum("plan_tier").notNull().default("Starter"),
    defaultLanguage: text("default_language").notNull(),
    brandingConfig: jsonb("branding_config").$type<TenantBrandingConfig>(),
    whiteLabelEnabled: boolean("white_label_enabled").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("tenant_name_key").on(t.name),
    uniqueIndex("tenant_slug_key").on(t.slug),
    check("tenant_default_language_iso639_1", sql`length(${t.defaultLanguage}) = 2`),
  ],
);

/**
 * **tenant_data_policy** (LLD §3.3, FR-ADM-06). 1:1 with `tenant`. Retention values
 * of `0`/blank are invalid at the API layer (`RETENTION_PERIOD_INVALID`); `-1` means
 * "Indefinite" and is only settable via an explicit `{ mode: "indefinite" }` request —
 * that gate lives in the application service, not the DB CHECK, since the DB only
 * needs to reject the truly-invalid `0`/negative-other-than-(-1) cases.
 */
export const tenantDataPolicy = pgTable(
  "tenant_data_policy",
  {
    tenantId: uuid("tenant_id")
      .primaryKey()
      .references(() => tenant.id),
    retentionTranscriptsDays: integer("retention_transcripts_days").notNull(),
    retentionToolPayloadsDays: integer("retention_tool_payloads_days").notNull(),
    retentionToolMetadataDays: integer("retention_tool_metadata_days").notNull(),
    retentionPiiDays: integer("retention_pii_days").notNull(),
    residencyRegion: regionEnum("residency_region").notNull(),
    allowOutOfRegionInference: boolean("allow_out_of_region_inference").notNull().default(false),
    purgeLastRunAt: timestamp("purge_last_run_at", { withTimezone: true }),
  },
  (t) => [
    check(
      "tenant_data_policy_retention_transcripts_valid",
      sql`${t.retentionTranscriptsDays} > 0 OR ${t.retentionTranscriptsDays} = -1`,
    ),
    check(
      "tenant_data_policy_retention_tool_payloads_valid",
      sql`${t.retentionToolPayloadsDays} > 0 OR ${t.retentionToolPayloadsDays} = -1`,
    ),
    check(
      "tenant_data_policy_retention_tool_metadata_valid",
      sql`${t.retentionToolMetadataDays} > 0 OR ${t.retentionToolMetadataDays} = -1`,
    ),
    check(
      "tenant_data_policy_retention_pii_valid",
      sql`${t.retentionPiiDays} > 0 OR ${t.retentionPiiDays} = -1`,
    ),
  ],
);

/**
 * **tenant_runtime_quota** (LLD §3.10, NFR-4 / NFR-4a / FR-AGT-10). The sole live
 * enforcement source of truth for runtime-shaping limits; seeded from `plan_tier` at
 * provisioning time but tunable afterward without changing the tier label (LLD's
 * "tier is a template, not a live constraint"). `NULL` means "no cap" for the
 * Enterprise-negotiated fields.
 */
export const tenantRuntimeQuota = pgTable("tenant_runtime_quota", {
  tenantId: uuid("tenant_id")
    .primaryKey()
    .references(() => tenant.id),
  maxConcurrentRuns: integer("max_concurrent_runs"),
  maxTokensPerMinute: integer("max_tokens_per_minute"),
  maxToolCallsPerSecond: integer("max_tool_calls_per_second"),
  toolEgressAllowlist: text("tool_egress_allowlist").array().notNull().default(sql`'{}'::text[]`),
  maxConcurrentConversations: integer("max_concurrent_conversations"),
  maxMcpConnectors: integer("max_mcp_connectors"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * **tenant_database_route** (ADR-0001 §2a/§5 — the Enterprise dedicated-database
 * escape hatch's *routing* table). Every MVP row points at the shared cluster
 * database; provisioning an Enterprise tenant writes a row here pointing at a
 * dedicated database. Actually standing up that second physical database is
 * deployment/infra work (nexus-deploy scope, per the plan's open item #3) — this
 * table only records the routing intent so the schema never needs to change when
 * that infra work happens.
 *
 * `dsnVaultRef` is a `SecretsProvider` pointer (never a plaintext connection string,
 * consistent with the "no secret in a config column" rule applied everywhere else).
 */
export const tenantDatabaseRoute = pgTable("tenant_database_route", {
  tenantId: uuid("tenant_id")
    .primaryKey()
    .references(() => tenant.id),
  isDedicated: boolean("is_dedicated").notNull().default(false),
  dsnVaultRef: text("dsn_vault_ref"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * **tenant_graph_database_route** (Target Architecture Blueprint Phase 7a, ADR-0018
 * §2.2/§5 — "The tenant → graph cluster + database routing table"). The Postgres-side
 * record of a tenant's Neo4j database — mirrors `tenant_database_route`'s own
 * "routing row records intent, physical provisioning may lag" shape exactly.
 *
 * **Disclosed, deliberate deviation from ADR-0018 §2.2's "created lazily, on a
 * tenant's first knowledge collection build"**: this phase (7a) has no ingestion
 * pipeline yet to hang a "first collection build" hook off of (that's Phase 7b), so
 * `provisionTenant()` writes this row — and calls the real Neo4j provisioning primitive
 * — eagerly, at tenant-creation time, so Phase 7b's ingestion work can assume the
 * database already exists by the time it runs (per this phase's own dispatch brief).
 * This trades ADR-0018's "tenants that never use Module B cost nothing" cost
 * optimization for build-ordering simplicity; it does not change the isolation
 * mechanism itself, and Phase 7b (or a later cost-optimization pass) can move the
 * call site from `provisionTenant()` to a real "first collection build" hook without
 * touching `ensureTenantGraphDatabase()`'s idempotent primitive at all.
 *
 * `provisionedAt IS NULL` is the "half-provisioned tenant" signal ADR-0018 §4 calls
 * for: the Postgres tenant row and this routing row both exist, but the Neo4j
 * database/role/grants may not (yet) — repairable by re-invoking
 * `ensureTenantGraphDatabase(tenantId)` again (idempotent), never by hand.
 */
/**
 * **tenant_identity_resolution_policy** (Target Architecture Blueprint Phase 19,
 * BL-50, FR-OC-08). 1:1 with `tenant`, mirrors `tenant_data_policy`'s own shape.
 * `enabled` defaults `false` — cross-channel identity linking is OFF until a tenant
 * admin explicitly opts in (FR-OC-08's hard requirement: never an automatic/inferred
 * merge). When `true`, `@nextbot/conversations`'
 * `resolveLinkedConversations()` treats two conversations as the same customer only
 * when their `conversation.customer_identifier_hash` values are EXACTLY equal — this
 * table records the opt-in only, never the matching rule itself (there is only one
 * matching rule: exact hash equality, no fuzzy/similarity matching anywhere).
 */
export const tenantIdentityResolutionPolicy = pgTable("tenant_identity_resolution_policy", {
  tenantId: uuid("tenant_id")
    .primaryKey()
    .references(() => tenant.id),
  enabled: boolean("enabled").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * **tenant_breakglass_grant** (Target Architecture Blueprint Phase 20, BL-52,
 * FR-ADM-09). The tenant-side, explicitly-consented half of "Consented Break-Glass
 * Operator Access" — there is no other way for a NextBot Platform Operator to gain
 * scoped, time-boxed read access to a tenant's data for incident diagnosis; a row here
 * must exist, be unexpired, and be unrevoked, or the platform-ops side's own
 * `activateBreakglassAccess()` denies the request outright, fail-closed, regardless of
 * the operator's own role/token validity (the spec's own named hard requirement).
 *
 * `grantedByUserId`/`revokedByUserId` are deliberately FK-less `uuid` columns — the
 * same loosely-associated-actor convention `tool_call.decidedByUserId`/
 * `tool_call_event.actorUserId` already use in this schema — so this table's own
 * lifecycle never blocks on `app_user` row deletion ordering.
 *
 * `expiresAt` is tenant-chosen at creation time but capped at a platform-enforced
 * maximum (`BREAKGLASS_MAX_GRANT_HOURS`, `packages/contracts/src/tenancy.ts`),
 * validated in `packages/modules/tenancy/src/domain/breakglass-grant-policy.ts` —
 * never silently clamped, rejected outright if the requested window is too long, so a
 * tenant can never be misled into believing they granted less exposure than an
 * accepted request actually recorded.
 *
 * Time-box + revocation are checked **synchronously at every access attempt**
 * (`revoked_at IS NULL AND expires_at > now()`), the exact same shape and rationale as
 * `auth_session`/`scim_token`'s own `revoked_at`/`expires_at` columns — no background
 * expiry-sweep job exists or is needed for this table; break-glass access is a
 * genuinely lower-frequency operational need than the Tier-3 approval/workflow-
 * suspension/escalation-SLA sweeps this codebase already runs.
 *
 * Only one grant may be ACTIVE (unexpired, unrevoked) per tenant at a time — enforced
 * in application code (`createBreakglassGrant()`), not a DB constraint, since
 * "active" is a function of `now()` and cannot be expressed as a static partial-unique
 * index without a per-request-time predicate.
 */
export const tenantBreakglassGrant = pgTable(
  "tenant_breakglass_grant",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id),
    grantedByUserId: uuid("granted_by_user_id").notNull(),
    reason: text("reason").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedByUserId: uuid("revoked_by_user_id"),
  },
  (t) => [
    index("tenant_breakglass_grant_tenant_idx").on(t.tenantId, t.createdAt),
    // The "is there an active grant right now" check (`getActiveBreakglassGrant`) is
    // the hot path both the tenant's own settings screen and every platform-ops
    // access attempt run — indexed on exactly the two predicates that check filters on.
    index("tenant_breakglass_grant_tenant_active_idx").on(t.tenantId, t.revokedAt, t.expiresAt),
  ],
);

export const tenantGraphDatabaseRoute = pgTable(
  "tenant_graph_database_route",
  {
    tenantId: uuid("tenant_id")
      .primaryKey()
      .references(() => tenant.id),
    // The Neo4j cluster's Bolt URL this tenant is routed to. A single value today
    // (one cluster per regional cell, ADR-0018 §2.1) — the per-cluster database
    // budget/routing-table growth ADR-0018 §2.2 describes is an operational-capacity
    // concern for when a cell needs a second cluster, not a schema change.
    clusterUrl: text("cluster_url").notNull(),
    // `t-<hex(tenantId)>` — computed once and stored, so a future change to the
    // naming scheme can never orphan an already-provisioned tenant's database.
    databaseName: text("database_name").notNull(),
    // NULL until `ensureTenantGraphDatabase()` has actually completed successfully.
    provisionedAt: timestamp("provisioned_at", { withTimezone: true }),
    lastProvisionErrorAt: timestamp("last_provision_error_at", { withTimezone: true }),
    lastProvisionError: text("last_provision_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("tenant_graph_database_route_database_name_key").on(t.databaseName)],
);
