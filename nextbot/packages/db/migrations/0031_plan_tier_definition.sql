-- Platform Manager console Phase 2 (NFR-11): editable plan-tier definitions.
-- One row per existing `plan_tier` enum value (Starter/Growth/Enterprise) — not
-- arbitrary new tiers, that is materially larger scope than this phase. Seeded below
-- with today's hardcoded PLAN_TIER_DEFAULTS values
-- (packages/modules/tenancy/src/domain/plan-tier-defaults.ts) byte-for-byte, so
-- behavior is unchanged on deploy day. `getEffectivePlanTierDefaults()` falls back to
-- that same pure function if a row is ever missing.
--
-- No RLS — same reasoning as `tenant`/`platform_audit_log_entry`: written exclusively
-- via withPlatform() (LLD §3.2 rule 4's two allowed callers). Unlike
-- `platform_audit_log_entry` this table is NOT append-only (operators are expected to
-- edit it), so it is intentionally absent from ensure-roles.ts's UPDATE/DELETE
-- revoke list.
--
-- `features` is descriptive/forward-looking only — no feature-gating mechanism reads
-- it anywhere else in the codebase.

CREATE TABLE plan_tier_definition (
  tier plan_tier PRIMARY KEY,
  max_tool_calls_per_second integer,
  max_concurrent_conversations integer,
  max_mcp_connectors integer,
  is_dedicated_database boolean NOT NULL DEFAULT false,
  features text[] NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Seed values must match PLAN_TIER_DEFAULTS in
-- packages/modules/tenancy/src/domain/plan-tier-defaults.ts exactly — this is what
-- makes provisionTenant()'s existing tests (provision-tenant.int.test.ts,
-- tenant-isolation.isolation.test.ts) still pass unmodified after it switches to
-- reading this table via getEffectivePlanTierDefaults().
INSERT INTO plan_tier_definition
  (tier, max_tool_calls_per_second, max_concurrent_conversations, max_mcp_connectors, is_dedicated_database, features)
VALUES
  ('Starter', 1, 50, 3, false, '{}'),
  ('Growth', 5, 500, 15, false, '{}'),
  -- "1,000/min -> ~16/s" per the NFR-4a table; max_mcp_connectors NULL means "no cap".
  ('Enterprise', 16, 5000, NULL, true, '{}');
