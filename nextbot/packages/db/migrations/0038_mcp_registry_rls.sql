-- Phase 6 (BL-29) — RLS for the four new mcp-registry tables (LLD §3.2 rule 1).

ALTER TABLE mcp_server ENABLE ROW LEVEL SECURITY;
ALTER TABLE mcp_server FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON mcp_server
  USING     (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);

ALTER TABLE mcp_server_version ENABLE ROW LEVEL SECURITY;
ALTER TABLE mcp_server_version FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON mcp_server_version
  USING     (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);

ALTER TABLE mcp_manifest_item ENABLE ROW LEVEL SECURITY;
ALTER TABLE mcp_manifest_item FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON mcp_manifest_item
  USING     (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);

ALTER TABLE mcp_drift_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE mcp_drift_event FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON mcp_drift_event
  USING     (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);
