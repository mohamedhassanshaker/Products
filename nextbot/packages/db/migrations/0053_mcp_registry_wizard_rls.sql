-- Phase 3 (BL-34) — RLS for the two new mcp-registry tables (LLD §3.2 rule 1).

ALTER TABLE mcp_environment_binding ENABLE ROW LEVEL SECURITY;
ALTER TABLE mcp_environment_binding FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON mcp_environment_binding
  USING     (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);

ALTER TABLE mcp_enrolment_draft ENABLE ROW LEVEL SECURITY;
ALTER TABLE mcp_enrolment_draft FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON mcp_enrolment_draft
  USING     (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);
