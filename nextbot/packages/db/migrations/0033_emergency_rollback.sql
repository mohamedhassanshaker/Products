-- Phase 6 (BL-27, ADR-0017) — Emergency rollback: re-promote a previously-Production
-- version directly, bypassing the eval/reviewer/sandbox gate, on the grounds the gate
-- was already satisfied when that exact version was first promoted (ADR-0017 §2.1).
--
-- Additive only: one new enum value on the existing `deployment_action` type (labels
-- this action distinctly from an ordinary `Rollback` — ADR-0017 §2.5's "never
-- indistinguishable" requirement) plus one new nullable FK column on the existing
-- `deployment_history` table (the eligibility query's join target — ADR-0017 §5). No
-- existing row is touched; no data loss.
--
-- `ALTER TYPE ... ADD VALUE` is safe inside this migration's own transaction (this file
-- neither reads nor writes a row using the new value in the same transaction — the
-- Postgres 12+ restriction that matters here is only "don't use the new value in the
-- same transaction that added it").
ALTER TYPE deployment_action ADD VALUE 'EmergencyRollback';

ALTER TABLE deployment_history
  ADD COLUMN agent_definition_version_id uuid REFERENCES agent_definition_version (id);

CREATE INDEX deployment_history_tenant_version_env_idx
  ON deployment_history (tenant_id, agent_definition_version_id, environment);
