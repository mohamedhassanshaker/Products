-- Target Architecture Blueprint Phase 5 (BL-35, ADR-0015, LLD §14.5.3/14.5.4) — the
-- composition bridge (owned by agent-platform per LLD §14.5.3) and the two
-- "upgrade consumers" bookkeeping columns on `agent_definition_version`.

CREATE TABLE agent_version_skill (
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  agent_definition_version_id uuid NOT NULL REFERENCES agent_definition_version (id),
  skill_id uuid NOT NULL REFERENCES skill (id),
  skill_version_id uuid NOT NULL REFERENCES skill_version (id),
  ordinal smallint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, agent_definition_version_id, skill_id)
);
CREATE INDEX agent_version_skill_tenant_skill_version_idx ON agent_version_skill (tenant_id, skill_version_id);
CREATE INDEX agent_version_skill_tenant_skill_idx ON agent_version_skill (tenant_id, skill_id);

-- ADR-0015 §2.4 — "upgrade consumers" generates a new Draft per stale consumer,
-- recording where it came from and what it was upgraded to. Both nullable: every
-- ordinarily-authored version has neither set.
ALTER TABLE agent_definition_version
  ADD COLUMN upgrade_source_version_id uuid,
  ADD COLUMN upgraded_skill_version_id uuid REFERENCES skill_version (id);

-- The database-level expression of ADR-0015's idempotency rule (LLD §14.5.4): two
-- concurrent "Upgrade consumers" runs against the same skill version cannot both
-- create a pending (Draft) upgrade for the same consumer version.
CREATE UNIQUE INDEX agent_definition_version_upgrade_pending_key
  ON agent_definition_version (tenant_id, upgrade_source_version_id, upgraded_skill_version_id)
  WHERE status = 'Draft' AND upgrade_source_version_id IS NOT NULL;
