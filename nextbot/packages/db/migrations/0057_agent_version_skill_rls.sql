-- Target Architecture Blueprint Phase 5 (BL-35) — RLS for `agent_version_skill`,
-- standard single-clause tenant-scoped shape (LLD §3.2 rule 1).

ALTER TABLE agent_version_skill ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_version_skill FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON agent_version_skill
  USING      (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);
