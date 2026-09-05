import { boolean, check, index, integer, jsonb, pgEnum, pgTable, smallint, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tenant } from "./tenancy.js";
import { environmentEnum } from "./enums.js";
import { backendTypeEnum, connector, connectorAuthMethodEnum, credential, mcpTransportEnum, trustLevelEnum } from "./connectors.js";
import { approvalTierEnum, capabilityGroup, classSourceEnum, rwClassEnum, tierSourceEnum, tool } from "./tool-registry.js";

/**
 * Phase 6 (BL-29, ADR-0014, LLD §14.3 — Module A, MCP Definition Registry) — manifest
 * pinning and drift-as-new-item quarantine. Closes the Blueprint's gap G-03 ("the
 * clearest privilege-escalation path in the shipped platform"): today an MCP server
 * can change a tool's input schema and change agent behavior in production with no
 * review.
 *
 * **Disclosed scope reduction versus LLD §14.3's full shape** (recorded here, not
 * silently narrowed): this phase ships the pinning/drift mechanism itself (BL-29),
 * not the 9-step enrolment wizard or the `connector`/`mcp_environment_binding`
 * migration (both BL-34, Phase 3 of `docs/plans/target-architecture-blueprint-plan.md`).
 * Concretely:
 *   - `mcp_server` carries its own `endpoint_url`/`transport`/`credential_id` directly
 *     (one endpoint per server) rather than LLD §14.3.2's per-environment
 *     `mcp_environment_binding` rows — Sandbox/Staging/Production binding separation
 *     is a BL-34 addition once the wizard exists to author it.
 *   - Discovery covers `kind = 'Tool'` only (`@nextbot/mcp-client`'s `listTools`, the
 *     only discovery call this codebase's MCP client supports today); `Resource`/
 *     `Prompt` manifest items and their FR-MCP-20 knowledge-ingestion-candidate bridge
 *     are BL-34's addition once `list_resources`/`list_prompts` client support ships
 *     alongside the wizard. The `kind` enum already includes `Resource`/`Prompt` so no
 *     later migration is needed to add the values, only the application logic that
 *     populates them.
 *   - No `artifact_mcp_pin` bridge to `agent_definition_version`/`skill_version`/
 *     `workflow_version` yet (LLD §14.3.5) — those consumer-side pin/badge features
 *     depend on Skills/Workflows (Phases 5/9 of the blueprint plan), which don't exist
 *     yet either. The `mcp_server_version`/`mcp_manifest_item` immutability and
 *     drift-as-new-item semantics that ADR-0014 actually exists to guarantee do not
 *     depend on that bridge existing yet.
 *
 * None of this weakens ADR-0014's actual security property (§2.2: a changed schema is
 * a new item, never an in-place update) — that property is fully implemented here.
 *
 * **Phase 3 update (BL-34, `docs/plans/mcp-enrolment-wizard-plan.md`)**: closes the
 * scope reduction above. `mcp_environment_binding` (per-environment endpoint/
 * credential/connector-owning row), `mcp_enrolment_draft` (the wizard's resumable
 * state), and the `backendType`/`ownerUserId`/`criticality`/`trustLevel` (server) and
 * `transport`/`authMethod`/`policyJson` (version) and `ioClass`/`ioClassSource`/
 * `approvalTierSource`/`knowledgeIngestionCandidate`/`toolId` (manifest item) columns
 * are additive only — every column added to an existing table is nullable or
 * DEFAULT-backed so Phase 0's already-shipped rows and the reconciler's existing
 * INSERT statements (`mcp-server-repository.ts`, unchanged this phase) remain valid
 * with no backfill migration required. `artifact_mcp_pin` (LLD §14.3.5) remains
 * deferred — still no Skills/Workflows to pin against.
 */

export const mcpServerStatusEnum = pgEnum("mcp_server_status", ["Active", "Suspended", "Retired"]);
export const mcpServerVersionStatusEnum = pgEnum("mcp_server_version_status", ["Draft", "Approved", "Superseded"]);
export const mcpManifestItemKindEnum = pgEnum("mcp_manifest_item_kind", ["Tool", "Resource", "Prompt"]);
export const mcpDriftChangeKindEnum = pgEnum("mcp_drift_change_kind", ["ItemAdded", "ItemRemoved", "SchemaChanged"]);
export const mcpDriftResolutionEnum = pgEnum("mcp_drift_resolution", ["Pending", "Accepted", "Rejected"]);
export const mcpReachabilityEnum = pgEnum("mcp_reachability", ["Unknown", "Reachable", "Unreachable"]);
// Phase 3 (BL-34, LLD §14.3.2) additions below — the 9-step enrolment wizard.
export const mcpCriticalityEnum = pgEnum("mcp_criticality", ["Low", "Medium", "High", "BusinessCritical"]);
export const mcpBindingReachabilityEnum = pgEnum("mcp_binding_reachability", ["Unknown", "Reachable", "Unreachable"]);

/**
 * **mcp_server** — the enrolment-lifecycle parent (LLD §14.3.1's role, scoped down per
 * this file's own doc comment above: one endpoint per server this phase, not a
 * per-environment binding).
 */
export const mcpServer = pgTable(
  "mcp_server",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id),
    name: text("name").notNull(),
    description: text("description"),
    endpointUrl: text("endpoint_url").notNull(),
    transport: text("transport").notNull().default("StreamableHTTP"),
    credentialId: uuid("credential_id").references(() => credential.id),
    // Phase 3 (BL-34) additions — wizard step 1 ("identify"). Nullable/defaulted so
    // Phase 0's pre-existing rows (created via `createServerWithApprovedVersion`,
    // which never populated these) remain valid without a backfill: an
    // un-migrated Phase-0 server simply shows "Unassigned"/"Medium"/"SemiTrusted"
    // in the console until an admin edits it, exactly as a nullable optional field
    // should.
    backendType: backendTypeEnum("backend_type"),
    ownerUserId: uuid("owner_user_id"),
    criticality: mcpCriticalityEnum("criticality").notNull().default("Medium"),
    trustLevel: trustLevelEnum("trust_level").notNull().default("SemiTrusted"),
    status: mcpServerStatusEnum("status").notNull().default("Active"),
    currentVersionId: uuid("current_version_id"),
    // NFR-14 — reconciler cadence, per-server configurable, bounded (5 min .. 24 h).
    reconcileIntervalSeconds: integer("reconcile_interval_seconds").notNull().default(3600),
    lastReconciledAt: timestamp("last_reconciled_at", { withTimezone: true }),
    // FR-MCP-18's boundary rule: unreachability is a **health** signal, tracked here
    // directly (this phase has no separate `connector`/`connector_health_check` link —
    // see this file's scope-reduction note), never conflated with `mcp_drift_event`.
    reachability: mcpReachabilityEnum("reachability").notNull().default("Unknown"),
    lastProbeError: jsonb("last_probe_error"),
    createdByUserId: uuid("created_by_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("mcp_server_tenant_name_key").on(t.tenantId, t.name),
    index("mcp_server_tenant_status_idx").on(t.tenantId, t.status),
    index("mcp_server_tenant_last_reconciled_idx").on(t.tenantId, t.lastReconciledAt),
  ],
);

/**
 * **mcp_server_version** — immutable once `Approved` (ADR-0014 §2.1: "the contract...
 * is pinned to a server version"). No `UPDATE` path exists in the repository for any
 * column except `status`/`approved_*` — enforced at the application layer here
 * (`mcp-server-repository.ts` never issues an `UPDATE` touching `manifest_hash`/
 * `item_count` after creation); the DB-trigger-level backstop `agent_definition_
 * version`/`skill_version` use is a reasonable future hardening, not required for
 * this phase's actual security property (drift produces a **new row**, which this
 * schema's `supersedes_version_id` chain already makes structurally true regardless
 * of whether an in-place `UPDATE` is additionally blocked at the engine level).
 */
export const mcpServerVersion = pgTable(
  "mcp_server_version",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id),
    serverId: uuid("server_id")
      .notNull()
      .references(() => mcpServer.id),
    version: integer("version").notNull(),
    // Phase 3 (BL-34) additions — wizard steps 2/3/7. Nullable: Phase 0's existing
    // version rows (created before the wizard existed) carry no per-version
    // transport/auth/policy of their own (the single-endpoint-per-server model that
    // phase shipped); a NULL here just means "ask the server row instead," which
    // every reader added this phase already does.
    transport: mcpTransportEnum("transport"),
    authMethod: connectorAuthMethodEnum("auth_method"),
    // `McpRuntimePolicySchema` (LLD §14.3.2) — timeout/retry/circuit-breaker/rate-
    // limit/cost-tag/egress-allowlist, wizard step 7.
    policyJson: jsonb("policy_json"),
    // ADR-0014 §2.1 — sha256 over the canonical JSON array of `{kind,name,schemaHash}`
    // sorted by `(kind,name)`. THE pinned value.
    manifestHash: text("manifest_hash").notNull(),
    itemCount: integer("item_count").notNull().default(0),
    status: mcpServerVersionStatusEnum("status").notNull().default("Draft"),
    supersedesVersionId: uuid("supersedes_version_id"),
    approvedByUserId: uuid("approved_by_user_id"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    createdByUserId: uuid("created_by_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("mcp_server_version_tenant_server_version_key").on(t.tenantId, t.serverId, t.version),
    index("mcp_server_version_tenant_status_idx").on(t.tenantId, t.status),
    index("mcp_server_version_tenant_hash_idx").on(t.tenantId, t.manifestHash),
  ],
);

/**
 * **mcp_manifest_item** — append-only per version (ADR-0014 §2.2: drift is a new
 * item, never an in-place update on an existing row). `supersedes_item_id` is set
 * when a drift-review Accept mints this item as the replacement for an earlier item
 * of the same `(kind, name)` whose schema changed — the earlier item's row is left
 * completely untouched (still referenced by whatever server version it belongs to).
 */
export const mcpManifestItem = pgTable(
  "mcp_manifest_item",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id),
    serverVersionId: uuid("server_version_id")
      .notNull()
      .references(() => mcpServerVersion.id),
    kind: mcpManifestItemKindEnum("kind").notNull(),
    name: text("name").notNull(),
    descriptionSource: text("description_source").notNull(),
    schemaJson: jsonb("schema_json").notNull(),
    schemaHash: text("schema_hash").notNull(),
    approvalTier: approvalTierEnum("approval_tier").notNull().default("Tier3"),
    // FR-MCP-16's fail-closed default — an unreviewed or newly-drifted item is
    // disabled; never auto-enabled (ADR-0014 §2.2/§2.5).
    enabled: boolean("enabled").notNull().default(false),
    capabilityGroupId: uuid("capability_group_id").references(() => capabilityGroup.id, { onDelete: "set null" }),
    supersedesItemId: uuid("supersedes_item_id"),
    // Phase 3 (BL-34) additions — wizard step 5 ("classification"). `ioClass`
    // defaults `Write` (the conservative direction, matching `tool-registry`'s own
    // `classifyReadWrite` fallback) so Phase 0's carried-forward drift-review rows
    // (which never set these) still satisfy NOT NULL without a backfill guess in
    // the *unsafe* direction.
    ioClass: rwClassEnum("io_class").notNull().default("Write"),
    ioClassSource: classSourceEnum("io_class_source").notNull().default("AutoHeuristic"),
    approvalTierSource: tierSourceEnum("approval_tier_source").notNull().default("AdminOverride"),
    // `kind='Resource'` only — surfaces the item in Module B's future source picker
    // (FR-MCP-20/FR-KB-02, not built yet; the column exists so this phase's wizard
    // can already capture the intent).
    knowledgeIngestionCandidate: boolean("knowledge_ingestion_candidate").notNull().default(false),
    // The `tool` row materialised from this item at enrol (Tool-kind items only) —
    // NULL for Resource/Prompt items and for anything never enrolled/disabled.
    toolId: uuid("tool_id").references(() => tool.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("mcp_manifest_item_tenant_version_kind_name_key").on(t.tenantId, t.serverVersionId, t.kind, t.name),
    index("mcp_manifest_item_tenant_version_kind_idx").on(t.tenantId, t.serverVersionId, t.kind),
    index("mcp_manifest_item_tenant_schema_hash_idx").on(t.tenantId, t.schemaHash),
    index("mcp_manifest_item_tenant_tool_idx").on(t.tenantId, t.toolId),
  ],
);

/**
 * **mcp_drift_event** — append-only. The partial unique index on `(tenant_id,
 * dedupe_key) WHERE resolution = 'Pending'` is ADR-0014's idempotency guarantee:
 * repeated reconciler runs against unchanged drift insert nothing
 * (`ON CONFLICT DO NOTHING`).
 */
export const mcpDriftEvent = pgTable(
  "mcp_drift_event",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id),
    serverId: uuid("server_id")
      .notNull()
      .references(() => mcpServer.id),
    pinnedVersionId: uuid("pinned_version_id")
      .notNull()
      .references(() => mcpServerVersion.id),
    detectedAt: timestamp("detected_at", { withTimezone: true }).notNull().defaultNow(),
    changeKind: mcpDriftChangeKindEnum("change_kind").notNull(),
    itemKind: mcpManifestItemKindEnum("item_kind").notNull(),
    itemName: text("item_name").notNull(),
    oldSchemaHash: text("old_schema_hash"),
    newSchemaHash: text("new_schema_hash"),
    diff: jsonb("diff"),
    resolution: mcpDriftResolutionEnum("resolution").notNull().default("Pending"),
    resolvedByUserId: uuid("resolved_by_user_id"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolutionNote: text("resolution_note"),
    resultingVersionId: uuid("resulting_version_id"),
    dedupeKey: text("dedupe_key").notNull(),
  },
  (t) => [
    uniqueIndex("mcp_drift_event_tenant_dedupe_pending_key")
      .on(t.tenantId, t.dedupeKey)
      .where(sql`${t.resolution} = 'Pending'`),
    index("mcp_drift_event_tenant_server_detected_idx").on(t.tenantId, t.serverId, t.detectedAt),
    index("mcp_drift_event_tenant_pending_idx").on(t.tenantId, t.resolution),
  ],
);

/**
 * **mcp_environment_binding** (Phase 3, BL-34, LLD §14.3.1/§14.3.2, FR-MCP-19) — one
 * per `(server_version, environment)`, each owning exactly one `connector` row (the
 * runtime/health record the existing health subsystem/circuit breaker/gateway-agent
 * tunnelling keep working against, unchanged). Sandbox and Production credentials are
 * captured and stored **separately** here (`credentialId`, one per binding) — never a
 * single shared credential across environments, which is exactly the requirement
 * FR-MCP-16 step 3 exists to guarantee (sandbox testing must never reach a live
 * system).
 */
export const mcpEnvironmentBinding = pgTable(
  "mcp_environment_binding",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id),
    serverVersionId: uuid("server_version_id")
      .notNull()
      .references(() => mcpServerVersion.id),
    environment: environmentEnum("environment").notNull(),
    endpointUrl: text("endpoint_url"),
    stdioCommand: jsonb("stdio_command"),
    gatewayAgentId: uuid("gateway_agent_id"),
    // Per-environment credential (FR-MCP-16 step 3) — separate from every other
    // environment's binding, even for the same logical server.
    credentialId: uuid("credential_id").references(() => credential.id),
    // The runtime/health row this binding owns (§14.3.1) — the health subsystem,
    // circuit breaker, and MCP Health screen keep reading/writing `connector`
    // unchanged; this FK is the only place the two tables meet.
    connectorId: uuid("connector_id")
      .notNull()
      .references(() => connector.id),
    reachability: mcpBindingReachabilityEnum("reachability").notNull().default("Unknown"),
    reachableAt: timestamp("reachable_at", { withTimezone: true }),
    lastProbeError: jsonb("last_probe_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("mcp_environment_binding_tenant_version_env_key").on(t.tenantId, t.serverVersionId, t.environment),
    uniqueIndex("mcp_environment_binding_tenant_connector_key").on(t.tenantId, t.connectorId),
    index("mcp_environment_binding_tenant_version_idx").on(t.tenantId, t.serverVersionId),
    index("mcp_environment_binding_tenant_env_reachability_idx").on(t.tenantId, t.environment, t.reachability),
    check(
      "mcp_environment_binding_endpoint_url_required_for_http",
      sql`${t.endpointUrl} IS NOT NULL OR ${t.stdioCommand} IS NOT NULL`,
    ),
  ],
);

/**
 * **mcp_enrolment_draft** (Phase 3, BL-34, LLD §14.3.2) — the 9-step wizard's
 * resumable server-side state. `payload` never holds a secret, only `credentialId`
 * pointers already written to the vault at step 3 — the same discipline every other
 * credential-bearing form in this codebase follows (`connectors`' own wizard never
 * round-trips plaintext back to the client either).
 */
export const mcpEnrolmentDraft = pgTable(
  "mcp_enrolment_draft",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id),
    serverId: uuid("server_id").references(() => mcpServer.id),
    step: smallint("step").notNull().default(1),
    payload: jsonb("payload").notNull().default({}),
    // The raw step-4 `tools/list`/`resources/list`/`prompts/list` response, retained
    // for the step-5/8 UI and discarded (left in place, harmlessly — the whole draft
    // row is deleted at enrol) once the wizard completes.
    discoverySnapshot: jsonb("discovery_snapshot"),
    dryRunResult: jsonb("dry_run_result"),
    createdByUserId: uuid("created_by_user_id").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull().default(sql`now() + interval '7 days'`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("mcp_enrolment_draft_tenant_created_by_idx").on(t.tenantId, t.createdByUserId),
    index("mcp_enrolment_draft_tenant_expires_idx").on(t.tenantId, t.expiresAt),
    check("mcp_enrolment_draft_step_range", sql`${t.step} BETWEEN 1 AND 9`),
  ],
);
