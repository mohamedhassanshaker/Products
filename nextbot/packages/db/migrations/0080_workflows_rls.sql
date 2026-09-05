-- Target Architecture Blueprint Phase 15 (BL-47a) — RLS for `workflow`/
-- `workflow_version`, standard single-clause tenant-scoped shape (LLD §3.2 rule 1),
-- same as every other tenant-scoped table in this codebase.

ALTER TABLE workflow ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON workflow
  USING      (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);

ALTER TABLE workflow_version ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_version FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON workflow_version
  USING      (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);
