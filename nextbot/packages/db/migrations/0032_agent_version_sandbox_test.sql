-- Phase 7 (client-feedback-batch item 6) — sandbox-test gate for the
-- Approved -> Production promotion (promotion-policy.ts). Additive only: one new
-- nullable column on the existing `agent_definition_version` table, no existing
-- column altered or dropped, no backfill (every pre-existing row simply has no
-- recorded sandbox test yet, which is the honest, correct state for it — no
-- version created before this migration could have satisfied a gate that didn't
-- exist yet). Genuinely low-risk: no data loss, no default expression to compute
-- against existing rows, RLS already covers the whole row via `agent_definition_version`'s
-- existing tenant-isolation policy (0015_agent_platform_rls.sql) — a new column
-- inherits the same row-level policy automatically, no new RLS statement needed.

ALTER TABLE agent_definition_version
  ADD COLUMN last_sandbox_test_at timestamptz;
