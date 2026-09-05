import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tenant } from "./tenancy.js";
import { environmentEnum } from "./enums.js";

// LLD §3.5 enums
export const backendTypeEnum = pgEnum("backend_type", [
  "Ticketing",
  "CRM",
  "ERP",
  "Billing",
  "HRIS",
  "KnowledgeBase",
  "Custom",
]);
export const mcpTransportEnum = pgEnum("mcp_transport", ["StreamableHTTP", "StdioViaGateway"]);
export const connectorAuthMethodEnum = pgEnum("connector_auth_method", [
  "OAuth2",
  "APIKey",
  "BearerToken",
  "CustomHeader",
  "mTLS",
  "None",
]);
export const connectorStatusEnum = pgEnum("connector_status", ["Connected", "Degraded", "Offline"]);
export const trustLevelEnum = pgEnum("trust_level", ["Trusted", "SemiTrusted", "Untrusted"]);
export const circuitStateEnum = pgEnum("circuit_state", ["Closed", "Open", "HalfOpen"]);
export const credentialTypeEnum = pgEnum("credential_type", [
  "APIKey",
  "OAuthToken",
  "SystemUserToken",
  "BearerToken",
  "ClientCertificate",
  "MfaSecret",
  "ModelProviderKey",
  // Phase 10 (BL-07, ADR-0009): the tenant's GitHub App installation token / GitLab
  // OAuth access+refresh token pair, and the webhook HMAC secret registered alongside
  // it — both stored via the same envelope-encryption vault as every other credential,
  // never a bespoke storage path.
  "GitOAuthToken",
  "WebhookSecret",
  // Phase 3 (BL-15, ADR-0009's same "vault everything" pattern applied to the Meta
  // family): the Meta App Secret (used to verify the WhatsApp webhook's
  // `X-Hub-Signature-256` HMAC, same mechanism as the Git webhooks above) and the
  // admin-chosen webhook verification handshake token (`hub.verify_token`) — both
  // vaulted rather than stored in plaintext config, even though the verify token
  // itself isn't Meta-issued secret material, for consistency with this codebase's
  // "no credential/token is ever a plaintext column" bar. The System User token
  // reuses the existing `SystemUserToken` value above.
  "MetaAppSecret",
  "MetaWebhookVerifyToken",
]);

export interface StdioCommand {
  command: string;
  args: string[];
  env: Record<string, string>;
}

/**
 * **credential** (LLD §3.5, FR-SEC-02 — ADR-0007). No plaintext column exists
 * anywhere on this table. `ciphertext`'s SELECT grant is restricted to the "gateway"
 * DB role only (`packages/db/src/bootstrap/ensure-roles.ts`) — the "app" role (used
 * by `apps/web`'s admin API) can INSERT/UPDATE it (initial entry / rotation) but
 * never SELECT it back.
 */
export const credential = pgTable(
  "credential",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id),
    label: text("label").notNull(),
    type: credentialTypeEnum("type").notNull(),
    vaultRef: text("vault_ref").notNull(),
    ciphertext: text("ciphertext").notNull(),
    dekRef: text("dek_ref").notNull(),
    maskedHint: text("masked_hint").notNull(),
    lastRotatedAt: timestamp("last_rotated_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("credential_vault_ref_key").on(t.vaultRef), index("credential_tenant_idx").on(t.tenantId)],
);

/**
 * **connector** (LLD §3.5, BL-02). `status`/`circuit_state` are computed by the
 * health/circuit-breaker subsystem (BL-11, a later phase) — no API path in this
 * phase sets them directly; they default to `Offline`/`Closed` at creation and are
 * only ever updated by that subsystem once it lands.
 */
export const connector = pgTable(
  "connector",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id),
    name: text("name").notNull(),
    description: text("description"),
    backendType: backendTypeEnum("backend_type").notNull(),
    templateKey: text("template_key"),
    transport: mcpTransportEnum("transport").notNull(),
    endpointUrl: text("endpoint_url"),
    stdioCommand: jsonb("stdio_command").$type<StdioCommand>(),
    gatewayAgentId: uuid("gateway_agent_id"),
    authMethod: connectorAuthMethodEnum("auth_method").notNull(),
    credentialId: uuid("credential_id").references(() => credential.id),
    environment: environmentEnum("environment").notNull(),
    status: connectorStatusEnum("status").notNull().default("Offline"),
    trustLevel: trustLevelEnum("trust_level").notNull().default("SemiTrusted"),
    healthIntervalSeconds: integer("health_interval_seconds").notNull().default(60),
    latencyThresholdMs: integer("latency_threshold_ms").notNull().default(2000),
    errorRateThresholdPct: numeric("error_rate_threshold_pct", { precision: 5, scale: 2 }).notNull().default("5.00"),
    offlineAlertAfterMinutes: integer("offline_alert_after_minutes").notNull().default(5),
    circuitState: circuitStateEnum("circuit_state").notNull().default("Closed"),
    circuitOpenedAt: timestamp("circuit_opened_at", { withTimezone: true }),
    lastDiscoveredAt: timestamp("last_discovered_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("connector_tenant_env_name_key").on(t.tenantId, t.environment, t.name),
    index("connector_tenant_env_status_idx").on(t.tenantId, t.environment, t.status),
    index("connector_tenant_backend_type_idx").on(t.tenantId, t.backendType),
    check(
      "connector_endpoint_url_required_for_http",
      sql`${t.transport} != 'StreamableHTTP' OR ${t.endpointUrl} IS NOT NULL`,
    ),
    check(
      "connector_stdio_command_required_for_stdio",
      sql`${t.transport} != 'StdioViaGateway' OR ${t.stdioCommand} IS NOT NULL`,
    ),
    check(
      "connector_credential_required_unless_none",
      sql`${t.authMethod} = 'None' OR ${t.credentialId} IS NOT NULL`,
    ),
    // FR-SEC-02 / security review: https-only egress endpoint (defense in depth —
    // application-layer validation via TypeBox also rejects non-https at the edge).
    check("connector_endpoint_url_https_only", sql`${t.endpointUrl} IS NULL OR ${t.endpointUrl} LIKE 'https://%'`),
  ],
);

/**
 * **connector_health_check** (Phase 18, BL-11, FR-MCP-08) — one row per health
 * probe (`apps/worker`'s health-checker job, scheduled — see
 * `apps/worker/src/mcp-health-check.ts`). Feeds B.3A.4's per-tool p50/p95/p99
 * latency + error-rate + call-volume sparkline; kept as a plain time-series table
 * (no partitioning yet — same "add it once volume is real" deferral Phase 13 made
 * for `agent_run_span`).
 */
export const connectorHealthCheck = pgTable(
  "connector_health_check",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id),
    connectorId: uuid("connector_id")
      .notNull()
      .references(() => connector.id),
    checkedAt: timestamp("checked_at", { withTimezone: true }).notNull().defaultNow(),
    ok: boolean("ok").notNull(),
    latencyMs: integer("latency_ms"),
    errorMessage: text("error_message"),
  },
  (t) => [
    index("connector_health_check_tenant_connector_checked_idx").on(t.tenantId, t.connectorId, t.checkedAt),
  ],
);

/** Alert destination kinds a `connector_alert_rule` can notify (B.3A.4's "alert
 * configuration with thresholds and destinations"). */
export const alertDestinationKindEnum = pgEnum("alert_destination_kind", ["Email", "Slack", "InApp"]);
export const alertMetricEnum = pgEnum("alert_metric", ["LatencyMs", "ErrorRatePct", "OfflineMinutes"]);

/**
 * **connector_alert_rule** (Phase 18, BL-11) — per-connector alert configuration.
 * `destination` for `Slack` is a **credential reference** (`credential.id`), never a
 * plaintext webhook URL in this table — the security review for this phase treats
 * a Slack webhook URL as a secret exactly like any other connector credential
 * (LLD §3.5's existing vault, not a bespoke plaintext config column).
 */
export const connectorAlertRule = pgTable(
  "connector_alert_rule",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id),
    connectorId: uuid("connector_id")
      .notNull()
      .references(() => connector.id),
    metric: alertMetricEnum("metric").notNull(),
    thresholdValue: numeric("threshold_value", { precision: 10, scale: 2 }).notNull(),
    destinationKind: alertDestinationKindEnum("destination_kind").notNull(),
    destinationEmail: text("destination_email"),
    destinationCredentialId: uuid("destination_credential_id").references(() => credential.id),
    enabled: boolean("enabled").notNull().default(true),
    lastTriggeredAt: timestamp("last_triggered_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("connector_alert_rule_tenant_connector_idx").on(t.tenantId, t.connectorId)],
);
