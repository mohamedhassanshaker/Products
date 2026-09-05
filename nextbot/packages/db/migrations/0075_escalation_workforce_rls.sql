-- Target Architecture Blueprint Phase 13 (BL-45) — RLS for `agent_presence` and
-- `escalation_assignment_log` (LLD §3.2 rule 1), same shape every other tenant-scoped
-- table in this codebase uses.

ALTER TABLE agent_presence ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_presence FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON agent_presence
  USING     (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);

ALTER TABLE escalation_assignment_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE escalation_assignment_log FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON escalation_assignment_log
  USING     (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);
