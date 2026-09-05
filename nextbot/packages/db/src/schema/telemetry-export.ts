import { boolean, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { tenant } from "./tenancy.js";

/**
 * Target Architecture Blueprint Phase 18 (BL-49, FR-ADM-10) — tenant-scoped,
 * opt-in OpenTelemetry trace/metric export and audit-log SIEM streaming.
 *
 * Both are ADDITIVE to the existing in-console experiences (Runtime Traces,
 * FR-RP-08; Audit Log Viewer, FR-ADM-03) — this module never replaces either read
 * path, it only forwards a copy of the same underlying data to a tenant-configured
 * external endpoint. Both default `enabled = false` (opt-in, per FR-ADM-10's own
 * wording), one row per tenant (the `tenant_id` unique index), created lazily on
 * first configuration rather than provisioned for every tenant up front.
 */
export const otelExportConfig = pgTable(
  "otel_export_config",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id),
    // OTLP/HTTP collector endpoint the tenant operates (e.g. their own Grafana Tempo/
    // Datadog Agent OTLP receiver). Traces AND the periodic metric snapshot are both
    // sent here — FR-ADM-10 groups them as one opt-in setting, not two.
    otlpEndpointUrl: text("otlp_endpoint_url").notNull(),
    enabled: boolean("enabled").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("otel_export_config_tenant_key").on(t.tenantId)],
);

/**
 * The audit-log SIEM streaming half. `last_exported_audit_log_id`/
 * `last_exported_at` are THIS table's own cursor, entirely independent of
 * `domain_event.processed`/`processed_at` (`@nextbot/audit`'s private cursor) and of
 * `webhook_delivery` (the webhooks subsystem's own per-event tracking) — this is a
 * THIRD, unrelated consumer of tenant data (it reads `audit_log_entry`, not
 * `domain_event`, so there is no shared-cursor risk with either of the other two at
 * all, only recorded here for completeness since all three read from the same
 * underlying stream of "things that happened").
 */
export const siemExportConfig = pgTable(
  "siem_export_config",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id),
    endpointUrl: text("endpoint_url").notNull(),
    enabled: boolean("enabled").notNull().default(false),
    lastExportedAuditLogId: uuid("last_exported_audit_log_id"),
    lastExportedAt: timestamp("last_exported_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("siem_export_config_tenant_key").on(t.tenantId)],
);
