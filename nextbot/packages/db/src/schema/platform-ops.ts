import { boolean, index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { planTierEnum } from "./enums.js";
import { tenant } from "./tenancy.js";

/**
 * **platform_audit_log_entry** (Platform Manager console Phase 1, NFR-11). A
 * separate audit trail from `audit_log_entry` for two reasons: (1) `audit_log_entry`
 * has a `NOT NULL` `tenant_id` and is `FORCE ROW LEVEL SECURITY` — a provisioning-time
 * action has no tenant row to attribute to yet, and a cross-tenant rollup action has
 * no single tenant at all; (2) this table is written exclusively via `withPlatform()`
 * (LLD §3.2 rule 4's two allowed callers: `packages/modules/tenancy` and
 * `apps/web/app/api/internal/ops/**`), so it deliberately carries no RLS policy at
 * all — same reasoning as the `tenant` table itself (see its own doc comment).
 *
 * Append-only, exactly like `audit_log_entry`: `UPDATE`/`DELETE` are unconditionally
 * revoked from both the "app" and "platform" Postgres roles on every bootstrap run
 * (`ensure-roles.ts`), not via a one-time migration-level REVOKE (see that file's doc
 * comment for why a migration-level REVOKE would not survive the per-role blanket
 * grant loop that also runs on every `pnpm db:migrate`).
 *
 * `targetTenantId` is nullable (a rollup/health action may not target one specific
 * tenant) and uses `ON DELETE SET NULL` rather than a hard FK block — an audit trail
 * entry must never vanish just because the tenant it once referenced was later
 * deleted, but referential integrity also must never be the reason a real tenant
 * deprovisioning flow fails.
 */
export const platformAuditLogEntry = pgTable(
  "platform_audit_log_entry",
  {
    id: uuid("id").primaryKey(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    actorLabel: text("actor_label").notNull(),
    actionType: text("action_type").notNull(),
    targetTenantId: uuid("target_tenant_id").references(() => tenant.id, { onDelete: "set null" }),
    details: jsonb("details").notNull(),
  },
  (t) => [
    index("platform_audit_log_entry_occurred_idx").on(t.occurredAt),
    index("platform_audit_log_entry_target_tenant_idx").on(t.targetTenantId),
  ],
);

/**
 * **plan_tier_definition** (Platform Manager console Phase 2, NFR-11). One row per
 * existing `plan_tier` enum value (`Starter`/`Growth`/`Enterprise` — not arbitrary
 * new tiers, that is materially larger scope than this phase). Makes today's
 * hardcoded `PLAN_TIER_DEFAULTS` (`packages/modules/tenancy/src/domain/
 * plan-tier-defaults.ts`) editable at runtime; seeded at migration time with those
 * exact values so behavior is unchanged on deploy day (see this table's migration).
 *
 * `getEffectivePlanTierDefaults()` reads this table and falls back to the pure
 * `getPlanTierQuotaDefaults()` domain function if a row is ever missing (defensive —
 * every enum value is seeded by migration, so this should not happen in practice).
 *
 * `features` is explicitly descriptive/forward-looking only (surfaced with that
 * caveat in the Plan Tiers screen's copy) — no feature-gating mechanism reads this
 * column anywhere else in the codebase, and none should be built against it this
 * phase.
 *
 * No RLS, same reasoning as `tenant`/`platform_audit_log_entry`: written exclusively
 * via `withPlatform()` (LLD §3.2 rule 4's two allowed callers). Unlike
 * `platform_audit_log_entry` this table is NOT append-only — operators are expected
 * to edit it — so it is not part of the `ensure-roles.ts` UPDATE/DELETE revoke list.
 */
export const planTierDefinition = pgTable("plan_tier_definition", {
  tier: planTierEnum("tier").primaryKey(),
  maxToolCallsPerSecond: integer("max_tool_calls_per_second"),
  maxConcurrentConversations: integer("max_concurrent_conversations"),
  maxMcpConnectors: integer("max_mcp_connectors"),
  isDedicatedDatabase: boolean("is_dedicated_database").notNull().default(false),
  /** Descriptive/forward-looking only — see this table's doc comment. */
  features: text("features").array().notNull().default(sql`'{}'::text[]`),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
