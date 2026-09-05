import { index, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { tenant } from "./tenancy.js";

/**
 * Phase 17 (BL-10, FR-ADM-03/NFR-5) — the outcome of an audited action, shown as
 * B.8.2's "Outcome" column and filterable.
 */
export const auditOutcomeEnum = pgEnum("audit_outcome", ["Success", "Failure", "Denied"]);

/**
 * **audit_log_entry** (LLD §3.x, FR-ADM-03/NFR-5). Append-only: `UPDATE`/`DELETE`
 * are revoked from every application role (`ensure-roles.ts`) — only `INSERT`/
 * `SELECT` remain, so even a compromised app process cannot rewrite or erase its own
 * trail. Populated by `audit`'s outbox consumer (`sync-audit-from-events.ts`), which
 * reads the generic `domain_event` table every other module already appends to
 * (LLD §2.4) rather than being called directly (module boundary: `audit` cannot be
 * a target of any module -> module import, LLD §2.3).
 *
 * `payload` mirrors the originating `domain_event.payload` verbatim (already
 * PII-masked at the writer per the Phase 12 `maskArgsForLogging` convention); the
 * Audit Log Viewer's detail drawer applies a *second*, context-aware mask
 * (`pii/application/masker.ts`) on top of that at render/export time, per the
 * masking-context matrix (FR-SEC-04) — belt-and-braces, not redundant, since the
 * writer-side mask and the read-side context mask can have different intensities.
 */
export const auditLogEntry = pgTable(
  "audit_log_entry",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    actorId: uuid("actor_id"),
    actorLabel: text("actor_label").notNull(),
    actionType: text("action_type").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    outcome: auditOutcomeEnum("outcome").notNull().default("Success"),
    details: jsonb("details").notNull(),
    sourceDomainEventId: uuid("source_domain_event_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("audit_log_entry_tenant_occurred_idx").on(t.tenantId, t.occurredAt),
    index("audit_log_entry_tenant_action_type_idx").on(t.tenantId, t.actionType),
    index("audit_log_entry_tenant_target_idx").on(t.tenantId, t.targetType, t.targetId),
  ],
);
