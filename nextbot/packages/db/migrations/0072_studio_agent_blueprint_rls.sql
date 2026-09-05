-- Target Architecture Blueprint Phase 12 (BL-43) — RLS for `studio_draft` and
-- `agent_blueprint` (LLD §3.2 rule 1), same shape every other tenant-scoped table
-- in this codebase uses.

ALTER TABLE studio_draft ENABLE ROW LEVEL SECURITY;
ALTER TABLE studio_draft FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON studio_draft
  USING     (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);

ALTER TABLE agent_blueprint ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_blueprint FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON agent_blueprint
  USING     (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);
